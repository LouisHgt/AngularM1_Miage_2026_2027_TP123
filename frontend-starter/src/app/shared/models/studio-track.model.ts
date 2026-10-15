/** Audio data loaded and ready for use by the studio. */
export interface StudioTrack {
  id: string;
  name: string;
  kind: 'original' | 'stem' | 'recording';
  buffer: AudioBuffer;
}
