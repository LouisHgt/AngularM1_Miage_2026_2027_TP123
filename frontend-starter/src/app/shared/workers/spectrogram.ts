export interface ComplexSpectrogram {
  real: Float32Array;
  imaginary: Float32Array;
  frequencyBins: number;
  frames: number;
}

export const FFT_SIZE = 4096;
export const HOP_SIZE = 1024;
export const FULL_FREQUENCY_BINS = FFT_SIZE / 2 + 1;
export const MODEL_FREQUENCY_BINS = 1024;
export const SPLIT_FRAMES = 512;
export const FRONT_PADDING = FFT_SIZE - HOP_SIZE;

function assertStftParameters(frameSize: number, hopSize: number, frontPadding: number): void {
  if (!Number.isInteger(Math.log2(frameSize)) || frameSize < 2) {
    throw new Error('La taille de fenêtre STFT doit être une puissance de deux.');
  }
  if (hopSize <= 0 || hopSize > frameSize) {
    throw new Error('Le pas STFT doit être compris entre 1 et la taille de fenêtre.');
  }
  if (frontPadding < 0) {
    throw new Error('Le padding STFT ne peut pas être négatif.');
  }
}

/** Nombre total de trames STFT pour `sampleCount` échantillons (padding avant inclus). */
export function stftFrameCount(
  sampleCount: number,
  hopSize = HOP_SIZE,
  frontPadding = FRONT_PADDING,
): number {
  return Math.max(1, Math.ceil((frontPadding + sampleCount) / hopSize));
}

/** Longueur (en coordonnées avec padding) du signal reconstruit par `frames` trames. */
export function istftLength(frames: number, frameSize = FFT_SIZE, hopSize = HOP_SIZE): number {
  return Math.max(0, (frames - 1) * hopSize + frameSize);
}

export function stft(
  samples: Float32Array,
  frameSize = FFT_SIZE,
  hopSize = HOP_SIZE,
  frontPadding = frameSize - hopSize,
): ComplexSpectrogram {
  assertStftParameters(frameSize, hopSize, frontPadding);
  const frames = stftFrameCount(samples.length, hopSize, frontPadding);
  return stftRange(samples, 0, frames, frameSize, hopSize, frontPadding);
}

/**
 * STFT limitée à `frameCount` trames à partir de `firstFrame`, calculée directement
 * depuis les échantillons : aucun spectrogramme global n'est alloué.
 */
export function stftRange(
  samples: Float32Array,
  firstFrame: number,
  frameCount: number,
  frameSize = FFT_SIZE,
  hopSize = HOP_SIZE,
  frontPadding = frameSize - hopSize,
): ComplexSpectrogram {
  assertStftParameters(frameSize, hopSize, frontPadding);
  if (firstFrame < 0 || frameCount < 1) {
    throw new Error('La plage de trames STFT est invalide.');
  }

  const frequencyBins = frameSize / 2 + 1;
  const real = new Float32Array(frameCount * frequencyBins);
  const imaginary = new Float32Array(frameCount * frequencyBins);
  const window = periodicHannWindow(frameSize);
  const frameReal = new Float64Array(frameSize);
  const frameImaginary = new Float64Array(frameSize);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = (firstFrame + frame) * hopSize - frontPadding;
    frameImaginary.fill(0);
    for (let sample = 0; sample < frameSize; sample += 1) {
      frameReal[sample] = (samples[offset + sample] ?? 0) * window[sample];
    }
    fft(frameReal, frameImaginary, false);
    for (let bin = 0; bin < frequencyBins; bin += 1) {
      const target = frame * frequencyBins + bin;
      real[target] = frameReal[bin];
      imaginary[target] = frameImaginary[bin];
    }
  }

  return { real, imaginary, frequencyBins, frames: frameCount };
}

/**
 * Ajoute (overlap-add) les trames d'un bloc dans `output`, aux positions globales
 * `(firstFrame + frame) * hop`. La normalisation par l'énergie de fenêtre est faite
 * une seule fois à la fin (voir `accumulateWindowEnergy`), ce qui évite toute double
 * amplification dans les zones de chevauchement entre blocs.
 */
