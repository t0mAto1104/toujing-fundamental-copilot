// Callers validate disclosure host/path before entering this transport.
// Workers rejects redirect: 'error' before sending the request. Manual mode
// plus explicit rejection preserves the same no-redirect security boundary.
export async function readDisclosureBytes(
  url: string,
  options: {
    headers: HeadersInit;
    limit: number;
    timeoutMs: number;
    signal?: AbortSignal;
  },
) {
  const response = await fetch(url, {
    headers: options.headers,
    redirect: 'manual',
    signal: options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(options.timeoutMs),
        ])
      : AbortSignal.timeout(options.timeoutMs),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error('披露源返回跳转，已按安全策略停止读取');
  }
  if (
    !response.ok ||
    Number(response.headers.get('content-length')) > options.limit
  ) {
    await response.body?.cancel();
    throw new Error('披露文件不可达或超过大小限制');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('披露文件无正文');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > options.limit) {
        await reader.cancel();
        throw new Error('披露文件超出安全大小');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
