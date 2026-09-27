import type { ResearchDossier } from '@/lib/research-dossier';
import type { ModuleId } from '@/lib/report-template';

// A research lens, not a guessed exchange classification. Callers may pass only
// sourced industry data, never company names, user questions or generated prose.
export function researchIndustryProfile(
  industry: string,
  dossier?: ResearchDossier,
) {
  const explicit = industry.trim();
  if (
    /^(?:证券[ⅡII]*|证券业|证券公司|证券经纪|多元金融.*证券|资本市场服务)$/.test(
      explicit,
    )
  )
    return {
      kind: 'broker' as const,
      label: '证券',
      sourceUrls: [] as string[],
      basis: '按接口行业归属选择研究方向',
    };
  if (/银行/.test(explicit) && !/非银行|非银|待核验|未取得|未知/.test(explicit))
    return {
      kind: 'bank' as const,
      label: '银行',
      sourceUrls: [] as string[],
      basis: '按接口行业归属选择研究方向',
    };
  // Do not override an explicit, different industry. Formal company self-
  // descriptions can recover the lens when its classification endpoint fails.
  if (explicit && !/^(未取得|待核验|未知|金融|金融业)$/.test(explicit))
    return {
      kind: 'other' as const,
      label: explicit,
      sourceUrls: [],
      basis: '按接口行业归属选择研究方向',
    };
  const passages =
    dossier?.documents
      .filter((d) => d.kind === '正式披露')
      .flatMap((d) => d.excerpts.map((e) => ({ url: d.url, text: e.text }))) ||
    [];
  const broker = passages.find(({ text }) =>
    /(?:本公司|本集团)(?:是|为)(?:一家)?(?:(?:国内|大型|综合性|全国性|上市|国际化)){0,5}证券公司(?=[，。；、]|$)/.test(
      text.replace(/\s+/g, ''),
    ),
  );
  if (broker)
    return {
      kind: 'broker' as const,
      label: '证券',
      sourceUrls: [broker.url],
      basis: '根据公司主营原文选择券商研究方向，非官方行业分类',
    };
  const statement = passages.find(({ text }) => {
    const normalized = text.replace(/\s+/g, '');
    return (
      /(?:本行|本公司|本集团)(?:是|为)(?:一家)?(?:(?:国有|大型|股份制|综合性|全国性|区域性|城市|农村|上市)){0,5}商业银行(?=[，。；、]|$)/.test(
        normalized,
      ) ||
      /(?:本行|本公司|本集团)(?:主要从事|主营业务为|主要业务(?:为|包括)|主要经营(?:范围)?(?:为|包括)|经营范围(?:为|包括))(?:(?:商业|公司|个人|零售)银行业务)(?=[，。；、]|$)/.test(
        normalized,
      ) ||
      /本行主要业务为提供银行及相关金融服务(?=[，。；、]|$)/.test(normalized) ||
      /(?:本行|本公司|本集团)(?:主要)?(?:经营范围|业务)(?:为|包括)吸收(?:公众)?存款[，、；][^。]{0,100}发放(?:短期、中期和长期)?贷款(?=[，。；、]|$)/.test(
        normalized,
      )
    );
  });
  return statement
    ? {
        kind: 'bank' as const,
        label: '银行',
        sourceUrls: [statement.url],
        basis: '根据公司主营原文选择银行研究方向，非官方行业分类',
      }
    : {
        kind: 'other' as const,
        label: explicit,
        sourceUrls: [] as string[],
        basis: '行业资料未取得或未匹配',
      };
}

