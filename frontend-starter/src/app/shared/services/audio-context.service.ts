import { Injectable } from '@angular/core';

/** Provides the single Web Audio context shared by all studio features. */
@Injectable({ providedIn: 'root' })
export class AudioContextService {
  private context: AudioContext | null = null;

  getOrCreate(): AudioContext {
    if (this.context) {
      return this.context;
    }
    if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') {
      throw new Error('La Web Audio API est indisponible dans ce navigateur.');
    }
    this.context = new AudioContext();
    return this.context;
  }

  close(): Promise<void> {
    if (!this.context || this.context.state === 'closed') {
      return Promise.resolve();
    }
    const context = this.context;
    this.context = null;
    return context.close();
  }
}
