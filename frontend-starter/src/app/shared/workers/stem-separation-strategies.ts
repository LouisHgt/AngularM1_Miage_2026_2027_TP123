import * as ort from 'onnxruntime-web';
import {
  SeparationAudio,
  StemProgressCallback,
  StemResult,
  StemSeparationModel,
  StemSeparationStrategy,
} from '../models/stem-separation.model';
import { readCachedModel, writeCachedModel } from './model-cache';
import {
  FRONT_PADDING,
  FULL_FREQUENCY_BINS,
  MODEL_FREQUENCY_BINS,
  SPLIT_FRAMES,
  accumulateWindowEnergy,
  istftLength,
  overlapAddFrames,
  stftFrameCount,
  stftRange,
  type ComplexSpectrogram,
} from './spectrogram';

const MODEL_PROXY_BASE = '/api/models';
const SPLEETER_SAMPLE_RATE = 44100;
const MODEL_CACHE_VERSION = 'v1';

if (typeof self !== 'undefined') {
  ort.env.wasm.wasmPaths = new URL('./ort/', self.location.href).toString();
}

abstract class OnnxStemStrategy implements StemSeparationStrategy {
  abstract readonly mode: StemSeparationModel['mode'];
  abstract readonly label: string;
  protected abstract readonly model: StemSeparationModel;
  protected sessions: ort.InferenceSession[] = [];

  /** Options de création des sessions ; surchargeables par modèle. */
  protected sessionOptions(): ort.InferenceSession.SessionOptions {
    return { executionProviders: ['wasm'] };
  }

  async loadModels(): Promise<void> {
    if (this.model.modelUrls.some((url) => !url)) {
      throw new Error(`Les artefacts du modèle ${this.label.toLowerCase()} ne sont pas configurés.`);
    }

    this.sessions = [];
    for (const [index, url] of this.model.modelUrls.entries()) {
      const cacheKey = `${MODEL_CACHE_VERSION}:${this.mode}:${index}:${url}`;
      const bytes = await this.loadModelBytes(url, cacheKey);
      this.sessions.push(
        await ort.InferenceSession.create(bytes, this.sessionOptions()),
      );
    }
  }

  async separate(
    _audio: SeparationAudio,
    _onProgress?: StemProgressCallback,
  ): Promise<ReadonlyArray<StemResult>> {
    throw new Error(
      `Les tenseurs du modèle ${this.label} sont chargés, mais son prétraitement audio n'est pas encore implémenté.`,
    );
  }

  getTensorSummary(): string {
    return this.sessions
      .map(
        (session, index) =>
          `modèle ${index + 1}: entrées [${Object.keys(session.inputMetadata).join(', ')}], sorties [${Object.keys(session.outputMetadata).join(', ')}]`,
      )
      .join(' ; ');
  }

  async validateModelContract(): Promise<string> {
    const summaries: string[] = [];
    for (const [index, session] of this.sessions.entries()) {
      const input = session.inputMetadata[0];
      if (!input?.isTensor || input.type !== 'float32' || input.shape.length !== 4) {
        throw new Error(`Le modèle ${index + 1} n'a pas le contrat audio attendu.`);
      }

      const dimensions: number[] = input.shape.map(
        (dimension: number | string, dimensionIndex: number): number => {
        if (typeof dimension === 'number') {
          return dimension;
        }
        if (dimensionIndex === 1) {
          return 1;
        }
        throw new Error(`Dimension dynamique inattendue dans le modèle ${index + 1}.`);
        },
      );
      const inputSize = dimensions.reduce((total: number, dimension: number) => total * dimension, 1);
      const tensor = new ort.Tensor('float32', new Float32Array(inputSize), dimensions);
      const outputs = await session.run({ [session.inputNames[0]]: tensor });
      const output = outputs[session.outputNames[0]];
      if (!output || output.type !== 'float32' || output.dims.length !== 4) {
        throw new Error(`La sortie du modèle ${index + 1} est incompatible.`);
      }
      summaries.push(`modèle ${index + 1}: sonde OK (${output.dims.join('×')})`);
    }
    return summaries.join(' ; ');
  }