const bankChecklists: Partial<Record<ModuleId, readonly string[]>> = {
  business: [
    '公司银行、零售银行、金融市场等披露分部及收入/利润贡献',
    '贷款与存款结构、客户和地域集中度；不以制造业产品毛利率替代',
    '净利息与非利息收入基本盘；题材需对应已披露金融业务和日期',
  ],
  finance: [
    '归母/扣非利润、ROE及同比采用同期间、币种和合并口径',
    '净息差、信用成本、不良贷款率、关注类贷款和拨备覆盖率',
    '核心一级资本充足率、资本充足率、贷款/存款与流动性指标',
    '程序历史图与原文核验；银行经营现金流不作为制造业式盈利兑现率',
  ],
  industry: [
    '信贷需求与存款结构、利率与贷款重定价、金融监管及宏观周期',
    '行业数据需注明统计范围、时点；传导至公司净息差、信用风险和资本约束',
    '不将行业增速直接等同于公司贷款/利润增速，不套用库存、产能和订单',
  ],
  peers: [
    '选择业务结构、客户/地域及监管口径相近的具名银行',
    '同期间比较净息差、ROE、不良率、拨备、核心一级资本及PB',
    '注明上市地、币种和不可比项；不把同板块或市值相近等同直接可比',
  ],
  drivers: [
    '贷款/生息资产规模与收益率、存款成本及重定价到净息差和净利息收入',
    '手续费/投资收益、信用成本与成本收入比到归母利润和资本积累',
    '只引用已披露基准；区分银行流动性、会计利润及资本约束',
  ],
  valuation: [
    '优先PB—ROE与资产质量、资本约束；PE仅作同口径补充',
    '程序历史估值及同业比较注明时点、币种和数据缺口',
    '基准/改善/承压情景围绕净息差、信用成本和资本；不是目标价或建议',
  ],
  governance: [
    '主要股东、关联交易、监管处罚及风险暴露，以正式披露核验',
    '分红与资本补充、资本消耗、资本充足约束及实施进度',
    '表外担保与授信、风险集中度和关联方敞口，不以未检索到认定不存在',
  ],
  calculations: [
    '原始输入→公式→结果→来源；同口径同比、单季与TTM',
    '余额不滚动相加、缺失不填零；不套用制造业毛利率或CFO净利比',
    '银行监管比率优先引用披露，核对合并/监管口径，不从不完整数据反推',
  ],
};

const brokerChecklists: Partial<Record<ModuleId, readonly string[]>> = {
  business: [
    '公司定位、主营服务与发展历程须有公司披露来源',
    '经纪/财富管理、投行、资管、自营与国际业务的收入及利润贡献',
    '交易量与佣金率、管理规模与费率、承销规模及自营风险；不将成交额直接换算为公司收入',
  ],
  finance: [
    '同期间区分合并净利润、归母与扣非利润，ROE及分部利润',
    '净资本、风险覆盖率、资本杠杆率、流动性覆盖率及净稳定资金率，区分母公司监管与合并财报口径',
    '金融资产、公允价值、信用减值及回购/融资负债；现金流不按制造业现金兑现率评价',
  ],
  industry: [
    '市场成交量、融资需求、资管规模、佣金竞争及监管变化',
    '行业成长到经纪费率、承销、资管及自营收益的传导；不套用产能、开工率及客户认证',
  ],
  peers: [
    '具名可比券商，按财富管理/投行/资管/自营结构与国际业务解释可比性',
    '同日期、币种和口径比较ROE、PB、利润稳定性与资本风险指标',
  ],
  valuation: [
    'PE/PB结合ROE、周期利润及资本约束；不把一次性投资收益当作持续盈利',
    '基准/改善/承压情景围绕成交量、费率、承销、资管及市场风险，不给目标价',
  ],
  drivers: [
    '成交量×费率、管理规模×费率、承销项目与投资组合风险到收入利润',
    '量与价分别取证；自营收益与市场波动、杠杆和资本占用联系，不将现金流等同盈利兑现',
  ],
  governance: [
    '关联交易、监管处罚、客户资产隔离及风险集中度',
    '分红融资与净资本约束，区分合并财报和母公司监管口径',
  ],
  calculations: [
    '沿用程序原值及同比，区分总净利润、归母和扣非',
    '不计算制造业式毛利率、存货周转及CFO净利润兑现率；监管比率不由不完整数据反推',
  ],
};

export function industryModuleChecklist(
  industry: string,
  id: ModuleId,
  fallback: readonly string[],
) {
  const kind = researchIndustryProfile(industry).kind;
  return (
    (kind === 'broker'
      ? brokerChecklists[id]
      : kind === 'bank'
        ? bankChecklists[id]
        : undefined) ?? fallback
  );
}

export function industryModuleRequirement(
  industry: string,
  id: ModuleId,
  fallback: string,
) {
  const list = industryModuleChecklist(industry, id, []);
  return list.length ? list.join('；') : fallback;
}

export function bankModuleChecklist(id: ModuleId, fallback: readonly string[]) {
  return bankChecklists[id] ?? fallback;
}

export function bankModuleRequirement(id: ModuleId, fallback: string) {
  return bankChecklists[id]?.join('；') ?? fallback;
}

export function bankModuleResearchLens(
  id: ModuleId,
  deep: boolean,
  ids: ModuleId[],
) {
  const checklist = bankChecklists[id];
  if (!checklist) return '';
  return `${checklist.join('；')}。${id === 'business' && ids.includes('peers') ? '详细同业比较放同业模块，本模块只说明业务位置。' : ''}${deep ? '展开可核验的主要业务及风险传导。' : '集中于主营最关键变量和一项反证。'}每项注明证据、报告期与口径；未披露不填零，不适用的制造业指标不列为银行数据缺口。`;
}