export function overlapAddFrames(
  spectrogram: ComplexSpectrogram,
  firstFrame: number,
  output: Float32Array,
  frameSize = FFT_SIZE,
  hopSize = HOP_SIZE,
): void {
  if (spectrogram.frequencyBins !== frameSize / 2 + 1) {
    throw new Error('Le nombre de fréquences ne correspond pas à la taille STFT.');
  }
  if ((firstFrame + spectrogram.frames - 1) * hopSize + frameSize > output.length) {
    throw new Error('Le tampon de sortie iSTFT est trop court.');
  }

  const window = periodicHannWindow(frameSize);
  const real = new Float64Array(frameSize);
  const imaginary = new Float64Array(frameSize);
  for (let frame = 0; frame < spectrogram.frames; frame += 1) {
    real.fill(0);
    imaginary.fill(0);
    for (let bin = 0; bin < spectrogram.frequencyBins; bin += 1) {
      const source = frame * spectrogram.frequencyBins + bin;
      real[bin] = spectrogram.real[source];
      imaginary[bin] = spectrogram.imaginary[source];
    }
    for (let bin = 1; bin < frameSize / 2; bin += 1) {
      real[frameSize - bin] = real[bin];
      imaginary[frameSize - bin] = -imaginary[bin];
    }
    fft(real, imaginary, true);
    const offset = (firstFrame + frame) * hopSize;
    for (let sample = 0; sample < frameSize; sample += 1) {
      output[offset + sample] += real[sample] * window[sample];
    }
  }
}

/** Somme des fenêtres au carré pour `frames` trames : dénominateur de l'iSTFT. */
export function accumulateWindowEnergy(
  frames: number,
  frameSize = FFT_SIZE,
  hopSize = HOP_SIZE,
): Float32Array {
  const weights = new Float32Array(istftLength(frames, frameSize, hopSize));
  const window = periodicHannWindow(frameSize);
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * hopSize;
    for (let sample = 0; sample < frameSize; sample += 1) {
      weights[offset + sample] += window[sample] ** 2;
    }
  }
  return weights;
}

export function istft(
  spectrogram: ComplexSpectrogram,
  frameSize = FFT_SIZE,
  hopSize = HOP_SIZE,
): Float32Array {
  if (spectrogram.frequencyBins !== frameSize / 2 + 1) {
    throw new Error('Le nombre de fréquences ne correspond pas à la taille STFT.');
  }

  const length = Math.max(0, (spectrogram.frames - 1) * hopSize + frameSize);
  const samples = new Float64Array(length);
  const weights = new Float64Array(length);
  const window = periodicHannWindow(frameSize);

  for (let frame = 0; frame < spectrogram.frames; frame += 1) {
    const real = new Float64Array(frameSize);
    const imaginary = new Float64Array(frameSize);
    for (let bin = 0; bin < spectrogram.frequencyBins; bin += 1) {
      const source = frame * spectrogram.frequencyBins + bin;
      real[bin] = spectrogram.real[source];
      imaginary[bin] = spectrogram.imaginary[source];
    }
    for (let bin = 1; bin < frameSize / 2; bin += 1) {
      real[frameSize - bin] = real[bin];
      imaginary[frameSize - bin] = -imaginary[bin];
    }
    fft(real, imaginary, true);
    const offset = frame * hopSize;
    for (let sample = 0; sample < frameSize; sample += 1) {
      const weight = window[sample] ** 2;
      samples[offset + sample] += real[sample] * window[sample];
      weights[offset + sample] += weight;
    }
  }

  return Float32Array.from(samples, (sample, index) =>
    weights[index] > 1e-8 ? sample / weights[index] : 0,
  );
}

function periodicHannWindow(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }
  return window;
}

function fft(real: Float64Array, imaginary: Float64Array, inverse: boolean): void {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / length;
    const phaseReal = Math.cos(angle);
    const phaseImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let factorReal = 1;
      let factorImaginary = 0;
      const half = length >> 1;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const productReal = factorReal * real[odd] - factorImaginary * imaginary[odd];
        const productImaginary = factorReal * imaginary[odd] + factorImaginary * real[odd];
        real[odd] = real[even] - productReal;
        imaginary[odd] = imaginary[even] - productImaginary;
        real[even] += productReal;
        imaginary[even] += productImaginary;
        [factorReal, factorImaginary] = [
          factorReal * phaseReal - factorImaginary * phaseImaginary,
          factorReal * phaseImaginary + factorImaginary * phaseReal,
        ];
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      real[index] /= size;
      imaginary[index] /= size;
    }
  }
}
