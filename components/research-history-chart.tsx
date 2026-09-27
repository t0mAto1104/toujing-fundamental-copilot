'use client';

import { useState } from 'react';
import {
  historyStatistics,
  type ReportHistory,
  type HistorySeries,
} from '@/lib/research-history';

const number = (n: number | null) =>
  n === null
    ? '未取得 / 不适用'
    : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });

export function ResearchHistoryChart({
  history,
  group,
}: {
  history: ReportHistory;
  group: 'finance' | 'valuation';
}) {
  const [years, setYears] = useState(3);
  const [selected, setSelected] = useState(history[group][0]?.id || '');
  const series = history[group];
  const year = Number(history.asOf.slice(0, 4));
  const from =
    group === 'finance'
      ? `${year - years}-01-01`
      : `${year - years}${history.asOf.slice(4, 10)}`;
  return (
    <section
      className="research-history"
      aria-label={group === 'finance' ? '历史财务与成长性图表' : '历史估值图表'}
    >
      <div className="research-history-toolbar">
        <strong>
          {group === 'finance' ? '财务与成长性' : '历史估值'} · 近{years}年
        </strong>
        <div className="print-hidden">
          <label>
            指标{' '}
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {[3, 5].map((n) => (
            <button
              type="button"
              aria-pressed={years === n}
              key={n}
              onClick={() => setYears(n)}
            >
              {n}年
            </button>
          ))}
        </div>
      </div>
      {series.map((s) => (
        <SeriesChart
          key={s.id}
          series={{ ...s, points: s.points.filter((p) => p.date >= from) }}
          selected={s.id === selected}
        />
      ))}
      <p className="research-history-note">
        资料截止：{history.asOf.slice(0, 10)}。{history.notices.join(' ')}
      </p>
      <p className="research-history-note print-hidden">
        导出 PDF 包含此时间范围内的全部指标。
      </p>
    </section>
  );
}

export function SeriesChart({
  series,
  selected,
}: {
  series: HistorySeries;
  selected: boolean;
}) {
  const points = series.points;
  const stats = historyStatistics(
    points,
    series.frequency === 'annual' && series.unit !== '%',
  );
  const valid = points.filter((p) => p.value !== null);
  const lo = Math.min(0, ...valid.map((p) => p.value!));
  const hi = Math.max(0, ...valid.map((p) => p.value!));
  const span = hi - lo || 1;
  const first = Date.parse(points[0]?.date || '2000-01-01');
  const last = Date.parse(points.at(-1)?.date || '2001-01-01');
  const x = (date: string) =>
    64 +
    (last === first ? 0.5 : (Date.parse(date) - first) / (last - first)) * 590;
  const y = (value: number) => 180 - ((value - lo) / span) * 148;
  let path = '',
    connected = false;
  points.forEach((p, i) => {
    const gap =
      i > 0 &&
      Date.parse(p.date) - Date.parse(points[i - 1].date) >
        (series.frequency === 'annual' ? 370 : 45) * 86400_000;
    if (p.value === null) {
      connected = false;
      return;
    }
    path += `${connected && !gap ? 'L' : 'M'}${x(p.date)},${y(p.value)} `;
    connected = true;
  });
  const sources = [...new Set(points.flatMap((p) => p.sourceUrls))];
  return (
    <figure
      className={`research-history-series ${selected ? 'is-selected' : ''}`}
    >
      <figcaption>
        {series.label}{' '}
        <span>
          （{series.unit} ·{' '}
          {series.frequency === 'annual' ? '全年' : '月末观察'}）
        </span>
      </figcaption>
      {valid.length >= 2 ? (
        <svg
          viewBox="0 0 690 220"
          role="img"
          aria-label={`${series.label}历史折线；详细数值见下方数据表`}
        >
          {[lo, lo + span / 2, lo + span].map((v, i) => (
            <g key={i}>
              <line
                x1="64"
                x2="654"
                y1={y(v)}
                y2={y(v)}
                stroke="currentColor"
                opacity="0.15"
              />
              <text x="58" y={y(v) + 4} textAnchor="end">
                {number(v)}
              </text>
            </g>
          ))}
          <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" />
          {valid.map((p) => (
            <circle
              key={p.date}
              cx={x(p.date)}
              cy={y(p.value!)}
              r="3"
              fill="var(--primary)"
              tabIndex={0}
              role="img"
              aria-label={`${p.date}：${number(p.value)}${series.unit}`}
            >
              <title>{`${p.date}：${number(p.value)}${series.unit}`}</title>
            </circle>
          ))}
          {[points[0], points.at(-1)].filter(Boolean).map((p, i) => (
            <text
              key={i}
              x={i ? 654 : 64}
              y="210"
              textAnchor={i ? 'end' : 'start'}
            >
              {p!.date}
            </text>
          ))}
        </svg>
      ) : (
        <p>有效观察不足两个，暂不绘制趋势线。</p>
      )}
      <p className="research-history-note">
        {stats.samples} 个有效观察 · 末期 {number(stats.latest)} {series.unit}
        {stats.cagr !== null
          ? ` · ${stats.cagrYears} 年 CAGR ${number(stats.cagr)}%`
          : ''}
      </p>
      <p className="research-history-note">{series.note}</p>
      <details className="print-hidden">
        <summary>查看数据与计算口径</summary>
        <p>
          CAGR＝（末期÷首期）^(1/相隔年数)−1；仅金额序列、各期完整且为正时展示，实际年数以首末期间为准。
        </p>
        <div className="custom-financial-table">
          <table>
            <thead>
              <tr>
                <th>期间</th>
                <th>
                  {series.label}（{series.unit}）
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <th>{p.date}</th>
                  <td>{number(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="research-history-note">
        来源：
        {sources.length
          ? sources.map((url, i) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                {i ? ' · ' : ''}原始数据 {i + 1}
              </a>
            ))
          : '未取得'}
      </p>
    </figure>
  );
}
