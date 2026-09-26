import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { dailySummary as summaryApi } from '../lib/ipc';
import type { DailyProductionSummary } from '../types';
import { formatCurrency, formatNumber, formatDate } from '../lib/utils';
import { BarChart, KpiCard } from '../components/Charts';
import { exportToCsv, printHtml, reportHeader, buildTableHtml } from '../lib/export';
import {
  Package, TrendingUp, Users, Boxes, Flame, FileText,
} from 'lucide-react';

const STAGE_LABELS: Record<string, string> = {
  raw_brick_making: 'Raw Bricks Made',
  raw_brick_transport: 'Transported to Kiln',
  kiln_loading: 'Loaded into Kiln',
  baked_brick_unloading: 'Baked Bricks Unloaded',
};

export default function DailySummaryPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<DailyProductionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const r = await summaryApi.get(date);
      setSummary(r);
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [date]);

  const handleCsv = () => {
    if (!summary) return;
    // Build a flat per-worker CSV
    const rows = summary.top_workers.map((w) => ({
      date: summary.date,
      worker_code: w.worker_code,
      worker_name: w.worker_name,
      department: w.department_name,
      qty: w.total_qty,
      labour_amount: w.total_labour.toFixed(2),
    }));
    exportToCsv(`daily-summary-${summary.date}`, rows);
    pushToast('success', 'CSV exported.');
  };

  const handlePrint = () => {
    if (!summary) return;
    const kilnName = 'Brick Kiln ERP';
    const body = `
      ${reportHeader(kilnName, 'Daily Production Summary', { from: summary.date, to: summary.date })}
      <h3>Production by Stage</h3>
      ${buildTableHtml(summary.stages, [
        { key: 'stage_label', label: 'Stage' },
        { key: 'total_qty', label: 'Quantity', align: 'right' as const, format: (v: number) => (v || 0).toLocaleString() },
        { key: 'total_labour', label: 'Labour (Rs.)', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
        { key: 'entries_count', label: 'Entries', align: 'right' as const },
        { key: 'unique_workers', label: 'Workers', align: 'right' as const },
      ])}
      <h3>Top Workers</h3>
      ${buildTableHtml(summary.top_workers.map((w) => ({
        ...w,
        worker_name: w.worker_name,
      })), [
        { key: 'worker_code', label: 'Code' },
        { key: 'worker_name', label: 'Name' },
        { key: 'department_name', label: 'Dept' },
        { key: 'total_qty', label: 'Qty', align: 'right' as const, format: (v: number) => (v || 0).toLocaleString() },
        { key: 'total_labour', label: 'Labour (Rs.)', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
      ])}
      <h3>Stock on Hand</h3>
      ${buildTableHtml(summary.stock_snapshot, [
        { key: 'category_name', label: 'Category' },
        { key: 'quantity', label: 'Quantity', align: 'right' as const, format: (v: number) => (v || 0).toLocaleString() },
      ])}
    `;
    printHtml('Daily Production Summary', body);
  };

  return (
    <div>
      <PageHeader
        title="Daily Production Summary"
        subtitle="Today's complete production overview — by stage, worker, department"
        actions={
          <>
            <button className="btn-secondary" onClick={handleCsv} disabled={!summary || loading}>
              <FileText className="h-4 w-4" /> CSV
            </button>
            <button className="btn-primary" onClick={handlePrint} disabled={!summary || loading}>
              Print / PDF
            </button>
          </>
        }
      />

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div>
            <label className="label">Select Date</label>
            <input
              type="date"
              className="input"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="text-sm text-slate-600 ml-auto">
            Showing: <span className="font-semibold text-slate-900">{formatDate(date)}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : !summary ? (
        <EmptyState title="No data" />
      ) : summary.total_entries === 0 ? (
        <EmptyState
          title="No production recorded on this date"
          message="Use the Production page to record entries, then return here for the summary."
          icon={<Package className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-6">
          {/* Top KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label="Total Production"
              value={formatNumber(summary.total_qty)}
              sublabel="bricks"
              icon={<Package className="h-5 w-5" />}
              color="text-blue-600"
            />
            <KpiCard
              label="Total Labour"
              value={formatCurrency(summary.total_labour)}
              sublabel="today"
              icon={<TrendingUp className="h-5 w-5" />}
              color="text-emerald-600"
            />
            <KpiCard
              label="Active Workers"
              value={String(summary.total_workers_active)}
              sublabel="worked today"
              icon={<Users className="h-5 w-5" />}
              color="text-purple-600"
            />
            <KpiCard
              label="Entries"
              value={String(summary.total_entries)}
              sublabel="production records"
              icon={<FileText className="h-5 w-5" />}
              color="text-amber-600"
            />
          </div>

          {/* Stage breakdown - the user's request */}
          <div className="card p-5">
            <h2 className="text-base font-semibold text-slate-900 mb-4">Production by Stage (آج کی پیداوار)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {summary.stages.map((s) => (
                <div
                  key={s.stage}
                  className={`p-4 rounded-md border ${
                    s.total_qty > 0
                      ? 'bg-gradient-to-br from-slate-50 to-white border-slate-200'
                      : 'bg-slate-50 border-slate-100 opacity-60'
                  }`}
                >
                  <div className="text-xs text-slate-500 uppercase tracking-wider">{STAGE_LABELS[s.stage] || s.stage_label}</div>
                  <div className={`text-2xl font-bold mt-1 ${s.total_qty > 0 ? 'text-slate-900' : 'text-slate-400'}`}>
                    {formatNumber(s.total_qty)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {formatCurrency(s.total_labour)} labour
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    {s.entries_count} entries · {s.unique_workers} workers
                  </div>
                </div>
              ))}
            </div>

            {summary.stages.length > 0 && (
              <div className="mt-5">
                <BarChart
                  data={summary.stages.map((s) => ({
                    label: STAGE_LABELS[s.stage]?.split(' ')[0] || s.stage,
                    value: s.total_qty,
                  }))}
                  formatValue={(n) => formatNumber(n)}
                  height={200}
                />
              </div>
            )}
          </div>

          {/* Two-column: top workers + department breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-5">
              <h2 className="text-base font-semibold text-slate-900 mb-3">Top Workers</h2>
              {summary.top_workers.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No workers worked on this date.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left py-2">Code</th>
                      <th className="text-left py-2">Name</th>
                      <th className="text-left py-2">Dept</th>
                      <th className="text-right py-2">Qty</th>
                      <th className="text-right py-2">Labour</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summary.top_workers.map((w) => (
                      <tr key={w.worker_id}>
                        <td className="py-2 font-mono text-xs text-slate-500">{w.worker_code}</td>
                        <td className="py-2 font-medium text-slate-900">{w.worker_name}</td>
                        <td className="py-2 text-slate-600 text-xs">{w.department_name || '—'}</td>
                        <td className="py-2 text-right font-mono font-semibold text-slate-900">{formatNumber(w.total_qty)}</td>
                        <td className="py-2 text-right font-mono text-emerald-700">{formatCurrency(w.total_labour)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card p-5">
              <h2 className="text-base font-semibold text-slate-900 mb-3">By Department</h2>
              {summary.by_department.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No department data.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left py-2">Department</th>
                      <th className="text-right py-2">Qty</th>
                      <th className="text-right py-2">Labour</th>
                      <th className="text-right py-2">Entries</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summary.by_department.map((d) => (
                      <tr key={d.department_id}>
                        <td className="py-2 font-medium text-slate-900">{d.department_name || '—'}</td>
                        <td className="py-2 text-right font-mono font-semibold text-slate-900">{formatNumber(d.total_qty)}</td>
                        <td className="py-2 text-right font-mono text-emerald-700">{formatCurrency(d.total_labour)}</td>
                        <td className="py-2 text-right text-slate-600">{d.entries_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Stock + Batches */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="card p-5 lg:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Boxes className="h-5 w-5 text-emerald-600" />
                <h2 className="text-base font-semibold text-slate-900">Baked Brick Stock (current)</h2>
              </div>
              {summary.stock_snapshot.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No stock on hand.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {summary.stock_snapshot.map((s) => (
                    <div key={s.category_id} className={`p-3 rounded-md border ${s.quantity > 0 ? 'bg-white border-emerald-200' : 'bg-slate-100 border-slate-200 opacity-60'}`}>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">{s.category_name}</div>
                      <div className={`text-lg font-bold ${s.quantity > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {formatNumber(s.quantity)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Flame className="h-5 w-5 text-orange-600" />
                <h2 className="text-base font-semibold text-slate-900">Batches</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider">Active Batches</div>
                  <div className="text-3xl font-bold text-slate-900">{summary.active_batches}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider">Currently Firing</div>
                  <div className="text-3xl font-bold text-orange-600">{summary.firing_batches}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
