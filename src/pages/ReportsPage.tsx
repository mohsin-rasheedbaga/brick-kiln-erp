import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { useAuthStore } from '../stores/auth';
import {
  reports as reportsApi, customers as custApi, departments as deptApi,
  workers as workerApi, batches as batchApi, brickCategories as catApi,
  expenseCategories as expCatApi, settings as settingsApi,
} from '../lib/ipc';
import type { Customer, Department, Worker, Batch, BrickCategory, ExpenseCategory, Settings } from '../types';
import { formatCurrency, formatNumber, formatDate } from '../lib/utils';
import { BarChart, DonutChart, HorizontalBarChart, KpiCard } from '../components/Charts';
import { exportToCsv, printHtml, reportHeader, buildTableHtml } from '../lib/export';
import {
  Package, ShoppingCart, Wallet, Users, Boxes, TrendingUp, FileText, Banknote,
} from 'lucide-react';

type ReportType =
  | 'production' | 'sales' | 'expenses' | 'customers'
  | 'workers' | 'batch-costing' | 'profit-loss' | 'cash-flow' | 'stock';

const REPORT_TYPES: Array<{ value: ReportType; label: string; icon: React.ElementType; description: string }> = [
  { value: 'production',   label: 'Production Report',       icon: Package,       description: 'Production quantities and labour by stage, worker, or day' },
  { value: 'sales',        label: 'Sales Report',             icon: ShoppingCart,  description: 'Sales totals, invoices, and outstanding balances' },
  { value: 'expenses',     label: 'Expense Report',          icon: Wallet,        description: 'Expenses by category, department, or batch' },
  { value: 'customers',    label: 'Customer Balances',       icon: Users,         description: 'All customers with sales, paid, and balances' },
  { value: 'workers',     label: 'Worker Labour',            icon: Users,         description: 'Worker labour earnings, advances, payments, payable' },
  { value: 'batch-costing', label: 'Batch Costing',          icon: Boxes,         description: 'Batch costs, revenue, profit/loss per batch' },
  { value: 'profit-loss',  label: 'Profit & Loss',            icon: TrendingUp,    description: 'Overall revenue, costs, profit/loss for a period' },
  { value: 'cash-flow',    label: 'Cash Flow',                icon: Banknote,      description: 'Cash in/out by movement type' },
  { value: 'stock',       label: 'Stock Report',              icon: Boxes,         description: 'Stock levels and movement summary' },
];

