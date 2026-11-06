import { istft, stft } from './spectrogram';

describe('spectrogram utilities', () => {
  it('reconstruit un signal avec STFT puis iSTFT', () => {
    const source = Float32Array.from({ length: 12000 }, (_, index) =>
      Math.sin((2 * Math.PI * 220 * index) / 44100),
    );

    const reconstructed = istft(stft(source));
    let error = 0;
    for (let index = 4096; index < source.length - 1024; index += 1) {
      error = Math.max(error, Math.abs(source[index] - reconstructed[index + 3072]));
    }

    expect(error).toBeLessThan(0.001);
  });

  it('refuse une taille de fenêtre non compatible', () => {
    expect(() => stft(new Float32Array(10), 1000)).toThrow(
      'puissance de deux',
    );
  });

  it('conserve les trames nécessaires au padding avant', () => {
    expect(stft(new Float32Array(44100)).frames).toBe(47);
  });
});
