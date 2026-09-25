import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { productionCostReport as reportApi, stock as stockApi } from '../lib/ipc';
import type { StockBalance } from '../types';
import { formatCurrency, formatNumber, formatDate } from '../lib/utils';
import { KpiCard, BarChart } from '../components/Charts';
import { exportToCsv, printHtml, reportHeader, buildTableHtml } from '../lib/export';
import { FileText, Printer, Package, Flame, TrendingUp, TrendingDown, Boxes } from 'lucide-react';

export default function ProductionCostReportPage() {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any>(null);
  const [stock, setStock] = useState<StockBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        reportApi.get(from, to),
        stockApi.balance(),
      ]);
      setData(r);
      setStock(s);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [from, to]);

  const handlePrint = () => {
    if (!data) return;
    const body = reportHeader('Brick Kiln ERP', 'Production Cost & Profit Report', { from, to }) + `
      <h3>Production by Stage</h3>
      ${buildTableHtml(data.stages, [
        { key: 'label', label: 'Stage' },
        { key: 'quantity', label: 'Quantity', align: 'right' as const, format: (v: number) => (v || 0).toLocaleString() },
        { key: 'labour_cost', label: 'Labour Cost', align: 'right' as const, format: (v: number) => 'Rs. ' + (v || 0).toFixed(2) },
        { key: 'entries_count', label: 'Entries', align: 'right' as const },
      ])}
      <h3>Cost Summary</h3>
      <table>
        <tr><td>Total Raw Bricks Made</td><td>${formatNumber(data.total_raw_made)}</td></tr>
        <tr><td>Bricks Loaded into Kiln</td><td>${formatNumber(data.total_loaded)}</td></tr>
        <tr><td>Baked Bricks Unloaded</td><td>${formatNumber(data.total_unloaded)}</td></tr>
        <tr><td>Wastage (broken/rejected)</td><td>${formatNumber(data.wastage_qty)} (${data.wastage_pct.toFixed(1)}%)</td></tr>
        <tr><td>Labour Cost</td><td>Rs. ${data.labour_cost.toFixed(2)}</td></tr>
        <tr><td>Firing Cost (coal/wood/diesel)</td><td>Rs. ${data.firing_cost.toFixed(2)}</td></tr>
        <tr><td>Total Cost</td><td><strong>Rs. ${data.total_cost.toFixed(2)}</strong></td></tr>
        <tr><td>Cost per 1000 Bricks</td><td>Rs. ${data.cost_per_1000.toFixed(2)}</td></tr>
        <tr><td>Cost per Brick</td><td>Rs. ${data.cost_per_brick.toFixed(2)}</td></tr>
      </table>
      <h3>Sales Summary</h3>
      <table>
        <tr><td>Bricks Sold</td><td>${formatNumber(data.sales_qty)}</td></tr>
        <tr><td>Sales Revenue</td><td>Rs. ${data.sales_revenue.toFixed(2)}</td></tr>
        <tr><td>Avg Selling Rate/Brick</td><td>Rs. ${data.avg_selling_rate.toFixed(2)}</td></tr>
      </table>
      <h3>Profit / Loss</h3>
      <div class="totals">
        <div class="totals-row"><span>Revenue</span><span>Rs. ${data.sales_revenue.toFixed(2)}</span></div>
        <div class="totals-row"><span>Total Cost</span><span>Rs. ${data.total_cost.toFixed(2)}</span></div>
        <div class="totals-row grand"><span>${data.profit_loss >= 0 ? 'PROFIT' : 'LOSS'}</span><span>Rs. ${data.profit_loss.toFixed(2)}</span></div>
        <div class="totals-row"><span>Profit per Brick</span><span>Rs. ${data.profit_per_brick.toFixed(2)}</span></div>
        <div class="totals-row"><span>Profit %</span><span>${data.profit_pct.toFixed(1)}%</span></div>
      </div>
      <h3>Expense Breakdown</h3>
      ${buildTableHtml(data.expense_breakdown, [
        { key: 'category', label: 'Category' },
        { key: 'amount', label: 'Amount', align: 'right' as const, format: (v: number) => 'Rs. ' + (v || 0).toFixed(2) },
      ])}
    `;
    printHtml('Production Cost Report', body);
  };

  const handleCsv = () => {
    if (!data) return;
    exportToCsv('production-cost-report', data.stages.map((s: any) => ({
      stage: s.label,
      quantity: s.quantity,
      labour_cost: s.labour_cost.toFixed(2),
      entries: s.entries_count,
      workers: s.workers_count,
    })));
    pushToast('success', 'CSV exported.');
  };

  return (
    <div>
      <PageHeader
        title="Production Cost & Profit Report"
        subtitle="Complete brick lifecycle: raw → transport → fire → baked → sell → profit"
        actions={
          <>
            <button className="btn-secondary" onClick={handleCsv} disabled={!data || loading}><FileText className="h-4 w-4" /> CSV</button>
            <button className="btn-primary" onClick={handlePrint} disabled={!data || loading}><Printer className="h-4 w-4" /> Print / PDF</button>
          </>
        }
      />

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div><label className="label">From</label><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label">To</label><input type="date" className="input" value={to} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </div>

      {loading ? <Spinner className="mx-auto mt-12" /> : !data ? <EmptyState title="No data" /> : (
        <div className="space-y-6">
          {/* Stage breakdown */}
          <div className="card p-5">
            <h2 className="text-base font-semibold text-slate-900 mb-4">Production by Stage</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
              {data.stages.map((s: any) => (
                <div key={s.stage} className={`p-3 rounded-md border ${s.quantity > 0 ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
                  <div className="text-xs text-slate-500 uppercase">{s.label}</div>
                  <div className="text-2xl font-bold text-slate-900">{formatNumber(s.quantity)}</div>
                  <div className="text-xs text-emerald-600 mt-1">{formatCurrency(s.labour_cost)} labour</div>
                  <div className="text-[10px] text-slate-400">{s.entries_count} entries · {s.workers_count} workers</div>
                </div>
              ))}
            </div>
            {data.stages.length > 0 && (
              <BarChart data={data.stages.map((s: any) => ({ label: s.label.split(' ')[0], value: s.quantity }))} formatValue={(n) => formatNumber(n)} height={200} />
            )}
          </div>

          {/* Cost + Wastage */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-5">
              <h2 className="text-base font-semibold text-slate-900 mb-4">Cost Breakdown</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Labour Cost (all stages)</span><span className="font-mono">{formatCurrency(data.labour_cost)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Transport Cost</span><span className="font-mono">{formatCurrency(data.transport_cost)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Firing Cost (coal/wood/diesel)</span><span className="font-mono text-orange-700">{formatCurrency(data.firing_cost)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Other Expenses</span><span className="font-mono">{formatCurrency(data.total_cost - data.labour_cost - data.firing_cost)}</span></div>
                <div className="flex justify-between font-bold border-t border-slate-200 pt-2"><span>Total Cost</span><span className="font-mono text-red-700">{formatCurrency(data.total_cost)}</span></div>
                <div className="flex justify-between mt-2 p-2 bg-slate-50 rounded">
                  <span className="text-slate-600">Cost per 1000 Bricks</span>
                  <span className="font-mono font-bold text-slate-900">{formatCurrency(data.cost_per_1000)}</span>
                </div>
                <div className="flex justify-between p-2 bg-slate-50 rounded">
                  <span className="text-slate-600">Cost per Brick</span>
                  <span className="font-mono font-bold text-slate-900">{formatCurrency(data.cost_per_brick)}</span>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <h2 className="text-base font-semibold text-slate-900 mb-4">Wastage & Efficiency</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Raw Bricks Made</span><span className="font-mono">{formatNumber(data.total_raw_made)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Bricks Loaded into Kiln</span><span className="font-mono">{formatNumber(data.total_loaded)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Baked Bricks Unloaded</span><span className="font-mono text-emerald-700">{formatNumber(data.total_unloaded)}</span></div>
                <div className="flex justify-between font-bold border-t border-slate-200 pt-2">
                  <span className="text-red-700">Wastage (broken/reject)</span>
                  <span className="font-mono text-red-700">{formatNumber(data.wastage_qty)} ({data.wastage_pct.toFixed(1)}%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sales + Profit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Bricks Sold" value={formatNumber(data.sales_qty)} icon={<Package className="h-5 w-5" />} color="text-blue-600" />
            <KpiCard label="Sales Revenue" value={formatCurrency(data.sales_revenue)} icon={<TrendingUp className="h-5 w-5" />} color="text-emerald-600" />
            <KpiCard label="Avg Rate/Brick" value={formatCurrency(data.avg_selling_rate)} icon={<Boxes className="h-5 w-5" />} color="text-amber-600" />
            <KpiCard label="Profit per Brick" value={formatCurrency(data.profit_per_brick)} icon={<TrendingUp className="h-5 w-5" />} color={data.profit_per_brick >= 0 ? 'text-emerald-600' : 'text-red-600'} />
          </div>

          {/* Profit/Loss summary */}
          <div className={`card p-5 ${data.profit_loss >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className={`text-xs uppercase tracking-wider font-medium ${data.profit_loss >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {data.profit_loss >= 0 ? 'Net Profit' : 'Net Loss'}
                </div>
                <div className={`text-3xl font-bold mt-1 ${data.profit_loss >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {formatCurrency(data.profit_loss)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">Profit Margin</div>
                <div className={`text-xl font-semibold ${data.profit_pct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {data.profit_pct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          {/* Expense breakdown */}
          {data.expense_breakdown.length > 0 && (
            <div className="card p-5">
              <h2 className="text-base font-semibold text-slate-900 mb-3">Expense Breakdown</h2>
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs uppercase">
                  <tr><th className="text-left py-2">Category</th><th className="text-right py-2">Amount</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.expense_breakdown.map((e: any, i: number) => (
                    <tr key={i}><td className="py-2 text-slate-700">{e.category || '—'}</td><td className="py-2 text-right font-mono text-red-700">{formatCurrency(e.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Current stock */}
          <div className="card p-5">
            <h2 className="text-base font-semibold text-slate-900 mb-3">Current Baked Brick Stock</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {stock.map((s) => (
                <div key={s.category_id} className={`p-3 rounded-md border ${s.quantity > 0 ? 'bg-white border-emerald-200' : 'bg-slate-100 border-slate-200 opacity-60'}`}>
                  <div className="text-xs text-slate-500 uppercase">{s.category_name}</div>
                  <div className={`text-lg font-bold ${s.quantity > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{formatNumber(s.quantity)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
