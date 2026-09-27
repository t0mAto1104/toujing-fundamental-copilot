export type DataCell = string | number | null;
export type DataTable = {
  columns: { key: string; label: string }[];
  rows: Record<string, DataCell>[];
  total: number | null;
  page: number;
  pages: number | null;
  coverage: string;
};
export const eventKinds = {
  forecast: '业绩预告',
  survey: '机构调研',
  holders: '股东增减持',
  buyback: '股票回购',
  pledge: '股权质押',
} as const;
export type EventKind = keyof typeof eventKinds;
