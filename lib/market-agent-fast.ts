// Exact whole-question recognition only; FX still goes through the semantic
// guard and source-verified web search, never a keyword-based finance bypass.
const currencies: Record<string, string> = {
  澳元: 'AUD',
  澳币: 'AUD',
  人民币: 'CNY',
  美元: 'USD',
  美金: 'USD',
  欧元: 'EUR',
  日元: 'JPY',
  英镑: 'GBP',
  港币: 'HKD',
  港元: 'HKD',
  加元: 'CAD',
  加币: 'CAD',
  新西兰元: 'NZD',
  纽元: 'NZD',
  新加坡元: 'SGD',
  新元: 'SGD',
  瑞士法郎: 'CHF',
  瑞郎: 'CHF',
};
const names = Object.keys(currencies)
  .concat([...new Set(Object.values(currencies))])
  .join('|');
const fxQuestion = new RegExp(
  `^(?:请问|查询|查一下|帮我查(?:询)?一下)?(?:今天|今日|当前|现在|最新)?(${names})(?:兑|对|兑换|/)(${names})的?(?:参考)?汇率(?:是多少|多少)?[?？。!！]*$`,
  'i',
);
const unitQuestion = new RegExp(
  `^(?:请问)?(?:今天|今日|当前|现在)?1(?:个)?(${names})(?:等于|能换|兑换)(?:多少)?(${names})[?？。!！]*$`,
  'i',
);
const singleCurrencyQuestion = new RegExp(
  `^(?:请问|查询|查一下|帮我查(?:询)?一下)?(?:今天|今日|当前|现在|最新)?(${names})的?(?:参考)?汇率(?:是多少|多少)?[?？。!！]*$`,
  'i',
);
type MarketFxPair = { base: string; quote: string; assumedQuote?: true };

export function parseMarketFxQuestion(question: string): MarketFxPair | null {
  const compact = question.replace(/\s+/g, '');
  const match = compact.match(fxQuestion) || compact.match(unitQuestion);
  const code = (name: string) => currencies[name] || name.toUpperCase();
  if (!match) {
    const single = compact.match(singleCurrencyQuestion);
    // This Chinese-market product defaults shorthand quotes to CNY, but must
    // disclose that assumption. Whole-question matching remains mandatory.
    if (!single || code(single[1]) === 'CNY') return null;
    return { base: code(single[1]), quote: 'CNY', assumedQuote: true };
  }
  const base = code(match[1]);
  const quote = code(match[2]);
  return base === quote ? null : { base, quote };
}

const definitions: Record<string, string> = {
  PE: '市盈率（PE）=股价÷每股收益，也可用总市值÷归母净利润计算。TTM 使用最近四个季度利润；亏损时 PE 通常不具可比性。不能单凭 PE 高低判断是否便宜，还要结合成长、周期和利润质量。',
  PB: '市净率（PB）=股价÷每股净资产，也可用总市值÷归母净资产计算。需结合净资产质量、盈利能力和行业特点；净资产为负时不宜直接比较。',
  ROE: '净资产收益率（ROE）衡量股东资本的盈利能力，常用归母净利润÷平均归母净资产。需区分加权平均等统计口径，并结合杠杆、非经常损益和现金流判断质量。',
  EPS: '每股收益（EPS）通常为归属普通股股东的净利润÷加权平均普通股股数。基本与稀释每股收益口径不同，应留意增发、回购及潜在稀释。',
  市值: '总市值=当前股价×总股本；流通市值按流通股本计算。市值反映股票的市场定价，不等于公司内在价值，也不等于企业价值（EV）。',
  经营现金流:
    '经营活动现金流量净额是经营收款与付款的净额，不等于净利润。分析时应结合应收账款、存货、预收与应付变化，区分可持续盈利和一次性现金变化。',
  股息率: '股息率通常为每股现金分红÷股价。历史分红口径与预期分红口径不同；高股息率不代表未来分红有保证，需要核验现金流与分红政策。',
  CAGR: '复合年增长率（CAGR）=（期末值÷期初值）的（1÷年数）次方−1。起止值为正且统计口径一致时才适合这样计算；它平滑了过程，不能代替逐年波动分析。',
};
export function marketDefinition(question: string) {
  const normalized = question
    .replace(/\s+/g, '')
    .replace(/市盈率/gi, 'PE')
    .replace(/市净率/gi, 'PB')
    .replace(/净资产收益率/gi, 'ROE')
    .replace(/每股收益/gi, 'EPS')
    .replace(/复合年增长率/gi, 'CAGR');
  const match = normalized.match(
    /^(?:(?:请|帮我)?(?:解释|介绍)(?:一下)?|什么是)?(PE|PB|ROE|EPS|CAGR|市值|经营现金流|股息率)(?:是什么|是什么意思|怎么计算|如何计算)?[?？。!！]*$/i,
  );
  return match ? definitions[match[1].toUpperCase()] || null : null;
}
