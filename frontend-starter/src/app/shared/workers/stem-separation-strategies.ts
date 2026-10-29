import {
  StemName,
  StemSeparationModel,
  StemSeparationStrategy,
} from '../models/stem-separation.model';

const STEM_NAMES: StemName[] = ['vocals', 'drums', 'bass', 'other'];
const MODEL_RELEASE_BASE =
  'https://github.com/LouisHgt/AngularM1_Miage_2026_2027_TP123/releases/download/v1.0-models';

abstract class OnnxStemStrategy implements StemSeparationStrategy {
  abstract readonly mode: StemSeparationModel['mode'];
  abstract readonly label: string;
  protected abstract readonly model: StemSeparationModel;

  async loadModels(): Promise<void> {
    if (this.model.modelUrls.some((url) => !url)) {
      throw new Error(`Les artefacts du modèle ${this.label.toLowerCase()} ne sont pas configurés.`);
    }

    const responses = await Promise.all(this.model.modelUrls.map((url) => fetch(url)));
    const failedResponse = responses.find((response) => !response.ok);
    if (failedResponse) {
      throw new Error(`Le modèle IA est indisponible (${failedResponse.status}).`);
    }
    await Promise.all(responses.map((response) => response.arrayBuffer()));
  }

  async separate(_audioBuffer: AudioBuffer): Promise<Record<StemName, AudioBuffer>> {
    throw new Error(
      `Le runtime ONNX de la stratégie ${this.label} doit encore être raccordé à ses artefacts.`,
    );
  }

  protected emptyStemRecord(): Record<StemName, AudioBuffer> {
    return Object.fromEntries(STEM_NAMES.map((name) => [name, {} as AudioBuffer])) as Record<
      StemName,
      AudioBuffer
    >;
  }
}

export class DemucsStrategy extends OnnxStemStrategy {
  readonly mode = 'quality' as const;
  readonly label = 'Qualité';
  protected readonly model = {
    mode: this.mode,
    label: this.label,
    description: 'Demucs v4 monolithique, une session ONNX et quatre sorties.',
    modelUrls: [`${MODEL_RELEASE_BASE}/htdemucs.onnx`],
  };
}

export class SpleeterStrategy extends OnnxStemStrategy {
  readonly mode = 'fast' as const;
  readonly label = 'Rapide';
  protected readonly model = {
    mode: this.mode,
    label: this.label,
    description: 'Spleeter 4 stems, quatre sessions ONNX et reconstruction iSTFT.',
    modelUrls: [
      `${MODEL_RELEASE_BASE}/vocals.fp16.onnx`,
      `${MODEL_RELEASE_BASE}/drums.fp16.onnx`,
      `${MODEL_RELEASE_BASE}/bass.fp16.onnx`,
      `${MODEL_RELEASE_BASE}/other.fp16.onnx`,
    ],
  };
}

export function createStemSeparationStrategy(
  mode: StemSeparationModel['mode'],
): StemSeparationStrategy {
  return mode === 'quality' ? new DemucsStrategy() : new SpleeterStrategy();
}
