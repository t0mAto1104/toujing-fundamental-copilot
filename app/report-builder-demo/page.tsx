'use client';
/* oxlint-disable next/no-html-link-for-pages -- hosted authentication uses full-page navigation. */

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  FileText,
  GripVertical,
  Layers3,
  LockKeyhole,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { CompanySearchField } from '@/components/company-search-field';
import { MobileWorkspaceNav } from '@/components/mobile-workspace-nav';
import { useWorkspaceSession } from '@/components/workspace-session';
import { AI_MODELS, defaultResearchModel } from '@/lib/ai-models';
import type { ListingOption } from '@/lib/market-listings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  MODULES,
  MODULE_CHECKLISTS,
  TEMPLATE_LABELS,
  ANALYSIS_STRUCTURE,
  isProgramModule,
  STORAGE_KEY,
  defaultDraft,
  generationSpec,
  moveBlock,
  newBlock,
  paginate,
  parseDraft,
  validateResearchTemplate,
  type Block,
  type ModuleId,
  type PagePart,
  type TemplateId,
} from './model';
import './style.css';

function PaperContent({ block }: { block: Block }) {
  if (
    ['snapshot', 'fiveFactors', 'calculations', 'audit', 'methods'].includes(
      block.id,
    )
  ) {
    const rows: Record<string, string[][]> = {
      snapshot: [
        ['证券名称 / 代码 / 上市地', '待绑定研究对象'],
        ['股价 / 涨跌 / 市值 / 币种', '待接入真实行情'],
        ['行情与资料截止时点', '待取数后记录'],
        ['报告版本 / 证据快照', '生成时记录'],
      ],
      fiveFactors: ['政策', '行业', '资金', '财报', '宏观'].map((name) => [
        name,
        '待核验 · 需事实、来源与公司传导',
      ]),
      calculations: [
        ['TTM', '上年全年 + 本期累计 − 上年同期'],
        ['单季', '本期累计 − 前期累计'],
        ['同比', '同口径对比；异常基期不硬算'],
        ['简化现金结余', '经营现金流 − 购建支出；非标准 FCF'],
      ],
      audit: [
        ['正式披露正文 / 财报时效', '待检查'],
        ['财务口径 / 业务拆分 / 五维证据', '待检查'],
        ['跨章一致性', '待检查'],
        ['采集时间 / 成败及原因', '待记录'],
      ],
      methods: [
        ['主营业务 / 行业匹配', '待确认'],
        ['研究方法 / 版本', '待实际选用后记录'],
        ['行业经营信号 / 来源', '待补证'],
      ],
    };
    return (
      <>
        <p className="paper-copy">
          {MODULES.find((m) => m.id === block.id)?.description}
        </p>
        <table className="paper-table">
          <thead>
            <tr>
              <th>核验项目</th>
              <th>
                {block.id === 'calculations' ? '计算规则' : '状态 / 要求'}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows[block.id].map(([name, value]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="paper-note">
          {isProgramModule(block.id)
            ? '程序输出的版式示意；生成后填入真实数据和核验结果。'
            : '缺少证据不默认为中性；不适用也需依据。'}
        </p>
      </>
    );
  }
  if (block.id === 'finance' || block.id === 'peers')
    return (
      <>
        <p className="paper-copy">
          {block.id === 'finance'
            ? '从利润兑现到现金回收，交叉检验经营质量。'
            : '优先选择业务相似且财务口径可比的公司。'}
        </p>
        <table className="paper-table">
          <thead>
            <tr>
              <th>关键指标</th>
              <th>最新报告期</th>
              <th>对比期</th>
            </tr>
          </thead>
          <tbody>
            {['营业收入', '归母净利润', '经营现金流'].map((x) => (
              <tr key={x}>
                <td>{x}</td>
                <td>待核验</td>
                <td>待核验</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="paper-note">
          示意表格 · 接入后填入真实数据、期间、单位与来源。
        </p>
      </>
    );
  if (block.id === 'summary')
    return (
      <>
        <p className="paper-highlight">
          核心判断应当可以被证据支持，也可以被反证推翻。
        </p>
        <div className="paper-insights">
          <div>
            <strong>01 / 经营变化</strong>
            <p>是什么驱动收入与利润变化？</p>
          </div>
          <div>
            <strong>02 / 证据检验</strong>
            <p>现金流是否支持盈利表现？</p>
          </div>
          <div>
            <strong>03 / 关键反证</strong>
            <p>哪些变化会推翻当前判断？</p>
          </div>
        </div>
      </>
    );
  if (block.id === 'business')
    return (
      <>
        <p className="paper-copy">研究产品与收入结构，追溯盈利的来源。</p>
        <div className="paper-business">
          <div>
            <span>业务拆解</span>
            <strong>产品 / 客户 / 市场</strong>
          </div>
          <div>
            <span>竞争优势</span>
            <strong>能力 / 壁垒 / 持续性</strong>
          </div>
        </div>
        <p className="paper-note">证据要求：公司公告、定期报告和经营披露。</p>
      </>
    );
  if (block.id === 'sources')
    return (
      <>
        <p className="paper-copy">结论可追溯，缺口不隐藏。</p>
        <table className="paper-table">
          <thead>
            <tr>
              <th>证据项目</th>
              <th>核验状态</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>原始公告与财务数据</td>
              <td>待接入真实来源</td>
            </tr>
            <tr>
              <td>来源冲突 / 信息缺口</td>
              <td>生成时逐项披露</td>
            </tr>
          </tbody>
        </table>
        <p className="paper-note">此处是版式示意，不是已完成的公司研究。</p>
      </>
    );
  const fields: Record<string, string[]> = {
    industry: ['供需与竞争格局', '政策到业绩的传导路径'],
    valuation: ['估值方法与基期', '情景假设与敏感性'],
    risk: ['风险与触发条件', '下一步跟踪指标'],
    catalysts: ['已经发生的事件', '尚未兑现的事项'],
    ownership: ['股本与主要股东', '资金变化的局限性'],
    drivers: [
      '逐业务经营基准',
      '量价成本到利润与现金流的传导',
      '反证条件与经营验证',
    ],
    governance: [
      '分红、融资与项目回报',
      '关联交易、担保质押与受限资金',
      '联营投资收益与治理边界',
    ],
  };
  return (
    <div
      className={block.layout === 'columns' ? 'paper-two-col' : 'paper-topics'}
    >
      {(fields[block.id] || ['研究问题', '证据与核验']).map((x, i) => (
        <div key={x}>
          <h4>
            {String(i + 1).padStart(2, '0')} / {x}
          </h4>
          <p className="paper-copy">
            {i === 0
              ? block.requirement.slice(0, 90)
              : '引用实际取得的资料，写清推导过程；证据不足时明确保留判断。'}
          </p>
          <span className="paper-evidence">待关联来源</span>
        </div>
      ))}
    </div>
  );
}

function ReportPage({
  parts,
  index,
  count,
  title,
  active,
  select,
}: {
  parts: PagePart[];
  index: number;
  count: number;
  title: string;
  active?: ModuleId;
  select?: (id: ModuleId) => void;
}) {
  return (
    <article className="rb-paper" aria-label={`报告第 ${index + 1} 页`}>
      <header className="paper-masthead">
        <span>透镜 TOUJING</span>
        <span>FUNDAMENTAL RESEARCH</span>
      </header>
      <div className="paper-title">
        <span>公司研究 / 版式样例</span>
        <h2>{title || '公司基本面深度研究'}</h2>
        <p>结构预览，不含真实公司分析或实时数据</p>
      </div>
      <div className="paper-body">
        {parts.map(({ block, units, continuation }) => (
          <section
            key={block.id}
            className={`paper-block ${active === block.id && select ? 'paper-selected' : ''}`}
            style={{ flex: units }}
          >
            {select ? (
              <button
                className="paper-block-heading"
                onClick={() => select(block.id)}
                aria-label={`编辑${block.title}`}
              >
                <span className="paper-block-mark" />
                <h3>
                  {block.title}
                  {continuation ? ' · 续' : ''}
                </h3>
                <Settings2 size={14} />
              </button>
            ) : (
              <div className="paper-block-heading">
                <span className="paper-block-mark" />
                <h3>
                  {block.title}
                  {continuation ? ' · 续' : ''}
                </h3>
              </div>
            )}
            <div
              className={
                block.layout === 'columns' ? 'paper-content-columns' : ''
              }
            >
              <PaperContent block={block} />
            </div>
          </section>
        ))}
      </div>
      <footer className="paper-footer">
        <span>仅供研究参考 · 不构成投资建议</span>
        <span>
          {String(index + 1).padStart(2, '0')} /{' '}
          {String(count).padStart(2, '0')}
        </span>
      </footer>
    </article>
  );
}

export default function ReportBuilderDemo() {
  const { user } = useWorkspaceSession();
  const [company, setCompany] = useState('');
  const [targetCompany, setTargetCompany] = useState<{
    query: string;
    listing?: ListingOption;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const createLock = useRef(false);
  const [runError, setRunError] = useState('');
  const [chosenModel, setChosenModel] = useState('');
  const allowedModels = AI_MODELS.filter((m) =>
    user?.allowedAIModels?.includes(m.id),
  );
  const model = allowedModels.some((m) => m.id === chosenModel)
    ? chosenModel
    : user?.preferredResearchModel ||
      defaultResearchModel(user?.allowedAIModels || []);
  const [draft, setDraft] = useState(defaultDraft);
  const [active, setActive] = useState<ModuleId>('summary');
  const [adding, setAdding] = useState<ModuleId>('peers');
  const [pageIndex, setPageIndex] = useState(0);
  const [status, setStatus] = useState('默认结构已就绪');
  const [dialog, setDialog] = useState<'preview' | 'spec' | 'reset' | null>(
    null,
  );
  const [dragged, setDragged] = useState<ModuleId | null>(null);
  const [dropTarget, setDropTarget] = useState<ModuleId | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<TemplateId | null>(
    null,
  );
  const draggedRef = useRef<ModuleId | null>(null);
  const pages = paginate(draft.blocks);
  const shownPage = Math.min(pageIndex, pages.length - 1);
  const selected = draft.blocks.find((b) => b.id === active) || draft.blocks[0];
  const available = MODULES.filter(
    (m) => !draft.blocks.some((b) => b.id === m.id),
  );
  const addId = available.some((m) => m.id === adding)
    ? adding
    : available[0]?.id;
  const spec = generationSpec(draft);
  const overLimit = pages.length > draft.pageLimit;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Preserve company links into the assistant without starting paid research.
      const query = new URLSearchParams(window.location.search).get('query');
      if (query) setCompany(query.trim().slice(0, 500));
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = parseDraft(raw);
          if (saved) {
            setDraft(saved);
            setActive(saved.blocks[0].id);
            setStatus('已载入本机保存的模板');
          } else setStatus('本机模板无法读取，已使用默认结构');
        }
      } catch {
        setStatus('本机存储不可用，仍可编辑和预览');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function edit(next: Partial<typeof draft>) {
    setDraft((d) => ({ ...d, ...next, templateId: 'custom' }));
    setStatus('有未保存的修改');
  }
  function updateBlock(next: Partial<Block>) {
    if (selected.id === 'sources') return;
    edit({
      blocks: draft.blocks.map((b) =>
        b.id === selected.id ? { ...b, ...next } : b,
      ),
    });
  }
  function select(id: ModuleId) {
    setActive(id);
    const p = pages.findIndex((parts) =>
      parts.some((part) => part.block.id === id),
    );
    if (p >= 0) setPageIndex(p);
  }
  function move(id: ModuleId, index: number) {
    const blocks = moveBlock(draft.blocks, id, index);
    edit({ blocks });
    setActive(id);
    setPageIndex(
      paginate(blocks).findIndex((p) => p.some((part) => part.block.id === id)),
    );
    setStatus('模块顺序已更新，尚未保存');
  }
  function remove(id: ModuleId) {
    if (id === 'sources') return;
    const blocks = draft.blocks.filter((b) => b.id !== id);
    edit({ blocks });
    if (active === id) {
      setActive(blocks[0].id);
      setPageIndex(0);
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      setStatus('模板已保存到当前浏览器');
    } catch {
      setStatus('保存失败：浏览器存储不可用，可下载生成要求备份');
    }
  }
  function downloadSpec() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = '透镜-自定义研报要求.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('已下载生成要求；未发送给 AI');
  }
  async function startResearch() {
    if (createLock.current || !targetCompany) return;
    createLock.current = true;
    setCreating(true);
    setRunError('');
    try {
      const reportTemplate = validateResearchTemplate(draft);
      const response = await fetch('/api/research-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              query: targetCompany.query,
              listingId: targetCompany.listing?.id,
            },
          ],
          model,
          reportTemplate,
          confirmed: true,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await response.json()) as {
        error?: string;
        tasks?: Array<{ id: string }>;
      };
      if (!response.ok || !data.tasks?.[0]?.id)
        throw new Error(data.error || '无法创建研究任务。');
      window.location.assign(
        `/company/research?task=${encodeURIComponent(data.tasks[0].id)}&start=1`,
      );
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : '创建失败，编辑内容已保留。',
      );
      createLock.current = false;
      setCreating(false);
    }
  }
  return (
    <main className="report-builder-demo">
      <header className="rb-header">
        <MobileWorkspaceNav active="research" />
        <a href="/" className="rb-brand" aria-label="返回透镜首页">
          <BrandMark />
          <strong>透镜</strong>
          <span>AI自定义研报</span>
        </a>
        <div className="rb-header-right">
          <span className="rb-demo-badge">自定义研究</span>
          <a href="/reports">
            <ArrowLeft size={15} />
            返回我的报告
          </a>
        </div>
      </header>
      <div className="rb-intro">
        <div>
          <p className="rb-eyebrow">REPORT STUDIO</p>
          <h1>
            AI自定义研报<span>从研究问题，到你的报告。</span>
          </h1>
        </div>
        <div className="rb-actions">
          <Button variant="outline" onClick={save}>
            <Save />
            保存模板
          </Button>
          <Button onClick={() => setDialog('preview')} disabled={overLimit}>
            <Eye />
            预览版式
          </Button>
        </div>
      </div>
      <section className="rb-run-bar" aria-label="生成自定义研报">
        <div className="rb-run-search">
          <h2>选择研究公司</h2>
          <CompanySearchField
            value={company}
            onValueChange={setCompany}
            showButton
            buttonLabel="生成研报"
            onResearch={(query, listing) => {
              if (creating) return;
              setRunError('');
              if (!user) {
                setRunError('请先登录，再生成真实研报。');
                return;
              }
              try {
                validateResearchTemplate(draft);
                setTargetCompany({ query, listing });
              } catch (e) {
                setRunError((e as Error).message);
              }
            }}
          />
        </div>
        <label className="rb-run-model">
          本次研究模型
          <NativeSelect
            aria-label="本次研究模型"
            value={model}
            onChange={(e) => setChosenModel(e.target.value)}
            disabled={!user || creating || !allowedModels.length}
          >
            {allowedModels.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <p>
          按当前模块、要求和顺序生成，完成后存入「我的报告」。页数为篇幅预算，实际
          PDF 随内容自然分页，不截断来源或证据。
        </p>
        {!user && (
          <a
            href="/signin-with-chatgpt?return_to=%2Freport-builder"
            className="text-primary underline"
          >
            登录后生成
          </a>
        )}
        {runError && (
          <p role="alert" className="text-destructive">
            {runError}
          </p>
        )}
      </section>
      <div className="rb-template-bar">
        <label htmlFor="report-template">
          <FileText size={16} />
          报告模板
        </label>
        <NativeSelect
          id="report-template"
          value={draft.templateId || 'custom'}
          onChange={(e) => setPendingTemplate(e.target.value as TemplateId)}
        >
          <NativeSelectOption value="brief">
            简版 · 默认 7 模块
          </NativeSelectOption>
          <NativeSelectOption value="deep">深度版 · 17 模块</NativeSelectOption>
          <NativeSelectOption value="custom" disabled>
            自定义 · 已调整
          </NativeSelectOption>
        </NativeSelect>
        <p>
          {draft.templateId === 'deep'
            ? '覆盖经营归因、治理、五维证据及核验附录。'
            : draft.templateId === 'brief'
              ? '保留 7 个核心模块，其余按需添加。'
              : '已保留你的调整，可从模板重新开始。'}
        </p>
        <span>
          模块库 <b>{MODULES.length}</b> 项
        </span>
      </div>
      <div className="rb-toolbar">
        <div className="rb-toolbar-add">
          <label htmlFor="add-module">
            <Layers3 size={16} />
            添加研究模块
          </label>
          <NativeSelect
            id="add-module"
            value={addId || ''}
            onChange={(e) => setAdding(e.target.value as ModuleId)}
            disabled={!available.length}
          >
            {available.length ? (
              [false, true].map((program) => (
                <NativeSelectOptGroup
                  key={String(program)}
                  label={
                    program ? '数据与核验附录 · 程序输出' : '研究分析 · AI 写作'
                  }
                >
                  {available
                    .filter((m) => isProgramModule(m.id) === program)
                    .map((m) => (
                      <NativeSelectOption key={m.id} value={m.id}>
                        {m.title}
                      </NativeSelectOption>
                    ))}
                </NativeSelectOptGroup>
              ))
            ) : (
              <NativeSelectOption value="">全部模块已添加</NativeSelectOption>
            )}
          </NativeSelect>
          <Button
            variant="secondary"
            disabled={!addId}
            onClick={() => {
              if (!addId) return;
              const blocks = [
                ...draft.blocks.slice(0, -1),
                newBlock(addId),
                draft.blocks.at(-1)!,
              ];
              edit({ blocks });
              setActive(addId);
              setPageIndex(
                paginate(blocks).findIndex((p) =>
                  p.some((part) => part.block.id === addId),
                ),
              );
            }}
          >
            <Plus />
            添加
          </Button>
        </div>
        <div className="rb-toolbar-meta">
          <span>
            <FileText size={15} />
            <b>{pages.length}</b> / {draft.pageLimit} 页
          </span>
          <span>{draft.blocks.length} 个模块</span>
          <Button variant="ghost" onClick={() => setDialog('reset')}>
            <RotateCcw />
            恢复默认
          </Button>
        </div>
      </div>
      <div className="rb-workspace">
        <aside className="rb-outline">
          <div className="rb-panel-heading">
            <h2>报告结构</h2>
            <span>{String(draft.blocks.length).padStart(2, '0')}</span>
          </div>
          <p className="rb-hint">拖动调整顺序，点击编辑要求</p>
          <ol className="rb-module-list">
            {draft.blocks.map((block, index) => {
              const locked = block.id === 'sources';
              const firstPage =
                pages.findIndex((p) =>
                  p.some((part) => part.block.id === block.id),
                ) + 1;
              return (
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- optional pointer drop target; keyboard users have labeled up/down buttons.
                <li
                  key={block.id}
                  className={`rb-module ${selected.id === block.id ? 'is-active' : ''} ${dragged === block.id ? 'is-dragging' : ''} ${dropTarget === block.id ? 'is-drop-target' : ''}`}
                  data-module={block.id}
                  onDragOver={(e) => {
                    if (draggedRef.current) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropTarget(block.id);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedRef.current) move(draggedRef.current, index);
                    draggedRef.current = null;
                    setDragged(null);
                    setDropTarget(null);
                  }}
                >
                  <div className="rb-module-main">
                    <button
                      className="rb-grip"
                      disabled={locked}
                      draggable={!locked}
                      aria-label={
                        locked ? '来源模块固定保留' : `拖动${block.title}`
                      }
                      title="拖动排序，也可使用下方上下移按钮"
                      onDragStart={(e) => {
                        draggedRef.current = block.id;
                        setDragged(block.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', block.id);
                      }}
                      onDragEnd={() => {
                        draggedRef.current = null;
                        setDragged(null);
                        setDropTarget(null);
                      }}
                    >
                      {locked ? (
                        <LockKeyhole size={15} />
                      ) : (
                        <GripVertical size={17} />
                      )}
                    </button>
                    <button
                      className="rb-module-select"
                      onClick={() => select(block.id)}
                      aria-pressed={selected.id === block.id}
                    >
                      <strong>{block.title}</strong>
                      <span>
                        第 {firstPage} 页 · {block.units / 2} 页篇幅
                      </span>
                    </button>
                    <span className="rb-order">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>
                  {!locked && (
                    <div className="rb-module-tools">
                      <span>{MODULES.find((m) => m.id === block.id)?.tag}</span>
                      <button
                        aria-label={`上移${block.title}`}
                        disabled={index === 0}
                        onClick={() => move(block.id, index - 1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        aria-label={`下移${block.title}`}
                        disabled={index >= draft.blocks.length - 2}
                        onClick={() => move(block.id, index + 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        aria-label={`删除${block.title}`}
                        onClick={() => remove(block.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="rb-evidence">
            <ShieldCheck size={18} />
            <div>
              <strong>精简篇幅，不删减依据</strong>
              <p>来源、数据缺口和免责声明始终保留。</p>
            </div>
          </div>
        </aside>
        <section className="rb-canvas" aria-label="版式画布">
          <div className="rb-canvas-bar">
            <span>
              <Eye size={15} />
              实时版式预览
            </span>
            <span>A4 · 纵向</span>
          </div>
          <div className="rb-paper-scroller">
            <ReportPage
              parts={pages[shownPage]}
              index={shownPage}
              count={pages.length}
              title={draft.title}
              active={selected.id}
              select={select}
            />
          </div>
          <div className="rb-page-nav">
            <Button
              variant="ghost"
              aria-label="上一页"
              disabled={shownPage === 0}
              onClick={() => setPageIndex(shownPage - 1)}
            >
              <ChevronLeft />
            </Button>
            <div>
              {pages.map((_, index) => (
                <button
                  key={index}
                  className={shownPage === index ? 'active' : ''}
                  aria-label={`查看第 ${index + 1} 页`}
                  aria-current={shownPage === index ? 'page' : undefined}
                  onClick={() => setPageIndex(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              aria-label="下一页"
              disabled={shownPage === pages.length - 1}
              onClick={() => setPageIndex(shownPage + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </section>
        <aside className="rb-settings">
          <div className="rb-panel-heading">
            <h2>
              <Settings2 size={16} />
              模块设置
            </h2>
            <span>当前选中</span>
          </div>
          <div className="rb-settings-body">
            <div className="rb-selected-label">
              <span>{MODULES.find((m) => m.id === selected.id)?.tag}</span>
              <h3>{selected.title}</h3>
              <p>{MODULES.find((m) => m.id === selected.id)?.description}</p>
            </div>
            <details className="rb-checklist">
              <summary>
                模块核验清单 · {MODULE_CHECKLISTS[selected.id].length} 项
              </summary>
              <ul>
                {MODULE_CHECKLISTS[selected.id].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p>
                {isProgramModule(selected.id)
                  ? '内容规则固定，由程序取数、计算或归档；可调整标题和版式，不交给 AI 编写事实。'
                  : `分析结构：${ANALYSIS_STRUCTURE.join(' → ')}。`}
              </p>
            </details>
            {selected.id === 'sources' ? (
              <div className="rb-locked">
                <LockKeyhole size={18} />
                <p>
                  此模块固定在末尾，保留关键来源与未核验事项。不能删除或改写核验规则。
                </p>
              </div>
            ) : (
              <>
                <label className="rb-field" htmlFor="rb-module-title">
                  模块标题
                  <Input
                    id="rb-module-title"
                    value={selected.title}
                    maxLength={32}
                    onChange={(e) =>
                      updateBlock({
                        title:
                          e.target.value ||
                          MODULES.find((m) => m.id === selected.id)!.title,
                      })
                    }
                  />
                </label>
                <label className="rb-field" htmlFor="rb-module-requirement">
                  内容要求
                  <Textarea
                    id="rb-module-requirement"
                    aria-label="内容要求"
                    aria-describedby="module-requirement-hint"
                    readOnly={isProgramModule(selected.id)}
                    value={selected.requirement}
                    maxLength={1000}
                    rows={5}
                    onChange={(e) =>
                      updateBlock({ requirement: e.target.value })
                    }
                  />
                  <span id="module-requirement-hint" className="rb-helper">
                    写清问题、口径和优先证据。留空将使用该模块默认要求。
                  </span>
                </label>
                <div className="rb-field-row">
                  <label className="rb-field" htmlFor="rb-module-units">
                    篇幅预算
                    <NativeSelect
                      id="rb-module-units"
                      aria-label="模块篇幅预算"
                      value={selected.units}
                      onChange={(e) =>
                        updateBlock({ units: Number(e.target.value) })
                      }
                    >
                      <NativeSelectOption value={1}>
                        半页 · 简洁
                      </NativeSelectOption>
                      <NativeSelectOption value={2}>
                        1 页 · 标准
                      </NativeSelectOption>
                      <NativeSelectOption value={4}>
                        2 页 · 深入
                      </NativeSelectOption>
                    </NativeSelect>
                  </label>
                  <label className="rb-field" htmlFor="rb-module-layout">
                    内容排版
                    <NativeSelect
                      id="rb-module-layout"
                      aria-label="内容排版"
                      value={selected.layout}
                      onChange={(e) =>
                        updateBlock({
                          layout: e.target.value as Block['layout'],
                        })
                      }
                    >
                      <NativeSelectOption value="text">
                        单栏叙述
                      </NativeSelectOption>
                      <NativeSelectOption value="columns">
                        双栏分组
                      </NativeSelectOption>
                    </NativeSelect>
                  </label>
                </div>
                <label className="rb-check">
                  <input
                    type="checkbox"
                    checked={selected.breakBefore}
                    onChange={(e) =>
                      updateBlock({ breakBefore: e.target.checked })
                    }
                  />
                  本模块另起一页
                </label>
              </>
            )}
            <div className="rb-divider" />
            <h3 className="rb-settings-subtitle">
              <ClipboardList size={16} />
              整份报告
            </h3>
            <label className="rb-field" htmlFor="rb-title">
              报告名称
              <Input
                id="rb-title"
                value={draft.title}
                maxLength={60}
                onChange={(e) => edit({ title: e.target.value })}
              />
            </label>
            <label className="rb-field" htmlFor="rb-question">
              核心研究问题
              <Textarea
                id="rb-question"
                aria-label="核心研究问题"
                value={draft.question}
                maxLength={600}
                rows={2}
                onChange={(e) => edit({ question: e.target.value })}
              />
            </label>
            <label className="rb-field">
              总页数上限
              <NativeSelect
                aria-label="总页数上限"
                value={draft.pageLimit}
                onChange={(e) => edit({ pageLimit: Number(e.target.value) })}
              >
                {[4, 6, 8, 12, 16].map((n) => (
                  <NativeSelectOption value={n} key={n}>
                    {n} 页以内
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            {overLimit && (
              <p role="alert" className="rb-warning">
                当前排版 {pages.length}{' '}
                页，超过上限。请减少模块篇幅、取消分页或调高上限；不会自动裁掉内容。
              </p>
            )}
            <div className="rb-budget">
              <div>
                <Sparkles size={16} />
                <strong>按需研究，按章写作</strong>
              </div>
              <p>
                展示内容预算约{' '}
                <b>{spec.estimatedBodyCharacters.toLocaleString()}</b> 字<br />
                其中 AI 写作预算约{' '}
                <b>{spec.aiWritingCharacterBudget.toLocaleString()}</b> 字<br />
                {spec.programModuleCount} 个程序输出模块不安排 AI 写作
              </p>
              <span>字数为设计预算，并非 Token 或费用估算。</span>
              <button onClick={() => setDialog('spec')}>
                查看生成要求 <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </aside>
      </div>
      <footer className="rb-status">
        <output>
          <CheckCheck size={15} />
          {status}
        </output>
        <span>编辑与预览不消耗 Token · 确认生成后调用 AI</span>
      </footer>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent
          className={`rb-dialog ${dialog === 'preview' ? 'rb-preview-dialog' : ''}`}
        >
          <DialogTitle>
            {dialog === 'preview'
              ? '报告预览'
              : dialog === 'spec'
                ? '结构化生成要求'
                : '恢复默认结构？'}
          </DialogTitle>
          <DialogDescription>
            {dialog === 'preview'
              ? `${pages.length} 页版式样例，不是真实报告。生成后按实际内容分页，不截断证据。`
              : dialog === 'spec'
                ? '这些模块、内容要求与篇幅预算会在确认生成后提交研究流程。此处仅查看或下载。'
                : '这会替换当前未保存的编辑；不会覆盖本机已保存的模板，除非再次点击保存。'}
          </DialogDescription>
          {dialog === 'preview' && (
            <div className="rb-preview-pages">
              {pages.map((parts, index) => (
                <ReportPage
                  key={index}
                  parts={parts}
                  index={index}
                  count={pages.length}
                  title={draft.title}
                />
              ))}
            </div>
          )}
          {dialog === 'spec' && (
            <>
              <pre className="rb-spec">{JSON.stringify(spec, null, 2)}</pre>
              <Button onClick={downloadSpec}>
                <Download />
                下载生成要求
              </Button>
            </>
          )}
          {dialog === 'reset' && (
            <div className="rb-reset-actions">
              <Button variant="outline" onClick={() => setDialog(null)}>
                取消
              </Button>
              <Button
                onClick={() => {
                  setDraft(defaultDraft());
                  setActive('summary');
                  setPageIndex(0);
                  setStatus('已恢复默认结构，尚未保存');
                  setDialog(null);
                }}
              >
                <Check />
                确认恢复
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={targetCompany !== null}
        onOpenChange={(open) => {
          if (!open && !creating) setTargetCompany(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>确认生成真实研报？</AlertDialogTitle>
          <AlertDialogDescription>
            研究对象：
            {targetCompany?.listing
              ? `${targetCompany.listing.name} · ${targetCompany.listing.exchange} · ${targetCompany.listing.code}`
              : targetCompany?.query}
            。将使用 {model}，按当前 {draft.blocks.length} 个模块生成；会消耗
            API
            Token，费用受账号预算限制。关闭页面不会自动续跑，已完成分段可从我的报告继续。
          </AlertDialogDescription>
          {runError && (
            <p role="alert" className="text-sm text-destructive">
              {runError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={creating}>取消</AlertDialogCancel>
            <Button
              disabled={creating || overLimit || !user || !allowedModels.length}
              onClick={() => void startResearch()}
            >
              {creating ? '正在创建任务…' : '确认生成'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingTemplate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTemplate(null);
        }}
      >
        <AlertDialogContent className="rb-dialog rb-template-dialog">
          <AlertDialogTitle>
            应用{pendingTemplate ? TEMPLATE_LABELS[pendingTemplate] : ''}模板？
          </AlertDialogTitle>
          <AlertDialogDescription>
            将替换当前模块、顺序、内容要求与篇幅设置，保留报告名称和核心研究问题。本机已保存的模板不会被覆盖，除非再次点击保存。
          </AlertDialogDescription>
          {pendingTemplate && (
            <div className="rb-template-summary">
              <strong>
                {pendingTemplate === 'brief'
                  ? '7 个模块 · 约 4 页 · 上限 6 页'
                  : '17 个模块 · 约 14 页 · 上限 16 页'}
              </strong>
              <p>
                {pendingTemplate === 'brief'
                  ? '核心结论、公司与业务、财务质量、行业与政策、估值与情景、风险与跟踪、来源与数据缺口。'
                  : '在核心结构上加入行情快照、经营驱动、治理、股东与资金、同行、事件、五维证据、计算底稿、研究方法及验收记录。'}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>取消切换</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingTemplate) return;
                const next = {
                  ...defaultDraft(pendingTemplate),
                  title: draft.title,
                  question: draft.question,
                };
                setDraft(next);
                setActive(next.blocks[0].id);
                setPageIndex(0);
                setStatus(
                  `已应用${TEMPLATE_LABELS[pendingTemplate]}模板，尚未保存`,
                );
                setPendingTemplate(null);
              }}
            >
              确认应用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
