import { MODEL_STORE, openStudioDatabase } from '../storage/studio-db';

interface CachedModel {
  key: string;
  bytes: ArrayBuffer;
}

export async function readCachedModel(key: string): Promise<ArrayBuffer | null> {
  const database = await openStudioDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(MODEL_STORE, 'readonly')
        .objectStore(MODEL_STORE)
        .get(key);
      request.onerror = () => reject(request.error ?? new Error('Lecture du cache impossible.'));
      request.onsuccess = () => resolve((request.result as CachedModel | undefined)?.bytes ?? null);
    });
  } finally {
    database.close();
  }
}

export async function writeCachedModel(key: string, bytes: ArrayBuffer): Promise<void> {
  const database = await openStudioDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(MODEL_STORE, 'readwrite')
        .objectStore(MODEL_STORE)
        .put({ key, bytes } satisfies CachedModel);
      request.onerror = () => reject(request.error ?? new Error('Écriture du cache impossible.'));
      request.onsuccess = () => resolve();
    });
  } finally {
    database.close();
  }
}
