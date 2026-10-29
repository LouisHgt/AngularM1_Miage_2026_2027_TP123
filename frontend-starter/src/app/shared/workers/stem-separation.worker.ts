import { StemSeparationRequest } from '../models/stem-separation.model';
import { createStemSeparationStrategy } from './stem-separation-strategies';

const report = (progress: number, message: string) =>
  postMessage({ type: 'progress', progress, message });

self.onmessage = async ({ data }: MessageEvent<StemSeparationRequest>) => {
  try {
    const strategy = createStemSeparationStrategy(data.mode);
    report(5, `Chargement du modèle ${strategy.label.toLowerCase()}…`);
    await strategy.loadModels();
    report(20, 'Modèle chargé, préparation de l’audio…');
    const audioBuffer = createWorkerAudioBuffer(data);
    const separated = await strategy.separate(audioBuffer);
    const stems = Object.entries(separated).map(([name, buffer]) => ({
      name,
      samples: buffer.getChannelData(0).slice(),
    }));
    report(95, 'Recomposition des quatre stems…');
    postMessage(
      { type: 'complete', stems },
      { transfer: stems.map((stem) => stem.samples.buffer) },
    );
  } catch (error) {
    postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'La séparation IA a échoué.',
    });
  }
};

function createWorkerAudioBuffer(data: StemSeparationRequest): AudioBuffer {
  if (typeof OfflineAudioContext !== 'function') {
    throw new Error('Le navigateur ne permet pas de créer un AudioBuffer dans le Worker.');
  }

  const context = new OfflineAudioContext(
    data.channels.length,
    data.channels[0]?.length ?? 0,
    data.sampleRate,
  );
  const buffer = context.createBuffer(
    data.channels.length,
    data.channels[0]?.length ?? 0,
    data.sampleRate,
  );
  data.channels.forEach((channel, index) => buffer.copyToChannel(new Float32Array(channel), index));
  return buffer;
}