  private async loadModelBytes(url: string, cacheKey: string): Promise<ArrayBuffer> {
    try {
      const cached = await readCachedModel(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error) {
      console.warn('[StemSeparation] Lecture du cache impossible, téléchargement utilisé.', error);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Le modèle IA est indisponible (${response.status}).`);
    }
    const bytes = await response.arrayBuffer();

    try {
      await writeCachedModel(cacheKey, bytes.slice(0));
    } catch (error) {
      console.warn('[StemSeparation] Modèle chargé mais non mis en cache.', error);
    }
    return bytes;
  }
}

/** Taille de segment du modèle htdemucs exporté : 7,8 s à 44 100 Hz. */
export const DEMUCS_SEGMENT_SAMPLES = 343980;
/** Chevauchement entre segments, fondu par une fenêtre triangulaire. */
const DEMUCS_OVERLAP = 0.25;
/** Ordre des sorties de htdemucs. */
const DEMUCS_STEM_ORDER: StemResult['name'][] = ['drums', 'bass', 'other', 'vocals'];

export class DemucsStrategy extends OnnxStemStrategy {
  readonly mode = 'quality' as const;
  readonly label = 'Qualité';
  protected readonly model = {
    mode: this.mode,
    label: this.label,
    description: `Demucs v4 monolithique, une session ONNX et quatre sorties.`,
    modelUrls: [`${MODEL_PROXY_BASE}/htdemucs.onnx`],
  };

  /**
   * Les optimisations de graphe d'ONNX Runtime dupliquent les poids (316 Mo) et
   * dépassent la mémoire WASM (`std::bad_alloc` à la création de la session,
   * reproduit en Node). Sans optimisation, la session se crée (~1,4 Go) et l'inférence passe.
   */
  protected override sessionOptions(): ort.InferenceSession.SessionOptions {
    return {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'disabled',
      enableCpuMemArena: false,
      enableMemPattern: false,
    };
  }

  /** Vérifie les métadonnées sans exécuter le modèle (une inférence de sonde coûterait plusieurs secondes). */
  override async validateModelContract(): Promise<string> {
    const session = this.sessions[0];
    const input = session?.inputMetadata[0];
    const shape = input?.isTensor ? input.shape : [];
    if (
      !input?.isTensor ||
      input.type !== 'float32' ||
      shape.length !== 3 ||
      shape[1] !== 2 ||
      shape[2] !== DEMUCS_SEGMENT_SAMPLES
    ) {
      throw new Error(
        `Le modèle Demucs n'a pas le contrat attendu [1, 2, ${DEMUCS_SEGMENT_SAMPLES}] (reçu : [${shape.join(', ')}]).`,
      );
    }
    return `Demucs : contrat vérifié, segments de ${DEMUCS_SEGMENT_SAMPLES} échantillons.`;
  }

  /**
   * Séparation par segments de 7,8 s avec 25 % de chevauchement et fondu triangulaire.
   * Le signal est normalisé (moyenne/écart-type du mono) comme à l'entraînement, puis
   * dénormalisé en sortie. Le morceau entier est traité.
   */
  override async separate(
    audio: SeparationAudio,
    onProgress: StemProgressCallback = () => undefined,
  ): Promise<ReadonlyArray<StemResult>> {
    const session = this.sessions[0];
    if (!session) {
      throw new Error('Le modèle Demucs doit être chargé avant la séparation.');
    }
    let lastProgress = 0;
    const report = (progress: number, message: string): void => {
      lastProgress = Math.max(lastProgress, Math.min(99, Math.round(progress * 10) / 10));
      onProgress(lastProgress, message);
    };

    report(30, "Préparation de l'audio (stéréo, 44 100 Hz)…");
    const resampled = resampleStereo(
      normalizeStereo(audio.channels),
      audio.sampleRate,
      SPLEETER_SAMPLE_RATE,
    );
    if (resampled[1].length !== resampled[0].length) {
      throw new Error('Les deux canaux audio ont des longueurs différentes.');
    }
    const channels = resampled;
    const length = channels[0].length;

    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += (channels[0][index] + channels[1][index]) / 2;
    }
    const mean = sum / length;
    let variance = 0;
    for (let index = 0; index < length; index += 1) {
      const deviation = (channels[0][index] + channels[1][index]) / 2 - mean;
      variance += deviation * deviation;
    }
    const deviation = Math.max(Math.sqrt(variance / length), 1e-8);

