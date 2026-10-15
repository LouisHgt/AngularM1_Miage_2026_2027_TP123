import { StudioTrack } from '../models/studio-track.model';
import { StudioStore } from './studio.store';

const BUFFER = {} as AudioBuffer;

const TRACK: StudioTrack = {
  id: 'track-1',
  name: 'Original',
  kind: 'original',
  buffer: BUFFER,
};

describe('StudioStore', () => {
  it('ajoute et remplace une piste portant le même identifiant', () => {
    const store = new StudioStore();
    store.addTrack(TRACK);
    store.addTrack({ ...TRACK, name: 'Version actualisée' });

    expect(store.tracks()).toHaveLength(1);
    expect(store.tracks()[0].name).toBe('Version actualisée');
  });

  it('supprime une piste et nettoie son état de mixage', () => {
    const store = new StudioStore();
    store.addTrack(TRACK);
    store.mixer.set({
      ...store.mixer(),
      selectedTrackId: TRACK.id,
      playingTrackId: TRACK.id,
      mutedTrackIds: [TRACK.id],
      soloTrackIds: [TRACK.id],
    });

    store.removeTrack(TRACK.id);

    expect(store.tracks()).toEqual([]);
    expect(store.mixer()).toMatchObject({
      selectedTrackId: null,
      playingTrackId: null,
      mutedTrackIds: [],
      soloTrackIds: [],
    });
  });
});
