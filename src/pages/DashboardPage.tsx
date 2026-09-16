import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth';
import { dashboard as dashApi, reports as reportsApi } from '../lib/ipc';
import type { DashboardStats } from '../types';
import { Spinner } from '../components/Feedback';
import { BarChart, DonutChart, KpiCard } from '../components/Charts';
import { Link } from 'react-router-dom';
import {
  Users, Building2, Package, Wallet, TrendingUp, TrendingDown,
  Boxes, Flame, AlertCircle, ArrowDownToLine, ArrowUpFromLine,
} from 'lucide-react';
import { formatCurrency, formatNumber, formatDate } from '../lib/utils';

const STAGE_LABELS: Record<string, string> = {
  raw_brick_making: 'Raw Brick',
  raw_brick_transport: 'Transport',
  kiln_loading: 'Kiln Loading',
  baked_brick_unloading: 'Unloading',
};

export default function DashboardPage() {
  const { user, hasPermission } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prodTrend, setProdTrend] = useState<Array<{ label: string; value: number }>>([]);

  // Determine what sections to show based on permissions
  const canSeeAccounts = hasPermission('accounts.view') || hasPermission('expenses.view') || hasPermission('worker_payments.view');
  const canSeeSales = hasPermission('sales.create') || hasPermission('customers.view');
  const canSeeProduction = hasPermission('production.view') || hasPermission('dashboard.view');

  useEffect(() => {
    Promise.all([
      dashApi.stats(),
      reportsApi.production({
        from: new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
        groupBy: 'day',
      }),
    ])
      .then(([s, prod]) => {
        setStats(s);
        setProdTrend((prod.rows || []).slice(0, 30).reverse().map((r: any) => ({
          label: r.date ? r.date.slice(5) : '',
          value: r.total_qty ?? 0,
        })));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner className="mx-auto mt-12" />;
  if (error) return <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">{error}</div>;
  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Welcome, <span className="font-medium text-slate-700">{user?.fullName}</span>. Today is {formatDate(stats.today.date)}.
        </p>
      </div>

      {/* Cash Balance — prominent for accountant */}
      {canSeeAccounts && (
        <div className="card p-5 bg-gradient-to-br from-brand-600 to-brand-800 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-brand-100 uppercase tracking-wider font-medium">Total Cash Balance</div>
              <div className="text-3xl font-bold mt-1">{formatCurrency(stats.cash_balance)}</div>
              <div className="text-xs text-brand-200 mt-1">
                Received today: {formatCurrency(stats.today.cash_received)} · Expenses today: {formatCurrency(stats.today.expenses_total)}
              </div>
            </div>
            <Wallet className="h-10 w-10 text-brand-200" />
          </div>
        </div>
      )}

      {/* Today's activity cards — shown based on permissions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {canSeeProduction && (
          <KpiCard
            label="Today's Production"
            value={formatNumber(stats.today.total_production_qty)}
            sublabel={`${formatCurrency(stats.today.total_labour)} labour`}
            icon={<Package className="h-5 w-5" />}
            color="text-amber-600"
          />
        )}
        {canSeeSales && (
          <KpiCard
            label="Today's Sales"
            value={formatCurrency(stats.today.sales_total)}
            sublabel={`${stats.today.sales_count} invoice${stats.today.sales_count === 1 ? '' : 's'}`}
            icon={<TrendingUp className="h-5 w-5" />}
            color="text-emerald-600"
          />
        )}
        {canSeeAccounts && (
          <KpiCard
            label="Today's Expenses"
            value={formatCurrency(stats.today.expenses_total)}
            sublabel={`${stats.today.expenses_count} expense${stats.today.expenses_count === 1 ? '' : 's'}`}
            icon={<TrendingDown className="h-5 w-5" />}
            color="text-red-600"
          />
        )}
        {canSeeAccounts && (
          <KpiCard
            label="Cash Balance"
            value={formatCurrency(stats.cash_balance)}
            sublabel={`${formatCurrency(stats.today.cash_received)} received today`}
            icon={<Wallet className="h-5 w-5" />}
            color="text-brand-600"
          />
        )}
      </div>

      {/* Charts row — shown based on permissions */}
      {canSeeProduction && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Today's production by stage (bar chart) */}
          <div className="card p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-slate-900">Today's Production by Stage</h2>
              <Link to="/production" className="text-xs text-brand-600 hover:underline">View all →</Link>
            </div>
            {stats.today.production_by_stage.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No production recorded today.</p>
            ) : (
              <BarChart
                data={stats.today.production_by_stage.map((p) => ({
                  label: STAGE_LABELS[p.stage] || p.stage,
                  value: p.total_qty,
                }))}
                formatValue={(n) => formatNumber(n)}
                height={220}
              />
            )}
          </div>

          {/* Stock by category donut */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-slate-900">Stock by Category</h2>
              <Link to="/stock" className="text-xs text-brand-600 hover:underline">View →</Link>
            </div>
            {stats.stock_by_category.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No stock on hand.</p>
            ) : (
              <DonutChart
                data={stats.stock_by_category.map((s) => ({
                  label: s.category_name,
                  value: s.quantity,
                }))}
                formatValue={(n) => formatNumber(n)}
                size={140}
              />
            )}
          </div>
        </div>
      )}

      {/* 30-day production trend */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-900">Production Trend (Last 30 Days)</h2>
          <Link to="/reports" className="text-xs text-brand-600 hover:underline">Reports →</Link>
        </div>
        {prodTrend.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No production in the last 30 days.</p>
        ) : (
          <BarChart
            data={prodTrend}
            formatValue={(n) => formatNumber(n)}
            height={200}
          />
        )}
      </div>

      {/* Operational mini-stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {hasPermission('workers.view') && (
          <MiniStatCard label="Active Workers" value={stats.active_workers} icon={Users} to="/workers" />
        )}
        {hasPermission('departments.manage') && (
          <MiniStatCard label="Departments" value={stats.active_departments} icon={Building2} to="/departments" />
        )}
        {hasPermission('batches.view') && (
          <MiniStatCard label="Active Batches" value={stats.active_batches} icon={Package} to="/batches" subtitle={`${stats.firing_batches} firing`} />
        )}
        {canSeeSales && (
          <MiniStatCard label="Open Invoices" value={stats.open_invoices_count} icon={AlertCircle} to="/pos" />
        )}
      </div>

      {/* Receivables & payables — only for accounts/sales users */}
      {canSeeAccounts && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {canSeeSales && (
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-2">
                <ArrowDownToLine className="h-5 w-5 text-amber-600" />
                <h2 className="text-base font-semibold text-slate-900">Customer Receivables</h2>
              </div>
              <div className="text-2xl font-bold text-amber-700">{formatCurrency(stats.customer_receivables)}</div>
              <div className="text-xs text-slate-500 mt-1">Total outstanding from {stats.open_invoices_count} open invoice(s)</div>
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-center gap-2 mb-2">
              <ArrowUpFromLine className="h-5 w-5 text-purple-600" />
              <h2 className="text-base font-semibold text-slate-900">Worker Payable</h2>
            </div>
            <div className="text-2xl font-bold text-purple-700">{formatCurrency(stats.worker_payable)}</div>
            <div className="text-xs text-slate-500 mt-1">Total earned − advances − payments (active workers)</div>
          </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="h-5 w-5 text-orange-600" />
            <h2 className="text-base font-semibold text-slate-900">Kiln Status</h2>
          </div>
          {stats.kiln_status_breakdown.length === 0 ? (
            <p className="text-sm text-slate-400">No active kilns.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {stats.kiln_status_breakdown.map((k) => (
                <span key={k.status} className="badge-info">
                  {k.status}: {k.count}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Quick links — based on permissions */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {canSeeSales && <QuickAction to="/pos" icon={TrendingUp} label="New Sale" />}
          {canSeeProduction && <QuickAction to="/production" icon={Package} label="Record Production" />}
          {canSeeAccounts && <QuickAction to="/expenses" icon={TrendingDown} label="New Expense" />}
          {canSeeAccounts && <QuickAction to="/cash" icon={Wallet} label="Cash Register" />}
          {hasPermission('batches.view') && <QuickAction to="/batches" icon={Boxes} label="Batches" />}
          {hasPermission('workers.view') && <QuickAction to="/workers" icon={Users} label="Workers" />}
        </div>
      </div>
    </div>
  );
}

function MiniStatCard({ label, value, subtitle, icon: Icon, to }: {
  label: string; value: number; subtitle?: string; icon: React.ElementType; to: string;
}) {
  return (
    <Link to={to} className="block">
      <div className="card p-4 hover:shadow-md hover:border-brand-300 transition flex items-center gap-3">
        <div className="h-9 w-9 rounded-md flex items-center justify-center bg-slate-100 text-slate-600">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</div>
          <div className="text-lg font-bold text-slate-900">{value}</div>
          {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
        </div>
      </div>
    </Link>
  );
}

function QuickAction({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
  return (
    <Link to={to} className="flex flex-col items-center gap-2 p-3 rounded-md border border-slate-200 hover:bg-slate-50 hover:border-brand-300 transition">
      <Icon className="h-5 w-5 text-slate-600" />
      <span className="text-xs font-medium text-slate-700">{label}</span>
    </Link>
  );
}