    const stride = Math.floor(DEMUCS_SEGMENT_SAMPLES * (1 - DEMUCS_OVERLAP));
    const segmentCount = Math.max(1, Math.ceil((length - DEMUCS_SEGMENT_SAMPLES) / stride) + 1);
    report(
      33,
      `Audio prêt : ${(length / SPLEETER_SAMPLE_RATE).toFixed(1)} s, ${segmentCount} segment(s).`,
    );

    const weightWindow = new Float32Array(DEMUCS_SEGMENT_SAMPLES);
    const half = Math.floor(DEMUCS_SEGMENT_SAMPLES / 2);
    for (let index = 0; index < DEMUCS_SEGMENT_SAMPLES; index += 1) {
      weightWindow[index] =
        index < half ? index + 1 : DEMUCS_SEGMENT_SAMPLES - index;
    }
    const accumulators = DEMUCS_STEM_ORDER.map(() => [
      new Float32Array(length),
      new Float32Array(length),
    ]);
    const weightSum = new Float32Array(length);

    for (let segment = 0; segment < segmentCount; segment += 1) {
      const start = segment * stride;
      const valid = Math.min(DEMUCS_SEGMENT_SAMPLES, length - start);
      const label = `Segment ${segment + 1}/${segmentCount}`;
      const at = (fraction: number): number => 35 + (55 * (segment + fraction)) / segmentCount;

      report(at(0), `${label} : préparation de l'entrée…`);
      const inputData = new Float32Array(2 * DEMUCS_SEGMENT_SAMPLES);
      for (let channel = 0; channel < 2; channel += 1) {
        for (let index = 0; index < valid; index += 1) {
          inputData[channel * DEMUCS_SEGMENT_SAMPLES + index] =
            (channels[channel][start + index] - mean) / deviation;
        }
      }
      const input = new ort.Tensor('float32', inputData, [1, 2, DEMUCS_SEGMENT_SAMPLES]);
      const outputs: ort.Tensor[] = [];
      try {
        report(at(0.1), `${label} : inférence Demucs (peut prendre plusieurs dizaines de secondes)…`);
        const result = await session.run({ [session.inputNames[0]]: input });
        for (const output of Object.values(result)) {
          outputs.push(output);
        }
        const value = result[session.outputNames[0]];
        if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)) {
          throw new Error('La sortie Demucs n\'est pas un tenseur float32.');
        }
        if (value.data.length !== 4 * 2 * DEMUCS_SEGMENT_SAMPLES) {
          throw new Error('La sortie Demucs a une taille inattendue.');
        }
        if (value.data.some((sample) => !Number.isFinite(sample))) {
          throw new Error('La sortie Demucs contient des valeurs invalides.');
        }

