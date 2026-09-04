import type { CompanyReport } from '@/lib/research-types';

const resultsUrl =
  'https://ir.mi.com/static-files/4a85fc36-8a6d-4c24-b45b-b18d5d162e6c';
const presentationUrl =
  'https://ir.mi.com/static-files/bdeea0b9-246c-45be-8cb4-ab4faaddf80a';
const policyUrl =
  'https://www.ndrc.gov.cn/xxgk/zcfb/tz/202512/t20251230_1402851.html';
const retailUrl =
  'https://www.stats.gov.cn/sj/zxfbhjd/202608/t20260817_1965052.html';
const gdpUrl =
  'https://www.stats.gov.cn/english/PressRelease/202607/t20260715_1964120.html';

export const xiaomiFallbackReport: CompanyReport = {
  companyName: '小米集团',
  companyCode: '01810',
  exchange: '香港交易所',
  industry: '消费电子、智能汽车与AIoT',
  updatedAt: '2026-08-30（有来源降级快照）',
  quote: {
    price: '待核验',
    change: '--',
    currency: 'HKD',
    marketCap: '待核验',
    asOf: '2026年第二季度财报',
  },
  thesis:
    '汽车与AI新业务延续增长，但手机、IoT收入和集团毛利率同时承压，基本面呈“新业务扩张、传统核心降速”的分化。',
  stance: '中性',
  overview:
    '小米正从手机与AIoT平台公司向“人车家全生态”扩展。2026年第二季度收入环比回升，但同比仍下滑；智能汽车交付增长提供第二增长曲线，存储等关键部件涨价、补贴退坡与研发投入上升则压缩利润空间。',
  metrics: [
    {
      label: '总收入',
      value: '人民币1,089亿元',
      period: '2026Q2',
      change: '同比 -6.1%',
      assessment: '环比增长9.9%，但同比仍受手机和IoT业务回落拖累。',
      sourceUrl: resultsUrl,
    },
    {
      label: '经调整净利润',
      value: '人民币62亿元',
      period: '2026Q2',
      change: '同比 -42.6%',
      assessment: '利润降幅明显大于收入，成本与新业务投入压力突出。',
      sourceUrl: resultsUrl,
    },
    {
      label: '集团毛利率',
      value: '19.8%',
      period: '2026Q2',
      change: '同比 -2.7pct',
      assessment: '关键部件涨价及产品结构变化压低手机、IoT与汽车业务毛利率。',
      sourceUrl: resultsUrl,
    },
    {
      label: '智能手机收入',
      value: '人民币421亿元',
      period: '2026Q2',
      change: '同比 -7.5%',
      assessment: '出货量下滑，平均售价提升仅部分抵消收入压力。',
      sourceUrl: resultsUrl,
    },
    {
      label: '智能手机出货量',
      value: '3,120万部',
      period: '2026Q2',
      change: '同比 -26.5%',
      assessment:
        '公司解释为产品组合优化及中低端机型出货减少，同时全球需求受部件涨价影响。',
      sourceUrl: resultsUrl,
    },
    {
      label: '汽车、AI及新业务收入',
      value: '人民币249亿元',
      period: '2026Q2',
      change: '同比 +17.1%',
      assessment: '汽车交付增加是主要贡献，但平均售价下降限制收入增速。',
      sourceUrl: resultsUrl,
    },
    {
      label: '经营活动现金流',
      value: '人民币38.4亿元',
      period: '2026Q2',
      change: 'Q1为净流出17.9亿元',
      assessment:
        '季度现金流转正；管理口径剔除金融业务相关项目后为净流入112亿元。',
      sourceUrl: resultsUrl,
    },
    {
      label: '期末现金及等价物',
      value: '人民币372.5亿元',
      period: '2026-06-30',
      change: '季度净增110.9亿元',
      assessment:
        '同期总借款为393亿元，需结合定期存款及投资资产整体判断流动性。',
      sourceUrl: resultsUrl,
    },
  ],
  factors: [
    {
      category: '政策',
      signal: '正面',
      title: '数码产品与汽车以旧换新形成需求托底',
      summary:
        '2026年全国统一补贴范围覆盖手机、平板、智能穿戴、智能眼镜及汽车更新，对小米的手机、IoT和汽车业务均有直接需求支持；但公司披露部分国内IoT收入仍受到补贴力度变化影响。',
      evidence: [
        {
          label: '数码产品补贴',
          value: '售价15%，单件最高500元',
          sourceName: '国家发展改革委',
          sourceUrl: policyUrl,
          date: '2025-12-30',
        },
        {
          label: '支持范围',
          value: '手机、平板、智能穿戴、智能眼镜及汽车更新',
          sourceName: '国家发展改革委',
          sourceUrl: policyUrl,
          date: '2025-12-30',
        },
      ],
    },
    {
      category: '行业',
      signal: '负面',
      title: '部件成本上升与需求偏弱压制手机业务',
      summary:
        '小米第二季度手机出货量同比下降26.5%，公司明确将部分压力归因于关键部件价格持续上涨和全球需求转弱；同时产品组合上移使手机平均售价创季度新高。',
      evidence: [
        {
          label: '手机出货量',
          value: '3,120万部，同比下降26.5%',
          sourceName: '小米集团2026Q2业绩',
          sourceUrl: resultsUrl,
          date: '2026-08-18',
        },
        {
          label: '手机平均售价',
          value: '人民币1,351元，同比上升25.9%',
          sourceName: '小米集团2026Q2业绩',
          sourceUrl: resultsUrl,
          date: '2026-08-18',
        },
      ],
    },
    {
      category: '资金',
      signal: '中性',
      title: '经营现金流转正，但扩张与回购持续占用资金',
      summary:
        '第二季度经营活动净现金流转正，期末现金及等价物增加；同时公司支付约50亿元用于股份回购，汽车和AI资本投入仍需持续观察。',
      evidence: [
        {
          label: '经营活动现金流',
          value: '净流入人民币38.4亿元',
          sourceName: '小米集团现金流量表',
          sourceUrl: resultsUrl,
          date: '2026Q2',
        },
        {
          label: '股份回购付款',
          value: '约人民币50亿元',
          sourceName: '小米集团现金流说明',
          sourceUrl: resultsUrl,
          date: '2026Q2',
        },
      ],
    },
    {
      category: '财报',
      signal: '负面',
      title: '收入韧性尚可，但利润率同比收缩',
      summary:
        '集团收入同比下降6.1%，经调整净利润同比下降42.6%，毛利率从22.5%降至19.8%。汽车交付增长尚未完全抵消核心手机与IoT业务的同比回落。',
      evidence: [
        {
          label: '集团收入',
          value: '人民币1,089亿元，同比下降6.1%',
          sourceName: '小米集团2026Q2业绩',
          sourceUrl: resultsUrl,
          date: '2026-08-18',
        },
        {
          label: '集团毛利率',
          value: '19.8%，同比下降2.7个百分点',
          sourceName: '小米集团2026Q2业绩',
          sourceUrl: resultsUrl,
          date: '2026-08-18',
        },
      ],
    },
    {
      category: '宏观',
      signal: '中性',
      title: '通信消费强于大盘，但汽车与家电需求分化',
      summary:
        '2026年前7个月社会消费品零售总额同比增长1.2%，其中通信器材类保持较快增长，而汽车、家电等品类偏弱。宏观需求并非全面扩张，小米不同业务线的景气度存在明显分化。',
      evidence: [
        {
          label: '社会消费品零售总额',
          value: '1—7月同比增长1.2%',
          sourceName: '国家统计局',
          sourceUrl: retailUrl,
          date: '2026-08-17',
        },
        {
          label: '通信器材类零售额',
          value: '1—7月同比增长15.1%',
          sourceName: '国家统计局',
          sourceUrl: retailUrl,
          date: '2026-08-17',
        },
      ],
    },
  ],
  strengths: [
    '智能汽车交付量同比增长28.2%，新业务收入占比提升。',
    '互联网服务毛利率达到76.8%，高毛利业务具备结构性缓冲。',
    'AIoT连接设备和全球月活用户继续增长，生态规模仍在扩大。',
  ],
  risks: [
    '手机和IoT业务同比下滑，关键部件涨价继续压缩毛利率。',
    '汽车平均售价下降、AI研发投入上升，可能延长利润释放周期。',
    '消费需求分化、补贴强度变化与地缘不确定性影响海外和国内销售。',
  ],
  catalysts: [
    '2026年以旧换新补贴的落地强度与转化效率。',
    'YU7等车型的交付爬坡、产品结构和汽车毛利率变化。',
    '存储等关键部件成本回落及高端手机占比提升。',
    'MiMo等AI能力在终端、汽车和互联网服务中的商业化进展。',
  ],
  conclusion:
    '小米的核心矛盾不在于是否有增长故事，而在于汽车与AI扩张能否在不继续侵蚀集团利润率的前提下，弥补手机和IoT业务的放缓。2026Q2显示新业务规模继续增长，但集团收入、毛利率与经调整利润同比承压。后续最应跟踪汽车毛利率、关键部件成本、手机出货与补贴转化，而非短期价格波动。',
  sources: [
    {
      title: '小米集团2026年第二季度及中期业绩公告',
      publisher: '小米集团投资者关系',
      url: resultsUrl,
      date: '2026-08-18',
    },
    {
      title: '小米集团2026年第二季度业绩演示材料',
      publisher: '小米集团投资者关系',
      url: presentationUrl,
      date: '2026-08-18',
    },
    {
      title: '小米集团季度业绩资料库',
      publisher: '小米集团投资者关系',
      url: 'https://ir.mi.com/financial-information/quarterly-results',
      date: '检索于2026-08-30',
    },
    {
      title: '关于2026年实施大规模设备更新和消费品以旧换新政策的通知',
      publisher: '国家发展改革委',
      url: policyUrl,
      date: '2025-12-30',
    },
    {
      title: '2026年1—7月份社会消费品零售总额增长1.2%',
      publisher: '国家统计局',
      url: retailUrl,
      date: '2026-08-17',
    },
    {
      title: '2026年上半年国民经济运行情况',
      publisher: '国家统计局',
      url: gdpUrl,
      date: '2026-07-15',
    },
    {
      title: '小米集团投资者关系主页',
      publisher: '小米集团',
      url: 'https://ir.mi.com/',
      date: '检索于2026-08-30',
    },
  ],
  disclaimer:
    '本报告仅供信息参考，不构成任何投资建议；市场有风险，决策需独立判断。',
  degraded: true,
  notice:
    '当前 OpenAI API 项目额度不足，已展示截至2026年8月30日由官方来源整理的降级报告。补充API额度后，将自动恢复实时联网分析。',
};
