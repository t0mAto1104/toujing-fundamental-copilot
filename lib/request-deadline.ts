// Request-local cancellation only. Never share pending I/O between Worker requests.
export function requestDeadline(
  timeoutMs: number,
  parent?: AbortSignal | null,
) {
  const controller = new AbortController();
  const expiresAt = Date.now() + timeoutMs;
  const cancel = () => controller.abort(parent?.reason);
  if (parent?.aborted) cancel();
  else parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('请求超时，请稍后重试。', 'TimeoutError'),
      ),
    Math.max(0, timeoutMs),
  );
  return {
    signal: controller.signal,
    remaining: () => Math.max(0, expiresAt - Date.now()),
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', cancel);
    },
  };
}

export function abortable<T>(
  task: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    // Attach both handlers even when already aborted: late failures stay handled.
    void task
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', cancel));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}

export function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function within<T>(
  task: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const deadline = requestDeadline(timeoutMs);
  try {
    return await abortable(task, deadline.signal);
  } finally {
    deadline.dispose();
  }
}
