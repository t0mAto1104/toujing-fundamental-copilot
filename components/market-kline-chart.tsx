'use client';

/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- Focusable canvas application intentionally supports keyboard crosshair navigation; native controls are also provided. */

import { Expand, Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { Button } from '@/components/ui/button';
import {
  marketAmount,
  marketNumber,
  movingAverage,
  type KlineBar,
} from '@/lib/quote-types';

const up = '#ec636d';
const down = '#26b987';
const averages = [
  { length: 5, color: '#d49e1b' },
  { length: 10, color: '#a783ef' },
  { length: 20, color: '#348bd4' },
];

export function MarketKlineChart({
  bars,
  minute,
  precision = 2,
}: {
  bars: KlineBar[];
  minute: boolean;
  precision?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeries = useRef<ISeriesApi<'Line'>[]>([]);
  const maData = useMemo(
    () => averages.map(({ length }) => movingAverage(bars, length)),
    [bars],
  );
  const data = useRef(bars);
  const previous = useRef<KlineBar[]>([]);
  const cursor = useRef(-1);
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<KlineBar | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    data.current = bars;
  }, [bars]);

  useEffect(() => {
    let disposed = false;
    let observer: MutationObserver | undefined;
    void import('lightweight-charts')
      .then(
        ({
          createChart,
          CandlestickSeries,
          HistogramSeries,
          LineSeries,
          ColorType,
          CrosshairMode,
          TickMarkType,
        }) => {
          if (disposed || !container.current) return;
          const formatTime = (time: unknown, tick = false) => {
            if (typeof time !== 'number') return '';
            return new Intl.DateTimeFormat('zh-CN', {
              timeZone: 'Asia/Shanghai',
              ...(tick && minute
                ? {}
                : { year: 'numeric', month: '2-digit', day: '2-digit' }),
              ...(minute
                ? { hour: '2-digit', minute: '2-digit', hour12: false }
                : {}),
            }).format(new Date(time * 1000));
          };
          const api = createChart(container.current, {
            autoSize: true,
            layout: {
              background: { type: ColorType.Solid, color: 'transparent' },
              fontSize: 12,
              attributionLogo: true,
            },
            localization: {
              locale: 'zh-CN',
              timeFormatter: (time: unknown) => formatTime(time),
            },
            crosshair: { mode: CrosshairMode.Normal },
            rightPriceScale: {
              minimumWidth: 68,
              scaleMargins: { top: 0.08, bottom: 0.07 },
            },
            timeScale: {
              timeVisible: minute,
              secondsVisible: false,
              rightOffset: 5,
              tickMarkFormatter: (time: unknown, type: number) => {
                if (typeof time !== 'number') return '';
                const date = new Date(time * 1000 + 8 * 3600_000).toISOString();
                return type === TickMarkType.Year
                  ? date.slice(0, 4)
                  : type === TickMarkType.Month
                    ? date.slice(0, 7)
                    : formatTime(time, true);
              },
            },
            handleScroll: {
              mouseWheel: false,
              pressedMouseMove: true,
              horzTouchDrag: true,
              vertTouchDrag: false,
            },
            handleScale: {
              mouseWheel: true,
              pinch: true,
              axisPressedMouseMove: true,
              axisDoubleClickReset: true,
            },
          });
          chart.current = api;
          series.current = api.addSeries(CandlestickSeries, {
            upColor: up,
            downColor: down,
            borderVisible: false,
            wickUpColor: up,
            wickDownColor: down,
            priceFormat: {
              type: 'price',
              precision,
              minMove: 10 ** -precision,
            },
          });
          maSeries.current = averages.map(({ color }) =>
            api.addSeries(
              LineSeries,
              {
                color,
                lineWidth: 1,
                priceScaleId: 'right',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: true,
                priceFormat: {
                  type: 'price',
                  precision,
                  minMove: 10 ** -precision,
                },
              },
              0,
            ),
          );
          volume.current = api.addSeries(
            HistogramSeries,
            {
              priceFormat: { type: 'volume' },
              lastValueVisible: false,
              priceLineVisible: false,
            },
            1,
          );
          api.panes()[1].setStretchFactor(0.25);
          const theme = () => {
            const dark = document.documentElement.classList.contains('dark');
            api.applyOptions({
              layout: { textColor: dark ? '#b8c5c2' : '#4b605b' },
              grid: {
                vertLines: { color: dark ? '#ffffff08' : '#00000008' },
                horzLines: { color: dark ? '#ffffff0f' : '#0000000c' },
              },
              rightPriceScale: {
                borderColor: dark ? '#ffffff20' : '#00000020',
              },
              timeScale: { borderColor: dark ? '#ffffff20' : '#00000020' },
              crosshair: {
                vertLine: {
                  color: dark ? '#91a59d' : '#526960',
                  labelBackgroundColor: '#24483a',
                },
                horzLine: {
                  color: dark ? '#91a59d' : '#526960',
                  labelBackgroundColor: '#24483a',
                },
              },
            });
          };
          theme();
          observer = new MutationObserver(theme);
          observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class'],
          });
          api.subscribeCrosshairMove((param) => {
            const index = data.current.findIndex(
              (bar) => bar.time === param.time,
            );
            cursor.current = index;
            setHovered(index >= 0 ? data.current[index] : null);
          });
          setReady(true);
        },
      )
      .catch(() => {
        if (!disposed) setError('图表组件加载失败，请刷新页面。');
      });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart.current?.remove();
      chart.current = null;
      series.current = null;
      volume.current = null;
      maSeries.current = [];
      previous.current = [];
    };
  }, [minute, precision]);

  useEffect(() => {
    if (!ready || !chart.current || !series.current || !volume.current) return;
    const candle = (bar: KlineBar) => ({
      time: bar.time as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    });
    const vol = (bar: KlineBar) =>
      bar.volume === null
        ? { time: bar.time as UTCTimestamp }
        : {
            time: bar.time as UTCTimestamp,
            value: bar.volume,
            color: `${bar.close >= bar.open ? up : down}99`,
          };
    const old = previous.current;
    // Polls update the last bar without resetting a user's zoom or historical position.
    const incremental =
      old.length > 0 &&
      bars.length >= old.length &&
      old
        .slice(0, -1)
        .every((bar, i) => JSON.stringify(bar) === JSON.stringify(bars[i])) &&
      old.at(-1)?.time === bars[old.length - 1]?.time;
    if (incremental) {
      for (const bar of bars.slice(old.length - 1)) {
        series.current.update(candle(bar));
        volume.current.update(vol(bar));
      }
    } else {
      const range = chart.current.timeScale().getVisibleRange();
      series.current.setData(bars.map(candle));
      volume.current.setData(bars.map(vol));
      if (!old.length)
        chart.current.timeScale().setVisibleLogicalRange({
          from: Math.max(0, bars.length - 100),
          to: bars.length + 4,
        });
      else if (range) chart.current.timeScale().setVisibleRange(range);
    }
    previous.current = bars;
    maSeries.current.forEach((line, index) =>
      line.setData(
        maData[index].map((point) =>
          point.value === null
            ? { time: point.time as UTCTimestamp }
            : { time: point.time as UTCTimestamp, value: point.value },
        ),
      ),
    );
  }, [bars, ready, maData]);

  const selected =
    (hovered && bars.find((bar) => bar.time === hovered.time)) || bars.at(-1);
  const selectedIndex = bars.findIndex((bar) => bar.time === selected?.time);
  const zoom = (factor: number) => {
    const scale = chart.current?.timeScale();
    const range = scale?.getVisibleLogicalRange();
    if (range) {
      const half =
        Math.max(5, Math.min(600, (range.to - range.from) * factor)) / 2;
      const center = (range.from + range.to) / 2;
      scale?.setVisibleLogicalRange({ from: center - half, to: center + half });
    }
  };

  return (
    <div
      ref={root}
      className="bg-card/20 p-3 sm:p-4 [&:fullscreen]:flex [&:fullscreen]:flex-col [&:fullscreen]:bg-background"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums"
          aria-label="光标所在 K 线数据"
        >
          <span className="text-muted-foreground">{selected?.date || '—'}</span>
          {(
            [
              ['开', selected?.open],
              ['高', selected?.high],
              ['低', selected?.low],
              ['收', selected?.close],
            ] as const
          ).map(([label, value]) => (
            <span key={label}>
              {label} <b>{marketNumber(value, precision)}</b>
            </span>
          ))}
          <span>
            量 <b>{marketAmount(selected?.volume, '手')}</b>
          </span>
          <span>
            额 <b>{marketAmount(selected?.amount, '元')}</b>
          </span>
          {averages.map(({ length, color }, i) => (
            <span key={length} style={{ color }}>
              MA{length}{' '}
              <b>{marketNumber(maData[i][selectedIndex]?.value, precision)}</b>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="放大 K 线"
            title="放大"
            onClick={() => zoom(0.7)}
          >
            <Plus />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="缩小 K 线"
            title="缩小"
            onClick={() => zoom(1.4)}
          >
            <Minus />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="回到最新 K 线"
            title="回到最新"
            onClick={() => {
              chart.current
                ?.priceScale('right')
                .applyOptions({ autoScale: true });
              chart.current?.timeScale().setVisibleLogicalRange({
                from: Math.max(0, bars.length - 100),
                to: bars.length + 4,
              });
            }}
          >
            <RotateCcw />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="全屏 K 线图"
            title="全屏"
            onClick={() => {
              void (
                document.fullscreenElement
                  ? document.exitFullscreen()
                  : root.current?.requestFullscreen()
              )?.catch(() => setError('当前浏览器不支持全屏。'));
            }}
          >
            <Expand />
          </Button>
        </div>
      </div>
      {error ? (
        <p className="mb-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div
        ref={container}
        tabIndex={0}
        role="application"
        aria-label="交互 K 线图。拖动平移，滚轮或双指缩放，左右方向键逐根查看，Home 回到最新。"
        className="h-[420px] w-full outline-none focus-visible:ring-2 focus-visible:ring-primary sm:h-[490px] [:fullscreen_&]:min-h-0 [:fullscreen_&]:flex-1"
        onKeyDown={(event) => {
          if (
            !['ArrowLeft', 'ArrowRight', 'Home', '+', '-', '='].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          if (event.key === '+' || event.key === '=') return zoom(0.7);
          if (event.key === '-') return zoom(1.4);
          const index =
            event.key === 'Home'
              ? bars.length - 1
              : Math.max(
                  0,
                  Math.min(
                    bars.length - 1,
                    (cursor.current < 0 ? bars.length - 1 : cursor.current) +
                      (event.key === 'ArrowLeft' ? -1 : 1),
                  ),
                );
          const bar = bars[index];
          if (bar && series.current) {
            cursor.current = index;
            setHovered(bar);
            const scale = chart.current?.timeScale();
            const range = scale?.getVisibleLogicalRange();
            if (
              range &&
              (index < range.from || index > range.to || event.key === 'Home')
            )
              scale?.setVisibleLogicalRange({
                from: Math.max(0, index - (range.to - range.from) + 5),
                to: index + 5,
              });
            chart.current?.setCrosshairPosition(
              bar.close,
              bar.time as UTCTimestamp,
              series.current,
            );
          }
        }}
      />
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs leading-5 text-muted-foreground">
        <span>红涨绿跌 · 拖动平移 / 滚轮缩放 / 十字光标查看 · 北京时间</span>
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noreferrer"
          className="hover:text-primary"
        >
          TradingView Lightweight Charts™ · Copyright © 2025 TradingView, Inc.
        </a>
      </div>
    </div>
  );
}
