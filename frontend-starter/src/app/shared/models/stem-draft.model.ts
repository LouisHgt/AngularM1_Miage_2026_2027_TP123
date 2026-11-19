import { StemResult, StemSeparationMode } from './stem-separation.model';

/** Brouillon de stems conservé dans le navigateur pour un morceau (un par identifiant de piste). */
export interface StemDraft {
  trackId: string;
  mode: StemSeparationMode;
  /** Horodatage de l'enregistrement (ms depuis 1970). */
  savedAt: number;
  stems: StemResult[];
}

/** Métadonnées d'un brouillon, affichées dans le studio. */
export type StemDraftInfo = Pick<StemDraft, 'mode' | 'savedAt'>;
