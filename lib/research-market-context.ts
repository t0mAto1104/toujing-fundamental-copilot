import { readDataSnapshot } from '@/lib/data-snapshot-cache';
import { chinaDate } from '@/lib/signal-types';
import type { DataTable } from '@/lib/market-extension-types';

// Reuse already validated HTTP/D1 snapshots. Never wait for another remote
// source, add model requests, or treat absent cached evidence as a zero value.
export async function cachedResearchMarketContext(symbol?: string) {
  const today = chinaDate();
  const keys = ['lpr', 'curve'].map((kind) => `macro:v39:${kind}:${today}`);
  if (symbol && /^(sh|sz|bj)\d{6}$/.test(symbol))
    keys.push(
      ...['forecast', 'holders', 'buyback', 'pledge'].map(
        (kind) => `events:v39:${kind}:${symbol}:${today}:1`,
      ),
    );
  const snapshots = await Promise.all(
    keys.map((key) =>
      readDataSnapshot<DataTable>(`signals:v1:${key}`).catch(() => null),
    ),
  );
  const result: {
    title: string;
    publisher: string;
    url: string;
    date: string;
    facts: Record<string, string | number | null>;
  }[] = [];
  let size = 0;
  for (const snapshot of snapshots) {
    if (!snapshot || snapshot.stale || !snapshot.value.rows?.length) continue;
    const row = snapshot.value.rows[0];
    if (row.code && String(row.code) !== symbol?.slice(2)) continue;
    const facts = Object.fromEntries(
      snapshot.value.columns.map(({ key, label }) => [
        label,
        typeof row[key] === 'string'
          ? row[key].slice(0, 160)
          : (row[key] ?? null),
      ]),
    );
    const fact = {
      title: snapshot.value.coverage.slice(0, 110),
      publisher: snapshot.sourceName,
      url: snapshot.sourceUrl,
      date: String(row.date ?? ''),
      facts,
    };
    const length = JSON.stringify(fact).length;
    if (size + length > 2400) continue;
    size += length;
    result.push(fact);
  }
  return result;
}
