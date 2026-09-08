import { ensureReportDatabase, getReportDatabase } from '@/lib/report-database';
import { observeDataSource } from '@/lib/data-source-health';

type SnapshotRow = {
  payload_json: string;
  source_name: string;
  source_url: string;
  fetched_at: string;
  expires_at: string;
};

export type DataSnapshot<T> = {
  value: T;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
};

const memory = new Map<string, DataSnapshot<unknown>>();
const inflight = new Map<string, Promise<DataSnapshot<unknown>>>();

function parseRow<T>(row: SnapshotRow | null): DataSnapshot<T> | null {
  if (!row) return null;
  try {
    return {
      value: JSON.parse(row.payload_json) as T,
      sourceName: row.source_name,
      sourceUrl: row.source_url,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
      stale: row.expires_at <= new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function readDataSnapshot<T>(cacheKey: string) {
  const local = memory.get(cacheKey) as DataSnapshot<T> | undefined;
  if (local && local.expiresAt > new Date().toISOString())
    return { ...local, stale: false };

  const database = getReportDatabase();
  const fallback = local ? { ...local, stale: true } : null;
  if (!database) return fallback;
  try {
    await ensureReportDatabase(database);
    const row = await database
      .prepare(
        `SELECT payload_json, source_name, source_url, fetched_at, expires_at
       FROM data_snapshots WHERE cache_key = ?`,
      )
      .bind(cacheKey)
      .first<SnapshotRow>();
    const parsed = parseRow<T>(row);
    if (parsed) memory.set(cacheKey, parsed as DataSnapshot<unknown>);
    return parsed || fallback;
  } catch (error) {
    if (fallback) return fallback;
    throw error;
  }
}

export async function storeDataSnapshot<T>(
  cacheKey: string,
  category: string,
  value: T,
  ttlMs: number,
  sourceName: string,
  sourceUrl: string,
) {
  const fetchedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const snapshot: DataSnapshot<T> = {
    value,
    sourceName,
    sourceUrl,
    fetchedAt,
    expiresAt,
    stale: false,
  };
  memory.set(cacheKey, snapshot as DataSnapshot<unknown>);

  const database = getReportDatabase();
  if (database) {
    await ensureReportDatabase(database);
    await database
      .prepare(
        `INSERT INTO data_snapshots (
          cache_key, category, payload_json, source_name, source_url,
          fetched_at, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          category = excluded.category,
          payload_json = excluded.payload_json,
          source_name = excluded.source_name,
          source_url = excluded.source_url,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        cacheKey,
        category,
        JSON.stringify(value),
        sourceName,
        sourceUrl,
        fetchedAt,
        expiresAt,
        fetchedAt,
      )
      .run();
  }
  return snapshot;
}

export async function getOrRefreshDataSnapshot<T>(options: {
  cacheKey: string;
  category: string;
  ttlMs: number;
  sourceName: string;
  sourceUrl: string;
  refresh: () => Promise<T>;
  requestScoped?: boolean;
}): Promise<DataSnapshot<T>> {
  const cached = await readDataSnapshot<T>(options.cacheKey);
  if (cached && !cached.stale) {
    await observeDataSource(options, 'cache');
    return cached;
  }

  const existing = inflight.get(options.cacheKey) as
    | Promise<DataSnapshot<T>>
    | undefined;
  if (existing && !options.requestScoped) return existing;

  const started = Date.now();
  const task = options
    .refresh()
    .catch(async (error) => {
      await observeDataSource(
        options,
        'failure',
        Date.now() - started,
        undefined,
        error,
      );
      throw error;
    })
    .then(async (value) => {
      await observeDataSource(options, 'success', Date.now() - started, value);
      return storeDataSnapshot(
        options.cacheKey,
        options.category,
        value,
        options.ttlMs,
        options.sourceName,
        options.sourceUrl,
      );
    })
    .catch((error) => {
      if (cached) return { ...cached, stale: true };
      throw error;
    })
    .finally(() => {
      if (!options.requestScoped) inflight.delete(options.cacheKey);
    });
  if (!options.requestScoped)
    inflight.set(options.cacheKey, task as Promise<DataSnapshot<unknown>>);
  return task;
}
