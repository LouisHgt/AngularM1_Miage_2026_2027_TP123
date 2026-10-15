import { Injectable, signal } from '@angular/core';
import { MixerState } from '../models/mixer-state.model';
import { StudioTrack } from '../models/studio-track.model';

const INITIAL_MIXER_STATE: MixerState = {
  selectedTrackId: null,
  playingTrackId: null,
  position: 0,
  isPlaying: false,
  masterVolume: 1,
  mutedTrackIds: [],
  soloTrackIds: [],
};

/** Owns the shared in-memory state of an open studio. */
@Injectable({ providedIn: 'root' })
export class StudioStore {
  readonly tracks = signal<StudioTrack[]>([]);
  readonly mixer = signal<MixerState>(INITIAL_MIXER_STATE);

  addTrack(track: StudioTrack): void {
    this.tracks.update((tracks) => {
      const index = tracks.findIndex((item) => item.id === track.id);
      if (index === -1) {
        return [...tracks, track];
      }
      const updated = [...tracks];
      updated[index] = track;
      return updated;
    });
  }

  removeTrack(id: string): void {
    this.tracks.update((tracks) => tracks.filter((track) => track.id !== id));
    this.mixer.update((state) => ({
      ...state,
      selectedTrackId: state.selectedTrackId === id ? null : state.selectedTrackId,
      playingTrackId: state.playingTrackId === id ? null : state.playingTrackId,
      mutedTrackIds: state.mutedTrackIds.filter((trackId) => trackId !== id),
      soloTrackIds: state.soloTrackIds.filter((trackId) => trackId !== id),
    }));
  }
}
