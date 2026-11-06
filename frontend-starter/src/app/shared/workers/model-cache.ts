const DATABASE_NAME = 'webjam-studio';
const STORE_NAME = 'onnx-models';
const DATABASE_VERSION = 1;

interface CachedModel {
  key: string;
  bytes: ArrayBuffer;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB est indisponible dans ce navigateur.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Ouverture du cache impossible.'));
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function readCachedModel(key: string): Promise<ArrayBuffer | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(key);
      request.onerror = () => reject(request.error ?? new Error('Lecture du cache impossible.'));
      request.onsuccess = () => resolve((request.result as CachedModel | undefined)?.bytes ?? null);
    });
  } finally {
    database.close();
  }
}

export async function writeCachedModel(key: string, bytes: ArrayBuffer): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put({ key, bytes } satisfies CachedModel);
      request.onerror = () => reject(request.error ?? new Error('Écriture du cache impossible.'));
      request.onsuccess = () => resolve();
    });
  } finally {
    database.close();
  }
}
