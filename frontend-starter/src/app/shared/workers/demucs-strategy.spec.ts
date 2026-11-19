import type * as ort from 'onnxruntime-web';
import {
  DEMUCS_SEGMENT_SAMPLES,
  DemucsStrategy,
} from './stem-separation-strategies';

const SAMPLE_RATE = 44100;
/** Poids par stem (drums, bass, other, vocals) : leur somme vaut 1. */
const WEIGHTS = [0.4, 0.3, 0.2, 0.1];

interface Counters {
  runs: number;
  inputDisposed: number;
  outputsCreated: number;
  outputsDisposed: number;
}

function fakeSession(counters: Counters, shape: number[] = [1, 2, DEMUCS_SEGMENT_SAMPLES]) {
  return {
    inputNames: ['mix'],
    outputNames: ['stems'],
    inputMetadata: [{ isTensor: true, type: 'float32', shape }],
    run: async (feeds: Record<string, ort.Tensor>) => {
      const input = feeds['mix'];
      counters.runs += 1;
      const original = input.dispose.bind(input);
      input.dispose = () => {
        counters.inputDisposed += 1;
        original();
      };
      const data = input.data as Float32Array;
      const output = new Float32Array(4 * data.length);
      WEIGHTS.forEach((weight, stem) => {
        for (let index = 0; index < data.length; index += 1) {
          output[stem * data.length + index] = data[index] * weight;
        }
      });
      counters.outputsCreated += 1;
      return {
        stems: {
          type: 'float32',
          data: output,
          dims: [1, 4, 2, DEMUCS_SEGMENT_SAMPLES],
          dispose: () => {
            counters.outputsDisposed += 1;
          },
        },
      };
    },
  } as unknown as ort.InferenceSession;
}

class TestableDemucs extends DemucsStrategy {
  install(session: ort.InferenceSession): void {
    this.sessions = [session];
  }
}

function tone(seconds: number): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, index) =>
    0.4 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE),
  );
}

function setup(shape?: number[]) {
  const counters: Counters = { runs: 0, inputDisposed: 0, outputsCreated: 0, outputsDisposed: 0 };
  const strategy = new TestableDemucs();
  strategy.install(fakeSession(counters, shape));
  return { counters, strategy };
}

describe('DemucsStrategy', () => {
  it('sépare un court extrait en un segment et reconstruit le signal', async () => {
    const { counters, strategy } = setup();
    const source = tone(3);
    const stems = await strategy.separate({ sampleRate: SAMPLE_RATE, channels: [source, source] });

    expect(counters.runs).toBe(1);
    expect(stems.map((stem) => stem.name)).toEqual(['drums', 'bass', 'other', 'vocals']);
    let maxError = 0;
    for (let index = 0; index < source.length; index += 1) {
      const sum = stems.reduce((total, stem) => total + stem.channels[0][index], 0);
      maxError = Math.max(maxError, Math.abs(sum - source[index]));
    }
    expect(maxError).toBeLessThan(1e-3);
  });

  it('enchaîne plusieurs segments avec fondu, sans fuite ni NaN', async () => {
    const { counters, strategy } = setup();
    const source = tone(20); // 3 segments avec 25 % de chevauchement
    const progress: number[] = [];
    const stems = await strategy.separate(
      { sampleRate: SAMPLE_RATE, channels: [source, source] },
      (value) => progress.push(value),
    );

    expect(counters.runs).toBeGreaterThan(2);
    expect(counters.inputDisposed).toBe(counters.runs);
    expect(counters.outputsDisposed).toBe(counters.outputsCreated);
    let maxError = 0;
    for (let index = 0; index < source.length; index += 1) {
      const sum = stems.reduce((total, stem) => total + stem.channels[0][index], 0);
      maxError = Math.max(maxError, Math.abs(sum - source[index]));
    }
    expect(maxError).toBeLessThan(1e-3);
    for (const stem of stems) {
      expect(stem.channels[0].length).toBe(source.length);
      expect(stem.channels.every((channel) => channel.every(Number.isFinite))).toBe(true);
    }
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
    expect(progress.at(-1)).toBeLessThanOrEqual(95);
  });

  it('traite toute la durée du morceau, sans limite d’extrait', async () => {
    const { counters, strategy } = setup();
    const source = tone(45);
    const stems = await strategy.separate({ sampleRate: SAMPLE_RATE, channels: [source] });
    expect(stems[0].channels[0].length).toBe(source.length);
    expect(counters.runs).toBe(Math.ceil((source.length - DEMUCS_SEGMENT_SAMPLES) / 257985) + 1);
  });

  it('valide le contrat du modèle sans exécuter d’inférence', async () => {
    const { counters, strategy } = setup();
    await expect(strategy.validateModelContract()).resolves.toContain('contrat vérifié');
    expect(counters.runs).toBe(0);
  });

  it('refuse un modèle au contrat inattendu', async () => {
    const { strategy } = setup([1, 2, 1000]);
    await expect(strategy.validateModelContract()).rejects.toThrow('contrat attendu');
  });

  it('refuse de séparer sans modèle chargé', async () => {
    await expect(
      new DemucsStrategy().separate({ sampleRate: SAMPLE_RATE, channels: [tone(1)] }),
    ).rejects.toThrow('doit être chargé');
  });
});
