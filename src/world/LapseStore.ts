/** One day's picture of the island for the growth time-lapse, with what to caption it. */
export interface LapseFrame {
  /** Which island (seed and type). */
  island: string;
  day: number;
  blob: Blob;
  pop: number;
  /** Village title (Camp, Hamlet ...) and the season and year. */
  title: string;
  season: string;
  year: number;
}

const DB = 'aztlan-timelapse';
const STORE = 'frames';
/** Most pictures kept per island: beyond it every other one of the older half is let go. */
export const LAPSE_MAX = 360;
/** Islands whose pictures are kept (the most recently played). */
const KEEP_ISLANDS = 3;
const RECENT_KEY = 'aztlan-timelapse-islands';

let opening: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: ['island', 'day'] });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((res) => {
    tx.oncomplete = () => res(true);
    tx.onerror = tx.onabort = () => res(false);
  });
}

const range = (island: string) => IDBKeyRange.bound([island, -Infinity], [island, Infinity]);

/** Every picture of this island, oldest first (empty if storage is unavailable). */
export async function lapseFrames(island: string): Promise<LapseFrame[]> {
  const db = await open();
  if (!db) return [];
  return new Promise((res) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(range(island));
      req.onsuccess = () => res((req.result as LapseFrame[]).sort((a, b) => a.day - b.day));
      req.onerror = () => res([]);
    } catch {
      res([]);
    }
  });
}

/** The last day this island has a picture for (-1 if none). */
export async function lastLapseDay(island: string): Promise<number> {
  const db = await open();
  if (!db) return -1;
  return new Promise((res) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openKeyCursor(range(island), 'prev');
      req.onsuccess = () => res(req.result ? (req.result.primaryKey as [string, number])[1] : -1);
      req.onerror = () => res(-1);
    } catch {
      res(-1);
    }
  });
}

/** Which of `days` (sorted) to let go to bring them down to the limit: every other one of the older half. */
export function thinDays(days: number[], max = LAPSE_MAX): number[] {
  if (days.length <= max) return [];
  const older = days.slice(0, Math.floor(days.length / 2));
  return older.filter((_, i) => i % 2 === 1);
}

/** Keep a picture (and tidy up: thin this island's, forget islands not played for a long while). */
export async function addLapseFrame(f: LapseFrame): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(f);
    if (!(await done(tx))) return false;
  } catch {
    return false;
  }
  const frames = await lapseFrames(f.island);
  const drop = thinDays(frames.map((x) => x.day));
  const stale = rememberIsland(f.island);
  if (drop.length || stale.length) {
    try {
      const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
      for (const day of drop) st.delete([f.island, day]);
      for (const island of stale) st.delete(range(island));
      await done(tx);
    } catch { /* tidy next time */ }
  }
  return true;
}

/** Move this island to the front of the recently played list; returns islands that fell off it. */
function rememberIsland(island: string): string[] {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    const next = [island, ...list.filter((x) => x !== island)];
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, KEEP_ISLANDS)));
    return next.slice(KEEP_ISLANDS);
  } catch {
    return [];
  }
}
