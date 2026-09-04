import {
  abortable,
  abortableDelay,
  requestDeadline,
} from '@/lib/request-deadline';

const EASTMONEY_MIN_INTERVAL_MS = 1_100;
const EASTMONEY_GLOBAL_INTERVAL_MS = 750;
type Lane = { owner?: symbol; expiresAt: number; nextStart: number };
// Only lease metadata is shared. A canceled Worker invocation cannot leave an
// unresolved Promise blocking all future requests. Each upstream origin has
// its own serial lane; a separate global start limit still prevents bursts.
const lanes = new Map<string, Lane>();
let nextGlobalStart = 0;

async function timedFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  deadline: ReturnType<typeof requestDeadline>,
  finished: () => void,
) {
  const signal = deadline.signal;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    deadline.dispose();
    finished();
  };
  try {
    signal.throwIfAborted();
    const pending = fetch(input, { ...init, signal });
    // A transport that resolves after cancellation must not leak its body.
    void pending.then(
      (r) => {
        if (signal.aborted) void r.body?.cancel().catch(() => undefined);
      },
      () => undefined,
    );
    const response = await abortable(pending, signal);
    if (!response.body) {
      cleanup();
      return response;
    }
    const reader = response.body.getReader();
    let abortBody: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        abortBody = () => {
          controller.error(signal.reason);
          void reader.cancel(signal.reason).catch(() => undefined);
          cleanup();
        };
        signal.addEventListener('abort', abortBody, { once: true });
        if (signal.aborted) abortBody();
      },
      async pull(controller) {
        try {
          const chunk = await abortable(reader.read(), signal);
          if (done) return;
          if (chunk.done) {
            controller.close();
            signal.removeEventListener('abort', abortBody);
            cleanup();
          } else controller.enqueue(chunk.value);
        } catch (error) {
          if (!done) controller.error(error);
          signal.removeEventListener('abort', abortBody);
          cleanup();
        }
      },
      cancel(reason) {
        signal.removeEventListener('abort', abortBody);
        void reader.cancel(reason).catch(() => undefined);
        cleanup();
      },
    });
    const result = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(result, 'url', { value: response.url });
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
) {
  const deadline = requestDeadline(
    timeoutMs,
    init.signal ?? (input instanceof Request ? input.signal : null),
  );
  return timedFetch(input, init, deadline, () => {});
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
) {
  const response = await fetchWithTimeout(input, init, timeoutMs);
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function eastmoneyFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
) {
  const deadline = requestDeadline(
    timeoutMs,
    init.signal ?? (input instanceof Request ? input.signal : null),
  );
  const url = new URL(input instanceof Request ? input.url : input);
  let lane = lanes.get(url.hostname);
  if (!lane) {
    lane = { expiresAt: 0, nextStart: 0 };
    lanes.set(url.hostname, lane);
  }
  const owner = Symbol();
  const release = () => {
    if (lane.owner === owner) {
      lane.owner = undefined;
      lane.expiresAt = 0;
    }
  };
  try {
    while (true) {
      deadline.signal.throwIfAborted();
      const now = Date.now();
      if (lane.expiresAt <= now) lane.owner = undefined;
      if (!lane.owner && lane.nextStart <= now && nextGlobalStart <= now) {
        lane.owner = owner;
        lane.expiresAt = now + deadline.remaining();
        lane.nextStart = now + EASTMONEY_MIN_INTERVAL_MS;
        nextGlobalStart = now + EASTMONEY_GLOBAL_INTERVAL_MS;
        break;
      }
      await abortableDelay(
        Math.min(
          100,
          Math.max(
            1,
            lane.owner
              ? lane.expiresAt - now
              : Math.max(lane.nextStart, nextGlobalStart) - now,
          ),
        ),
        deadline.signal,
      );
    }
    const headers = new Headers(init.headers);
    if (!headers.has('User-Agent')) headers.set('User-Agent', 'Mozilla/5.0');
    return await timedFetch(input, { ...init, headers }, deadline, release);
  } catch (error) {
    deadline.dispose();
    release();
    throw error;
  }
}

export async function eastmoneyJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
) {
  const response = await eastmoneyFetch(input, init, timeoutMs);
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`东方财富 HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function stripHtml(value: string) {
  return value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
