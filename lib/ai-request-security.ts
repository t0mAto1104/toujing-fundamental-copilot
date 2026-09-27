import { ResearchAccessError } from '@/lib/site-users';

export function assertSameOriginAIRequest(request: Request) {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    origin !== new URL(request.url).origin ||
    (fetchSite && fetchSite !== 'same-origin') ||
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json'
  ) {
    throw new ResearchAccessError(
      '请从本站页面提交此操作。',
      'request_forbidden',
      403,
    );
  }
}
export async function readAIRequestJSON(
  request: Request,
  maxBytes = 16_384,
): Promise<Record<string, any>> {
  assertSameOriginAIRequest(request);
  const reader = request.body?.getReader();
  if (!reader)
    throw new ResearchAccessError('请求内容为空。', 'invalid_request', 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new ResearchAccessError('请求内容过长。', 'invalid_request', 413);
    }
    chunks.push(value);
  }
  try {
    const data = new Uint8Array(length);
    let offset = 0;
    for (const part of chunks) {
      data.set(part, offset);
      offset += part.length;
    }
    const body = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(data),
    );
    if (!body || Array.isArray(body) || typeof body !== 'object')
      throw new Error();
    return body;
  } catch {
    throw new ResearchAccessError('请求格式无效。', 'invalid_request', 400);
  }
}
