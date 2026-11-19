import { StemDraft } from '../models/stem-draft.model';
import { StemResult } from '../models/stem-separation.model';

/**
 * Format compact des brouillons : PCM 16 bits par canal, avec un facteur d'échelle
 * (le pic du canal) pour conserver la dynamique même si les stems dépassent ±1.
 * Divise par deux l'espace occupé par rapport à du Float32.
 */
export const DRAFT_FORMAT = 'int16-v1';

/** Nombre maximal de brouillons conservés dans le navigateur ; le plus ancien est supprimé. */
export const MAX_DRAFTS = 3;

export interface StoredChannel {
  samples: Int16Array;
  scale: number;
}

export interface StoredStem {
  name: StemResult['name'];
  sampleRate: number;
  channels: StoredChannel[];
}

export interface StoredDraft {
  trackId: string;
  mode: StemDraft['mode'];
  savedAt: number;
  format: typeof DRAFT_FORMAT;
  stems: StoredStem[];
}

/**
 * Encode le brouillon en 16 bits. Avec `releaseSource`, les canaux Float32 de chaque stem
 * sont vidés dès qu'il est encodé, ce qui limite le pic de mémoire (le brouillon source
 * n'est alors plus utilisable).
 */
export function encodeDraft(draft: StemDraft, releaseSource = false): StoredDraft {
  const stems: StoredStem[] = [];
  for (const stem of draft.stems) {
    stems.push({
      name: stem.name,
      sampleRate: stem.sampleRate,
      channels: stem.channels.map(encodeChannel),
    });
    if (releaseSource) {
      stem.channels.length = 0;
    }
  }
  return {
    trackId: draft.trackId,
    mode: draft.mode,
    savedAt: draft.savedAt,
    format: DRAFT_FORMAT,
    stems,
  };
}

export function decodeDraft(stored: StoredDraft): StemDraft {
  if (stored.format !== DRAFT_FORMAT) {
    throw new Error(`Format de brouillon inconnu (${String(stored.format)}).`);
  }
  return {
    trackId: stored.trackId,
    mode: stored.mode,
    savedAt: stored.savedAt,
    stems: stored.stems.map((stem) => ({
      name: stem.name,
      sampleRate: stem.sampleRate,
      channels: stem.channels.map(decodeChannel),
    })),
  };
}

/** Taille approximative des données du brouillon une fois encodées, en octets. */
export function storedByteSize(stored: StoredDraft): number {
  return stored.stems.reduce(
    (total, stem) =>
      total + stem.channels.reduce((sum, channel) => sum + channel.samples.byteLength, 0),
    0,
  );
}

function encodeChannel(channel: Float32Array): StoredChannel {
  let peak = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const value = Math.abs(channel[index]);
    if (!Number.isFinite(value)) {
      throw new Error('Un stem contient des valeurs invalides et ne peut pas être enregistré.');
    }
    if (value > peak) {
      peak = value;
    }
  }
  const scale = peak > 0 ? peak : 1;
  const samples = new Int16Array(channel.length);
  for (let index = 0; index < channel.length; index += 1) {
    samples[index] = Math.round((channel[index] / scale) * 32767);
  }
  return { samples, scale };
}

function decodeChannel(channel: StoredChannel): Float32Array {
  const result = new Float32Array(channel.samples.length);
  const factor = channel.scale / 32767;
  for (let index = 0; index < result.length; index += 1) {
    result[index] = channel.samples[index] * factor;
  }
  return result;
}

/**
 * Brouillons à supprimer pour qu'il en reste au plus `max - 1` autres que celui qu'on
 * enregistre (`keepTrackId`). `keysOldestFirst` est trié du plus ancien au plus récent.
 */
export function selectDraftsToEvict(
  keysOldestFirst: readonly string[],
  keepTrackId: string,
  max = MAX_DRAFTS,
): string[] {
  const others = keysOldestFirst.filter((key) => key !== keepTrackId);
  return others.slice(0, Math.max(0, others.length - (max - 1)));
}

const MEGABYTE = 1024 * 1024;

export function megabytes(bytes: number): number {
  return Math.round(bytes / MEGABYTE);
}

/**
 * Refuse l'écriture avec un message précis quand l'espace restant est insuffisant.
 * `estimate` vient de `navigator.storage.estimate()` ; absent, on laisse le navigateur trancher.
 */
export function assertEnoughStorage(
  neededBytes: number,
  estimate: { quota?: number; usage?: number } | null,
): void {
  if (!estimate || typeof estimate.quota !== 'number') {
    return;
  }
  const available = estimate.quota - (estimate.usage ?? 0);
  if (neededBytes > available) {
    throw new Error(
      `Espace de stockage insuffisant : ~${megabytes(neededBytes)} Mo nécessaires, ` +
        `${megabytes(Math.max(0, available))} Mo disponibles (quota du navigateur : ${megabytes(estimate.quota)} Mo). ` +
        'Libérez de l’espace disque ou supprimez des données du site, puis réessayez.',
    );
  }
}
