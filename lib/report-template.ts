// Shared, non-secret template contract for the editor, task API and renderer.
export const MODULES = [
  {
    id: 'summary',
    title: '核心结论',
    tag: '研究观点',
    description: '先给结论，再给证据与反证。',
    requirement:
      '用三个关键问题概括公司现状。区分已核实事实、分析推断和待验证假设；列出能推翻结论的条件。',
    units: 1,
  },
  {
    id: 'business',
    title: '公司与业务',
    tag: '商业模式',
    description: '公司简介、发展历程、商业模式与业务构成。',
    requirement:
      '先介绍公司定位、主营产品/服务、客户与赚钱方式，再列有来源的成立、上市、重组或业务转型节点。按业务说明收入与利润来源，区分基本盘、利润引擎和早期业务；行业适用时解释分部毛利率。只选择关键有据数据，不在短段罗列全部数字；不以行业常识或模型记忆代替公司事实。',
    units: 1,
  },
  {
    id: 'finance',
    title: '财务质量',
    tag: '财务分析',
    description: '3～5 年历史折线、成长性与三表交叉核验。',
    requirement:
      '在资料可得时对比最近三年及最新同期的收入、归母与扣非利润、现金流和负债，区分年度、累计、单季和TTM。核验资本开支、受限资金、应收账龄、存货减值与债务期限；引用程序计算结果解释现金兑现，不混用口径。',
    units: 2,
  },
  {
    id: 'industry',
    title: '行业与政策',
    tag: '外部驱动',
    description: '产业成长、供需与政策如何传导到公司。',
    requirement:
      '分析行业供需、价格价差、库存、竞争格局、产能和客户认证；核验政策及宏观数据如何传导到公司订单、收入、成本与利润，注明发布日期和统计期。不能把宏观景气直接等同于公司业绩。',
    units: 1,
  },
  {
    id: 'valuation',
    title: '估值与情景',
    tag: '价值判断',
    description: '历史 PE/PB/PS、市值与可核对的情景。',
    requirement:
      '选择适合行业的估值方法，列明基期、历史估值、可比口径及假设。分别给出基准、改善、承压情景的条件、经营影响和证伪变量；缺少可靠输入时不计算估值。情景不是概率、盈利预测或目标价，不给买卖建议。',
    units: 1,
  },
  {
    id: 'risk',
    title: '风险与跟踪',
    tag: '风险校验',
    description: '列出反证、风险与后续观察条件。',
    requirement:
      '写出核心风险的触发条件、影响方向和可跟踪指标；单列数据缺口及来源冲突，不以缺少证据推断不存在风险。',
    units: 1,
  },
  {
    id: 'peers',
    title: '同业比较',
    tag: '可比分析',
    description: '在同一口径下比较同业公司。',
    requirement:
      '解释可比公司选择依据，在一致时间和单位下比较经营、财务及估值；不可比项目单独说明。',
    units: 2,
  },
  {
    id: 'catalysts',
    title: '事件与催化',
    tag: '时间线',
    description: '区分已经发生与尚未兑现的事件。',
    requirement:
      '列出近期重大事件、公告及可能的经营催化；区分已发生事实与待兑现事项，注明日期、来源及验证节点。',
    units: 1,
  },
  {
    id: 'ownership',
    title: '股东与资金',
    tag: '股本结构',
    description: '股权结构、持股变化及资金信息。',
    requirement:
      '展示最新可得股本与主要股东结构，标明披露时点；资金流数据只作背景，不直接解释为未来收益。',
    units: 1,
  },
  {
    id: 'snapshot',
    title: '公司与行情快照',
    tag: '程序输出',
    description: '证券身份、行情时点与报告版本。',
    requirement:
      '由程序展示公司名称、代码、上市地、币种、股价、涨跌、市值、行情时间、报告版本与证据快照标识；缺失或过期数据如实标注，不由模型补写。',
    units: 1,
  },
  {
    id: 'drivers',
    title: '经营驱动与利润传导',
    tag: '逐业务归因',
    description: '从量、价、成本到利润与现金回收。',
    requirement:
      '逐业务列出有来源的经营基准，区分销量、报价、结算价、单位成本、产品结构和产能利用率；说明对收入、利润和现金流的传导，写明反证条件与验证节点。不把收入增长直接等同于利润贡献。',
    units: 2,
  },
  {
    id: 'governance',
    title: '治理与资本配置',
    tag: '资本效率',
    description: '核验分红、融资、投资与治理约束。',
    requirement:
      '结合分红、融资、募投及在建项目预算、进度和回报分析资本配置；核查关联交易、担保质押、受限资金与联营投资收益。区分已知事实、判断及缺口，不凭公司身份评价管理层质量。',
    units: 2,
  },
  {
    id: 'fiveFactors',
    title: '五维基本面证据',
    tag: '交叉核验',
    description: '逐项核对政策、行业、资金、财报、宏观。',
    requirement:
      '政策、行业、资金、财报、宏观各列事实、日期、来源、公司传导与验证状态。缺证据标记待核验；不适用也须有依据，不默认中性。区分市场资金流与公司现金流；共享已有证据，不重复采集或扩写。',
    units: 2,
  },
  {
    id: 'calculations',
    title: '财务计算底稿',
    tag: '程序输出',
    description: '原始输入、公式、单位和计算结果可追溯。',
    requirement:
      '由程序列示财务原值、同比、单季、TTM及经营现金流减购建支出的计算，绑定输入来源、期间、单位与合并口径。余额不做TTM，缺失不填零，亏损基期不硬算通常增长率；简化现金结余不等同FCFF/FCFE，不重复扣营运资本。',
    units: 2,
  },
  {
    id: 'methods',
    title: '研究方法与行业信号',
    tag: '程序输出',
    description: '保留方法版本与行业适用边界。',
    requirement:
      '由程序列出实际采用的方法版本、主营业务与行业匹配依据、经营信号及待补证项；区分方法规则和已核验事实。行业未匹配时显式提示，不根据公司名称猜测指标，不将制造业指标强套金融企业。',
    units: 1,
  },
  {
    id: 'audit',
    title: '质量验收与采集记录',
    tag: '程序输出',
    description: '完整正文、资料时效与跨章一致性核验。',
    requirement:
      '由程序呈现正式披露正文读取状态、财报时效、五维证据、财务口径、业务拆分及跨章一致性检查，并记录实际采集时间、成功/失败、原因、资料数量与快照标识。标题或摘要不算读完全文；关键验收未通过时报告只标为初步分析。',
    units: 1,
  },
  {
    id: 'custom',
    title: '自定义专题',
    tag: '专题研究',
    description: '围绕你关心的问题展开研究。',
    requirement: '填写本专题需要回答的核心问题、时间范围和优先来源。',
    units: 1,
  },
  {
    id: 'sources',
    title: '来源与数据缺口',
    tag: '始终保留',
    description: '关键证据、来源链接与未核验事项。',
    requirement:
      '绑定关键数字与来源，列出数据日期、单位、计算口径、缺口与冲突；只引用实际取得的资料，不编造来源。',
    units: 1,
  },
] as const;

