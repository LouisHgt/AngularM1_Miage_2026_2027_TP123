import { Injectable, inject, signal } from '@angular/core';
import { StudioTrack } from '../models/studio-track.model';
import { AudioContextService } from './audio-context.service';

const POSITION_REFRESH_MS = 200;

/**
 * Écoute temporaire d'une piste à la fois (validation de la séparation), avec
 * position et déplacement dans la piste. Sera remplacé par le moteur de lecture
 * synchronisé de la mission A1.
 */
@Injectable({ providedIn: 'root' })
export class TrackPreviewService {
  private readonly audioContext = inject(AudioContextService);
  private source: AudioBufferSourceNode | null = null;
  private current: StudioTrack | null = null;
  private startedAt = 0;
  private startOffset = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly playingId = signal<string | null>(null);
  /** Position de lecture en secondes. */
  readonly position = signal(0);
  readonly duration = signal(0);
  readonly error = signal('');

  async toggle(track: StudioTrack): Promise<void> {
    if (this.playingId() === track.id) {
      this.stop();
      return;
    }
    await this.play(track, 0);
  }

  /** Déplace la lecture de la piste en cours à `seconds`. */
  async seek(seconds: number): Promise<void> {
    if (!this.current) {
      return;
    }
    const clamped = Math.min(Math.max(0, seconds), this.current.buffer.duration);
    await this.play(this.current, clamped);
  }

  stop(): void {
    this.halt();
    this.current = null;
    this.playingId.set(null);
    this.position.set(0);
    this.duration.set(0);
  }

  private async play(track: StudioTrack, offset: number): Promise<void> {
    this.halt();
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
          this.stop();
        }
      };
      this.source = source;
      this.current = track;
      this.startOffset = offset;
      this.startedAt = context.currentTime;
      this.playingId.set(track.id);
      this.duration.set(track.buffer.duration);
      this.position.set(offset);
      source.start(0, offset);
      this.timer = setInterval(() => {
        const elapsed = this.startOffset + (context.currentTime - this.startedAt);
        this.position.set(Math.min(elapsed, track.buffer.duration));
      }, POSITION_REFRESH_MS);
    } catch (error) {
      this.halt();
      this.current = null;
      this.playingId.set(null);
      this.error.set(
        error instanceof Error ? error.message : 'La lecture de la piste a échoué.',
      );
    }
  }

  /** Arrête la source et le minuteur sans toucher à la piste courante. */
  private halt(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const source = this.source;
    this.source = null;
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
