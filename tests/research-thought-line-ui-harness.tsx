// Offline-only fixture for the REAL report client. No credentials or real APIs.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Research from '../app/company/[slug]/research-client';
import type { CompanyReport } from '../lib/research-types';
import '../app/globals.css';

let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
let analyzeCalls = 0;
let progressReads = 0;
let delayStream = false;
let releaseHeaders: (() => void) | undefined;
let taskState = {
  id: 'offline',
  status: 'queued',
  message: '待启动',
  updatedAt: new Date().toISOString(),
};
const steps = [
  '正在检索官方来源…',
  '正在核验财报与行业证据…',
  '正在撰写业务分析…',
  '正在撰写财务分析与结论…',
];
let stepIndex = 0;
const encoder = new TextEncoder();
const report = {
  companyName: '离线验收公司',
  companyCode: '000000',
  exchange: '测试',
  industry: '测试',
  updatedAt: '2026-09-25',
  stance: '待核验',
  thesis: '等待动效离线验收已完成。',
  conclusion: '本页仅为界面测试，不是真实研报。',
  overview: '未调用任何模型或金融数据接口。',
  quote: {
    price: '—',
    change: '—',
    currency: 'CNY',
    marketCap: '—',
    asOf: '离线测试',
  },
  metrics: [],
  factors: [],
  strengths: [],
  risks: [],
  catalysts: [],
  sources: [],
  disclaimer: '离线测试，不构成投资建议。',
  researchRun: {
    taskId: 'offline',
    model: '离线模拟',
    frameworkVersion: 'test',
    evidenceAsOf: '测试',
    financialPeriods: [],
  },
} as unknown as CompanyReport;
function emit(
  event: { type: string; message?: string; [key: string]: unknown },
  close = false,
) {
  if (event.type === 'progress') {
    taskState = {
      ...taskState,
      message: event.message!,
      updatedAt: new Date().toISOString(),
    };
    event.updatedAt = taskState.updatedAt;
  }
  stream?.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  if (close) {
    stream?.close();
    stream = undefined;
    releaseHeaders?.();
    releaseHeaders = undefined;
  }
}
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof Request
        ? input.url
        : input.href,
    location.origin,
  );
  if (url.pathname === '/api/listings') return Response.json({ listings: [] });
  if (url.pathname === '/api/reports')
    return Response.json({
      report: { id: 'offline', query: '离线验收公司', report },
    });
  if (url.pathname === '/api/research-tasks') {
    if (init?.method === 'POST') return Response.json({ tasks: [taskState] });
    if (url.searchParams.get('progress') === '1') {
      progressReads++;
      return Response.json({ task: taskState });
    }
    return Response.json({
      task: {
        ...taskState,
        query: '离线验收公司',
        listing: { id: 'offline', code: '000000' },
      },
    });
  }
  if (url.pathname === '/api/analyze') {
    analyzeCalls++;
    stepIndex = 0;
    taskState = {
      ...taskState,
      status: 'running',
      message: '正在读取多期财报…',
      updatedAt: new Date().toISOString(),
    };
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
          controller.enqueue(
            encoder.encode('{"type":"task","taskId":"offline"}\n'),
          );
          init?.signal?.addEventListener(
            'abort',
            () => {
              if (stream === controller) {
                controller.error(new DOMException('Aborted', 'AbortError'));
                stream = undefined;
              }
            },
            { once: true },
          );
        },
        cancel() {
          stream = undefined;
        },
      }),
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    );
    if (!delayStream) return response;
    return new Promise<Response>((resolve, reject) => {
      releaseHeaders = () => resolve(response);
      init?.signal?.addEventListener(
        'abort',
        () => reject(init.signal?.reason),
        { once: true },
      );
    });
  }
  // Do not forward unrecognised requests to a real service.
  return Response.json({ error: '离线验收：此接口未启用' }, { status: 503 });
};

function Fixture() {
  const [run, setRun] = useState(0),
    [visible, setVisible] = useState(true);
  const [calls, setCalls] = useState(0);
  const [reads, setReads] = useState(0);
  return (
    <>
      <nav
        aria-label="离线测试控制"
        className="flex flex-wrap gap-2 border-b border-border bg-card p-3 text-sm [&_button]:min-h-11 [&_button]:rounded [&_button]:border [&_button]:border-border [&_button]:px-3"
      >
        <span className="w-full text-muted-foreground">
          离线验收 · 不调用模型、不获取金融数据
        </span>
        <button
          onClick={() => {
            delayStream = true;
            taskState = { ...taskState, status: 'queued' };
            history.replaceState(
              {},
              '',
              `${location.pathname}?task=offline&start=1`,
            );
            setVisible(true);
            setRun((n) => n + 1);
          }}
        >
          模拟流式延迟
        </button>
        <button
          onClick={() =>
            emit({
              type: 'progress',
              message: steps[Math.min(stepIndex++, steps.length - 1)],
            })
          }
        >
          下一阶段
        </button>
        <button onClick={() => emit({ type: 'report', report }, true)}>
          模拟完成
        </button>
        <button
          onClick={() =>
            emit({ type: 'error', error: '模拟网络中断，请手动重试。' }, true)
          }
        >
          模拟失败
        </button>
        <button
          onClick={() => {
            delayStream = false;
            setVisible(false);
          }}
        >
          离开等待页
        </button>
        <button
          onClick={() => {
            delayStream = false;
            history.replaceState({}, '', location.pathname);
            setVisible(true);
            setRun((n) => n + 1);
          }}
        >
          重新演示
        </button>
        <button
          onClick={() => {
            history.replaceState({}, '', `${location.pathname}?saved=offline`);
            setVisible(true);
            setRun((n) => n + 1);
          }}
        >
          打开已保存报告
        </button>
        <button
          onClick={() => document.documentElement.classList.toggle('dark')}
        >
          切换明暗
        </button>
        <button
          onClick={() => {
            setCalls(analyzeCalls);
            setReads(progressReads);
          }}
        >
          检查调用次数
        </button>
        <span>
          模拟研究请求：{calls} · 只读进度查询：{reads}
        </span>
      </nav>
      {visible ? <Research key={run} /> : <p>已离开等待页。</p>}
    </>
  );
}
createRoot(document.getElementById('thought-line-fixture')!).render(
  <Fixture />,
);