export default function ReportsPage() {
  const { hasPermission } = useAuthStore();
  const pushToast = useToastStore((s) => s.push);
  const [activeReport, setActiveReport] = useState<ReportType>('production');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);

  // Filter dropdowns
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [categories, setCategories] = useState<BrickCategory[]>([]);
  const [expenseCats, setExpenseCats] = useState<ExpenseCategory[]>([]);
  const [filter, setFilter] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      settingsApi.get(),
      custApi.list({ limit: 1000 }),
      deptApi.list(true),
      workerApi.list({ limit: 1000 }),
      batchApi.list({ limit: 100 }),
      catApi.list(false, false),
      expCatApi.list(false),
    ]).then(([s, cs, ds, ws, bs, cats, exps]) => {
      setSettings(s);
      setCustomers(cs.items);
      setDepartments(ds);
      setWorkers(ws.items);
      setBatches(bs.items);
      setCategories(cats);
      setExpenseCats(exps);
    }).catch(() => {});
  }, []);

  // Default date range = current month
  useEffect(() => {
    if (!from && !to) {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      setFrom(first.toISOString().slice(0, 10));
      setTo(now.toISOString().slice(0, 10));
    }
  }, []);

  const runReport = async () => {
    setLoading(true);
    setData(null);
    try {
      const dateRange = { from: from || undefined, to: to || undefined };
      let result: any;
      switch (activeReport) {
        case 'production':
          result = await reportsApi.production({ ...dateRange, stage: filter.stage || undefined, workerId: filter.workerId || undefined, departmentId: filter.departmentId || undefined, batchId: filter.batchId || undefined, groupBy: (filter.groupBy as any) || 'stage' });
          break;
        case 'sales':
          result = await reportsApi.sales({ ...dateRange, customerId: filter.customerId || undefined, batchId: filter.batchId || undefined, status: filter.status || undefined, groupBy: (filter.groupBy as any) || 'customer' });
          break;
        case 'expenses':
          result = await reportsApi.expenses({ ...dateRange, categoryId: filter.categoryId || undefined, departmentId: filter.departmentId || undefined, batchId: filter.batchId || undefined, groupBy: (filter.groupBy as any) || 'category' });
          break;
        case 'customers':
          result = await reportsApi.customers(filter.includeInactive === 'true');
          break;
        case 'workers':
          result = await reportsApi.workers({ ...dateRange, departmentId: filter.departmentId || undefined, workerId: filter.workerId || undefined });
          break;
        case 'batch-costing':
          result = await reportsApi.batchCosting({ batchId: filter.batchId || undefined, status: filter.status || undefined });
          break;
        case 'profit-loss':
          result = await reportsApi.profitLoss(dateRange);
          break;
        case 'cash-flow':
          result = await reportsApi.cashFlow(dateRange);
          break;
        case 'stock':
          result = await reportsApi.stock({ ...dateRange, categoryId: filter.categoryId || undefined });
          break;
      }
      setData(result);
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCsv = () => {
    if (!data) return;
    let rows: any[] = [];
    let filename = `${activeReport}-report`;
    switch (activeReport) {
      case 'production':
        rows = data.entries || [];
        filename = 'production-report';
        break;
      case 'sales':
        rows = data.invoices || [];
        filename = 'sales-report';
        break;
      case 'expenses':
        rows = data.expenses || [];
        filename = 'expenses-report';
        break;
      case 'customers':
        rows = data.customers || [];
        filename = 'customer-balances';
        break;
      case 'workers':
        rows = data.workers || [];
        filename = 'worker-labour';
        break;
      case 'batch-costing':
        rows = data.batches || [];
        filename = 'batch-costing';
        break;
      case 'cash-flow':
        rows = data.movements || [];
        filename = 'cash-flow';
        break;
      case 'stock':
        rows = data.categories || [];
        filename = 'stock-report';
        break;
      case 'profit-loss':
        // Build a flat row from P&L
        rows = [{
          total_sales: data.revenue.total_sales,
          cash_received: data.revenue.total_cash_received,
          other_income: data.revenue.other_income,
          total_revenue: data.revenue.total_revenue,
          labour_cost: data.costs.labour_cost,
          fuel_cost: data.costs.fuel_cost,
          transport_cost: data.costs.transport_cost,
          other_expense: data.costs.other_expense,
          worker_payments: data.costs.worker_payments,
          worker_advances: data.costs.worker_advances,
          total_costs: data.costs.total_costs,
          profit_loss: data.profit_loss,
          margin_pct: data.margin_pct.toFixed(2) + '%',
        }];
        filename = 'profit-loss';
        break;
    }
    exportToCsv(filename, rows);
    pushToast('success', 'CSV exported.');
  };

  const handlePrint = () => {
    if (!data) return;
    const kilnName = settings?.kiln_name || 'Brick Kiln';
    const dateRange = { from, to };
    const reportTitle = REPORT_TYPES.find((r) => r.value === activeReport)?.label || 'Report';
    let body = reportHeader(kilnName, reportTitle, dateRange);
    body += renderReportAsHtml(activeReport, data);
    printHtml(reportTitle, body);
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Generate, export, and print operational and financial reports"
        actions={
          <>
            <button className="btn-secondary" onClick={handleCsv} disabled={!data || loading}>
              <FileText className="h-4 w-4" /> Export CSV
            </button>
            <button className="btn-primary" onClick={handlePrint} disabled={!data || loading}>
              Print / PDF
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Report selector */}
        <div className="lg:col-span-1">
          <div className="card p-3">
            <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Report Type</div>
            <div className="space-y-1">
              {REPORT_TYPES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => { setActiveReport(r.value); setData(null); }}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition flex items-start gap-2 ${
                    activeReport === r.value ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <r.icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium leading-tight">{r.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{r.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Report content */}
        <div className="lg:col-span-3 space-y-4">
          {/* Filters */}
          <div className="card p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              {activeReport !== 'customers' && activeReport !== 'batch-costing' && activeReport !== 'profit-loss' && (
                <>
                  <div>
                    <label className="label">From Date</label>
                    <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">To Date</label>
                    <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                </>
              )}
              {activeReport === 'production' && (
                <>
                  <div>
                    <label className="label">Stage</label>
                    <select className="input" value={filter.stage || ''} onChange={(e) => setFilter({ ...filter, stage: e.target.value })}>
                      <option value="">All stages</option>
                      <option value="raw_brick_making">Raw Brick Making</option>
                      <option value="raw_brick_transport">Raw Brick Transport</option>
                      <option value="kiln_loading">Kiln Loading</option>
                      <option value="baked_brick_unloading">Baked Brick Unloading</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Group By</label>
                    <select className="input" value={filter.groupBy || 'stage'} onChange={(e) => setFilter({ ...filter, groupBy: e.target.value })}>
                      <option value="stage">Stage</option>
                      <option value="worker">Worker</option>
                      <option value="department">Department</option>
                      <option value="day">Day</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Worker</label>
                    <select className="input" value={filter.workerId || ''} onChange={(e) => setFilter({ ...filter, workerId: e.target.value })}>
                      <option value="">All workers</option>
                      {workers.map((w) => <option key={w.id} value={w.id}>{w.worker_code} — {w.full_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Department</label>
                    <select className="input" value={filter.departmentId || ''} onChange={(e) => setFilter({ ...filter, departmentId: e.target.value })}>
                      <option value="">All departments</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </>
              )}
              {activeReport === 'sales' && (
                <>
                  <div>
                    <label className="label">Customer</label>
                    <select className="input" value={filter.customerId || ''} onChange={(e) => setFilter({ ...filter, customerId: e.target.value })}>
                      <option value="">All customers</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Status</label>
                    <select className="input" value={filter.status || ''} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                      <option value="">All statuses</option>
                      <option value="unpaid">Unpaid</option>
                      <option value="partial">Partial</option>
                      <option value="paid">Paid</option>
                      <option value="overpaid">Overpaid</option>
                    </select>
                  </div>
                </>
              )}
              {activeReport === 'expenses' && (
                <>
                  <div>
                    <label className="label">Category</label>
                    <select className="input" value={filter.categoryId || ''} onChange={(e) => setFilter({ ...filter, categoryId: e.target.value })}>
                      <option value="">All categories</option>
                      {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Department</label>
                    <select className="input" value={filter.departmentId || ''} onChange={(e) => setFilter({ ...filter, departmentId: e.target.value })}>
                      <option value="">All departments</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </>
              )}
              {activeReport === 'workers' && (
                <div>
                  <label className="label">Department</label>
                  <select className="input" value={filter.departmentId || ''} onChange={(e) => setFilter({ ...filter, departmentId: e.target.value })}>
                    <option value="">All departments</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}
              {activeReport === 'batch-costing' && (
                <div>
                  <label className="label">Status</label>
                  <select className="input" value={filter.status || ''} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                    <option value="">All statuses</option>
                    <option value="open">Open</option>
                    <option value="firing">Firing</option>
                    <option value="completed">Completed</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              )}
              {activeReport === 'customers' && (
                <div>
                  <label className="label">Include Inactive?</label>
                  <select className="input" value={filter.includeInactive || 'false'} onChange={(e) => setFilter({ ...filter, includeInactive: e.target.value })}>
                    <option value="false">Active only</option>
                    <option value="true">Include inactive</option>
                  </select>
                </div>
              )}
              {activeReport === 'stock' && (
                <div>
                  <label className="label">Category</label>
                  <select className="input" value={filter.categoryId || ''} onChange={(e) => setFilter({ ...filter, categoryId: e.target.value })}>
                    <option value="">All categories</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <button className="btn-primary w-full" onClick={runReport} disabled={loading}>
              {loading ? <Spinner size="sm" className="border-white" /> : 'Generate Report'}
            </button>
          </div>

          {/* Report output */}
          {!data && !loading && (
            <div className="card p-12">
              <EmptyState
                title="No report generated yet"
                message="Select a report type, set the date range and filters, then click 'Generate Report'."
                icon={<FileText className="h-8 w-8" />}
              />
            </div>
          )}

          {loading && <Spinner className="mx-auto mt-12" />}

          {!loading && data && (
            <ReportRenderer type={activeReport} data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

// =================== Report Renderer ===================
function ReportRenderer({ type, data }: { type: ReportType; data: any }) {
  switch (type) {
    case 'production': return <ProductionReportView data={data} />;
    case 'sales': return <SalesReportView data={data} />;
    case 'expenses': return <ExpensesReportView data={data} />;
    case 'customers': return <CustomersReportView data={data} />;
    case 'workers': return <WorkersReportView data={data} />;
    case 'batch-costing': return <BatchCostingReportView data={data} />;
    case 'profit-loss': return <ProfitLossReportView data={data} />;
    case 'cash-flow': return <CashFlowReportView data={data} />;
    case 'stock': return <StockReportView data={data} />;
    default: return null;
  }
}

function ProductionReportView({ data }: { data: any }) {
  const { summary, rows, entries } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Quantity" value={formatNumber(summary.total_qty)} />
        <KpiCard label="Total Labour" value={formatCurrency(summary.total_labour)} color="text-emerald-700" />
        <KpiCard label="Entries" value={String(summary.entries_count)} />
        <KpiCard label="Unique Workers" value={String(summary.unique_workers)} />
      </div>
      {rows.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">By {Object.keys(rows[0])[0].replace(/_/g, ' ')}</h3>
          <BarChart
            data={rows.map((r: any) => ({
              label: String(Object.values(r)[0] || ''),
              value: r.total_qty,
            }))}
            formatValue={(n) => formatNumber(n)}
            height={220}
          />
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Production Entries ({entries.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Date</th>
              <th className="text-left px-4 py-2 font-semibold">Stage</th>
              <th className="text-left px-4 py-2 font-semibold">Worker</th>
              <th className="text-left px-4 py-2 font-semibold">Dept</th>
              <th className="text-right px-4 py-2 font-semibold">Qty</th>
              <th className="text-right px-4 py-2 font-semibold">Rate</th>
              <th className="text-right px-4 py-2 font-semibold">Labour</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.slice(0, 100).map((e: any) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-700">{formatDate(e.date)}</td>
                <td className="px-4 py-2"><span className="badge-info">{e.stage.replace(/_/g, ' ')}</span></td>
                <td className="px-4 py-2">
                  <div className="font-medium text-slate-900">{e.worker_name}</div>
                  <div className="text-xs text-slate-500 font-mono">{e.worker_code}</div>
                </td>
                <td className="px-4 py-2 text-slate-700">{e.department_name}</td>
                <td className="px-4 py-2 text-right font-mono">{formatNumber(e.quantity)}</td>
                <td className="px-4 py-2 text-right font-mono">{formatCurrency(e.rate_per_1000)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700">{formatCurrency(e.labour_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SalesReportView({ data }: { data: any }) {
  const { summary, rows, invoices } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Sales" value={formatCurrency(summary.total)} color="text-emerald-700" />
        <KpiCard label="Total Paid" value={formatCurrency(summary.total_paid)} color="text-emerald-700" />
        <KpiCard label="Outstanding" value={formatCurrency(summary.total_remaining)} color="text-amber-700" />
        <KpiCard label="Invoices" value={String(summary.invoice_count)} />
      </div>
      {rows.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Sales by {Object.keys(rows[0])[0].replace(/_/g, ' ')}</h3>
          <HorizontalBarChart data={rows.map((r: any) => ({ label: String(Object.values(r)[0] || ''), value: r.total }))} formatValue={(n) => formatCurrency(n)} maxItems={10} />
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Invoices ({invoices.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Date</th>
              <th className="text-left px-4 py-2 font-semibold">Invoice #</th>
              <th className="text-left px-4 py-2 font-semibold">Customer</th>
              <th className="text-right px-4 py-2 font-semibold">Total</th>
              <th className="text-right px-4 py-2 font-semibold">Paid</th>
              <th className="text-right px-4 py-2 font-semibold">Remaining</th>
              <th className="text-left px-4 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.slice(0, 100).map((i: any) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-700">{formatDate(i.date)}</td>
                <td className="px-4 py-2 font-mono text-slate-900">{i.invoice_number}</td>
                <td className="px-4 py-2 font-medium text-slate-900">{i.customer_name}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(i.total)}</td>
                <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatCurrency(i.paid)}</td>
                <td className="px-4 py-2 text-right font-mono text-amber-700">{formatCurrency(i.remaining)}</td>
                <td className="px-4 py-2"><span className={`badge-${i.payment_status === 'paid' ? 'success' : i.payment_status === 'partial' ? 'warning' : i.payment_status === 'overpaid' ? 'info' : 'default'}`}>{i.payment_status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpensesReportView({ data }: { data: any }) {
  const { summary, rows, expenses } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <KpiCard label="Total Expenses" value={formatCurrency(summary.total_amount)} color="text-red-700" />
        <KpiCard label="Count" value={String(summary.expense_count)} />
        <KpiCard label="Avg per Entry" value={formatCurrency(summary.expense_count ? summary.total_amount / summary.expense_count : 0)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {rows.length > 0 && (
          <div className="card p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">By {Object.keys(rows[0])[0].replace(/_/g, ' ')}</h3>
            <DonutChart
              data={rows.map((r: any) => ({ label: String(Object.values(r)[0] || ''), value: r.total_amount }))}
              formatValue={(n) => formatCurrency(n)}
            />
          </div>
        )}
        {summary.by_method && summary.by_method.length > 0 && (
          <div className="card p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">By Payment Method</h3>
            <DonutChart
              data={summary.by_method.map((m: any) => ({ label: m.method, value: m.total }))}
              formatValue={(n) => formatCurrency(n)}
            />
          </div>
        )}
      </div>
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Expense Entries ({expenses.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Date</th>
              <th className="text-left px-4 py-2 font-semibold">Expense #</th>
              <th className="text-left px-4 py-2 font-semibold">Category</th>
              <th className="text-left px-4 py-2 font-semibold">Paid To</th>
              <th className="text-right px-4 py-2 font-semibold">Amount</th>
              <th className="text-left px-4 py-2 font-semibold">Method</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {expenses.slice(0, 100).map((e: any) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-700">{formatDate(e.date)}</td>
                <td className="px-4 py-2 font-mono text-slate-900">{e.expense_number}</td>
                <td className="px-4 py-2 text-slate-700">{e.category_name}</td>
                <td className="px-4 py-2 text-slate-700">{e.paid_to || '—'}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-red-700">{formatCurrency(e.amount)}</td>
                <td className="px-4 py-2"><span className="badge-info">{e.payment_method}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomersReportView({ data }: { data: any }) {
  const { summary, customers } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Customers" value={String(summary.total_customers)} />
        <KpiCard label="Outstanding Balance" value={formatCurrency(summary.total_receivables)} color="text-amber-700" />
        <KpiCard label="Total Sales" value={formatCurrency(summary.total_sales)} color="text-emerald-700" />
        <KpiCard label="With Balance" value={String(summary.customers_with_balance)} />
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Code</th>
              <th className="text-left px-4 py-2 font-semibold">Name</th>
              <th className="text-left px-4 py-2 font-semibold">Mobile</th>
              <th className="text-right px-4 py-2 font-semibold">Opening</th>
              <th className="text-right px-4 py-2 font-semibold">Total Sales</th>
              <th className="text-right px-4 py-2 font-semibold">Total Paid</th>
              <th className="text-right px-4 py-2 font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.map((c: any) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{c.customer_code}</td>
                <td className="px-4 py-2 font-medium text-slate-900">{c.name}</td>
                <td className="px-4 py-2 text-slate-700">{c.mobile || '—'}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(c.opening_balance)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(c.total_sales)}</td>
                <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatCurrency(c.total_paid)}</td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${c.current_balance > 0 ? 'text-amber-700' : 'text-slate-700'}`}>{formatCurrency(c.current_balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkersReportView({ data }: { data: any }) {
  const { summary, workers } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Workers" value={String(summary.total_workers)} />
        <KpiCard label="Total Labour" value={formatCurrency(summary.total_labour)} color="text-emerald-700" />
        <KpiCard label="Total Advances" value={formatCurrency(summary.total_advances)} color="text-amber-700" />
        <KpiCard label="Total Payable" value={formatCurrency(summary.total_payable)} color="text-purple-700" />
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Code</th>
              <th className="text-left px-4 py-2 font-semibold">Name</th>
              <th className="text-left px-4 py-2 font-semibold">Dept</th>
              <th className="text-right px-4 py-2 font-semibold">Qty</th>
              <th className="text-right px-4 py-2 font-semibold">Earned</th>
              <th className="text-right px-4 py-2 font-semibold">Advances</th>
              <th className="text-right px-4 py-2 font-semibold">Payments</th>
              <th className="text-right px-4 py-2 font-semibold">Payable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {workers.map((w: any) => {
              const payable = Math.max(0, w.total_labour - w.total_advances - w.total_payments);
              return (
                <tr key={w.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{w.worker_code}</td>
                  <td className="px-4 py-2 font-medium text-slate-900">{w.full_name}</td>
                  <td className="px-4 py-2 text-slate-700">{w.department_name || '—'}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatNumber(w.total_qty)}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatCurrency(w.total_labour)}</td>
                  <td className="px-4 py-2 text-right font-mono text-amber-700">{formatCurrency(w.total_advances)}</td>
                  <td className="px-4 py-2 text-right font-mono text-purple-700">{formatCurrency(w.total_payments)}</td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${payable > 0 ? 'text-purple-700' : 'text-slate-500'}`}>{formatCurrency(payable)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatchCostingReportView({ data }: { data: any }) {
  const { summary, batches } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Batches" value={String(summary.total_batches)} />
        <KpiCard label="Total Cost" value={formatCurrency(summary.total_cost)} color="text-red-700" />
        <KpiCard label="Total Revenue" value={formatCurrency(summary.total_revenue)} color="text-emerald-700" />
        <KpiCard label="Net P/L" value={formatCurrency(summary.total_profit)} color={summary.total_profit >= 0 ? 'text-emerald-700' : 'text-red-700'} />
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Batch #</th>
              <th className="text-left px-4 py-2 font-semibold">Status</th>
              <th className="text-right px-4 py-2 font-semibold">Loaded</th>
              <th className="text-right px-4 py-2 font-semibold">Unloaded</th>
              <th className="text-right px-4 py-2 font-semibold">Labour</th>
              <th className="text-right px-4 py-2 font-semibold">Fuel</th>
              <th className="text-right px-4 py-2 font-semibold">Other</th>
              <th className="text-right px-4 py-2 font-semibold">Total Cost</th>
              <th className="text-right px-4 py-2 font-semibold">Revenue</th>
              <th className="text-right px-4 py-2 font-semibold">P/L</th>
              <th className="text-right px-4 py-2 font-semibold">Cost/1000</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {batches.map((b: any) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-slate-900">{b.batch_number}</td>
                <td className="px-4 py-2"><span className="badge-info">{b.status}</span></td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{formatNumber(b.raw_bricks_loaded)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{formatNumber(b.baked_bricks_unloaded)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(b.labour_cost)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(b.fuel_cost)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(b.other_cost)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{formatCurrency(b.total_cost)}</td>
                <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatCurrency(b.sales_revenue)}</td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${b.profit_loss >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(b.profit_loss)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{b.cost_per_1000 ? formatCurrency(b.cost_per_1000) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProfitLossReportView({ data }: { data: any }) {
  const { revenue, costs, profit_loss, margin_pct } = data;
  const revenueRows = [
    { label: 'Sales (invoice total)', value: revenue.total_sales },
    { label: 'Cash received', value: revenue.total_cash_received },
    { label: 'Other income', value: revenue.other_income },
  ];
  const costRows = [
    { label: 'Labour cost', value: costs.labour_cost },
    { label: 'Fuel cost', value: costs.fuel_cost },
    { label: 'Transport cost', value: costs.transport_cost },
    { label: 'Other expenses', value: costs.other_expense },
    { label: 'Worker payments', value: costs.worker_payments },
    { label: 'Worker advances', value: costs.worker_advances },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Revenue</h3>
          <div className="space-y-2 text-sm">
            {revenueRows.map((r) => (
              <div key={r.label} className="flex justify-between">
                <span className="text-slate-600">{r.label}</span>
                <span className="font-mono font-medium text-emerald-700">{formatCurrency(r.value)}</span>
              </div>
            ))}
            <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold">
              <span className="text-slate-900">Total Revenue</span>
              <span className="font-mono text-emerald-700">{formatCurrency(revenue.total_revenue)}</span>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Costs</h3>
          <div className="space-y-2 text-sm">
            {costRows.map((c) => (
              <div key={c.label} className="flex justify-between">
                <span className="text-slate-600">{c.label}</span>
                <span className="font-mono font-medium text-red-700">{formatCurrency(c.value)}</span>
              </div>
            ))}
            <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold">
              <span className="text-slate-900">Total Costs</span>
              <span className="font-mono text-red-700">{formatCurrency(costs.total_costs)}</span>
            </div>
          </div>
        </div>
      </div>
      <div className={`card p-6 ${profit_loss >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-xs uppercase tracking-wider font-medium ${profit_loss >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {profit_loss >= 0 ? 'Net Profit' : 'Net Loss'}
            </div>
            <div className={`text-3xl font-bold mt-1 ${profit_loss >= 0 ? 'text-emerald-900' : 'text-red-900'}`}>
              {formatCurrency(profit_loss)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Margin</div>
            <div className={`text-xl font-semibold ${margin_pct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {margin_pct.toFixed(2)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CashFlowReportView({ data }: { data: any }) {
  const { summary, by_type, movements } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Opening Balance" value={formatCurrency(summary.opening_balance)} />
        <KpiCard label="Total In" value={formatCurrency(summary.total_in)} color="text-emerald-700" />
        <KpiCard label="Total Out" value={formatCurrency(summary.total_out)} color="text-red-700" />
        <KpiCard label="Closing Balance" value={formatCurrency(summary.closing_balance)} color="text-brand-700" />
      </div>
      {by_type.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">By Movement Type</h3>
          <HorizontalBarChart
            data={by_type.map((b: any) => ({ label: b.movement_type.replace(/_/g, ' '), value: b.total_in + Math.abs(b.total_out) }))}
            formatValue={(n) => formatCurrency(n)}
            maxItems={10}
          />
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Cash Movements ({movements.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Date</th>
              <th className="text-left px-4 py-2 font-semibold">Type</th>
              <th className="text-left px-4 py-2 font-semibold">Description</th>
              <th className="text-right px-4 py-2 font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movements.slice(0, 100).map((m: any) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-700">{formatDate(m.date)}</td>
                <td className="px-4 py-2"><span className="badge-info">{m.movement_type.replace(/_/g, ' ')}</span></td>
                <td className="px-4 py-2 text-slate-600">{m.description}</td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${m.amount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {m.amount >= 0 ? '+' : ''}{formatCurrency(m.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockReportView({ data }: { data: any }) {
  const { summary, categories, movements_summary } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <KpiCard label="Total Bricks" value={formatNumber(summary.total_quantity)} />
        <KpiCard label="Stock Value" value={formatCurrency(summary.total_value)} color="text-emerald-700" />
        <KpiCard label="Categories" value={String(summary.categories_count)} />
      </div>
      {categories.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Stock by Category</h3>
          <DonutChart
            data={categories.map((c: any) => ({ label: c.category_name, value: c.quantity }))}
            formatValue={(n) => formatNumber(n)}
          />
        </div>
      )}
      {movements_summary.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Movements Summary</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Type</th>
                <th className="text-right px-4 py-2 font-semibold">In</th>
                <th className="text-right px-4 py-2 font-semibold">Out</th>
                <th className="text-right px-4 py-2 font-semibold">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements_summary.map((m: any) => (
                <tr key={m.movement_type}>
                  <td className="px-4 py-2 text-slate-700">{m.movement_type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatNumber(m.total_in)}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-700">{formatNumber(m.total_out)}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =================== HTML renderer for print ===================
function renderReportAsHtml(type: ReportType, data: any): string {
  // Simplified HTML version for printing - mirrors the React views above
  switch (type) {
    case 'profit-loss':
      const { revenue, costs, profit_loss, margin_pct } = data;
      return `
        <h2>Profit & Loss Statement</h2>
        <div class="grid-2">
          <div>
            <h3>Revenue</h3>
            ${buildTableHtml([
              { label: 'Sales (invoice total)', value: revenue.total_sales },
              { label: 'Cash received', value: revenue.total_cash_received },
              { label: 'Other income', value: revenue.other_income },
              { label: 'TOTAL REVENUE', value: revenue.total_revenue },
            ], [
              { key: 'label', label: 'Description' },
              { key: 'value', label: 'Amount (Rs.)', align: 'right', format: (v) => v.toFixed(2) },
            ])}
          </div>
          <div>
            <h3>Costs</h3>
            ${buildTableHtml([
              { label: 'Labour cost', value: costs.labour_cost },
              { label: 'Fuel cost', value: costs.fuel_cost },
              { label: 'Transport cost', value: costs.transport_cost },
              { label: 'Other expenses', value: costs.other_expense },
              { label: 'Worker payments', value: costs.worker_payments },
              { label: 'Worker advances', value: costs.worker_advances },
              { label: 'TOTAL COSTS', value: costs.total_costs },
            ], [
              { key: 'label', label: 'Description' },
              { key: 'value', label: 'Amount (Rs.)', align: 'right', format: (v) => v.toFixed(2) },
            ])}
          </div>
        </div>
        <div class="totals">
          <div class="totals-row grand">
            <span>${profit_loss >= 0 ? 'NET PROFIT' : 'NET LOSS'}</span>
            <span>Rs. ${profit_loss.toFixed(2)}</span>
          </div>
          <div class="totals-row">
            <span>Margin</span>
            <span>${margin_pct.toFixed(2)}%</span>
          </div>
        </div>
      `;
    case 'production':
      return `
        <h2>Production Report</h2>
        <div class="summary">
          <strong>Total Quantity:</strong> ${data.summary.total_qty.toLocaleString()} bricks<br>
          <strong>Total Labour:</strong> Rs. ${data.summary.total_labour.toFixed(2)}<br>
          <strong>Entries:</strong> ${data.summary.entries_count}<br>
          <strong>Unique Workers:</strong> ${data.summary.unique_workers}
        </div>
        <h3>Production Entries</h3>
        ${buildTableHtml(data.entries.slice(0, 200), [
          { key: 'date', label: 'Date' },
          { key: 'stage', label: 'Stage' },
          { key: 'worker_name', label: 'Worker' },
          { key: 'quantity', label: 'Qty', align: 'right' as const, format: (v: number) => v?.toLocaleString() || '0' },
          { key: 'labour_amount', label: 'Labour (Rs.)', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
        ])}
      `;
    case 'sales':
      return `
        <h2>Sales Report</h2>
        <div class="summary">
          <strong>Total Sales:</strong> Rs. ${data.summary.total.toFixed(2)}<br>
          <strong>Total Paid:</strong> Rs. ${data.summary.total_paid.toFixed(2)}<br>
          <strong>Outstanding:</strong> Rs. ${data.summary.total_remaining.toFixed(2)}<br>
          <strong>Invoices:</strong> ${data.summary.invoice_count}
        </div>
        <h3>Invoices</h3>
        ${buildTableHtml(data.invoices.slice(0, 200), [
          { key: 'date', label: 'Date' },
          { key: 'invoice_number', label: 'Invoice #' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'total', label: 'Total', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'paid', label: 'Paid', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'remaining', label: 'Remaining', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'payment_status', label: 'Status' },
        ])}
      `;
    case 'expenses':
      return `
        <h2>Expense Report</h2>
        <div class="summary">
          <strong>Total Expenses:</strong> Rs. ${data.summary.total_amount.toFixed(2)}<br>
          <strong>Count:</strong> ${data.summary.expense_count}
        </div>
        <h3>Expense Entries</h3>
        ${buildTableHtml(data.expenses.slice(0, 200), [
          { key: 'date', label: 'Date' },
          { key: 'expense_number', label: 'Expense #' },
          { key: 'category_name', label: 'Category' },
          { key: 'paid_to', label: 'Paid To' },
          { key: 'amount', label: 'Amount', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'payment_method', label: 'Method' },
        ])}
      `;
    case 'customers':
      return `
        <h2>Customer Balances</h2>
        <div class="summary">
          <strong>Total Customers:</strong> ${data.summary.total_customers}<br>
          <strong>Outstanding Receivables:</strong> Rs. ${data.summary.total_receivables.toFixed(2)}<br>
          <strong>Total Sales:</strong> Rs. ${data.summary.total_sales.toFixed(2)}
        </div>
        ${buildTableHtml(data.customers, [
          { key: 'customer_code', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'mobile', label: 'Mobile' },
          { key: 'opening_balance', label: 'Opening', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'total_sales', label: 'Sales', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'total_paid', label: 'Paid', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'current_balance', label: 'Balance', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
        ])}
      `;
    case 'workers':
      return `
        <h2>Worker Labour Report</h2>
        <div class="summary">
          <strong>Total Workers:</strong> ${data.summary.total_workers}<br>
          <strong>Total Labour:</strong> Rs. ${data.summary.total_labour.toFixed(2)}<br>
          <strong>Total Payable:</strong> Rs. ${data.summary.total_payable.toFixed(2)}
        </div>
        ${buildTableHtml(data.workers.map((w: any) => ({
        ...w,
        payable: Math.max(0, w.total_labour - w.total_advances - w.total_payments),
      })), [
          { key: 'worker_code', label: 'Code' },
          { key: 'full_name', label: 'Name' },
          { key: 'department_name', label: 'Dept' },
          { key: 'total_qty', label: 'Qty', align: 'right' as const, format: (v: number) => (v || 0).toLocaleString() },
          { key: 'total_labour', label: 'Earned', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'total_advances', label: 'Advances', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'total_payments', label: 'Payments', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'payable', label: 'Payable', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
        ])}
      `;
    case 'batch-costing':
      return `
        <h2>Batch Costing Report</h2>
        <div class="summary">
          <strong>Total Batches:</strong> ${data.summary.total_batches}<br>
          <strong>Total Cost:</strong> Rs. ${data.summary.total_cost.toFixed(2)}<br>
          <strong>Total Revenue:</strong> Rs. ${data.summary.total_revenue.toFixed(2)}<br>
          <strong>Net P/L:</strong> Rs. ${data.summary.total_profit.toFixed(2)}
        </div>
        ${buildTableHtml(data.batches, [
          { key: 'batch_number', label: 'Batch #' },
          { key: 'status', label: 'Status' },
          { key: 'raw_bricks_loaded', label: 'Loaded', align: 'right' as const, format: (v: number) => (v || 0).toLocaleString() },
          { key: 'baked_bricks_unloaded', label: 'Unloaded', align: 'right' as const, format: (v: number) => (v || 0).toLocaleString() },
          { key: 'total_cost', label: 'Total Cost', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'sales_revenue', label: 'Revenue', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'profit_loss', label: 'P/L', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
        ])}
      `;
    case 'cash-flow':
      return `
        <h2>Cash Flow Report</h2>
        <div class="summary">
          <strong>Opening Balance:</strong> Rs. ${data.summary.opening_balance.toFixed(2)}<br>
          <strong>Total In:</strong> Rs. ${data.summary.total_in.toFixed(2)}<br>
          <strong>Total Out:</strong> Rs. ${data.summary.total_out.toFixed(2)}<br>
          <strong>Closing Balance:</strong> Rs. ${data.summary.closing_balance.toFixed(2)}
        </div>
        <h3>Movements by Type</h3>
        ${buildTableHtml(data.by_type, [
          { key: 'movement_type', label: 'Type' },
          { key: 'total_in', label: 'In', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
          { key: 'total_out', label: 'Out', align: 'right' as const, format: (v: number) => Math.abs(v || 0).toFixed(2) },
          { key: 'count', label: 'Count', align: 'right' as const },
        ])}
      `;
    case 'stock':
      return `
        <h2>Stock Report</h2>
        <div class="summary">
          <strong>Total Bricks:</strong> ${data.summary.total_quantity.toLocaleString()}<br>
          <strong>Stock Value:</strong> Rs. ${data.summary.total_value.toFixed(2)}<br>
          <strong>Categories:</strong> ${data.summary.categories_count}
        </div>
        <h3>Stock by Category</h3>
        ${buildTableHtml(data.categories, [
          { key: 'category_code', label: 'Code' },
          { key: 'category_name', label: 'Category' },
          { key: 'quantity', label: 'Quantity', align: 'right' as const, format: (v: number) => (v || 0).toLocaleString() },
          { key: 'default_selling_rate', label: 'Rate', align: 'right' as const, format: (v: number) => (v || 0).toFixed(0) },
          { key: 'stock_value', label: 'Value (Rs.)', align: 'right' as const, format: (v: number) => (v || 0).toFixed(2) },
        ])}
      `;
    default:
      return '<p>Report rendering for this type is not yet implemented for print.</p>';
  }
}
