import { Injectable } from '@angular/core';
import { StemDraft } from '../models/stem-draft.model';
import {
  StoredDraft,
  assertEnoughStorage,
  decodeDraft,
  encodeDraft,
  megabytes,
  selectDraftsToEvict,
  storedByteSize,
} from '../storage/stem-draft-codec';
import { DRAFT_DATE_INDEX, DRAFT_STORE, openStudioDatabase } from '../storage/studio-db';

/**
 * Accès IndexedDB aux brouillons de stems, rangés par identifiant de piste.
 * Les audios sont compactés en 16 bits ; au plus `MAX_DRAFTS` (voir stem-draft-codec) brouillons sont conservés.
 */
@Injectable({ providedIn: 'root' })
export class StemDraftStorage {
  /**
   * Enregistre le brouillon, après avoir supprimé les plus anciens au-delà de la limite.
   * Retourne les identifiants des morceaux dont le brouillon a été supprimé.
   */
  async put(draft: StemDraft, releaseSource = false): Promise<string[]> {
    const stored = encodeDraft(draft, releaseSource);
    const needed = storedByteSize(stored);

    const evicted = selectDraftsToEvict(await this.keysOldestFirst(), draft.trackId);
    for (const trackId of evicted) {
      await this.delete(trackId);
    }
    assertEnoughStorage(needed, await this.estimate());

    try {
      await this.run(
        'readwrite',
        (store) => store.put(stored),
        'Enregistrement du brouillon impossible.',
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new Error(
          `Quota de stockage du navigateur dépassé (~${megabytes(needed)} Mo à enregistrer). ` +
            'Libérez de l’espace disque ou supprimez des données du site, puis réessayez.',
        );
      }
      throw error;
    }
    return evicted;
  }

  async get(trackId: string): Promise<StemDraft | null> {
    const result = await this.run(
      'readonly',
      (store) => store.get(trackId),
      'Lecture du brouillon impossible.',
    );
    return result ? decodeDraft(result as StoredDraft) : null;
  }

  async delete(trackId: string): Promise<void> {
    await this.run(
      'readwrite',
      (store) => store.delete(trackId),
      'Suppression du brouillon impossible.',
    );
  }

  /** Identifiants des brouillons, du plus ancien au plus récent (sans lire les audios). */
  private async keysOldestFirst(): Promise<string[]> {
    const database = await openStudioDatabase();
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const keys: string[] = [];
        const transaction = database.transaction(DRAFT_STORE, 'readonly');
        const request = transaction.objectStore(DRAFT_STORE).index(DRAFT_DATE_INDEX).openKeyCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            keys.push(cursor.primaryKey as string);
            cursor.continue();
          }
        };
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('Lecture de la liste des brouillons impossible.'));
        transaction.onabort = transaction.onerror;
        transaction.oncomplete = () => resolve(keys);
      });
    } finally {
      database.close();
    }
  }

  private async estimate(): Promise<StorageEstimate | null> {
    try {
      return (await navigator.storage?.estimate?.()) ?? null;
    } catch {
      return null; // Estimation indisponible : le navigateur tranchera à l'écriture.
    }
  }

  private async run(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest,
    errorMessage: string,
  ): Promise<unknown> {
    const database = await openStudioDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(DRAFT_STORE, mode);
        const request = operation(transaction.objectStore(DRAFT_STORE));
        transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error(errorMessage));
        transaction.onabort = () => reject(transaction.error ?? new Error(errorMessage));
        // On attend la fin de la transaction : l'écriture est alors réellement durable.
        transaction.oncomplete = () => resolve(request.result);
      });
    } finally {
      database.close();
    }
  }
}
