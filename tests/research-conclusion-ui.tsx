// Synthetic UI-only fixture. No network, model requests or production imports.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../app/globals.css';
import { CustomResearchReport } from '../components/custom-research-report';
import { defaultDraft, newBlock } from '../lib/report-template';
import type { CompanyReport } from '../lib/research-types';
import type { ConclusionReview } from '../lib/research-conclusion';

function Fixture() {
  const [status, setStatus] = useState<ConclusionReview['status']>('limited');
  const template = defaultDraft();
  template.blocks = [newBlock('summary'), newBlock('sources')];
  const report: CompanyReport = {
    companyName: '离线合成样本（非真实公司）',
    companyCode: '—',
    exchange: '—',
    industry: '—',
    updatedAt: '2026-09-26',
    quote: {
      price: '—',
      change: '—',
      currency: 'CNY',
      marketCap: '—',
      asOf: '离线样本',
    },
    stance: '局部分析',
    thesis: '',
    conclusion: '',
    overview: '',
    factors: [],
    metrics: [],
    strengths: [],
    risks: [],
    catalysts: [],
    notice: '仅用于验证结论范围及缺口显示，不是真实研究报告。',
    disclaimer: '合成数据验收，不构成投资建议。',
    sources: [
      {
        title: '离线正式披露样本',
        date: '2026-08-30',
        publisher: '测试',
        url: 'https://example.test/disclosure',
      },
    ],
    customReport: {
      version: 'custom-report-v4',
      template,
      checks: [],
      gaps: ['历史估值：接口超时。'],
      sections: {
        summary: {
          facts: '样本公司披露了产品认证进展。',
          analysis:
            status === 'withheld'
              ? '本轮尚无适合形成结论的已核验分析，请按具体原因补证。'
              : '产品竞争力取决于客户认证与技术积累。',
          counterEvidence: '认证延迟可能影响产品推广。',
          watchFor: '跟踪认证完成情况。',
          sourceUrls:
            status === 'withheld' ? [] : ['https://example.test/disclosure'],
          dataGaps: [],
        },
      },
      conclusionReview: {
        version: 'scoped-conclusion-v1',
        status,
        basis: status === 'withheld' ? [] : ['summary'],
        limitations: [
          '估值或同业资料受限，不据此形成高低估判断。具体缺口：历史估值接口超时。',
          '最新正式披露全文尚未完整读取，仅基于已取得片段和接口数据。',
          '股东或资金资料受限：两融明细未取得。',
          '缺少2025年同期财务数据，不计算同比。',
        ],
        resolvedGaps: [
          {
            original: '未取得营业收入',
            sourceUrls: ['https://example.test/disclosure'],
          },
        ],
      },
    },
  };
  return (
    <main style={{ maxWidth: 980, margin: 'auto', padding: 20 }}>
      <h1>结论范围 · 离线界面验收</h1>
      <nav
        aria-label="验收场景"
        style={{ display: 'flex', gap: 16, margin: '16px 0', flexWrap: 'wrap' }}
      >
        {(['conditional', 'limited', 'withheld'] as const).map((id) => (
          <button
            key={id}
            onClick={() => setStatus(id)}
            aria-pressed={status === id}
          >
            {
              {
                conditional: '条件分析',
                limited: '局部分析',
                withheld: '暂缓综合判断',
              }[id]
            }
          </button>
        ))}
      </nav>
      <CustomResearchReport report={report} />
    </main>
  );
}
createRoot(document.getElementById('conclusion-fixture')!).render(<Fixture />);
