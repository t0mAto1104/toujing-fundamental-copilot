'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { marketAmount } from '@/lib/quote-types';
import type { FundPoint } from '@/lib/signal-types';

export default function FundFlowChart({
  points,
  frequency,
}: {
  points: FundPoint[];
  frequency: 'minute' | 'day';
}) {
  return (
    <figure
      className="h-56 pr-4"
      aria-label={`主力资金${frequency === 'minute' ? '当日累计' : '每日净额'}趋势，金额元`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 8, right: 12, bottom: 8, left: 16 }}
        >
          <CartesianGrid
            stroke="var(--border)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tickFormatter={(v: string) =>
              frequency === 'minute' ? v.slice(11) : v.slice(5)
            }
            minTickGap={40}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          />
          <YAxis
            tickFormatter={(v: number) => marketAmount(v)}
            width={68}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--card)',
              borderColor: 'var(--border)',
              borderRadius: 6,
            }}
            formatter={(v) => [
              marketAmount(typeof v === 'number' ? v : null, '元'),
              '主力净额',
            ]}
          />
          <Area
            type="linear"
            dataKey="main"
            name="主力净额"
            stroke="var(--primary)"
            fill="var(--primary)"
            fillOpacity={0.12}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
