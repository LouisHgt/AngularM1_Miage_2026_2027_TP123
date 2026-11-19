const DATABASE_NAME = 'webjam-studio';
/**
 * Version 2 : magasin `stem-drafts` à côté du cache des modèles ONNX.
 * Version 3 : index `savedAt` sur les brouillons, pour trouver les plus anciens sans lire les audios.
 */
const DATABASE_VERSION = 3;

export const MODEL_STORE = 'onnx-models';
export const DRAFT_STORE = 'stem-drafts';
export const DRAFT_DATE_INDEX = 'savedAt';

/**
 * Ouvre la base IndexedDB unique du studio (modèles ONNX et brouillons de stems).
 * Utilisée par le thread principal et par le Worker : une seule définition des magasins.
 */
export function openStudioDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB est indisponible dans ce navigateur.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Ouverture du stockage impossible.'));
    request.onblocked = () =>
      reject(new Error('Stockage bloqué : fermez les autres onglets du studio puis réessayez.'));
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) {
        throw new Error('Transaction de mise à jour du stockage indisponible.');
      }
      if (!database.objectStoreNames.contains(MODEL_STORE)) {
        database.createObjectStore(MODEL_STORE, { keyPath: 'key' });
      }
      const drafts = database.objectStoreNames.contains(DRAFT_STORE)
        ? transaction.objectStore(DRAFT_STORE)
        : database.createObjectStore(DRAFT_STORE, { keyPath: 'trackId' });
      if (!drafts.indexNames.contains(DRAFT_DATE_INDEX)) {
        drafts.createIndex(DRAFT_DATE_INDEX, 'savedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}