        report(at(0.9), `${label} : assemblage du segment…`);
        for (let stem = 0; stem < 4; stem += 1) {
          for (let channel = 0; channel < 2; channel += 1) {
            const base = (stem * 2 + channel) * DEMUCS_SEGMENT_SAMPLES;
            const target = accumulators[stem][channel];
            for (let index = 0; index < valid; index += 1) {
              target[start + index] += value.data[base + index] * weightWindow[index];
            }
          }
        }
        for (let index = 0; index < valid; index += 1) {
          weightSum[start + index] += weightWindow[index];
        }
      } finally {
        input.dispose();
        for (const output of outputs) {
          output.dispose();
        }
      }
    }

    report(91, 'Assemblage du résultat : dénormalisation…');
    const results: StemResult[] = DEMUCS_STEM_ORDER.map((name) => ({
      name,
      channels: [],
      sampleRate: SPLEETER_SAMPLE_RATE,
    }));
    for (let stem = 0; stem < 4; stem += 1) {
      for (let channel = 0; channel < 2; channel += 1) {
        const accumulator = accumulators[stem][channel];
        const samples = new Float32Array(length);
        for (let index = 0; index < length; index += 1) {
          samples[index] =
            weightSum[index] > 0 ? (accumulator[index] / weightSum[index]) * deviation + mean : 0;
        }
        accumulators[stem][channel] = new Float32Array(0);
        results[stem].channels.push(samples);
      }
    }
    report(95, 'Stems assemblés.');
    return results;
  }
}

export class SpleeterStrategy extends OnnxStemStrategy {
  readonly mode = 'fast' as const;
  readonly label = 'Rapide';
  protected readonly model = {
    mode: this.mode,
    label: this.label,
    description: 'Spleeter 4 stems, quatre sessions ONNX et reconstruction iSTFT.',
    modelUrls: [
      `${MODEL_PROXY_BASE}/vocals.fp16.onnx`,
      `${MODEL_PROXY_BASE}/drums.fp16.onnx`,
      `${MODEL_PROXY_BASE}/bass.fp16.onnx`,
      `${MODEL_PROXY_BASE}/other.fp16.onnx`,
    ],
  };

