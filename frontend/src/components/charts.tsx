'use client';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatMonth } from '@/lib/format';
import { useTheme } from './theme';

export const PALETTE = ['#0f766e', '#4f46e5', '#f97316', '#ec4899', '#0ea5e9', '#eab308', '#8b5cf6', '#14b8a6', '#ef4444', '#64748b'];

function useColors() {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  return {
    grid: dark ? '#1e2a44' : '#e2e8f0',
    axis: dark ? '#8a97b2' : '#5b6b85',
    income: dark ? '#34d399' : '#059669',
    expense: dark ? '#f87171' : '#e11d48',
    brand: dark ? '#2dd4bf' : '#0f766e',
    accent: dark ? '#818cf8' : '#4f46e5',
    tooltipBg: dark ? '#0d1526' : '#ffffff',
    tooltipBorder: dark ? '#1e2a44' : '#e2e8f0',
    text: dark ? '#e7ecf6' : '#0b1324',
  };
}

function MoneyTooltip({ active, payload, label, labelFormatter }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; labelFormatter?: (l: string) => string }) {
  const c = useColors();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border px-3 py-2 text-xs shadow-lg" style={{ background: c.tooltipBg, borderColor: c.tooltipBorder, color: c.text }}>
      {label && <p className="mb-1 font-medium">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="num flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} /> {p.name}: {formatMoney(p.value)}
        </p>
      ))}
    </div>
  );
}

const axisTick = (fill: string) => ({ fill, fontSize: 11 });

export function CashflowChart({ data, height = 260 }: { data: Array<{ month: string; income: string; expenses: string; net: string }>; height?: number }) {
  const c = useColors();
  const rows = data.map((d) => ({ month: d.month, Income: Number(d.income), Expenses: Number(d.expenses), Net: Number(d.net) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="month" tickFormatter={formatMonth} tick={axisTick(c.axis)} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => formatMoney(v, { compact: true })} tick={axisTick(c.axis)} axisLine={false} tickLine={false} width={64} />
        <Tooltip content={<MoneyTooltip labelFormatter={formatMonth} />} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <Bar dataKey="Income" fill={c.income} radius={[6, 6, 0, 0]} maxBarSize={28} />
        <Bar dataKey="Expenses" fill={c.expense} radius={[6, 6, 0, 0]} maxBarSize={28} />
        <Line dataKey="Net" stroke={c.accent} strokeWidth={2} dot={false} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, height = 220 }: { data: Array<{ name: string; value: number; color?: string | null }>; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
          {data.map((d, i) => (
            <Cell key={d.name} fill={d.color || PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip content={<MoneyTooltip />} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TrendLine({ data, dataKey, height = 220, label = 'Value' }: { data: Array<Record<string, string | number>>; dataKey: string; height?: number; label?: string }) {
  const c = useColors();
  const rows = data.map((d) => ({ ...d, [label]: Number(d[dataKey]) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="trend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.brand} stopOpacity={0.35} />
            <stop offset="100%" stopColor={c.brand} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="month" tickFormatter={formatMonth} tick={axisTick(c.axis)} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => formatMoney(v, { compact: true })} tick={axisTick(c.axis)} axisLine={false} tickLine={false} width={64} />
        <Tooltip content={<MoneyTooltip labelFormatter={formatMonth} />} />
        <Area dataKey={label} stroke={c.brand} strokeWidth={2} fill="url(#trend)" type="monotone" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SimpleBars({ data, height = 220, color }: { data: Array<{ name: string; value: number }>; height?: number; color?: string }) {
  const c = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="name" tick={axisTick(c.axis)} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => formatMoney(v, { compact: true })} tick={axisTick(c.axis)} axisLine={false} tickLine={false} width={64} />
        <Tooltip content={<MoneyTooltip />} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <Bar dataKey="value" name="Amount" fill={color ?? c.brand} radius={[6, 6, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MultiLine({ data, lines, height = 240 }: { data: Array<Record<string, string | number>>; lines: Array<{ key: string; label: string; color?: string; dashed?: boolean }>; height?: number }) {
  const c = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="month" tickFormatter={formatMonth} tick={axisTick(c.axis)} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => formatMoney(v, { compact: true })} tick={axisTick(c.axis)} axisLine={false} tickLine={false} width={64} />
        <Tooltip content={<MoneyTooltip labelFormatter={formatMonth} />} />
        {lines.map((l, i) => (
          <Line key={l.key} dataKey={l.key} name={l.label} stroke={l.color ?? PALETTE[i]} strokeWidth={2} strokeDasharray={l.dashed ? '5 4' : undefined} dot={false} type="monotone" connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Legend({ items }: { items: Array<{ name: string; value: string; color?: string | null; extra?: string }> }) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={it.name} className="flex items-center justify-between gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.color || PALETTE[i % PALETTE.length] }} />
            <span className="truncate">{it.name}</span>
          </span>
          <span className="num shrink-0 text-muted">
            {formatMoney(it.value)}
            {it.extra && <span className="ml-1.5 text-xs">{it.extra}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
