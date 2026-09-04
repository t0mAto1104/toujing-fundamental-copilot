export type MacroPolicyItem = {
  date: string;
  category: '宏观' | '政策';
  title: string;
  summary: string;
  implication: string;
  sourceName: string;
  sourceUrl: string;
  tags: string[];
};

export const macroPolicyItems: MacroPolicyItem[] = [
  {
    date: '2026-08-27', category: '宏观', title: '1—7月规模以上工业企业利润同比增长17.6%',
    summary: '国家统计局公布，1—7月规模以上工业企业营业收入同比增长6.5%，利润总额同比增长17.6%，行业利润分化仍然明显。',
    implication: '利润增长需要进一步拆分价格、销量和成本贡献；电子、有色与化工等行业改善较快，但汽车、建材等行业仍需核验盈利压力。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfb/202608/t20260827_1965126.html', tags: ['工业利润', '企业盈利', '制造业'],
  },
  {
    date: '2026-08-17', category: '宏观', title: '1—7月国民经济主要指标集中发布',
    summary: '官方集中披露工业、服务业、消费、投资、就业和进出口等主要指标，为观察三季度开局提供完整总量基准。',
    implication: '总量平稳与行业分化同时存在，应将宏观指标逐一映射到上市公司的订单、价格、库存和现金流。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfb/202608/t20260817_1965056.html', tags: ['经济运行', '就业', '进出口'],
  },
  {
    date: '2026-08-17', category: '宏观', title: '7月规模以上工业增加值同比增长4.5%',
    summary: '7月规模以上工业增加值同比实际增长4.5%，制造业增长5.5%，电子、运输设备和专用设备等行业增速相对较快。',
    implication: '工业生产韧性需要与企业利润和库存交叉验证；高增长行业更应关注订单能否转化为现金流。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfbhjd/202608/t20260817_1965055.html', tags: ['工业生产', '制造业', '新动能'],
  },
  {
    date: '2026-08-17', category: '宏观', title: '1—7月固定资产投资结构继续分化',
    summary: '1—7月固定资产投资同比下降6.7%，但知识产权产品投资和部分高技术产业投资保持增长。',
    implication: '总投资承压意味着传统投资链订单仍需谨慎核验，设备购置和高技术投资则提供结构性需求线索。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/xxgk/sjfb/zxfb2020/202608/t20260817_1965054.html', tags: ['固定资产投资', '设备更新', '高技术'],
  },
  {
    date: '2026-08-17', category: '宏观', title: '1—7月房地产开发与销售数据发布',
    summary: '房地产开发投资、销售面积和销售额仍处于同比下降区间，行业库存与新开工压力延续。',
    implication: '地产链需求恢复仍需等待销售、开工和融资数据共同改善，建材、家居及银行资产质量应分别核验。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfb/202608/t20260817_1965053.html', tags: ['房地产', '销售', '开工'],
  },
  {
    date: '2026-08-09', category: '宏观', title: '7月CPI同比上涨0.5%',
    summary: '7月居民消费价格同比上涨0.5%，核心CPI同比上涨0.9%，消费价格总体温和。',
    implication: '温和价格环境有利于居民实际购买力，但企业定价权仍需结合具体品类销量、促销和成本判断。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfbhjd/202608/t20260809_1965008.html', tags: ['CPI', '核心通胀', '消费价格'],
  },
  {
    date: '2026-08-09', category: '宏观', title: '7月PPI同比上涨3.5%',
    summary: '7月工业生产者出厂价格同比上涨3.5%、环比下降0.7%，同比与环比方向出现差异。',
    implication: '上游价格变化对行业利润的影响不一致，应区分资源品价格贡献与下游企业成本挤压。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfbhjd/202608/t20260809_1965007.html', tags: ['PPI', '工业价格', '成本'],
  },
  {
    date: '2026-07-31', category: '政策', title: '国务院部署做好下半年经济工作',
    summary: '国务院常务会议研究上半年经济形势和下半年经济工作，强调政策协同和重点任务落实。',
    implication: '后续观察重点是财政、投资、消费与产业政策的具体增量工具，以及其转化为项目和企业订单的节奏。',
    sourceName: '中国政府网（财政部转载）', sourceUrl: 'https://gs.mof.gov.cn/xxgk/zhengcefagui/202608/t20260805_3994993.htm', tags: ['稳增长', '政策协同', '下半年经济'],
  },
  {
    date: '2026-07-27', category: '宏观', title: '上半年规模以上工业企业利润同比增长18.7%',
    summary: '上半年工业企业利润保持增长，但行业间盈利增速和资产负债表表现差异较大。',
    implication: '行业景气判断应结合营业收入、利润率、应收账款和库存，不能只看利润总额单一指标。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfbhjd/202607/t20260727_1964194.html', tags: ['工业利润', '库存', '应收账款'],
  },
  {
    date: '2026-08-17', category: '宏观', title: '1—7月社会消费品零售总额数据发布',
    summary: '国家统计局公布1—7月消费市场数据，社会消费品零售总额同比增长1.2%，不同品类表现继续分化。',
    implication: '消费总量仍属温和修复，分析可选消费与耐用品公司时，应继续核验品类销量、渠道库存和政策补贴兑现。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfbhjd/202608/t20260817_1965052.html', tags: ['消费', '社零', '内需'],
  },
  {
    date: '2026-07-16', category: '宏观', title: '2026年上半年国内生产总值核算结果公布',
    summary: '国家统计局发布上半年GDP初步核算结果，并披露三次产业增加值及其结构变化。',
    implication: '总量增长需要与产业结构、价格和企业盈利交叉验证，行业判断不能只依赖单一GDP增速。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfb/202607/t20260716_1964142.html', tags: ['GDP', '产业结构', '增长'],
  },
  {
    date: '2026-07-15', category: '宏观', title: '上半年国民经济运行情况发布',
    summary: '国家统计局集中发布工业、服务业、投资、消费、就业和物价等上半年主要经济指标。',
    implication: '制造业生产、居民需求与价格变化存在差异，应据此拆分企业收入增长与利润率变化的来源。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/xwfbh/fbhwd/202607/t20260715_1964121.html', tags: ['工业', '投资', '就业', '物价'],
  },
  {
    date: '2026-07-15', category: '宏观', title: '上半年居民收入和消费支出情况发布',
    summary: '官方披露居民人均可支配收入和消费支出变化，可用于观察居民部门购买力与消费倾向。',
    implication: '居民收入与支出结构是判断大众消费、服务消费和可选消费需求持续性的基础证据。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfbhjd/202607/t20260715_1964129.html', tags: ['居民收入', '消费支出', '购买力'],
  },
  {
    date: '2026-07-02', category: '政策', title: '促进消费相关规划获国务院批复',
    summary: '国务院发布促进消费相关中长期部署，政策重点由短期刺激延伸至供给质量、消费场景与制度建设。',
    implication: '政策影响需要通过项目落地、企业订单和居民实际支出验证，受益方向可能集中在服务与新型消费。',
    sourceName: '中国政府网', sourceUrl: 'https://www.gov.cn/zhengce/content/202607/content_7075216.htm', tags: ['促消费', '服务消费', '中长期规划'],
  },
  {
    date: '2026-06-16', category: '宏观', title: '5月份国民经济运行情况发布',
    summary: '国家统计局披露5月工业、服务业、消费、投资、房地产和就业等主要指标。',
    implication: '月度数据为二季度盈利预期提供校准，需重点观察生产修复是否能传导至价格、库存和现金流。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/xwfbh/fbhwd/202606/t20260616_1963954.html', tags: ['工业', '消费', '房地产'],
  },
  {
    date: '2026-05-18', category: '宏观', title: '4月份经济运行数据解读发布',
    summary: '国家统计局对4月生产、需求、转型升级和宏观政策效果进行综合解读。',
    implication: '判断上市公司景气时，应将官方总量数据与行业订单、资本开支及上市公司一季报逐一对应。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/sjjd/202605/t20260518_1963741.html', tags: ['月度数据', '政策效果', '转型升级'],
  },
  {
    date: '2026-04-16', category: '宏观', title: '一季度国民经济运行情况发布',
    summary: '国家统计局公布一季度主要经济指标，为全年增长、需求和价格趋势提供第一份完整季度基准。',
    implication: '一季度数据应与上市公司一季报、行业开工率和订单变化交叉验证，避免把总量改善等同于所有行业改善。',
    sourceName: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/xwfbh/fbhwd/202604/t20260416_1963330.html', tags: ['一季度', '增长基准', '企业盈利'],
  },
  {
    date: '2026-03-16', category: '政策', title: '2026年政府工作报告全文发布',
    summary: '报告明确全年宏观政策取向和经济社会发展重点，涵盖扩大内需、产业升级、科技创新与风险防范。',
    implication: '行业影响取决于后续预算、专项行动和地方执行节奏，需持续追踪政策从目标到订单的传导。',
    sourceName: '中国人大网', sourceUrl: 'https://www.npc.gov.cn/c2/c30834/202603/t20260316_453264.html', tags: ['政府工作报告', '财政政策', '产业政策'],
  },
  {
    date: '2026-01-08', category: '政策', title: '设备更新和消费品以旧换新政策加力实施',
    summary: '国家发展改革委等部门推进2026年大规模设备更新和消费品以旧换新，覆盖设备投资和部分耐用品消费。',
    implication: '机械设备、汽车、家电与数码产业链的实际受益程度，应通过补贴规模、销量、订单和企业收入确认核验。',
    sourceName: '国家发展改革委', sourceUrl: 'https://www.ndrc.gov.cn/xwdt/ztzl/tddgmsbgxhxfpyjhx/gzdt/202601/t20260108_1403124_ext.html', tags: ['设备更新', '以旧换新', '耐用品'],
  },
];
