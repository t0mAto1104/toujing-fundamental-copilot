import type { CompanyReport } from '@/lib/research-types';

export const REPORT_STORAGE_KEY = 'lens-saved-reports-v1';

export type SavedReport = {
  id: string;
  companyName: string;
  companyCode: string;
  exchange: string;
  listingId?: string;
  industry: string;
  stance: CompanyReport['stance'];
  quote?: CompanyReport['quote'];
  conclusion: string;
  updatedAt: string;
  query: string;
  report?: CompanyReport;
};

export function readSavedReports(): SavedReport[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(
      window.localStorage.getItem(REPORT_STORAGE_KEY) || '[]',
    ) as SavedReport[];
  } catch {
    return [];
  }
}

export function readSavedReport(id: string): SavedReport | null {
  return readSavedReports().find((entry) => entry.id === id) || null;
}

export async function readStoredReports(): Promise<SavedReport[]> {
  const local = readSavedReports();
  try {
    const response = await fetch('/api/reports', { cache: 'no-store' });
    if (!response.ok) return local;
    const payload = (await response.json()) as { reports?: SavedReport[] };
    const remote = payload.reports || [];
    const remoteIds = new Set(remote.map((item) => item.id));
    return [...remote, ...local.filter((item) => !remoteIds.has(item.id))];
  } catch {
    return local;
  }
}

export async function readStoredReport(
  id: string,
): Promise<SavedReport | null> {
  const local = readSavedReport(id);
  if (local?.report) return local;
  try {
    const response = await fetch(`/api/reports?id=${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        report?: SavedReport | null;
      };
      if (payload.report) return payload.report;
    }
  } catch {}
  return local;
}

export async function saveReport(report: CompanyReport, query: string) {
  if (typeof window === 'undefined') return;
  const current = readSavedReports();
  const item: SavedReport = {
    id: `${report.exchange}-${report.companyCode}`,
    companyName: report.companyName,
    companyCode: report.companyCode,
    exchange: report.exchange,
    listingId: report.selectedListingId,
    industry: report.industry,
    stance: report.stance,
    quote: report.quote,
    conclusion: report.conclusion,
    updatedAt: report.updatedAt,
    query,
    report,
  };
  window.localStorage.setItem(
    REPORT_STORAGE_KEY,
    JSON.stringify(
      [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 30),
    ),
  );
  try {
    await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report, query }),
    });
  } catch {}
}

export async function removeSavedReport(id: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    REPORT_STORAGE_KEY,
    JSON.stringify(readSavedReports().filter((entry) => entry.id !== id)),
  );
  try {
    await fetch(`/api/reports?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch {}
}