  /**
   * Séparation par blocs : chaque bloc couvre au plus `SPLIT_FRAMES` (512) trames STFT
   * et correspond exactement à un « split » du tenseur `[2, 1, 512, 1024]` (les splits
   * sont indépendants dans Spleeter). Aucun spectrogramme ni tenseur global n'est créé ;
   * seuls les accumulateurs de sortie (un par stem et par canal) ont la taille du morceau.
   * Le chevauchement des fenêtres entre blocs est géré par overlap-add, puis normalisé
   * une seule fois par l'énergie de fenêtre.
   */
  override async separate(
    audio: SeparationAudio,
    onProgress: StemProgressCallback = () => undefined,
  ): Promise<ReadonlyArray<StemResult>> {
    if (this.sessions.length !== 4) {
      throw new Error('Les quatre modèles Spleeter doivent être chargés avant la séparation.');
    }
    let lastProgress = 0;
    const report = (progress: number, message: string): void => {
      lastProgress = Math.max(lastProgress, Math.min(99, Math.round(progress * 10) / 10));
      onProgress(lastProgress, message);
    };

    report(30, "Préparation de l'audio (stéréo, 44 100 Hz)…");
    const channels = resampleStereo(
      normalizeStereo(audio.channels),
      audio.sampleRate,
      SPLEETER_SAMPLE_RATE,
    );
    const sampleCount = channels[0].length;
    if (channels[1].length !== sampleCount) {
      throw new Error('Les deux canaux audio ont des longueurs différentes.');
    }
    const frames = stftFrameCount(sampleCount);
    const blockCount = Math.ceil(frames / SPLIT_FRAMES);
    const outputLength = istftLength(frames);
    report(
      33,
      `Audio prêt : ${(sampleCount / SPLEETER_SAMPLE_RATE).toFixed(1)} s, ${frames} trames, ${blockCount} bloc(s).`,
    );

    const accumulators = STEM_NAMES.map(() => [
      new Float32Array(outputLength),
      new Float32Array(outputLength),
    ]);
    const maskedReal = new Float32Array(SPLIT_FRAMES * FULL_FREQUENCY_BINS);
    const maskedImaginary = new Float32Array(SPLIT_FRAMES * FULL_FREQUENCY_BINS);
    const blocksStart = 35;
    const blocksSpan = 55;

    for (let block = 0; block < blockCount; block += 1) {
      const firstFrame = block * SPLIT_FRAMES;
      const blockFrames = Math.min(SPLIT_FRAMES, frames - firstFrame);
      const label = `Bloc ${block + 1}/${blockCount}`;
      const at = (fraction: number): number =>
        blocksStart + (blocksSpan * (block + fraction)) / blockCount;

      report(at(0), `${label} : STFT…`);
      const spectrograms = channels.map((channel) => stftRange(channel, firstFrame, blockFrames));

      report(at(0.15), `${label} : préparation du tenseur d'entrée…`);
      const inputData = new Float32Array(2 * SPLIT_FRAMES * MODEL_FREQUENCY_BINS);
      for (let channel = 0; channel < 2; channel += 1) {
        const spectrogram = spectrograms[channel];
        for (let frame = 0; frame < blockFrames; frame += 1) {
          for (let bin = 0; bin < MODEL_FREQUENCY_BINS; bin += 1) {
            inputData[(channel * SPLIT_FRAMES + frame) * MODEL_FREQUENCY_BINS + bin] = magnitude(
              spectrogram,
              frame,
              bin,
            );
          }
        }
      }
      const input = new ort.Tensor('float32', inputData, [
        2,
        1,
        SPLIT_FRAMES,
        MODEL_FREQUENCY_BINS,
      ]);

      const estimates: Float32Array[] = [];
      const outputsToDispose: ort.Tensor[] = [];
      try {
        for (const [index, session] of this.sessions.entries()) {
          report(
            at(0.2 + index * 0.125),
            `${label} : inférence ${STEM_NAMES[index]} (${index + 1}/4)…`,
          );
          const outputs = await session.run({ [session.inputNames[0]]: input });
          for (const output of Object.values(outputs)) {
            outputsToDispose.push(output);
          }
          const value = outputs[session.outputNames[0]];
          if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)) {
            throw new Error(`La sortie Spleeter ${index + 1} n'est pas un tenseur float32.`);
          }
          if (value.data.length !== inputData.length) {
            throw new Error(`La sortie Spleeter ${index + 1} a une taille inattendue.`);
          }
          if (value.data.some((sample) => !Number.isFinite(sample))) {
            throw new Error(`La sortie Spleeter ${index + 1} contient des valeurs invalides.`);
          }
          estimates.push(value.data);
        }

        report(at(0.7), `${label} : calcul des masques…`);
        const frameMeans = estimates.map((estimate) => frameMeansOf(estimate, blockFrames));

        for (let stemIndex = 0; stemIndex < 4; stemIndex += 1) {
          for (let channel = 0; channel < 2; channel += 1) {
            const spectrogram = spectrograms[channel];
            for (let frame = 0; frame < blockFrames; frame += 1) {
              const modelBase = (channel * SPLIT_FRAMES + frame) * MODEL_FREQUENCY_BINS;
              const means = frameMeans.map((mean) => mean[channel * SPLIT_FRAMES + frame]);
              for (let bin = 0; bin < FULL_FREQUENCY_BINS; bin += 1) {
                let denominator = 1e-10;
                let own = 0;
                for (let other = 0; other < 4; other += 1) {
                  const value =
                    bin < MODEL_FREQUENCY_BINS ? estimates[other][modelBase + bin] : means[other];
                  denominator += value * value;
                  if (other === stemIndex) {
                    own = value;
                  }
                }
                const mask = (own * own + 1e-10 / 4) / denominator;
                const source = frame * FULL_FREQUENCY_BINS + bin;
                maskedReal[source] = spectrogram.real[source] * mask;
                maskedImaginary[source] = spectrogram.imaginary[source] * mask;
              }
            }
            report(
              at(0.8 + ((stemIndex * 2 + channel + 1) / 8) * 0.2),
              `${label} : iSTFT ${STEM_NAMES[stemIndex]} (canal ${channel + 1}/2)…`,
            );
            overlapAddFrames(
              {
                real: maskedReal,
                imaginary: maskedImaginary,
                frequencyBins: FULL_FREQUENCY_BINS,
                frames: blockFrames,
              },
              firstFrame,
              accumulators[stemIndex][channel],
            );
          }
        }
      } finally {
        // Libération explicite des tenseurs natifs à chaque bloc, y compris en cas d'erreur.
        input.dispose();
        for (const output of outputsToDispose) {
          output.dispose();
        }
      }
    }

    report(91, 'Assemblage du résultat : normalisation des chevauchements…');
    const weights = accumulateWindowEnergy(frames);
    const results: StemResult[] = STEM_NAMES.map((name) => ({
      name,
      channels: [],
      sampleRate: SPLEETER_SAMPLE_RATE,
    }));
    for (let stemIndex = 0; stemIndex < 4; stemIndex += 1) {
      for (let channel = 0; channel < 2; channel += 1) {
        const accumulator = accumulators[stemIndex][channel];
        const samples = new Float32Array(sampleCount);
        for (let index = 0; index < sampleCount; index += 1) {
          const padded = FRONT_PADDING + index;
          samples[index] = weights[padded] > 1e-8 ? accumulator[padded] / weights[padded] : 0;
        }
        accumulators[stemIndex][channel] = new Float32Array(0);
        results[stemIndex].channels.push(samples);
      }
      report(92 + stemIndex, `Assemblage du résultat : ${STEM_NAMES[stemIndex]}…`);
    }
    report(95, 'Stems assemblés.');
    return results;
  }
}

