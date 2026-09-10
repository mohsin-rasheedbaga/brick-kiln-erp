import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth';
import { dashboard as dashApi } from '../lib/ipc';
import type { DashboardStats } from '../types';
import { Spinner } from '../components/Feedback';
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
  const { user } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dashApi.stats()
      .then(setStats)
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

      {/* Today's activity cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Today's Production"
          value={formatNumber(stats.today.total_production_qty)}
          subtitle={`${formatCurrency(stats.today.total_labour)} labour`}
          icon={Package}
          color="bg-amber-50 text-amber-600"
          to="/production"
        />
        <StatCard
          label="Today's Sales"
          value={formatCurrency(stats.today.sales_total)}
          subtitle={`${stats.today.sales_count} invoice${stats.today.sales_count === 1 ? '' : 's'}`}
          icon={TrendingUp}
          color="bg-emerald-50 text-emerald-600"
          to="/sales"
        />
        <StatCard
          label="Today's Expenses"
          value={formatCurrency(stats.today.expenses_total)}
          subtitle={`${stats.today.expenses_count} expense${stats.today.expenses_count === 1 ? '' : 's'}`}
          icon={TrendingDown}
          color="bg-red-50 text-red-600"
          to="/expenses"
        />
        <StatCard
          label="Cash Balance"
          value={formatCurrency(stats.cash_balance)}
          subtitle={`${formatCurrency(stats.today.cash_received)} received today`}
          icon={Wallet}
          color="bg-brand-50 text-brand-600"
          to="/cash"
        />
      </div>

      {/* Operational stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniStatCard label="Active Workers" value={stats.active_workers} icon={Users} to="/workers" />
        <MiniStatCard label="Departments" value={stats.active_departments} icon={Building2} to="/departments" />
        <MiniStatCard label="Active Batches" value={stats.active_batches} icon={Package} to="/batches" subtitle={`${stats.firing_batches} firing`} />
        <MiniStatCard label="Open Invoices" value={stats.open_invoices_count} icon={AlertCircle} to="/sales" />
      </div>

      {/* Today's production breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-900">Today's Production by Stage</h2>
            <Link to="/production" className="text-xs text-brand-600 hover:underline">View all →</Link>
          </div>
          {stats.today.production_by_stage.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No production recorded today.</p>
          ) : (
            <div className="space-y-2">
              {stats.today.production_by_stage.map((p) => (
                <div key={p.stage} className="flex items-center justify-between p-2 rounded hover:bg-slate-50">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{STAGE_LABELS[p.stage] || p.stage}</div>
                    <div className="text-xs text-slate-500">{formatCurrency(p.total_labour)} labour</div>
                  </div>
                  <div className="text-lg font-bold text-slate-900 font-mono">{formatNumber(p.total_qty)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Stock by Category</h2>
          {stats.stock_by_category.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No stock on hand.</p>
          ) : (
            <div className="space-y-2">
              {stats.stock_by_category.map((s) => (
                <div key={s.category_id} className="flex items-center justify-between p-2 rounded hover:bg-slate-50">
                  <div className="flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-slate-400" />
                    <div className="text-sm font-medium text-slate-900">{s.category_name}</div>
                  </div>
                  <div className="text-lg font-bold text-slate-900 font-mono">{formatNumber(s.quantity)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Receivables & payables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2">
            <ArrowDownToLine className="h-5 w-5 text-amber-600" />
            <h2 className="text-base font-semibold text-slate-900">Customer Receivables</h2>
          </div>
          <div className="text-2xl font-bold text-amber-700">{formatCurrency(stats.customer_receivables)}</div>
          <div className="text-xs text-slate-500 mt-1">Total outstanding from {stats.open_invoices_count} open invoice(s)</div>
        </div>

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

      {/* Quick links */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <QuickAction to="/sales" icon={TrendingUp} label="New Sale" />
          <QuickAction to="/production" icon={Package} label="Record Production" />
          <QuickAction to="/expenses" icon={TrendingDown} label="New Expense" />
          <QuickAction to="/cash" icon={Wallet} label="Cash Register" />
          <QuickAction to="/batches" icon={Boxes} label="Batches" />
          <QuickAction to="/workers" icon={Users} label="Workers" />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, subtitle, icon: Icon, color, to }: {
  label: string; value: string; subtitle?: string; icon: React.ElementType; color: string; to: string;
}) {
  return (
    <Link to={to} className="block">
      <div className="card p-4 hover:shadow-md hover:border-brand-300 transition">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</div>
            <div className="text-xl font-bold text-slate-900 mt-1">{value}</div>
            {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
          </div>
          <div className={`h-9 w-9 rounded-md flex items-center justify-center ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </div>
    </Link>
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
