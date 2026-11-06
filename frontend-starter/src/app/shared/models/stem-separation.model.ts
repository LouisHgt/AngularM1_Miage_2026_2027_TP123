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
  channels: Float32Array[];
  sampleRate: number;
}

export interface SeparationAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export interface StemSeparationRequest {
  type: 'separate';
  mode: StemSeparationMode;
  sampleRate: number;
  channels: Float32Array[];
}

/** Callback de progression global (0-100) émis pendant `separate`. */
export type StemProgressCallback = (progress: number, message: string) => void;

/**
 * Strategy shared by the Worker implementations.
 * Each strategy normalizes its model-specific output to the four application stems.
 */
export interface StemSeparationStrategy {
  mode: StemSeparationMode;
  label: string;
  loadModels(): Promise<void>;
  getTensorSummary(): string;
  validateModelContract(): Promise<string>;
  separate(
    audio: SeparationAudio,
    onProgress?: StemProgressCallback,
  ): Promise<ReadonlyArray<StemResult>>;
}

export type StemWorkerMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'complete'; stems: StemResult[] }
  | { type: 'error'; message: string };