const STEM_NAMES: StemResult['name'][] = ['vocals', 'drums', 'bass', 'other'];

function normalizeStereo(channels: readonly Float32Array[]): [Float32Array, Float32Array] {
  if (channels.length === 0 || !channels[0]) {
    throw new Error('Aucun canal audio à séparer.');
  }
  if (channels.length === 1) {
    return [channels[0], channels[0].slice()];
  }
  return [channels[0], channels[1]];
}

function resampleStereo(
  channels: [Float32Array, Float32Array],
  sourceRate: number,
  targetRate: number,
): [Float32Array, Float32Array] {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) {
    throw new Error("La fréquence d'échantillonnage de l'audio est invalide.");
  }
  if (sourceRate === targetRate) {
    return channels;
  }

  return [
    resampleChannel(channels[0], sourceRate, targetRate),
    resampleChannel(channels[1], sourceRate, targetRate),
  ];
}

function resampleChannel(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  const targetLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
  const result = new Float32Array(targetLength);
  const ratio = sourceRate / targetRate;

  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = sourcePosition - left;
    result[index] = (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
  }
  return result;
}

function magnitude(spectrogram: ComplexSpectrogram, frame: number, bin: number): number {
  const index = frame * spectrogram.frequencyBins + bin;
  return Math.hypot(spectrogram.real[index], spectrogram.imaginary[index]);
}

/** Moyenne des 1024 bins du modèle pour chaque (canal, trame) : sert aux bins 1024..2048. */
function frameMeansOf(estimate: Float32Array, blockFrames: number): Float32Array {
  const means = new Float32Array(2 * SPLIT_FRAMES);
  for (let channel = 0; channel < 2; channel += 1) {
    for (let frame = 0; frame < blockFrames; frame += 1) {
      const base = (channel * SPLIT_FRAMES + frame) * MODEL_FREQUENCY_BINS;
      let sum = 0;
      for (let bin = 0; bin < MODEL_FREQUENCY_BINS; bin += 1) {
        sum += estimate[base + bin];
      }
      means[channel * SPLIT_FRAMES + frame] = sum / MODEL_FREQUENCY_BINS;
    }
  }
  return means;
}

export function createStemSeparationStrategy(
  mode: StemSeparationModel['mode'],
): StemSeparationStrategy {
  return mode === 'quality' ? new DemucsStrategy() : new SpleeterStrategy();
}
