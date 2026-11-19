import { StemDraft } from '../models/stem-draft.model';
import {
  MAX_DRAFTS,
  StoredDraft,
  assertEnoughStorage,
  decodeDraft,
  encodeDraft,
  selectDraftsToEvict,
  storedByteSize,
} from './stem-draft-codec';

function draft(channelValues: number[][]): StemDraft {
  return {
    trackId: 'track-1',
    mode: 'fast',
    savedAt: 123,
    stems: [
      {
        name: 'vocals',
        sampleRate: 44100,
        channels: channelValues.map((values) => Float32Array.from(values)),
      },
    ],
  };
}

describe('codec des brouillons (PCM 16 bits)', () => {
  it('restitue le signal avec une erreur inférieure à la quantification 16 bits', () => {
    const source = Float32Array.from({ length: 2000 }, (_, index) => 0.7 * Math.sin(index / 7));
    const original = draft([Array.from(source)]);

    const restored = decodeDraft(encodeDraft(original));

    expect(restored.trackId).toBe('track-1');
    expect(restored.mode).toBe('fast');
    expect(restored.savedAt).toBe(123);
    let maxError = 0;
    source.forEach((value, index) => {
      maxError = Math.max(maxError, Math.abs(value - restored.stems[0].channels[0][index]));
    });
    expect(maxError).toBeLessThan(0.7 / 32767 + 1e-6);
  });

  it('conserve les pics supérieurs à 1 grâce au facteur d’échelle', () => {
    const restored = decodeDraft(encodeDraft(draft([[1.8, -2.4, 0.5]])));
    expect(restored.stems[0].channels[0][1]).toBeCloseTo(-2.4, 3);
    expect(restored.stems[0].channels[0][0]).toBeCloseTo(1.8, 3);
  });

  it('gère un canal silencieux', () => {
    const restored = decodeDraft(encodeDraft(draft([[0, 0, 0]])));
    expect(Array.from(restored.stems[0].channels[0])).toEqual([0, 0, 0]);
  });

  it('occupe deux fois moins de place que du Float32', () => {
    const stored = encodeDraft(draft([new Array(1000).fill(0.1), new Array(1000).fill(0.2)]));
    expect(storedByteSize(stored)).toBe(2 * 1000 * 2);
  });

  it('libère les canaux source quand on le demande, sans toucher au résultat encodé', () => {
    const source = draft([[0.5, -0.5], [0.25, 0.25]]);
    const stored = encodeDraft(source, true);
    expect(source.stems[0].channels).toHaveLength(0);
    expect(decodeDraft(stored).stems[0].channels[0][0]).toBeCloseTo(0.5, 3);
  });

  it('conserve la source par défaut', () => {
    const source = draft([[0.5]]);
    encodeDraft(source);
    expect(source.stems[0].channels).toHaveLength(1);
  });

  it('refuse d’enregistrer des valeurs invalides', () => {
    expect(() => encodeDraft(draft([[0.1, Number.NaN]]))).toThrow('valeurs invalides');
  });

  it('refuse un format de brouillon inconnu', () => {
    const stored = { ...encodeDraft(draft([[0.1]])), format: 'autre' } as unknown as StoredDraft;
    expect(() => decodeDraft(stored)).toThrow('Format de brouillon inconnu');
  });
});

describe('limite du nombre de brouillons', () => {
  it(`supprime les plus anciens pour garder au plus ${MAX_DRAFTS} brouillons`, () => {
    expect(selectDraftsToEvict(['a', 'b', 'c'], 'nouveau')).toEqual(['a']);
    expect(selectDraftsToEvict(['a', 'b', 'c', 'd'], 'nouveau')).toEqual(['a', 'b']);
  });

  it('ne supprime rien sous la limite', () => {
    expect(selectDraftsToEvict(['a', 'b'], 'nouveau')).toEqual([]);
    expect(selectDraftsToEvict([], 'nouveau')).toEqual([]);
  });

  it('remplacer le brouillon d’un morceau existant ne compte pas comme un ajout', () => {
    expect(selectDraftsToEvict(['a', 'b', 'c'], 'c')).toEqual([]);
  });
});

describe('vérification de l’espace de stockage', () => {
  const MB = 1024 * 1024;

  it('accepte quand l’espace suffit', () => {
    expect(() => assertEnoughStorage(100 * MB, { quota: 1000 * MB, usage: 100 * MB })).not.toThrow();
  });

  it('refuse avec les tailles exactes en Mo', () => {
    expect(() => assertEnoughStorage(170 * MB, { quota: 300 * MB, usage: 200 * MB })).toThrow(
      '~170 Mo nécessaires, 100 Mo disponibles (quota du navigateur : 300 Mo)',
    );
  });

  it('laisse le navigateur trancher quand l’estimation est indisponible', () => {
    expect(() => assertEnoughStorage(10_000 * MB, null)).not.toThrow();
    expect(() => assertEnoughStorage(10_000 * MB, {})).not.toThrow();
  });
});
