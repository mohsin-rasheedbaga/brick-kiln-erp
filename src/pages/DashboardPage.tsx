import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth';
import { dashboard as dashApi, reports as reportsApi } from '../lib/ipc';
import type { DashboardStats } from '../types';
import { Spinner } from '../components/Feedback';
import { BarChart, DonutChart, KpiCard } from '../components/Charts';
import { Link } from 'react-router-dom';
import {
  Users, Building2, Package, Wallet, TrendingUp, TrendingDown,
  Boxes, Flame, AlertCircle, ArrowDownToLine, ArrowUpFromLine, BarChart3,
  Truck, Hammer, ShoppingCart, ChevronRight,
} from 'lucide-react';
import { formatCurrency, formatNumber, formatDate } from '../lib/utils';

const STAGE_LABELS: Record<string, string> = {
  raw_brick_making: 'Raw Brick',
  raw_brick_transport: 'Transport + Loading',
  kiln_loading: 'Transport + Loading',
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

      {/* Super-Admin Visual Production Flow */}
      {user?.roleId === 'role-super-admin' && (
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-5 py-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <BarChart3 className="h-5 w-5" /> Today's Production Flow
            </h2>
            <p className="text-xs text-slate-300 mt-1">Live brick lifecycle — from raw clay to sale</p>
          </div>

          <div className="p-5">
            {/* Visual Flow: Stage 1 -> 2 -> 3 -> 4 -> 5 */}
            <div className="flex flex-col lg:flex-row items-stretch gap-3">

              {/* Stage 1: Raw Brick Making */}
              <FlowStageCard
                icon={Hammer}
                iconColor="bg-amber-100 text-amber-700"
                title="Raw Bricks Made"
                subtitle="نئی کچی اینٹ"
                quantity={stats.today.production_by_stage.find(p => p.stage === 'raw_brick_making')?.total_qty || 0}
                cost={stats.today.production_by_stage.find(p => p.stage === 'raw_brick_making')?.total_labour || 0}
                costLabel="Labour"
              />

              {/* Arrow */}
              <FlowArrow />

              {/* Stage 2: Transport + Loading (merged) */}
              <FlowStageCard
                icon={Truck}
                iconColor="bg-blue-100 text-blue-700"
                title="Transport + Loading"
                subtitle="بھٹے تک + بھٹے میں جوڑنا"
                quantity={
                  (stats.today.production_by_stage.find(p => p.stage === 'raw_brick_transport')?.total_qty || 0)
                  + (stats.today.production_by_stage.find(p => p.stage === 'kiln_loading')?.total_qty || 0)
                }
                cost={
                  (stats.today.production_by_stage.find(p => p.stage === 'raw_brick_transport')?.total_labour || 0)
                  + (stats.today.production_by_stage.find(p => p.stage === 'kiln_loading')?.total_labour || 0)
                }
                costLabel="Transport"
              />

              {/* Arrow */}
              <FlowArrow />

              {/* Stage 3: Baked Bricks Out */}
              <FlowStageCard
                icon={Flame}
                iconColor="bg-orange-100 text-orange-700"
                title="Baked Bricks Out"
                subtitle="پکی اینٹ نکلی"
                quantity={stats.today.production_by_stage.find(p => p.stage === 'baked_brick_unloading')?.total_qty || 0}
                cost={stats.today.production_by_stage.find(p => p.stage === 'baked_brick_unloading')?.total_labour || 0}
                costLabel="Unloading"
              />

              {/* Arrow */}
              <FlowArrow />

              {/* Stage 5: Sold */}
              <FlowStageCard
                icon={ShoppingCart}
                iconColor="bg-emerald-100 text-emerald-700"
                title="Sold Today"
                subtitle="فروخت ہوئی"
                quantity={0}
                cost={stats.today.sales_total}
                costLabel="Revenue"
                isRevenue
              />
            </div>

            {/* Summary row */}
            <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-center">
                <div className="text-xs text-emerald-700 uppercase font-medium">Cash Balance</div>
                <div className="text-xl font-bold text-emerald-700">{formatCurrency(stats.cash_balance)}</div>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-center">
                <div className="text-xs text-amber-700 uppercase font-medium">Receivables</div>
                <div className="text-xl font-bold text-amber-700">{formatCurrency(stats.customer_receivables)}</div>
              </div>
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-md text-center">
                <div className="text-xs text-purple-700 uppercase font-medium">Worker Payable</div>
                <div className="text-xl font-bold text-purple-700">{formatCurrency(stats.worker_payable)}</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-center">
                <div className="text-xs text-slate-600 uppercase font-medium">Bricks in Stock</div>
                <div className="text-xl font-bold text-slate-700">{formatNumber(stats.stock_by_category.reduce((s, c) => s + c.quantity, 0))}</div>
              </div>
            </div>

            {/* Stock by grade badges */}
            {stats.stock_by_category.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {stats.stock_by_category.map((s) => (
                  <span key={s.category_id} className={`badge ${s.quantity > 0 ? 'badge-success' : 'badge-default'}`}>
                    {s.category_name}: {formatNumber(s.quantity)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
                data={(() => {
                  // Merge kiln_loading into raw_brick_transport (same team)
                  const merged = new Map<string, number>();
                  for (const p of stats.today.production_by_stage) {
                    const key = p.stage === 'kiln_loading' ? 'raw_brick_transport' : p.stage;
                    merged.set(key, (merged.get(key) || 0) + p.total_qty);
                  }
                  const ORDER = ['raw_brick_making', 'raw_brick_transport', 'baked_brick_unloading'];
                  return Array.from(merged.entries())
                    .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
                    .map(([stage, qty]) => ({ label: STAGE_LABELS[stage] || stage, value: qty }));
                })()}
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

function FlowStageCard({ icon: Icon, iconColor, title, subtitle, quantity, cost, costLabel, isRevenue }: {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  subtitle: string;
  quantity: number;
  cost: number;
  costLabel: string;
  isRevenue?: boolean;
}) {
  const hasData = quantity > 0 || cost > 0;
  return (
    <div className={`flex-1 min-w-[140px] p-3 rounded-lg border-2 transition ${hasData ? 'border-slate-200 bg-white shadow-sm' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
      {/* Icon */}
      <div className="flex justify-center mb-2">
        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {/* Title */}
      <div className="text-center">
        <div className="text-xs font-semibold text-slate-700">{title}</div>
        <div className="text-[10px] text-slate-400">{subtitle}</div>
      </div>
      {/* Quantity */}
      <div className="text-center mt-2">
        <div className={`text-2xl font-bold ${hasData ? 'text-slate-900' : 'text-slate-400'}`}>
          {formatNumber(quantity)}
        </div>
        <div className="text-[10px] text-slate-400 uppercase">bricks</div>
      </div>
      {/* Cost */}
      {cost > 0 && (
        <div className="text-center mt-1 pt-1 border-t border-slate-100">
          <div className={`text-xs font-mono font-semibold ${isRevenue ? 'text-emerald-700' : 'text-amber-700'}`}>
            {isRevenue ? '+' : '−'} {formatCurrency(cost)}
          </div>
          <div className="text-[10px] text-slate-400">{costLabel}</div>
        </div>
      )}
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex items-center justify-center">
      <ChevronRight className="h-6 w-6 text-slate-300 rotate-90 lg:rotate-0" />
    </div>
  );
}
