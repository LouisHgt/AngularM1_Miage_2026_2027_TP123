import { Injectable, signal } from '@angular/core';
import { AudioContextService } from './audio-context.service';
import { StemDraftStorage } from './stem-draft.storage';
import { StudioStore } from './studio.store';
import { StemDraftInfo } from '../models/stem-draft.model';
import { MAX_DRAFTS } from '../storage/stem-draft-codec';
import { StudioTrack } from '../models/studio-track.model';
import {
  StemName,
  StemResult,
  StemSeparationMode,
  StemSeparationModel,
  StemWorkerMessage,
} from '../models/stem-separation.model';

export const STEM_SEPARATION_MODELS: Record<StemSeparationMode, StemSeparationModel> = {
  fast: {
    mode: 'fast',
    label: 'Rapide',
    description: 'Modèle léger, idéal pour tester rapidement un morceau.',
    modelUrls: [
      '/api/models/vocals.fp16.onnx',
      '/api/models/drums.fp16.onnx',
      '/api/models/bass.fp16.onnx',
      '/api/models/other.fp16.onnx',
    ],
  },
  quality: {
    mode: 'quality',
    label: 'Qualité',
    description: 'Modèle plus précis, mais plus long à télécharger et à exécuter.',
    modelUrls: [
      '/api/models/htdemucs.onnx',
    ],
  },
};

const STEM_LABELS: Record<StemName, string> = {
  vocals: 'Voix',
  drums: 'Batterie',
  bass: 'Basse',
  other: 'Autres',
};

const STEM_NAMES = Object.keys(STEM_LABELS) as StemName[];

@Injectable({ providedIn: 'root' })
export class StemSeparationService {
  readonly progress = signal(0);
  readonly status = signal<'idle' | 'running' | 'done' | 'error'>('idle');
  readonly message = signal('');
  /** Brouillon de stems enregistré dans le navigateur pour le morceau ouvert, le cas échéant. */
  readonly draft = signal<StemDraftInfo | null>(null);
  /** Erreur de lecture, d'écriture ou de suppression du brouillon. */
  readonly draftError = signal('');
  /** Information non bloquante, par exemple un ancien brouillon supprimé pour respecter la limite. */
  readonly draftNotice = signal('');

  private worker: Worker | null = null;

  constructor(
    private readonly audioContext: AudioContextService,
    private readonly studio: StudioStore,
    private readonly drafts: StemDraftStorage,
  ) {}

  /** Remet l'état à zéro : à appeler à l'ouverture du studio d'un morceau. */
  reset(): void {
    this.stopWorker();
    this.status.set('idle');
    this.progress.set(0);
    this.message.set('');
    this.draft.set(null);
    this.draftError.set('');
    this.draftNotice.set('');
  }

  separate(trackId: string, mode: StemSeparationMode): Promise<void> {
    const track = this.studio.tracks().find((item) => item.id === trackId);
    if (!track) {
      return Promise.reject(new Error('La piste à séparer est introuvable dans le studio.'));
    }

    const model = STEM_SEPARATION_MODELS[mode];
    if (model.modelUrls.some((url) => !url)) {
      return Promise.reject(
        new Error(`Le modèle ${model.label.toLowerCase()} n'est pas encore configuré.`),
      );
    }
    if (typeof Worker !== 'function') {
      return Promise.reject(new Error('Les Web Workers sont indisponibles dans ce navigateur.'));
    }

    this.stopWorker();
    this.status.set('running');
    this.progress.set(0);
    this.draftError.set('');
    this.draftNotice.set('');
    this.message.set(`Préparation du modèle ${model.label.toLowerCase()}…`);

    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('../workers/stem-separation.worker', import.meta.url),
        { type: 'module' },
      );
      this.worker = worker;

      worker.onmessage = ({ data }: MessageEvent<StemWorkerMessage>) => {
        if (data.type === 'progress') {
          this.progress.set(data.progress);
          this.message.set(data.message);
          return;
        }
        if (data.type === 'error') {
          this.fail(worker, data.message, reject);
          return;
        }

        try {
          this.addStemTracks(track, data.stems);
          this.progress.set(100);
          this.status.set('done');
          this.message.set('Les quatre stems sont disponibles dans le studio.');
          this.stopWorker();
          void this.saveDraft(track.id, mode, data.stems);
          resolve();
        } catch (error) {
          this.fail(worker, error instanceof Error ? error.message : 'Création des stems impossible.', reject);
        }
      };
      worker.onerror = (event) =>
        this.fail(
          worker,
          event.message ? `Erreur du Worker de séparation : ${event.message}` : 'La séparation IA a échoué.',
          reject,
        );

