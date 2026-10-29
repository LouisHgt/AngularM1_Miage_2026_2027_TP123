export type StemSeparationMode = 'fast' | 'quality';

export type StemName = 'vocals' | 'drums' | 'bass' | 'other';

export interface StemSeparationModel {
  mode: StemSeparationMode;
  label: string;
  description: string;
  modelUrls: string[];
}

export interface StemResult {
  name: StemName;
  samples: Float32Array;
}

export interface StemSeparationRequest {
  type: 'separate';
  mode: StemSeparationMode;
  sampleRate: number;
  channels: Float32Array[];
}

/**
 * Strategy shared by the Worker implementations.
 * Each strategy normalizes its model-specific output to the four application stems.
 */
export interface StemSeparationStrategy {
  mode: StemSeparationMode;
  label: string;
  loadModels(): Promise<void>;
  separate(audioBuffer: AudioBuffer): Promise<Record<StemName, AudioBuffer>>;
}

export type StemWorkerMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'complete'; stems: StemResult[] }
  | { type: 'error'; message: string };
