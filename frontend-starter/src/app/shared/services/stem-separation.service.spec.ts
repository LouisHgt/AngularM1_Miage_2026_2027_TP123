import { AudioContextService } from './audio-context.service';
import { StudioStore } from './studio.store';
import { StemSeparationService } from './stem-separation.service';

describe('StemSeparationService', () => {
  it('refuse une exécution sans Web Worker au lieu de simuler une séparation', async () => {
    const store = new StudioStore();
    store.addTrack({
      id: 'track-1',
      name: 'Original',
      kind: 'original',
      buffer: {} as AudioBuffer,
    });
    const service = new StemSeparationService({} as AudioContextService, store);

    await expect(service.separate('track-1', 'fast')).rejects.toThrow(
      'Les Web Workers sont indisponibles dans ce navigateur.',
    );
    expect(store.tracks()).toHaveLength(1);
  });

  it('signale une piste inconnue', async () => {
    const service = new StemSeparationService({} as AudioContextService, new StudioStore());

    await expect(service.separate('unknown', 'quality')).rejects.toThrow(
      'La piste à séparer est introuvable',
    );
  });
});
