/** Shared transport and mixer state for the studio. */
export interface MixerState {
  selectedTrackId: string | null;
  playingTrackId: string | null;
  position: number;
  isPlaying: boolean;
  masterVolume: number;
  mutedTrackIds: string[];
  soloTrackIds: string[];
}
