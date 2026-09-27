import type { ResearchDossier } from '@/lib/research-dossier';
import { researchIndustryProfile } from '@/lib/research-industry-profile';

export const METHOD_VERSION = 'methods-2026-09-v5';
// Versioned research methods, never historical company facts. Keyword retrieval
// deliberately needs no embedding service or additional paid model invocation.
const methods = [
  {
    id: 'business',
    title: '业务到利润的传导',
    tags: ['业务', '收入', '产品', '客户', '毛利'],
    text: '拆分收入基本盘、利润引擎和早期业务。逐项区分销量、报价、结算价、单位成本和利用率；由经营变量解释利润及现金流，不用市场热度代替经营事实。每条因果链给出能推翻它的观察条件。',
  },
  {
    id: 'cash',
    title: '盈利质量与现金约束',
    tags: ['现金', '盈利', '应收', '存货', '债务', '财务'],
    text: '以同期间合并三表核对归母与扣非、经营现金流、应收存货及减值。累计与单季、余额与流量分别比较。CFO减购建支出是简化现金结余，非标准FCFF/FCFE，不重复扣营运资本；购建支出不包含全部资本投入。受限现金不是可用现金；一次性收益不是持续利润。',
  },
  {
    id: 'valuation',
    title: '估值的适用前提',
    tags: ['估值', 'PE', 'PB', '预期', '利润'],
    text: '先确认上市地、币种、行情时点与利润口径。TTM、静态与机构预测不能混用；非正利润不作低PE判断。同行与历史区间需同业务、同期间，条件不齐只列估值依赖的经营假设，不给目标价。',
  },
  {
    id: 'investment',
    title: '联营投资与新业务',
    tags: ['联营', '参股', '权益法', '新业务', '产能', '投产'],
    text: '确认持股比例、权益法或并表、已确认投资损益和现金分红。公司利润、联营合计及单家净利润不是同一口径。规划、建成、投产与达产分开，验证协同兑现及资金投入回报。',
  },
  {
    id: 'governance',
    title: '治理与资本配置',
    tags: ['关联', '质押', '担保', '回购', '募投', '合规'],
    text: '实际发生与批准额度、质押余额与比例、回购计划与执行分开列示。检查关联交易定价、担保受益方和资本开支约束；没有检索到处罚不能说没有处罚。',
  },
  {
    id: 'competition',
    title: '竞争优势的证伪',
    tags: ['竞争', '同行', '壁垒', '认证', '技术', '行业'],
    text: '用具名同行及可核验产品、认证、成本、转换成本比较；不同产品和会计期间不可硬比。检查客户集中度、替代路径、壁垒失效条件及政策传导，保留反证。',
  },
] as const;
const bankMethods = [
  {
    id: 'business',
    title: '银行业务到盈利的传导',
    text: '按披露区分公司、零售及金融市场业务；以生息资产规模/收益率、存款结构/成本和净息差解释净利息收入，再结合非利息收入、信用成本与成本收入比解释利润。保留反证，不把贷款增长直接等同利润增长。',
  },
  {
    id: 'cash',
    title: '资产质量、流动性与资本约束',
    text: '同期间核验归母/扣非利润、不良贷款率、关注类贷款、拨备覆盖率、信用成本、流动性与资本充足率，区分财报合并口径和监管口径。不机械套用制造业毛利率、存货/应收账龄或CFO净利比；不适用不等于缺失。',
  },
  {
    id: 'valuation',
    title: '银行同业与PB—ROE框架',
    text: '优先比较业务结构、资产质量和资本口径相近银行的PB、ROE、净息差与信用成本；PE仅作同口径补充。注明日期、上市地、币种和不可比项；低PB不是低估证明，不给目标价。',
  },
  {
    id: 'governance',
    title: '监管与资本配置',
    text: '核验关联方敞口、表外授信与担保、主要股东、监管处罚和分红/资本补充计划的执行进度。资本充足率不能与现金余额混同，未检索到风险不代表不存在。',
  },
] as const;
const brokerMethods = [
  {
    id: 'business',
    title: '券商业务到利润的传导',
    text: '按披露拆分经纪/财富管理、投行、资管、自营和国际业务，说明服务对象、收费方式与发展历程。以成交量×佣金率、管理规模×费率、承销与投资组合风险解释利润，不把行业成交额直接换算为公司收入。',
  },
  {
    id: 'cash',
    title: '金融资产、资本与流动性',
    text: '核对归母/扣非、ROE、公允价值及信用减值；净资本、风险覆盖率、资本杠杆率、流动性覆盖率和净稳定资金率须区分母公司监管与合并口径。经营现金流不作为制造业现金兑现率，不套用库存周转、产能或毛利率。',
  },
  {
    id: 'valuation',
    title: '券商周期盈利与PB—ROE',
    text: '可比券商需业务组合、杠杆及监管口径接近；同日期比较PB、ROE和周期利润稳定性。PE区分TTM与预测，不将一次性自营收益外推，不给目标价。',
  },
  {
    id: 'governance',
    title: '监管与客户资产安全',
    text: '核验监管处罚、关联交易、客户资产隔离、风险集中度、分红融资与净资本约束；未检索到处罚不代表不存在。',
  },
] as const;
const profiles = [
  {
    name: '银行',
    match: /银行/,
    variables: [
      '净息差',
      '不良贷款',
      '拨备覆盖率',
      '信用成本',
      '核心一级资本充足率',
      '存款',
      '净资产收益率',
    ],
    rule: '优先净息差、信用成本、资产质量、拨备、存贷款结构、ROE与资本充足率，注明报告期和财报/监管口径；不机械套用制造业毛利率、存货、产能订单或CFO净利比，不适用指标不列为缺口。',
  },
  {
    name: '保险',
    match: /保险/,
    variables: ['新业务价值', '综合成本率', '投资收益'],
    rule: '区分寿险新业务价值、财险承保和投资端收益，注意会计准则可比性。',
  },
  {
    name: '证券',
    match: /证券|资本市场/,
    variables: [
      '经纪',
      '投行',
      '资产管理',
      '自营',
      '净资本',
      '风险覆盖率',
      '资本杠杆率',
    ],
    rule: '区分交易量敏感收入与资本消耗型收益，不把市场成交额直接换算为公司收入。',
  },
  {
    name: '医药',
    match: /医药|制药|生物|医疗/,
    variables: ['集采', '研发', '临床', '原料药'],
    rule: '区分获批、临床、商业化和实际销售；集采、产品组合、原料与产能利用率分别验证。',
  },
  {
    name: '半导体与电子',
    match: /半导体|电子|芯片/,
    variables: ['库存', '产能利用率', '订单', '售价'],
    rule: '供应链月营收和行业价格仅为代理信号；确认产品、客户和时间对应，不等同目标公司收入。',
  },
  {
    name: '软件与互联网',
    match: /软件|互联网|计算机/,
    variables: ['付费用户', '客单价', '留存', '算力'],
    rule: '付费客户、续费、递延收入与现金回款优先；GPU租金不直接代表公司算力成本或利润。',
  },
  {
    name: '氟化工与制冷剂',
    match: /氟化工|制冷剂/,
    variables: ['配额', '价格', '销量', '原材料', '产能利用率'],
    rule: '将制冷剂与含氟聚合物等业务分开，先确认各自收入和利润贡献，再分析配额约束、量价成本和库存。市场报价不等于公司结算价，配额与计划产能不等于销量；低毛利或亏损新材料业务不能替代利润基本盘。',
  },
  {
    name: '周期制造与资源',
    match: /化工|钢铁|有色|煤炭|石油|机械|制造|新能源|电池/,
    variables: ['产量', '销量', '价格', '原材料', '产能'],
    rule: '拆分量、价、原料、价差与利用率；期货或现货市场价格不是公司采购或结算均价，注意库存与套保。',
  },
  {
    name: '消费与零售',
    match: /食品|饮料|零售|商贸|消费|家电|纺织/,
    variables: ['销量', '渠道', '库存', '同店', '客单价'],
    rule: '拆分渠道出货和终端动销、同店与开店增长，核对促销、库存与现金回款。',
  },
  {
    name: '地产与建筑',
    match: /房地产|建筑|建材/,
    variables: ['销售回款', '合同负债', '订单', '交付'],
    rule: '签约、交付确认收入与回款不是同一时点；检查融资与应收减值约束。',
  },
] as const;

