import type { PerfRunResult } from './PerfHarness';

export interface PerfRunSummary {
  id: string;
  createdAt: string;
  durationSec: number;
  scenario: PerfRunResult['scenario'];
  summary: PerfRunResult['summary'];
  sampleCount: number;
  gitBranch: string;
  gitCommit: string;
}

const DB_NAME = 'bitwars-perf-db';
const DB_VERSION = 1;
const STORE_RUNS = 'runs';
const STORE_SUMMARIES = 'summaries';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        db.createObjectStore(STORE_RUNS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SUMMARIES)) {
        db.createObjectStore(STORE_SUMMARIES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open performance DB'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function savePerfRun(run: PerfRunResult): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([STORE_RUNS, STORE_SUMMARIES], 'readwrite');
    tx.objectStore(STORE_RUNS).put(run);
    const summary: PerfRunSummary = {
      id: run.id,
      createdAt: run.createdAt,
      durationSec: run.durationSec,
      scenario: run.scenario,
      summary: run.summary,
      sampleCount: run.samples.length,
      gitBranch: run.metadata?.gitBranch ?? 'unknown',
      gitCommit: run.metadata?.gitCommit ?? 'unknown',
    };
    tx.objectStore(STORE_SUMMARIES).put(summary);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function listPerfRunSummaries(limit = 30): Promise<PerfRunSummary[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_SUMMARIES, 'readonly');
    const req = tx.objectStore(STORE_SUMMARIES).getAll();
    const rows = await new Promise<PerfRunSummary[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as PerfRunSummary[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error('Failed to read performance summaries'));
    });
    await txDone(tx);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows.slice(0, Math.max(1, limit));
  } finally {
    db.close();
  }
}

export async function loadPerfRun(id: string): Promise<PerfRunResult | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_RUNS, 'readonly');
    const req = tx.objectStore(STORE_RUNS).get(id);
    const row = await new Promise<PerfRunResult | null>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as PerfRunResult | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Failed to load performance run'));
    });
    await txDone(tx);
    return row;
  } finally {
    db.close();
  }
}

export async function deletePerfRun(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([STORE_RUNS, STORE_SUMMARIES], 'readwrite');
    tx.objectStore(STORE_RUNS).delete(id);
    tx.objectStore(STORE_SUMMARIES).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function clearPerfRuns(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([STORE_RUNS, STORE_SUMMARIES], 'readwrite');
    tx.objectStore(STORE_RUNS).clear();
    tx.objectStore(STORE_SUMMARIES).clear();
    await txDone(tx);
  } finally {
    db.close();
  }
}
