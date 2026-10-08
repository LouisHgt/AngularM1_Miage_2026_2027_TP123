/**
 * Frontend validation of an audio file before upload.
 * Mirrors the backend rules (backend/src/app.js): accepted MIME types and 25 MB max.
 * This improves the user experience but never replaces the backend validation.
 */
export const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024;

export const ACCEPTED_AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
]);

/** Returns a user-facing error message, or null when the file is acceptable. */
export function validateAudioFile(file: File | undefined | null): string | null {
  if (!file) {
    return 'Choisissez un fichier audio.';
  }
  if (!ACCEPTED_AUDIO_MIME_TYPES.has(file.type)) {
    return `Format non accepté (${file.type || 'inconnu'}). Formats acceptés : MP3, WAV, OGG, M4A.`;
  }
  if (file.size > MAX_AUDIO_FILE_SIZE) {
    return 'Fichier trop volumineux : 25 Mo maximum.';
  }
  return null;
}
