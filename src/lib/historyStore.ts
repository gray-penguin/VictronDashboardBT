// Local history bank for this app's live BLE readings. Unlike VictronDashboard's
// historyStore.ts (which banks month-blobs PULLED from VRM's API on demand),
// there's nothing to pull here — data only exists at all if a browser tab was
// open and listening the moment a device broadcast it. This module just
// appends a downsampled snapshot as readings arrive live, so history exists to
// look at later; it can never fill in a gap from while the tab was closed.

const DB_NAME = 'victron-dashboard-bt-history';
const DB_VERSION = 1;
const READINGS_STORE = 'readings';

export interface Reading {
  id: string; // `${deviceId}:${timestampMs}`
  deviceId: string;
  deviceName: string;
  readoutType: number;
  timestampMs: number;
  fields: Record<string, number>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(READINGS_STORE)) {
        const store = db.createObjectStore(READINGS_STORE, { keyPath: 'id' });
        store.createIndex('byDevice', 'deviceId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function appendReading(reading: Reading): Promise<void> {
  const db = await openDb();
  try {
    const store = db.transaction(READINGS_STORE, 'readwrite').objectStore(READINGS_STORE);
    await reqToPromise(store.put(reading));
  } finally {
    db.close();
  }
}

export async function getReadingsForDevice(deviceId: string): Promise<Reading[]> {
  const db = await openDb();
  try {
    const index = db.transaction(READINGS_STORE, 'readonly').objectStore(READINGS_STORE).index('byDevice');
    const rows = await reqToPromise<Reading[]>(index.getAll(IDBKeyRange.only(deviceId)));
    return rows.sort((a, b) => a.timestampMs - b.timestampMs);
  } finally {
    db.close();
  }
}

export async function countAllReadings(): Promise<number> {
  const db = await openDb();
  try {
    const store = db.transaction(READINGS_STORE, 'readonly').objectStore(READINGS_STORE);
    return await reqToPromise(store.count());
  } finally {
    db.close();
  }
}
