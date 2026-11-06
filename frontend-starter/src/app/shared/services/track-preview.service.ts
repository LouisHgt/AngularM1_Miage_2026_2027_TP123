import { Injectable, inject, signal } from '@angular/core';
import { StudioTrack } from '../models/studio-track.model';
import { AudioContextService } from './audio-context.service';

/**
 * Écoute temporaire d'une piste à la fois (validation de la séparation).
 * Sera remplacé par le moteur de lecture synchronisé de la mission A1.
 */
@Injectable({ providedIn: 'root' })
export class TrackPreviewService {
  private readonly audioContext = inject(AudioContextService);
  private source: AudioBufferSourceNode | null = null;

  readonly playingId = signal<string | null>(null);
  readonly error = signal('');

  async toggle(track: StudioTrack): Promise<void> {
    if (this.playingId() === track.id) {
      this.stop();
      return;
    }
    this.stop();
    this.error.set('');
    try {
      const context = this.audioContext.getOrCreate();
      if (context.state === 'suspended') {
        await context.resume();
      }
      const source = context.createBufferSource();
      source.buffer = track.buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (this.source === source) {
          this.source = null;
          this.playingId.set(null);
        }
      };
      this.source = source;
      this.playingId.set(track.id);
      source.start();
    } catch (error) {
      this.source = null;
      this.playingId.set(null);
      this.error.set(
        error instanceof Error ? error.message : 'La lecture de la piste a échoué.',
      );
    }
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    this.playingId.set(null);
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // La source était déjà arrêtée.
      }
      source.disconnect();
    }
  }
}
