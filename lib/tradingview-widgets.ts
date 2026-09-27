// Public display configuration only. Never pass users, watchlists, keys or
// research context into these third-party documents.
export type TradingViewWidget = 'market' | 'news';
export type TradingViewTheme = 'light' | 'dark';

export const GLOBAL_MARKET_SECTORS = [
  {
    sectionName: '指数 CFD · FOREX.com',
    symbols: [
      'FOREXCOM:SPXUSD',
      'FOREXCOM:NSXUSD',
      'FOREXCOM:DJI',
      'FOREXCOM:UKXGBP',
    ],
  },
  { sectionName: '指数 · INDEX 源', symbols: ['INDEX:NKY', 'INDEX:DEU40'] },
  {
    sectionName: '商品 CFD · CMC / TVC',
    symbols: ['CMCMARKETS:GOLD', 'TVC:USOIL'],
  },
  {
    sectionName: '交易所期货 · B3',
    symbols: ['BMFBOVESPA:ISP1!', 'BMFBOVESPA:EUR1!', 'BMFBOVESPA:CCM1!'],
  },
  {
    sectionName: '国债期货 · EUREX',
    symbols: ['EUREX:FGBL1!', 'EUREX:FBTP1!', 'EUREX:FGBM1!'],
  },
  {
    sectionName: '外汇 · FX 源',
    symbols: [
      'FX:EURUSD',
      'FX:GBPUSD',
      'FX:USDJPY',
      'FX:USDCHF',
      'FX:AUDUSD',
      'FX:USDCAD',
    ],
  },
];

export const TRADINGVIEW_LINKS = {
  market: 'https://www.tradingview.com/markets/',
  news: 'https://www.tradingview.com/news/top-providers/tradingview/',
  coverage: 'https://www.tradingview.com/widget-docs/markets/',
};

// Only use with the fixed external HTTPS src below, NEVER srcDoc / our origin.
// The vendor retains its own origin for storage and internal datafeed messages;
// the same-origin policy still isolates our cookies, parent DOM and BYOK settings.
export const TRADINGVIEW_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';

export function tradingViewFrameUrl(
  kind: TradingViewWidget,
  theme: TradingViewTheme,
) {
  if (kind !== 'market' && kind !== 'news') throw new Error('Unknown widget');
  if (theme !== 'light' && theme !== 'dark') throw new Error('Unknown theme');
  // Matches the URLs produced by the official embed-widget-market-quotes.js
  // and embed-widget-timeline.js loaders, without running them in our origin.
  const config = {
    colorTheme: theme,
    isTransparent: false,
    width: '100%',
    height: '100%',
    ...(kind === 'market'
      ? {
          locale: 'zh_CN',
          showSymbolLogo: true,
          symbolsGroups: GLOBAL_MARKET_SECTORS.map(
            ({ sectionName, symbols }) => ({
              name: sectionName,
              symbols: symbols.map((name) => ({ name })),
            }),
          ),
        }
      : { displayMode: 'adaptive', feedMode: 'all_symbols', locale: 'en' }),
  };
  const widget = kind === 'market' ? 'market-quotes' : 'timeline';
  const url = new URL(
    `https://www.tradingview-widget.com/embed-widget/${widget}/`,
  );
  url.searchParams.set('locale', config.locale);
  url.hash = encodeURIComponent(JSON.stringify(config));
  return url.toString();
}
