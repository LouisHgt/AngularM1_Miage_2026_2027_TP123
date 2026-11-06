import type * as ort from 'onnxruntime-web';
import { StemWorkerMessage } from '../models/stem-separation.model';
import { runSeparation } from './stem-separation-runner';
import { SpleeterStrategy } from './stem-separation-strategies';

const WEIGHTS = [0.5, 0.3, 0.15, 0.05];
const SAMPLE_RATE = 44100;

interface Counters {
  runs: number;
  inputDisposed: number;
  outputsCreated: number;
  outputsDisposed: number;
  dims: number[][];
}

/** Session simulée : estimation = poids × entrée, donc la somme des masques vaut 1. */
function fakeSession(weight: number, counters: Counters, corrupt = false): ort.InferenceSession {
  return {
    inputNames: ['x'],
    outputNames: ['y'],
    run: async (feeds: Record<string, ort.Tensor>) => {
      const input = feeds['x'];
      counters.runs += 1;
      counters.dims.push([...input.dims]);
      if (!(input as { __wrapped?: boolean }).__wrapped) {
        const original = input.dispose.bind(input);
        input.dispose = () => {
          counters.inputDisposed += 1;
          original();
        };
        (input as { __wrapped?: boolean }).__wrapped = true;
      }
      const data = Float32Array.from(input.data as Float32Array, (value) => value * weight);
      if (corrupt) {
        data[0] = Number.NaN;
      }
      counters.outputsCreated += 1;
      return {
        y: {
          type: 'float32',
          data,
          dims: [...input.dims],
          dispose: () => {
            counters.outputsDisposed += 1;
          },
        },
      };
    },
  } as unknown as ort.InferenceSession;
}

class TestableSpleeter extends SpleeterStrategy {
  install(sessions: ort.InferenceSession[]): void {
    this.sessions = sessions;
  }
}

function newCounters(): Counters {
  return { runs: 0, inputDisposed: 0, outputsCreated: 0, outputsDisposed: 0, dims: [] };
}

function strategyWith(counters: Counters, corruptIndex = -1): TestableSpleeter {
  const strategy = new TestableSpleeter();
  strategy.install(WEIGHTS.map((weight, index) => fakeSession(weight, counters, index === corruptIndex)));
  return strategy;
}

function tone(seconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, index) =>
    0.5 * Math.sin((2 * Math.PI * 220 * index) / sampleRate) +
    0.2 * Math.sin((2 * Math.PI * 1760 * index) / sampleRate),
  );
}

