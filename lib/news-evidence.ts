type NewsIdentity = {
  title: string;
  content: string;
  url: string;
  date: string;
};
const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .trim();
export function newsDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return NaN;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !==
    value.slice(0, 10)
  )
    return NaN;
  const iso = value.trim().replace(' ', 'T');
  return Date.parse(
    iso.length === 10
      ? `${iso}T00:00:00+08:00`
      : /(?:Z|[+-]\d\d:\d\d)$/.test(iso)
        ? iso
        : `${iso}+08:00`,
  );
}
export function deduplicateNews<T>(
  items: T[],
  identity: (item: T) => NewsIdentity,
  options: { now?: number; maxAgeDays?: number } = {},
) {
  const now = options.now ?? Date.now(),
    urls = new Set<string>(),
    content = new Set<string>();
  return items.filter((item) => {
    const row = identity(item);
    if (
      !row ||
      [row.date, row.title, row.content, row.url].some(
        (value) => typeof value !== 'string',
      )
    )
      return false;
    const time = newsDate(row.date);
    if (
      !Number.isFinite(time) ||
      time > now ||
      (options.maxAgeDays && time < now - options.maxAgeDays * 86400000)
    )
      return false;
    let url: URL;
    try {
      url = new URL(row.url);
      if (!['https:', 'http:'].includes(url.protocol)) return false;
    } catch {
      return false;
    }
    url.hash = '';
    const trackingKeys = [...url.searchParams.keys()].filter((key) =>
      /^(utm_|spm$|from$)/.test(key),
    );
    for (const key of trackingKeys) url.searchParams.delete(key);
    url.searchParams.sort();
    const body = normalize(row.content),
      title = normalize(row.title),
      date = new Date(time + 8 * 3600000).toISOString().slice(0, 10);
    if (!body || !title) return false;
    const byUrl = `${url.href}|${date}|${body}`,
      byContent = `${date}|${title}|${body}`;
    if (urls.has(byUrl) || content.has(byContent)) return false;
    urls.add(byUrl);
    content.add(byContent);
    return true;
  });
}
export function eventTransmission(text: string): string | null {
  if (/原料|原材料|采购价|能源价格|运费/.test(text))
    return '待公司资料核验：采购敞口与调价机制 → 成本、毛利及库存占款；观察库存周期和售价转嫁，不能直接认定公司受益。';
  if (/订单|签约|产能|投产|扩产/.test(text))
    return '待公司资料核验：订单交付、客户验收及产能利用 → 收入与现金回款；签约或规划不等于收入兑现，观察交付和应收账款。';
  if (/利率|降息|贷款|融资成本/.test(text))
    return '待公司资料核验：浮动利率债务、融资期限及实际需求 → 利息支出和现金流；观察重定价日期与债务余额，不能从宏观消息直接外推利润。';
  return null;
}