export type ModuleId = (typeof MODULES)[number]['id'];
export const MODULE_CHECKLISTS: Record<ModuleId, readonly string[]> = {
  summary: [
    '核心问题与结论适用边界',
    '支持证据与主要反证',
    '待验证假设与跟踪条件',
  ],
  business: [
    '有来源的公司简介、主营产品/服务、客户及商业模式',
    '有明确日期和来源的成立、上市、重组/转型发展节点；未核验不补造',
    '上游成本—公司产品—下游需求链路及直接竞争',
    '题材对应业务、商业化阶段、收入/订单、日期与缺口',
    '分业务收入、占比、同比及毛利率',
    '产品、客户集中度与市场',
    '基本盘、利润引擎、早期业务及协同',
    '利润贡献与一次性因素分开',
  ],
  finance: [
    '程序绘制历史折线，解读同比/CAGR与拐点，不补造图表点值',
    '三表同期间、同币种、同合并口径',
    '年度、累计、单季、TTM分别展示',
    '归母/扣非利润与经营现金兑现',
    '资本开支、应收账龄、存货及减值',
    '受限现金、完整有息负债与债务期限',
  ],
  industry: [
    '产业规模/渗透率/供需成长，区分实际与预测并传导到公司份额与现金',
    '供需、库存、价格价差与开工率',
    '市场份额、具名竞争者与产能',
    '技术/客户认证壁垒的原文证据',
    '政策与宏观数据到公司经营的传导',
  ],
  valuation: [
    '月末观察的历史 PE/PB/PS 和市值；非正估值、缺口与时效说明',
    '适用方法、基期、计算式及来源',
    '历史估值与同业同口径比较',
    '基准/改善/承压三种条件情景',
    '经营影响、假设及证伪条件',
  ],
  risk: [
    '风险触发条件与影响方向',
    '可跟踪指标、验证节点及反证',
    '数据缺口与来源冲突',
    '优势、风险与综合结论保持一致',
  ],
  peers: [
    '具名同行及选择依据',
    '业务/产品/产能/客户可比性',
    '财务和估值的期间、上市地、币种',
    '不可比项与样本不完整提示',
  ],
  catalysts: [
    '已发生事实与待兑现事项区分',
    '事件日期、公告日期与原始来源',
    '潜在经营影响及证伪节点',
  ],
  ownership: [
    '股本结构与主要股东披露时点',
    '股东变化与基金持股口径',
    '市场资金流、两融信息及局限',
    '未取得数据不等于资金流为零',
  ],
  snapshot: [
    '名称、代码、上市地与币种',
    '股价、涨跌、市值及行情时间',
    '报告版本、资料截止时点与快照标识',
  ],
  drivers: [
    '逐业务销量/价格/单位成本/利用率基准',
    '经营变量→收入→利润→现金流',
    '项目预算、投产进度及经营兑现',
    '可推翻因果判断的观察条件',
  ],
  governance: [
    '分红方案与实施进度、融资与现金约束',
    '募投/在建项目预算、进度与回报',
    '关联交易、担保质押及受限资金',
    '联营主体、持股比例及投资收益来源',
  ],
  fiveFactors: [
    '政策、行业、资金、财报、宏观逐维列示',
    '事实、日期、来源、公司传导与反证',
    '已核验/待核验/有依据的不适用',
    '复用证据，不因新闻热度强行判断',
  ],
  calculations: [
    '原始输入→公式→结果→来源',
    '同口径同比、单季与TTM',
    '现金流减购建支出及非标准FCF边界',
    '余额不滚动相加、空值不填零',
  ],
  methods: [
    '实际使用的研究方法及版本',
    '行业匹配依据与指标适用性',
    '经营信号及证据取得状态',
    '规则不是事实，匹配不是核验',
  ],
  audit: [
    '正式披露全文与最新财报时效',
    '财务口径、业务拆分和五维证据',
    '跨章数字及事实的一致性',
    '真实采集状态、失败原因与快照',
    '未通过验收则标为初步分析',
  ],
  custom: [
    '明确的研究问题和时间范围',
    '优先来源与必要输入',
    '事实、推断、反证及验证变量',
  ],
  sources: [
    '关键数字与原始来源绑定',
    '日期、单位、口径与来源冲突',
    '缺口、适用边界和免责声明',
  ],
};
export const ANALYSIS_STRUCTURE = [
  '资料事实',
  '分析推断',
  '反证与风险',
  '验证变量',
] as const;
export const PROGRAM_MODULES: readonly ModuleId[] = [
  'snapshot',
  'calculations',
  'methods',
  'audit',
  'sources',
];
export const isProgramModule = (id: ModuleId) => PROGRAM_MODULES.includes(id);
export type TemplateId = 'brief' | 'deep';
export const TEMPLATE_LABELS = {
  brief: '简版',
  deep: '深度版',
  custom: '自定义',
} as const;
export type Block = {
  id: ModuleId;
  title: string;
  requirement: string;
  units: number;
  layout: 'text' | 'columns';
  breakBefore: boolean;
};
export type Draft = {
  templateId: TemplateId | 'custom';
  title: string;
  question: string;
  pageLimit: number;
  blocks: Block[];
};
export type PagePart = { block: Block; units: number; continuation: boolean };
export const STORAGE_KEY = 'toujing-report-builder-demo-v1';
export const SAFETY_RULES = [
  '仅分析，不构成投资建议。',
  '不编造事实、数字或来源；缺失信息明确标注，不为凑页数补写。',
  '关键数字绑定来源、日期、单位与计算口径；事实、推断和假设分开。',
  '自定义要求不覆盖证据核验与安全规则。',
  '模块删除或缩短只改变展示范围，不取消数据口径、来源和质量核验；不足以支持结论时标明初步分析。',
];
export function newBlock(id: ModuleId): Block {
  const m = MODULES.find((m) => m.id === id)!;
  return {
    id,
    title: m.title,
    requirement: m.requirement,
    units: m.units,
    layout: 'text',
    breakBefore: false,
  };
}
export function isDefaultModuleRequirement(id: ModuleId, requirement: string) {
  return (
    requirement === newBlock(id).requirement ||
    (id === 'business' &&
      requirement ===
        '按业务拆分产品、收入金额与占比、同比、毛利率及利润来源；区分基本盘、利润引擎和早期业务，解释协同与客户集中风险。不以合并毛利率替代分部毛利率，不以行业常识代替公司事实。')
  );
}
export function defaultDraft(templateId: TemplateId = 'brief'): Draft {
  const ids: ModuleId[] =
    templateId === 'brief'
      ? [
          'summary',
          'business',
          'finance',
          'industry',
          'valuation',
          'risk',
          'sources',
        ]
      : [
          'snapshot',
          'summary',
          'business',
          'drivers',
          'industry',
          'finance',
          'governance',
          'ownership',
          'peers',
          'valuation',
          'catalysts',
          'fiveFactors',
          'risk',
          'calculations',
          'methods',
          'audit',
          'sources',
        ];
  const expanded: Partial<Record<ModuleId, number>> = {
    business: 2,
    industry: 2,
    finance: 4,
    valuation: 2,
  };
  return {
    templateId,
    title: templateId === 'brief' ? '公司基本面简版研究' : '公司基本面深度研究',
    question: '公司的盈利质量与长期竞争力是否发生变化？',
    pageLimit: templateId === 'brief' ? 6 : 16,
    blocks: ids.map((id) => ({
      ...newBlock(id),
      ...(templateId === 'deep' && expanded[id] ? { units: expanded[id] } : {}),
    })),
  };
}
export function moveBlock(blocks: Block[], id: ModuleId, targetIndex: number) {
  if (id === 'sources') return blocks;
  const from = blocks.findIndex((b) => b.id === id);
  if (from < 0) return blocks;
  const next = [...blocks];
  const [block] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length - 1)), 0, block);
  return next;
}
export function paginate(blocks: Block[]): PagePart[][] {
  const pages: PagePart[][] = [];
  for (const block of blocks) {
    let remaining = block.units;
    let continuation = false;
    if (block.breakBefore && pages.at(-1)?.length) pages.push([]);
    while (remaining > 0) {
      if (!pages.length || pages.at(-1)!.reduce((n, p) => n + p.units, 0) === 2)
        pages.push([]);
      const page = pages.at(-1)!;
      const take = Math.min(
        remaining,
        2 - page.reduce((n, p) => n + p.units, 0),
      );
      page.push({ block, units: take, continuation });
      remaining -= take;
      continuation = true;
    }
  }
  return pages;
}
export function generationSpec(draft: Draft) {
  return {
    mode: 'custom-research',
    templateId: draft.templateId,
    title: draft.title,
    researchQuestion: draft.question,
    pageLimit: draft.pageLimit,
    plannedPages: paginate(draft.blocks).length,
    estimatedBodyCharacters: draft.blocks.reduce(
      (n, b) => n + b.units * 350 + (b.id === 'business' ? 200 : 0),
      0,
    ),
    aiWritingCharacterBudget: draft.blocks.reduce(
      (n, b) =>
        n +
        (isProgramModule(b.id)
          ? 0
          : b.units * 350 + (b.id === 'business' ? 200 : 0)),
      0,
    ),
    programModuleCount: draft.blocks.filter((b) => isProgramModule(b.id))
      .length,
    modules: draft.blocks.map(({ units, ...b }) => ({
      ...b,
      requirement: b.requirement.trim() || newBlock(b.id).requirement,
      pageBudget: units / 2,
      bodyCharacterBudget: units * 350 + (b.id === 'business' ? 200 : 0),
      outputOwner: isProgramModule(b.id) ? 'program' : 'ai-analysis',
      checklist: MODULE_CHECKLISTS[b.id],
      analysisStructure: isProgramModule(b.id) ? [] : ANALYSIS_STRUCTURE,
    })),
    safetyRules: SAFETY_RULES,
    executionPlan: [
      '只为选定模块收集相关证据，共享资料去重。',
      '结构化财务计算与 AI 写作分离，按模块限制正文篇幅。',
      '先核验再排版；超出篇幅时标记并处理，不静默截断证据。',
    ],
  };
}
export function parseDraft(raw: string): Draft | null {
  try {
    const d = JSON.parse(raw);
    if (
      !d ||
      (d.templateId !== undefined &&
        !['brief', 'deep', 'custom'].includes(d.templateId)) ||
      typeof d.title !== 'string' ||
      d.title.length > 60 ||
      typeof d.question !== 'string' ||
      d.question.length > 600 ||
      ![4, 6, 8, 12, 16].includes(d.pageLimit) ||
      !Array.isArray(d.blocks) ||
      d.blocks.length < 1 ||
      d.blocks.length > MODULES.length
    )
      return null;
    const seen = new Set();
    for (const b of d.blocks) {
      if (
        !b ||
        !MODULES.some((m) => m.id === b.id) ||
        seen.has(b.id) ||
        typeof b.title !== 'string' ||
        !b.title.trim() ||
        b.title.length > 32 ||
        typeof b.requirement !== 'string' ||
        b.requirement.length > 1000 ||
        ![1, 2, 4].includes(b.units) ||
        !['text', 'columns'].includes(b.layout) ||
        typeof b.breakBefore !== 'boolean'
      )
        return null;
      seen.add(b.id);
    }
    if (d.blocks.at(-1)?.id !== 'sources') return null;
    // Evidence rules are immutable even when device-local storage is edited.
    d.blocks[d.blocks.length - 1] = newBlock('sources');
    // Keep existing device-local drafts; never replace prior custom requirements.
    d.templateId ??= 'custom';
    // Project only allowed fields: client JSON is never trusted configuration.
    return {
      templateId: d.templateId,
      title:
        d.templateId === 'brief' && d.title.trim() === '公司基本面深度研究'
          ? defaultDraft('brief').title
          : d.title.trim() || '公司基本面研究',
      question: d.question.trim(),
      pageLimit: d.pageLimit,
      blocks: d.blocks.map((b: Block) => ({
        id: b.id,
        title: b.title.trim(),
        requirement:
          isProgramModule(b.id) ||
          isDefaultModuleRequirement(b.id, b.requirement)
            ? newBlock(b.id).requirement
            : b.requirement.trim() || newBlock(b.id).requirement,
        units: b.units,
        layout: b.layout,
        breakBefore: b.breakBefore,
      })),
    };
  } catch {
    return null;
  }
}

export function validateResearchTemplate(value: unknown): Draft {
  const raw = JSON.stringify(value);
  const draft = raw && raw.length <= 28_000 ? parseDraft(raw) : null;
  if (
    !draft ||
    paginate(draft.blocks).length > draft.pageLimit ||
    !draft.blocks.some((b) => !isProgramModule(b.id))
  ) {
    throw Object.assign(
      new Error(
        '模板无效：至少保留一个分析模块及来源，且计划页数不能超过上限。',
      ),
      { status: 400, code: 'invalid_template' },
    );
  }
  return draft;
}
