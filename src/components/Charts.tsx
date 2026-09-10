/**
 * Lightweight SVG-based chart components for the dashboard and reports.
 * No external chart library required - everything is pure React + SVG.
 *
 * Components:
 *   - BarChart       : vertical bars with labels
 *   - HorizontalBar  : horizontal bars (good for ranked lists)
 *   - DonutChart     : donut with legend (for distributions)
 *   - LineChart      : simple line chart (for trends)
 *   - Sparkline      : tiny inline trend indicator
 */

import { useId } from 'react';
import { formatCurrency, formatNumber } from '../lib/utils';

// =================== Color palette ===================
export const CHART_COLORS = [
  '#dc2626', // brand red
  '#0ea5e9', // sky blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#84cc16', // lime
];

interface BaseChartProps {
  height?: number;
  className?: string;
}

// =================== Bar Chart ===================
interface BarChartDatum { label: string; value: number; color?: string; }
export function BarChart({ data, height = 240, formatValue = formatNumber, className }: BaseChartProps & { data: BarChartDatum[]; formatValue?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <div className="text-center text-sm text-slate-400 py-8">No data</div>;

  const barWidth = 100 / data.length;
  return (
    <div className={className} style={{ height }}>
      <div className="h-full flex items-end gap-2 px-1">
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const color = d.color || CHART_COLORS[i % CHART_COLORS.length];
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
              <div className="text-xs font-semibold text-slate-700 mb-1">{formatValue(d.value)}</div>
              <div
                className="w-full rounded-t transition-all hover:opacity-80"
                style={{ height: `${pct}%`, backgroundColor: color, minHeight: d.value > 0 ? '4px' : '0' }}
                title={`${d.label}: ${formatValue(d.value)}`}
              />
              <div className="text-xs text-slate-500 mt-1 text-center truncate w-full" title={d.label}>{d.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =================== Horizontal Bar Chart ===================
interface HBarDatum { label: string; value: number; color?: string; sublabel?: string; }
export function HorizontalBarChart({ data, formatValue = formatNumber, maxItems = 10 }: { data: HBarDatum[]; formatValue?: (n: number) => string; maxItems?: number }) {
  if (data.length === 0) return <div className="text-center text-sm text-slate-400 py-6">No data</div>;
  const items = data.slice(0, maxItems);
  const max = Math.max(1, ...items.map((d) => d.value));
  return (
    <div className="space-y-2">
      {items.map((d, i) => {
        const pct = (d.value / max) * 100;
        const color = d.color || CHART_COLORS[i % CHART_COLORS.length];
        return (
          <div key={i} className="flex items-center gap-2">
            <div className="w-32 text-sm text-slate-700 truncate text-right" title={d.label}>{d.label}</div>
            <div className="flex-1 bg-slate-100 rounded h-6 relative overflow-hidden">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${pct}%`, backgroundColor: color, minWidth: d.value > 0 ? '4px' : '0' }}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-700">
                {formatValue(d.value)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =================== Donut Chart ===================
interface DonutDatum { label: string; value: number; color?: string; }
export function DonutChart({ data, size = 160, thickness = 28, formatValue = formatNumber }: { data: DonutDatum[]; size?: number; thickness?: number; formatValue?: (n: number) => string }) {
  const gradId = useId();
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <div className="text-center text-sm text-slate-400 py-8">No data</div>;
  }
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={thickness} />
        {data.map((d, i) => {
          const value = d.value;
          const pct = value / total;
          const dash = pct * circumference;
          const color = d.color || CHART_COLORS[i % CHART_COLORS.length];
          const segment = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ transition: 'stroke-dasharray 0.3s' }}
            />
          );
          offset += dash;
          return segment;
        })}
        <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" className="fill-slate-900 text-xl font-bold">
          {formatValue(total)}
        </text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" dominantBaseline="central" className="fill-slate-500 text-[10px] uppercase tracking-wider">
          Total
        </text>
      </svg>
      <div className="flex-1 min-w-[140px] space-y-1">
        {data.map((d, i) => {
          const color = d.color || CHART_COLORS[i % CHART_COLORS.length];
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          return (
            <div key={i} className="flex items-center gap-2 text-sm">
              <div className="h-3 w-3 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-slate-700 flex-1 truncate">{d.label}</span>
              <span className="font-medium text-slate-900">{formatValue(d.value)}</span>
              <span className="text-xs text-slate-500">{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =================== Line Chart ===================
interface LinePoint { label: string; value: number; }
export function LineChart({ data, height = 200, color = '#dc2626', formatValue = formatNumber }: { data: LinePoint[]; height?: number; color?: string; formatValue?: (n: number) => string }) {
  if (data.length === 0) return <div className="text-center text-sm text-slate-400 py-8">No data</div>;
  if (data.length === 1) {
    return (
      <div className="text-center py-8">
        <div className="text-3xl font-bold text-slate-900">{formatValue(data[0].value)}</div>
        <div className="text-sm text-slate-500 mt-1">{data[0].label}</div>
      </div>
    );
  }
  const width = 600;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const range = max - min || 1;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * w;
    const y = padding.top + h - ((d.value - min) / range) * h;
    return { x, y, ...d };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${padding.top + h} L ${points[0].x.toFixed(1)} ${padding.top + h} Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
        const y = padding.top + h - t * h;
        const val = min + t * range;
        return (
          <g key={i}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padding.left - 8} y={y + 4} textAnchor="end" className="fill-slate-500 text-[10px]">{formatValue(val)}</text>
          </g>
        );
      })}
      {/* X-axis labels (show every Nth) */}
      {points.map((p, i) => {
        const step = Math.max(1, Math.floor(points.length / 6));
        if (i % step !== 0) return null;
        return <text key={i} x={p.x} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">{p.label}</text>;
      })}
      {/* Area */}
      <path d={areaD} fill={`url(#grad-${color.replace('#', '')})`} />
      {/* Line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {/* Points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="white" stroke={color} strokeWidth={2} />
      ))}
    </svg>
  );
}

// =================== Sparkline ===================
export function Sparkline({ data, color = '#10b981', width = 80, height = 24 }: { data: number[]; color?: string; width?: number; height?: number }) {
  if (data.length === 0) return null;
  if (data.length === 1) return <div className="w-4 h-4 rounded-full" style={{ backgroundColor: color }} />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// =================== KPI Card ===================
export function KpiCard({ label, value, sublabel, trend, icon, color = 'text-slate-900' }: {
  label: string;
  value: string;
  sublabel?: string;
  trend?: { value: string; direction: 'up' | 'down' | 'neutral' };
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</div>
          <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
          {sublabel && <div className="text-xs text-slate-500 mt-1">{sublabel}</div>}
        </div>
        {icon && <div className="text-slate-400">{icon}</div>}
      </div>
      {trend && (
        <div className={`text-xs mt-2 ${trend.direction === 'up' ? 'text-emerald-600' : trend.direction === 'down' ? 'text-red-600' : 'text-slate-500'}`}>
          {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.value}
        </div>
      )}
    </div>
  );
}
