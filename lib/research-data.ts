export type SectorProfile = {
  name: string;
  subtitle: string;
  scores: { policy: number; demand: number; earnings: number; funding: number; macro: number };
  policy: string;
  demand: string;
  earnings: string;
  funding: string;
  macro: string;
  sourceName: string;
  sourceUrl: string;
};

export const sectorProfiles: SectorProfile[] = [
  { name: '半导体', subtitle: '国产替代与周期复苏并行', scores: { policy: 5, demand: 4, earnings: 3, funding: 4, macro: 3 }, policy: '产业自主与设备材料国产化仍是中长期政策主线。', demand: 'AI 算力、汽车电子与先进封装形成结构性需求，消费电子复苏仍需验证。', earnings: '盈利弹性取决于产能利用率与产品结构，资本开支回报周期较长。', funding: '产业资金关注度高，但估值对订单兑现和供给扩张较敏感。', macro: '受全球电子周期、出口管制与汇率影响较大。', sourceName: '工业和信息化部', sourceUrl: 'https://www.miit.gov.cn/' },
  { name: '创新药', subtitle: '研发兑现与国际授权驱动', scores: { policy: 4, demand: 4, earnings: 3, funding: 3, macro: 4 }, policy: '审评审批、医保谈判和商业保险政策共同影响产品放量。', demand: '老龄化和未满足临床需求提供长期支撑，短期取决于产品竞争格局。', earnings: '研发费用前置，利润取决于核心品种放量和对外授权里程碑。', funding: '资金更偏好临床数据清晰、现金储备充足和有出海能力的公司。', macro: '国内需求韧性较强，但融资环境和海外合作节奏仍受利率影响。', sourceName: '国家医疗保障局', sourceUrl: 'https://www.nhsa.gov.cn/' },
  { name: '消费电子', subtitle: '换机周期与成本共同决定利润', scores: { policy: 4, demand: 3, earnings: 3, funding: 3, macro: 3 }, policy: '数码产品以旧换新对终端需求形成托底。', demand: 'AI 手机、可穿戴和新品周期提供结构性机会，整体换机需求仍偏温和。', earnings: '高端化改善均价，但存储、面板等零部件涨价可能挤压毛利率。', funding: '资金关注新品销量与供应链订单，持续性取决于财报验证。', macro: '居民收入预期、汇率和海外消费决定需求与成本。', sourceName: '国家发展改革委', sourceUrl: 'https://www.ndrc.gov.cn/xxgk/zcfb/tz/202512/t20251230_1402851.html' },
  { name: '新能源车', subtitle: '渗透率提升进入盈利分化期', scores: { policy: 4, demand: 4, earnings: 3, funding: 3, macro: 3 }, policy: '以旧换新、充换电基础设施和产业规范继续影响需求与供给。', demand: '国内渗透率提升与出口增长支撑总量，价格竞争压低单车盈利。', earnings: '电池成本、车型结构、规模效应和海外产能决定利润弹性。', funding: '资金从销量叙事转向自由现金流、海外份额与技术平台。', macro: '利率、居民耐用品消费和贸易政策是主要外部变量。', sourceName: '工业和信息化部', sourceUrl: 'https://www.miit.gov.cn/' },
  { name: '白酒', subtitle: '渠道库存与消费场景是核心', scores: { policy: 2, demand: 3, earnings: 4, funding: 3, macro: 2 }, policy: '直接产业扶持有限，消费政策更多通过收入与场景间接传导。', demand: '商务与宴席需求、渠道库存和批价共同决定动销质量。', earnings: '龙头毛利率与现金流较强，但收入增长对渠道健康度敏感。', funding: '资金偏好品牌壁垒、分红和现金流，风险在增长预期下修。', macro: '居民收入、企业活动和消费信心对需求影响明显。', sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/' },
  { name: '银行', subtitle: '息差与资产质量主导估值', scores: { policy: 3, demand: 3, earnings: 4, funding: 4, macro: 2 }, policy: '货币、地产和化债政策影响信贷需求与风险暴露。', demand: '实体融资需求与零售贷款恢复决定资产扩张速度。', earnings: '净息差、手续费收入、信用成本和拨备覆盖是核心变量。', funding: '高股息与低估值吸引长期资金，但需验证盈利可持续性。', macro: '利率下行、地产周期和名义增长直接影响盈利与资产质量。', sourceName: '中国人民银行', sourceUrl: 'https://www.pbc.gov.cn/' },
];

export const standardIndustryNames = [
  '农林牧渔', '基础化工', '钢铁', '有色金属', '电子', '汽车', '家用电器', '食品饮料',
  '纺织服饰', '轻工制造', '医药生物', '公用事业', '交通运输', '房地产', '商贸零售',
  '社会服务', '银行', '非银金融', '建筑材料', '建筑装饰', '电力设备', '机械设备',
  '国防军工', '计算机', '传媒', '通信', '煤炭', '石油石化', '环保', '美容护理', '综合',
];

export const popularIndustryNames = ['半导体', '创新药', '消费电子', '新能源车', '白酒', 'AI 算力', '储能', '光伏', '机器人'];

const clusterByIndustry: Record<string, 'consumer' | 'cyclical' | 'technology' | 'industrial' | 'finance' | 'healthcare'> = {
  农林牧渔: 'consumer', 家用电器: 'consumer', 食品饮料: 'consumer', 纺织服饰: 'consumer', 轻工制造: 'consumer', 商贸零售: 'consumer', 社会服务: 'consumer', 美容护理: 'consumer',
  基础化工: 'cyclical', 钢铁: 'cyclical', 有色金属: 'cyclical', 建筑材料: 'cyclical', 煤炭: 'cyclical', 石油石化: 'cyclical',
  电子: 'technology', 计算机: 'technology', 传媒: 'technology', 通信: 'technology', 半导体: 'technology', 消费电子: 'technology', 'AI 算力': 'technology',
  汽车: 'industrial', 公用事业: 'industrial', 交通运输: 'industrial', 房地产: 'industrial', 建筑装饰: 'industrial', 电力设备: 'industrial', 机械设备: 'industrial', 国防军工: 'industrial', 环保: 'industrial', 综合: 'industrial', 新能源车: 'industrial', 储能: 'industrial', 光伏: 'industrial', 机器人: 'industrial',
  银行: 'finance', 非银金融: 'finance', 医药生物: 'healthcare', 创新药: 'healthcare', 白酒: 'consumer',
};

const clusterProfiles = {
  consumer: { subtitle: '居民需求、渠道与品牌共同驱动', scores: { policy: 3, demand: 3, earnings: 4, funding: 3, macro: 3 }, policy: '消费政策通过收入预期、以旧换新和场景恢复影响需求。', demand: '核心跟踪终端销量、渠道库存、客单价与消费信心。', earnings: '产品结构、品牌溢价、原材料与费用效率决定利润兑现。', funding: '资金偏好现金流稳定、品牌壁垒清晰和分红可持续的公司。', macro: '居民收入、就业、物价与汇率是主要宏观变量。', sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/' },
  cyclical: { subtitle: '供需、价格与库存周期主导', scores: { policy: 3, demand: 3, earnings: 3, funding: 3, macro: 2 }, policy: '产能、能耗、环保和稳增长政策影响行业供给与需求。', demand: '基建、地产、制造业开工和出口决定需求强度。', earnings: '商品价格、成本曲线、库存和资本开支决定盈利弹性。', funding: '资金通常关注价格持续性、供给纪律和自由现金流。', macro: '对名义增长、全球需求、美元与大宗商品价格高度敏感。', sourceName: '国家发展改革委', sourceUrl: 'https://www.ndrc.gov.cn/' },
  technology: { subtitle: '创新周期与产业资本开支驱动', scores: { policy: 4, demand: 4, earnings: 3, funding: 4, macro: 3 }, policy: '数字经济、产业自主和科技创新政策提供中长期支持。', demand: '算力、终端创新、企业数字化与国产替代形成结构性需求。', earnings: '订单、研发投入、产品迭代和规模效应决定财报兑现。', funding: '资金关注成长确定性，但对估值和订单低于预期较敏感。', macro: '受全球科技周期、出口限制、汇率和资本开支影响。', sourceName: '工业和信息化部', sourceUrl: 'https://www.miit.gov.cn/' },
  industrial: { subtitle: '订单、投资与政策周期共同作用', scores: { policy: 4, demand: 3, earnings: 3, funding: 3, macro: 3 }, policy: '产业升级、设备更新、基建与绿色转型政策影响订单。', demand: '固定资产投资、制造业资本开支和出口订单是关键观察项。', earnings: '在手订单、交付节奏、成本控制和应收账款决定利润质量。', funding: '资金偏好订单能见度高、现金流改善和全球份额提升的公司。', macro: '利率、财政支出、制造业景气与贸易环境影响较大。', sourceName: '国家发展改革委', sourceUrl: 'https://www.ndrc.gov.cn/' },
  finance: { subtitle: '利率、信用与资本市场活跃度驱动', scores: { policy: 4, demand: 3, earnings: 4, funding: 4, macro: 2 }, policy: '货币、资本市场、地产和化债政策决定经营环境。', demand: '融资需求、财富管理、保险保障和交易活跃度影响收入。', earnings: '息差、手续费、投资收益、信用成本和资本充足率是核心。', funding: '高股息与低估值提供支撑，但需验证盈利和资产质量。', macro: '利率、信用周期、地产和名义增长变化直接影响盈利。', sourceName: '中国人民银行', sourceUrl: 'https://www.pbc.gov.cn/' },
  healthcare: { subtitle: '临床价值、支付政策与研发兑现驱动', scores: { policy: 4, demand: 4, earnings: 3, funding: 3, macro: 4 }, policy: '审评审批、医保支付、集采和商业保险共同影响放量。', demand: '人口结构和未满足临床需求提供长期支撑。', earnings: '产品放量、研发费用、授权收入和销售效率决定盈利。', funding: '资金偏好管线清晰、现金储备充足和国际化能力强的公司。', macro: '需求相对稳健，但融资环境和海外合作仍受利率影响。', sourceName: '国家医疗保障局', sourceUrl: 'https://www.nhsa.gov.cn/' },
};

export function getSectorProfile(name: string): SectorProfile {
  const exact = sectorProfiles.find((item) => item.name === name);
  if (exact) return exact;
  const cluster = clusterByIndustry[name] || 'industrial';
  return { name, ...clusterProfiles[cluster] };
}
