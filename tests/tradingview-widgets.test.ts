import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  GLOBAL_MARKET_SECTORS,
  tradingViewFrameUrl,
  TRADINGVIEW_SANDBOX,
  type TradingViewTheme,
  type TradingViewWidget,
} from '../lib/tradingview-widgets';

function config(kind: TradingViewWidget) {
  return JSON.parse(
    decodeURIComponent(
      new URL(tradingViewFrameUrl(kind, 'dark')).hash.slice(1),
    ),
  );
}

test('global markets preserve all selected instruments and distinguish product types', () => {
  const expected = [
    'FOREXCOM:SPXUSD',
    'FOREXCOM:NSXUSD',
    'FOREXCOM:DJI',
    'INDEX:NKY',
    'INDEX:DEU40',
    'FOREXCOM:UKXGBP',
    'BMFBOVESPA:ISP1!',
    'BMFBOVESPA:EUR1!',
    'CMCMARKETS:GOLD',
    'TVC:USOIL',
    'BMFBOVESPA:CCM1!',
    'EUREX:FGBL1!',
    'EUREX:FBTP1!',
    'EUREX:FGBM1!',
    'FX:EURUSD',
    'FX:GBPUSD',
    'FX:USDJPY',
    'FX:USDCHF',
    'FX:AUDUSD',
    'FX:USDCAD',
  ];
  assert.deepEqual(
    GLOBAL_MARKET_SECTORS.flatMap((group) => group.symbols).sort(),
    expected.sort(),
  );
  const data = config('market');
  assert.equal(data.locale, 'zh_CN');
  assert.equal(data.width, '100%');
  assert.equal(data.symbolsGroups.length, 6);
  for (const group of data.symbolsGroups) {
    assert.match(group.name, /[\u4e00-\u9fff]/);
    if (
      group.symbols.some((s: { name: string }) =>
        s.name.startsWith('FOREXCOM:'),
      )
    )
      assert.match(group.name, /CFD/);
    if (
      group.symbols.some((s: { name: string }) => s.name.startsWith('EUREX:'))
    )
      assert.match(group.name, /国债期货/);
  }
});

test('news uses the official all-symbols feed and supported original language', () => {
  const data = config('news');
  assert.equal(data.feedMode, 'all_symbols');
  assert.equal(data.locale, 'en');
  assert.equal(data.displayMode, 'adaptive');
  assert.equal(data.symbol, undefined);
  assert.match(tradingViewFrameUrl('news', 'dark'), /embed-widget\/timeline\//);
});

test('vendor frames retain only their external origin, never our origin or secrets', () => {
  assert.equal(
    TRADINGVIEW_SANDBOX,
    'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
  );
  for (const kind of ['market', 'news'] as const) {
    const url = new URL(tradingViewFrameUrl(kind, 'dark'));
    assert.equal(url.origin, 'https://www.tradingview-widget.com');
    assert.doesNotMatch(
      decodeURIComponent(url.toString()),
      /api\/|localStorage|cookie|apiKey|OPENAI|localhost/,
    );
    assert.ok(['zh_CN', 'en'].includes(url.searchParams.get('locale')!));
  }
  const component = readFileSync(
    new URL('../components/tradingview-panel.tsx', import.meta.url),
    'utf8',
  );
  assert.match(component, /referrerPolicy="no-referrer"/);
  assert.match(component, /src=\{tradingViewFrameUrl\(kind, theme\)\}/);
  assert.match(component, /observer.disconnect\(\)/);
  assert.match(component, /clearTimeout\(timer.current\)/);
  assert.match(component, /noopener nofollow/);
  assert.match(component, /by TradingView/);
  assert.doesNotMatch(
    component,
    /fetch\(|setInterval\(|api\/|createElement\('script'|srcDoc|allow-top-navigation/,
  );
});

test('theme and widget inputs are allowlisted instead of interpolating arbitrary HTML', () => {
  assert.match(
    decodeURIComponent(tradingViewFrameUrl('market', 'dark')),
    /"colorTheme":"dark"/,
  );
  assert.match(
    decodeURIComponent(tradingViewFrameUrl('market', 'light')),
    /"colorTheme":"light"/,
  );
  assert.throws(() => tradingViewFrameUrl('evil' as TradingViewWidget, 'dark'));
  assert.throws(() =>
    tradingViewFrameUrl('news', '"><script>' as TradingViewTheme),
  );
});

test('A-share data flow remains separate from the global widgets', () => {
  const quotes = readFileSync(
    new URL('../app/quotes/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(quotes, /href="\/global"/);
  assert.match(quotes, /\/api\/quotes\/kline/);
  assert.doesNotMatch(quotes, /TradingViewPanel|tradingview-widgets/);
  const page = readFileSync(
    new URL('../app/global/page.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(page, /TradingViewPanel kind="market"|CFD|国债期货|TRADINGVIEW_LINKS.coverage/);
  assert.match(page, /TradingViewPanel kind="news"/);
  assert.match(page, /href="\/quotes"/);
  assert.doesNotMatch(page, /api\/analyze|api\/chat|api\/brief/);
});
