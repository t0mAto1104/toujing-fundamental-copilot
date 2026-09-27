// Reconstruct the cash-restriction note from PDF coordinates rather than
// flattening empty current/prior cells. Conservative: only recognized headings.
type Item = { str: string; transform: number[]; width: number };

// Only join a broken thousands-group amount when two adjacent fragments share
// the same right-aligned column and adjacent lines. Never strip arbitrary spaces
// between numbers: they may separate different cells or reporting periods.
export function researchPdfText(items: Item[]) {
  const pieces: Array<{ item: Item; text: string }> = [];
  for (const item of items.filter((i) => i.str.trim())) {
    const text = item.str.trim(),
      previous = pieces.at(-1);
    const prefix = previous?.text || '';
    const joined = prefix + text;
    if (
      previous &&
      /^-?\d{1,3}(?:,\d{3})*(?:,\d{1,2}|\.\d?)$/.test(prefix) &&
      /^\d{1,3}(?:\.\d{1,2})?$/.test(text) &&
      /^-?\d{1,3}(?:,\d{3})+\.\d{2}$/.test(joined) &&
      Math.abs(
        previous.item.transform[4] +
          previous.item.width -
          item.transform[4] -
          item.width,
      ) < 2 &&
      previous.item.transform[5] - item.transform[5] >= 5 &&
      previous.item.transform[5] - item.transform[5] <= 18
    ) {
      previous.text = joined;
    } else pieces.push({ item, text });
  }
  return pieces
    .map((p) => p.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export type CashRestrictionTable = {
  page: number;
  unit: '元';
  rows: Array<{
    period: '期末' | '期初';
    amount: string | null;
    type: string;
    reason: string;
  }>;
};
export function cashRestrictionTable(
  items: Item[],
  page: number,
): CashRestrictionTable | null {
  const clean = items.filter((x) => x.str.trim());
  const title = clean.find((x) => /所有权或使用权受到限制的资产/.test(x.str));
  if (!title) return null;
  const below = clean.filter((x) => x.transform[5] < title.transform[5]);
  const current = below.find((x) => x.str.trim() === '期末');
  const prior = below.find((x) => x.str.trim() === '期初');
  if (
    !current ||
    !prior ||
    Math.abs(current.transform[5] - prior.transform[5]) > 3
  )
    return null;
  const headers = below.filter(
    (x) =>
      x.transform[5] < current.transform[5] &&
      /^(账面余额|账面价值|受限类型|受限情况)$/.test(x.str.trim()),
  );
  const headerY = Math.max(...headers.map((x) => x.transform[5]));
  const columns = headers
    .filter((x) => Math.abs(x.transform[5] - headerY) < 3)
    .sort((a, b) => a.transform[4] - b.transform[4]);
  if (
    columns.length !== 8 ||
    columns.map((x) => x.str.trim()).join(',') !==
      '账面余额,账面价值,受限类型,受限情况,账面余额,账面价值,受限类型,受限情况'
  )
    return null;
  const center = (x: Item) => x.transform[4] + x.width / 2;
  const centers = columns.map(center);
  const leftBoundary = columns[0].transform[4] - 6;
  const labels = below.filter(
    (x) =>
      x.transform[5] < headerY &&
      x.transform[4] < leftBoundary &&
      /^[\p{Script=Han}]{2,10}$/u.test(x.str.trim()),
  );
  const anchors = labels.filter((x) => x.str.trim() === '货币资金');
  const rows: CashRestrictionTable['rows'] = [];
  for (const anchor of anchors) {
    const y = anchor.transform[5];
    const upper = Math.min(
      headerY,
      ...labels
        .filter((x) => x.transform[5] > y + 3)
        .map((x) => (x.transform[5] + y) / 2),
    );
    const lower = Math.max(
      y - 30,
      ...labels
        .filter((x) => x.transform[5] < y - 3)
        .map((x) => (x.transform[5] + y) / 2),
    );
    const cells = columns.map(() => [] as Item[]);
    for (const item of below) {
      if (
        item.transform[5] >= upper ||
        item.transform[5] <= lower ||
        item.transform[4] < leftBoundary
      )
        continue;
      const x = center(item);
      const index = centers.reduce(
        (best, v, i) =>
          Math.abs(v - x) < Math.abs(centers[best] - x) ? i : best,
        0,
      );
      cells[index].push(item);
    }
    const values = cells.map((cell) =>
      cell
        .sort(
          (a, b) =>
            b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
        )
        .map((x) => x.str.trim())
        .join(''),
    );
    for (const [period, offset] of [
      ['期末', 0],
      ['期初', 4],
    ] as const) {
      const number = values[offset].replace(/,/g, '');
      if (number && !/^\d+(?:\.\d+)?$/.test(number)) return null;
      rows.push({
        period,
        amount: number || null,
        type: values[offset + 2],
        reason: values[offset + 3],
      });
    }
  }
  return rows.length ? { page, unit: '元', rows } : null;
}
