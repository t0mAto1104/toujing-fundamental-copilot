export function stripUrls(value: unknown, maxLength = 2_000) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\[([^\]]{1,120})\]\(https?:\/\/[^\s)]+\)/gi, '$1')
    .replace(/https?:\/\/[^\s<>()\]]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normalizeSources(
  sources: Array<{ title?: unknown; url?: unknown }>,
  limit = 4,
) {
  const seen = new Set<string>();
  return sources
    .flatMap((source) => {
      if (typeof source.url !== 'string') return [];
      try {
        const url = new URL(source.url);
        if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href))
          return [];
        seen.add(url.href);
        return [
          {
            title: stripUrls(source.title, 90) || url.hostname,
            url: url.href,
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, limit);
}