describe('SpleeterStrategy.separate (traitement par blocs)', () => {
  it('traite un fichier de quelques secondes en un bloc et reconstruit le signal', async () => {
    const counters = newCounters();
    const source = tone(3);
    const progress: Array<[number, string]> = [];

    const stems = await strategyWith(counters).separate(
      { sampleRate: SAMPLE_RATE, channels: [source, source] },
      (value, message) => progress.push([value, message]),
    );

    expect(counters.runs).toBe(4);
    expect(counters.dims[0]).toEqual([2, 1, 512, 1024]);
    expect(stems.map((stem) => stem.name)).toEqual(['vocals', 'drums', 'bass', 'other']);
    let maxError = 0;
    for (let index = 0; index < source.length; index += 1) {
      const sum = stems.reduce((total, stem) => total + stem.channels[0][index], 0);
      maxError = Math.max(maxError, Math.abs(sum - source[index]));
    }
    expect(maxError).toBeLessThan(0.002);

    const messages = progress.map(([, message]) => message).join('|');
    for (const step of ['Préparation', 'STFT', 'tenseur', 'inférence vocals', 'masques', 'iSTFT', 'Assemblage']) {
      expect(messages).toContain(step);
    }
  });

  it('enchaîne plusieurs blocs sans coupure, en conservant la longueur et sans fuite', async () => {
    const counters = newCounters();
    const source = tone(13); // ≈ 560 trames → 2 blocs
    const progress: number[] = [];

    const stems = await strategyWith(counters).separate(
      { sampleRate: SAMPLE_RATE, channels: [source, source.map((v) => -v)] },
      (value) => progress.push(value),
    );

    expect(counters.runs).toBe(8);
    expect(counters.inputDisposed).toBe(2);
    expect(counters.outputsDisposed).toBe(counters.outputsCreated);
    for (const stem of stems) {
      expect(stem.channels.length).toBe(2);
      for (const channel of stem.channels) {
        expect(channel.length).toBe(source.length);
        expect(channel.every((sample) => Number.isFinite(sample))).toBe(true);
      }
    }
    // Frontière de bloc : 512 trames × 1024 − 3072 échantillons ; pas de coupure ni de double gain.
    let maxError = 0;
    for (let index = 0; index < source.length; index += 1) {
      const left = stems.reduce((total, stem) => total + stem.channels[0][index], 0);
      const right = stems.reduce((total, stem) => total + stem.channels[1][index], 0);
      maxError = Math.max(maxError, Math.abs(left - source[index]), Math.abs(right + source[index]));
    }
    expect(maxError).toBeLessThan(0.002);

    expect(progress.length).toBeGreaterThan(20);
    expect(progress.every((value, i) => i === 0 || value >= progress[i - 1])).toBe(true);
    expect(progress.at(-1)).toBeLessThanOrEqual(95);
  });

  it('rééchantillonne vers 44 100 Hz et ajuste la longueur', async () => {
    const stems = await strategyWith(newCounters()).separate({
      sampleRate: 48000,
      channels: [tone(1, 48000)],
    });
    expect(stems[0].sampleRate).toBe(44100);
    expect(stems[0].channels[0].length).toBe(44100);
    expect(stems[0].channels.length).toBe(2);
  });

  it('refuse explicitement une sortie contenant NaN et libère les tenseurs', async () => {
    const counters = newCounters();
    await expect(
      strategyWith(counters, 1).separate({ sampleRate: SAMPLE_RATE, channels: [tone(1)] }),
    ).rejects.toThrow('valeurs invalides');
    expect(counters.inputDisposed).toBe(1);
    expect(counters.outputsDisposed).toBe(counters.outputsCreated);
  });

  it('refuse une fréquence d’échantillonnage invalide', async () => {
    await expect(
      strategyWith(newCounters()).separate({ sampleRate: 0, channels: [tone(1)] }),
    ).rejects.toThrow('fréquence');
  });
});

describe('runSeparation (Worker)', () => {
  it('relaie la progression intermédiaire puis le résultat', async () => {
    const messages: StemWorkerMessage[] = [];
    const strategy = strategyWith(newCounters());
    strategy.loadModels = async () => undefined;
    strategy.validateModelContract = async () => 'sonde OK';
    strategy.getTensorSummary = () => 'sessions simulées';

    await runSeparation(
      { type: 'separate', mode: 'fast', sampleRate: SAMPLE_RATE, channels: [tone(2)] },
      () => strategy,
      (message) => messages.push(message),
    );

    const progress = messages.filter((m) => m.type === 'progress');
    const values = progress.map((m) => (m as { progress: number }).progress);
    expect(values.filter((value) => value > 30 && value < 95).length).toBeGreaterThan(5);
    expect(values.every((value, i) => i === 0 || value >= values[i - 1])).toBe(true);
    expect(messages.at(-1)?.type).toBe('complete');
  });

  it('signale explicitement une erreur', async () => {
    const messages: StemWorkerMessage[] = [];
    const strategy = new TestableSpleeter();
    strategy.loadModels = async () => {
      throw new Error('modèle indisponible');
    };
    await runSeparation(
      { type: 'separate', mode: 'fast', sampleRate: SAMPLE_RATE, channels: [tone(1)] },
      () => strategy,
      (message) => messages.push(message),
    );
    expect(messages.at(-1)).toEqual({ type: 'error', message: 'modèle indisponible' });
  });
});
