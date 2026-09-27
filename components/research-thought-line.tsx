'use client';

import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

// Thought Line interaction adapted from React Bits; attribution/license:
// docs/third-party/react-bits-thought-line.md. No external animation runtime.
// Mount only while a request is running; steps come from real server events.
export function ResearchThoughtLine({
  steps,
  showTimer = true,
}: {
  steps: readonly string[];
  showTimer?: boolean;
}) {
  const traceId = useId();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!showTimer) return;
    const startedAt = performance.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((performance.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [showTimer]);
  const current = steps.at(-1) || '正在连接研究服务…';

  return (
    <div className="research-thought-line">
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        研究正在进行中。{current}
      </output>
      <details open>
        <summary aria-controls={traceId}>
          <Sparkles className="research-thought-glyph" aria-hidden="true" />
          <span className="research-thought-label">研究正在进行中…</span>
          {showTimer && (
            <span className="research-thought-timer" aria-hidden="true">
              {seconds < 60
                ? `${seconds} 秒`
                : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`}
            </span>
          )}
          <ChevronDown
            className="research-thought-chevron"
            aria-hidden="true"
          />
          <span className="sr-only">展开或收起研究进度</span>
        </summary>
        <ol id={traceId} aria-label="研究进度记录">
          {(steps.length ? steps : [current]).map((message, index, items) => {
            const isCurrent = index === items.length - 1;
            return (
              <li key={`${index}-${message}`} data-current={isCurrent}>
                <span className="research-thought-mark" aria-hidden="true">
                  {isCurrent ? <span /> : <Check />}
                </span>
                <span>
                  <span className="sr-only">
                    {isCurrent ? '当前进度：' : '历史进度：'}
                  </span>
                  {message}
                </span>
              </li>
            );
          })}
        </ol>
      </details>
    </div>
  );
}