      const channels = Array.from({ length: track.buffer.numberOfChannels }, (_, index) =>
        track.buffer.getChannelData(index).slice(),
      );
      worker.postMessage(
        {
          type: 'separate',
          mode,
          sampleRate: track.buffer.sampleRate,
          channels,
        },
        channels.map((channel) => channel.buffer),
      );
    });
  }

  /**
   * Recharge le brouillon de stems du morceau ouvert, s'il existe.
   * Retourne `false` s'il n'y en a pas ou si le studio a changé de morceau entre-temps.
   */
  async restoreDraft(trackId: string): Promise<boolean> {
    this.draftError.set('');
    let draft;
    try {
      draft = await this.drafts.get(trackId);
    } catch (error) {
      this.reportDraftError('Lecture du brouillon impossible', error);
      return false;
    }
    if (!draft) {
      this.draft.set(null);
      return false;
    }

    const original = this.studio.tracks().find((track) => track.id === trackId && track.kind === 'original');
    if (!original) {
      return false; // Le studio a été fermé ou a changé de morceau pendant la lecture.
    }
    try {
      this.addStemTracks(original, draft.stems);
    } catch (error) {
      this.reportDraftError('Brouillon illisible', error);
      return false;
    }
    this.draft.set({ mode: draft.mode, savedAt: draft.savedAt });
    this.progress.set(100);
    this.status.set('done');
    this.message.set(
      `Brouillon de stems rechargé (${STEM_SEPARATION_MODELS[draft.mode].label.toLowerCase()}).`,
    );
    return true;
  }

  /** Supprime le brouillon du navigateur et retire les stems du studio ouvert. */
  async deleteDraft(trackId: string): Promise<void> {
    this.draftError.set('');
    try {
      await this.drafts.delete(trackId);
    } catch (error) {
      this.reportDraftError('Suppression du brouillon impossible', error);
      return;
    }
    for (const name of STEM_NAMES) {
      this.studio.removeTrack(`${trackId}-${name}`);
    }
    this.draft.set(null);
    this.status.set('idle');
    this.progress.set(0);
    this.message.set('');
  }

  dispose(): void {
    this.stopWorker();
  }

  private addStemTracks(original: StudioTrack, stems: ReadonlyArray<StemResult>): void {
    const context = this.audioContext.getOrCreate();
    for (const stem of stems) {
      const buffer = context.createBuffer(
        stem.channels.length,
        stem.channels[0]?.length ?? 0,
        stem.sampleRate,
      );
      stem.channels.forEach((channel, index) => {
        // copyToChannel copie déjà les données dans l'AudioBuffer : aucune copie intermédiaire.
        buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index);
      });
      this.studio.addTrack({
        id: `${original.id}-${stem.name}`,
        name: `${original.name} — ${STEM_LABELS[stem.name]}`,
        kind: 'stem',
        buffer,
      });
    }
  }

  private async saveDraft(
    trackId: string,
    mode: StemSeparationMode,
    stems: ReadonlyArray<StemResult>,
  ): Promise<void> {
    const savedAt = Date.now();
    try {
      // Les Float32 d'origine sont libérés stem par stem pendant l'encodage 16 bits :
      // à ce stade ils ne servent plus qu'au brouillon (les AudioBuffer ont leur propre copie).
      const evicted = await this.drafts.put({ trackId, mode, savedAt, stems: [...stems] }, true);
      if (evicted.length > 0) {
        this.draftNotice.set(
          `Limite de ${MAX_DRAFTS} brouillons : ${evicted.length} ancien(s) brouillon(s) supprimé(s) automatiquement.`,
        );
      }
      // N'affiche le brouillon que si le studio de ce morceau est toujours ouvert.
      if (this.studio.tracks().some((track) => track.id === trackId && track.kind === 'original')) {
        this.draft.set({ mode, savedAt });
      }
    } catch (error) {
      this.reportDraftError('Stems générés mais brouillon non enregistré', error);
    }
  }

  private reportDraftError(prefix: string, error: unknown): void {
    console.error(`[StemSeparation] ${prefix}`, error);
    const detail = error instanceof Error ? error.message : 'erreur inconnue';
    this.draftError.set(`${prefix} : ${detail}`);
  }

  private fail(worker: Worker, message: string, reject: (reason?: unknown) => void): void {
    this.status.set('error');
    this.message.set(message);
    this.stopWorker();
    reject(new Error(message));
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
