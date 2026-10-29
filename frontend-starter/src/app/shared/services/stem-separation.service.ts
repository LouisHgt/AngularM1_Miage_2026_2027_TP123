import { Injectable, signal } from '@angular/core';
import { AudioContextService } from './audio-context.service';
import { StudioStore } from './studio.store';
import {
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
      'https://github.com/LouisHgt/AngularM1_Miage_2026_2027_TP123/releases/download/v1.0-models/vocals.fp16.onnx',
      'https://github.com/LouisHgt/AngularM1_Miage_2026_2027_TP123/releases/download/v1.0-models/drums.fp16.onnx',
      'https://github.com/LouisHgt/AngularM1_Miage_2026_2027_TP123/releases/download/v1.0-models/bass.fp16.onnx',
      'https://github.com/LouisHgt/AngularM1_Miage_2026_2027_TP123/releases/download/v1.0-models/other.fp16.onnx',
    ],
  },
  quality: {
    mode: 'quality',
    label: 'Qualité',
    description: 'Modèle plus précis, mais plus long à télécharger et à exécuter.',
    modelUrls: [
      'https://github.com/LouisHgt/AngularM1_Miage_2026_2027_TP123/releases/download/v1.0-models/htdemucs.onnx',
    ],
  },
};

const STEM_LABELS = {
  vocals: 'Voix',
  drums: 'Batterie',
  bass: 'Basse',
  other: 'Autres',
} as const;

@Injectable({ providedIn: 'root' })
export class StemSeparationService {
  readonly progress = signal(0);
  readonly status = signal<'idle' | 'running' | 'done' | 'error'>('idle');
  readonly message = signal('');

  private worker: Worker | null = null;

  constructor(
    private readonly audioContext: AudioContextService,
    private readonly studio: StudioStore,
  ) {}

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
          const context = this.audioContext.getOrCreate();
          for (const stem of data.stems) {
            const buffer = context.createBuffer(1, stem.samples.length, track.buffer.sampleRate);
            buffer.copyToChannel(new Float32Array(stem.samples), 0);
            this.studio.addTrack({
              id: `${track.id}-${stem.name}`,
              name: `${track.name} — ${STEM_LABELS[stem.name]}`,
              kind: 'stem',
              buffer,
            });
          }
          this.progress.set(100);
          this.status.set('done');
          this.message.set('Les quatre stems sont disponibles dans le studio.');
          this.stopWorker();
          resolve();
        } catch (error) {
          this.fail(worker, error instanceof Error ? error.message : 'Création des stems impossible.', reject);
        }
      };
      worker.onerror = () => this.fail(worker, 'La séparation IA a échoué.', reject);

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

  dispose(): void {
    this.stopWorker();
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
