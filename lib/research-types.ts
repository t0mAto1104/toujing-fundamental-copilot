export type SourceLink = {
  title: string;
  publisher: string;
  url: string;
  date: string;
};

export type CompanyMetric = {
  label: string;
  value: string;
  period: string;
  change: string;
  assessment: string;
  sourceUrl: string;
};

export type FactorEvidence = {
  label: string;
  value: string;
  sourceName: string;
  sourceUrl: string;
  date: string;
};

export type FactorGroup = {
  category: '政策' | '行业' | '资金' | '财报' | '宏观';
  signal: '正面' | '中性' | '负面';
  title: string;
  summary: string;
  evidence: FactorEvidence[];
};

export type ResearchChapter = {
  topic:
    | '业务与利润来源'
    | '行业供需与核心驱动'
    | '竞争格局与壁垒'
    | '盈利质量与财务风险'
    | '估值与预期差'
    | '治理与资本配置';
  facts: string;
  analysis: string;
  counterEvidence: string;
  watchFor: string;
  sourceUrls: string[];
};

export type ResearchScenario = {
  name: '基准' | '改善' | '承压';
  assumptions: string;
  impact: string;
  validation: string;
  sourceUrls: string[];
};

export type DeepResearch = {
  strategicInvestments?: Array<{
    entity: string;
    ownershipAndAccounting: string;
    contribution: string;
    stageAndSynergy: string;
    risksAndVerification: string;
    sourceUrls: string[];
  }>;
  governanceFindings?: Array<{
    subject: string;
    facts: string;
    analysis: string;
    boundary: string;
    sourceUrls: string[];
  }>;
  chapters: ResearchChapter[];
  scenarios: ResearchScenario[];
  timeline: Array<{
    period: string;
    status: '已披露' | '计划/指引' | '待确认';
    event: string;
    impact: string;
    sourceUrl: string;
  }>;
  dataGaps: string[];
  businessSegments?: Array<{
    name: string;
    role: string;
    period: string;
    revenue: string;
    share: string;
    growth: string;
    grossMargin: string;
    products: string;
    profitDriver: string;
    stage: string;
    sourceUrls: string[];
  }>;
  operatingDrivers?: Array<{
    business: string;
    variable: string;
    baseline: string;
    transmission: string;
    falsification: string;
    sourceUrls: string[];
  }>;
  peerComparison?: Array<{
    company: string;
    business: string;
    position: string;
    comparison: string;
    limitation: string;
    sourceUrls: string[];
  }>;
  financialTrend?: Array<{
    period: string;
    revenue: string;
    netProfit: string;
    operatingCashFlow: string;
    cashAndDebt: string;
    interpretation: string;
    sourceUrls: string[];
  }>;
  evidenceAudit?: {
    documentsRead: number;
    financialPeriods: number;
    webSearches: number;
    gaps: string[];
    checkedAt: string;
  };
};

export type CompanyReport = {
  researchRun?: {
    taskId: string;
    model: string;
    frameworkVersion: string;
    pipelineVersion: string;
    evidenceAsOf: string;
    financialPeriods: string[];
    evidence: unknown;
  };
  companyName: string;
  companyCode: string;
  exchange: string;
  selectedListingId?: string;
  industry: string;
  updatedAt: string;
  quote: {
    price: string;
    change: string;
    currency: string;
    marketCap: string;
    asOf: string;
    sourceName?: string;
    sourceUrl?: string;
    isStale?: boolean;
    staleReason?: string;
  };
  thesis: string;
  stance: '积极' | '中性' | '谨慎';
  overview: string;
  metrics: CompanyMetric[];
  factors: FactorGroup[];
  strengths: string[];
  risks: string[];
  catalysts: string[];
  conclusion: string;
  sources: SourceLink[];
  disclaimer: string;
  // Optional so previously saved reports remain readable without regeneration.
  deepResearch?: DeepResearch;
  frameworkVersion?: string;
  degraded?: boolean;
  notice?: string;
};
