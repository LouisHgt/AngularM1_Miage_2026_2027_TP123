/** State of the upload form, displayed by the tracks page. */
export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export interface UploadState {
  status: UploadStatus;
  /** Percentage from 0 to 100, meaningful while uploading. */
  progress: number;
  /** Success or error message to display. */
  message: string;
}

export const IDLE_UPLOAD: UploadState = { status: 'idle', progress: 0, message: '' };