export function retrieveResearchMethods(
  query: string,
  industry: string,
  dossier: ResearchDossier,
) {
  const suppliedIndustry = industry;
  const industryProfile = researchIndustryProfile(industry, dossier);
  // Only an explicit company business statement can refine the research lens.
  // This is not a new official industry classification or an AI-inferred fact.
  const primaryBusiness = dossier.documents
    .filter((d) => d.kind === '正式披露')
    .flatMap((d) => d.excerpts.map((e) => ({ url: d.url, text: e.text })))
    .find((e) =>
      /公司(?:主要)?(?:从事|业务|主营|是)[^。]{0,100}(?:氟化工|制冷剂)/.test(
        e.text,
      ),
    );
  const profile =
    industryProfile.kind === 'broker'
      ? profiles.find((p) => p.name === '证券')
      : industryProfile.kind === 'bank'
        ? profiles.find((p) => p.name === '银行')
        : primaryBusiness && (!industry || /化工|待核验|未取得/.test(industry))
          ? profiles.find((p) => p.name === '氟化工与制冷剂')
          : profiles.find((p) => p.name !== '银行' && p.match.test(industry));
  const clue = `${query.slice(0, 500)} ${industry} ${dossier.documents.flatMap((d) => d.excerpts.slice(0, 2).map((e) => e.text.slice(0, 300))).join(' ')}`;
  const ranked = methods
    .map((m, i) => ({
      m,
      score: m.tags.filter((t) => clue.toLowerCase().includes(t.toLowerCase()))
        .length,
      i,
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const selected = [
    ...new Set([methods[0], methods[1], ...ranked.slice(0, 2).map((x) => x.m)]),
  ].slice(0, 4);
  const signals = (profile?.variables ?? ['业务收入', '现金流', '竞争']).map(
    (variable) => {
      const passages = dossier.documents
        .filter((d) => d.kind === '正式披露')
        .flatMap((d) =>
          d.excerpts
            .filter((e) => e.text.includes(variable))
            .map((e) => ({
              sourceUrl: d.url,
              date: d.date,
              page: e.page,
              text: e.text.slice(
                Math.max(0, e.text.indexOf(variable) - 80),
                e.text.indexOf(variable) + 220,
              ),
            })),
        )
        .slice(0, 2);
      return {
        variable,
        status: passages.length ? '命中原文，需核验期间和含义' : '待补证',
        passages,
      };
    },
  );
  return {
    version: METHOD_VERSION,
    profile: profile?.name ?? '通用（行业未匹配）',
    industry,
    profileBasis:
      industryProfile.kind !== 'other'
        ? {
            label: industryProfile.basis,
            sourceUrls: industryProfile.sourceUrls,
          }
        : primaryBusiness && profile?.name === '氟化工与制冷剂'
          ? {
              label: '根据公司主营原文细化研究方向，非官方行业分类',
              sourceUrls: [primaryBusiness.url],
            }
          : {
              label: suppliedIndustry
                ? '按接口行业归属选择研究方向'
                : '行业资料未取得',
              sourceUrls: [] as string[],
            },
    industryRule:
      profile?.rule ?? '先确认主营业务和行业，不根据公司名称猜测适用经营指标。',
    methods:
      industryProfile.kind === 'broker'
        ? [...brokerMethods]
        : industryProfile.kind === 'bank'
          ? [...bankMethods]
          : selected.map(({ id, title, text }) => ({ id, title, text })),
    signals,
  };
}

export function methodPrompt(
  context: ReturnType<typeof retrieveResearchMethods>,
) {
  return {
    version: context.version,
    profile: context.profile,
    industryRule: context.industryRule,
    methods: context.methods,
    signals: context.signals.map(({ variable, status }) => ({
      variable,
      status,
    })),
    boundary:
      '这是研究方法和补证检查项，不是公司事实；方法命中不表示数据已取得。',
  };
}
