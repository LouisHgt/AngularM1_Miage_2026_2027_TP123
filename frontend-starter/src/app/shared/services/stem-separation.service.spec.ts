import { AudioContextService } from './audio-context.service';
import { StemDraftStorage } from './stem-draft.storage';
import { StudioStore } from './studio.store';
import { StemSeparationService } from './stem-separation.service';
import { StemDraft } from '../models/stem-draft.model';
import { StemResult } from '../models/stem-separation.model';

const ORIGINAL = {
  id: 'track-1',
  name: 'Original',
  kind: 'original' as const,
  buffer: {} as AudioBuffer,
};

function stems(): StemResult[] {
  return (['vocals', 'drums', 'bass', 'other'] as const).map((name) => ({
    name,
    sampleRate: 44100,
    channels: [new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])],
  }));
}

function fakeAudioContext(): AudioContextService {
  return {
    getOrCreate: () => ({
      createBuffer: (channels: number, length: number, sampleRate: number) => ({
        numberOfChannels: channels,
        length,
        sampleRate,
        copyToChannel: vi.fn(),
      }),
    }),
  } as unknown as AudioContextService;
}

function fakeStorage(initial: StemDraft | null = null) {
  let stored = initial;
  return {
    get: vi.fn(async () => stored),
    put: vi.fn(async (draft: StemDraft): Promise<string[]> => {
      stored = draft;
      return [];
    }),
    delete: vi.fn(async () => {
      stored = null;
    }),
  };
}

function setup(storage = fakeStorage()) {
  const store = new StudioStore();
  store.addTrack(ORIGINAL);
  const service = new StemSeparationService(
    fakeAudioContext(),
    store,
    storage as unknown as StemDraftStorage,
  );
  return { store, service, storage };
}

describe('StemSeparationService', () => {
  it('refuse une exécution sans Web Worker au lieu de simuler une séparation', async () => {
    const { service, store } = setup();

    await expect(service.separate('track-1', 'fast')).rejects.toThrow(
      'Les Web Workers sont indisponibles dans ce navigateur.',
    );
    expect(store.tracks()).toHaveLength(1);
  });

  it('signale une piste inconnue', async () => {
    const service = new StemSeparationService(
      {} as AudioContextService,
      new StudioStore(),
      fakeStorage() as unknown as StemDraftStorage,
    );

    await expect(service.separate('unknown', 'quality')).rejects.toThrow(
      'La piste à séparer est introuvable',
    );
  });

  describe('brouillon de stems', () => {
    it('recharge le brouillon enregistré et ajoute les quatre stems au studio', async () => {
      const { service, store } = setup(
        fakeStorage({ trackId: 'track-1', mode: 'fast', savedAt: 1000, stems: stems() }),
      );

      await expect(service.restoreDraft('track-1')).resolves.toBe(true);

      expect(store.tracks().map((track) => track.id)).toEqual([
        'track-1',
        'track-1-vocals',
        'track-1-drums',
        'track-1-bass',
        'track-1-other',
      ]);
      expect(service.draft()).toEqual({ mode: 'fast', savedAt: 1000 });
      expect(service.status()).toBe('done');
    });

    it('ne fait rien quand il n’y a pas de brouillon', async () => {
      const { service, store } = setup();
      await expect(service.restoreDraft('track-1')).resolves.toBe(false);
      expect(store.tracks()).toHaveLength(1);
      expect(service.draft()).toBeNull();
    });

    it('n’ajoute pas de stems si le studio a changé de morceau pendant la lecture', async () => {
      const { service, store } = setup(
        fakeStorage({ trackId: 'track-1', mode: 'fast', savedAt: 1, stems: stems() }),
      );
      store.clear();
      await expect(service.restoreDraft('track-1')).resolves.toBe(false);
      expect(store.tracks()).toHaveLength(0);
    });

    it('signale explicitement une erreur de lecture du brouillon', async () => {
      const storage = fakeStorage();
      storage.get.mockRejectedValue(new Error('IndexedDB est indisponible dans ce navigateur.'));
      const { service } = setup(storage);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(service.restoreDraft('track-1')).resolves.toBe(false);
      expect(service.draftError()).toContain('Lecture du brouillon impossible');
      expect(service.draftError()).toContain('IndexedDB est indisponible');
    });

    it('supprime le brouillon et retire les stems du studio', async () => {
      const { service, store, storage } = setup(
        fakeStorage({ trackId: 'track-1', mode: 'fast', savedAt: 1, stems: stems() }),
      );
      await service.restoreDraft('track-1');

      await service.deleteDraft('track-1');

      expect(storage.delete).toHaveBeenCalledWith('track-1');
      expect(store.tracks().map((track) => track.id)).toEqual(['track-1']);
      expect(service.draft()).toBeNull();
      expect(service.status()).toBe('idle');
    });

    it('garde les stems affichés si la suppression échoue', async () => {
      const storage = fakeStorage({ trackId: 'track-1', mode: 'fast', savedAt: 1, stems: stems() });
      const { service, store } = setup(storage);
      await service.restoreDraft('track-1');
      storage.delete.mockRejectedValue(new Error('quota'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await service.deleteDraft('track-1');

      expect(store.tracks()).toHaveLength(5);
      expect(service.draft()).not.toBeNull();
      expect(service.draftError()).toContain('Suppression du brouillon impossible');
    });

    it('prévient quand un ancien brouillon est supprimé pour respecter la limite', async () => {
      const storage = fakeStorage();
      storage.put.mockResolvedValue(['vieux-morceau']);
      const { service } = setup(storage);
      const saveDraft = (service as unknown as {
        saveDraft: (id: string, mode: string, stems: StemResult[]) => Promise<void>;
      }).saveDraft.bind(service);

      await saveDraft('track-1', 'fast', stems());

      expect(service.draftNotice()).toContain('Limite de 3 brouillons');
      expect(service.draft()).not.toBeNull();
    });

    it('signale explicitement un quota dépassé à l’enregistrement', async () => {
      const storage = fakeStorage();
      storage.put.mockRejectedValue(new Error('Quota de stockage du navigateur dépassé (~170 Mo).'));
      const { service } = setup(storage);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const saveDraft = (service as unknown as {
        saveDraft: (id: string, mode: string, stems: StemResult[]) => Promise<void>;
      }).saveDraft.bind(service);

      await saveDraft('track-1', 'fast', stems());

      expect(service.draftError()).toContain('brouillon non enregistré');
      expect(service.draftError()).toContain('Quota de stockage');
      expect(service.draft()).toBeNull();
    });

    it('reset() efface l’état du morceau précédent', async () => {
      const { service } = setup(
        fakeStorage({ trackId: 'track-1', mode: 'quality', savedAt: 1, stems: stems() }),
      );
      await service.restoreDraft('track-1');
      service.reset();
      expect(service.draft()).toBeNull();
      expect(service.status()).toBe('idle');
      expect(service.message()).toBe('');
    });
  });
});
