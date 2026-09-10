import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth';
import { Card } from '../components/Card';
import { Spinner } from '../components/Feedback';
import { Link } from 'react-router-dom';
import {
  Users, Boxes, Package, TrendingUp, Wallet, Building2, Activity, Clock,
} from 'lucide-react';
import { formatDate } from '../lib/utils';

interface DashboardStats {
  activeWorkers: number;
  activeDepartments: number;
  totalProductionToday: number;
  totalLabourToday: number;
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    activeWorkers: 0,
    activeDepartments: 0,
    totalProductionToday: 0,
    totalLabourToday: 0,
  });

  useEffect(() => {
    // For Phase 1, dashboard is a placeholder showing the layout.
    // Real data will come from a dedicated 'dashboard:stats' IPC endpoint in Phase 2.
    const t = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(t);
  }, []);

  if (loading) return <Spinner className="mx-auto mt-12" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Welcome, <span className="font-medium text-slate-700">{user?.fullName}</span>. Here's an overview of your kiln operation.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Workers"
          value="—"
          icon={Users}
          color="bg-blue-50 text-blue-600"
          to="/workers"
        />
        <StatCard
          label="Departments"
          value="—"
          icon={Building2}
          color="bg-emerald-50 text-emerald-600"
          to="/departments"
        />
        <StatCard
          label="Production Today"
          value="—"
          icon={Package}
          color="bg-amber-50 text-amber-600"
          to="/production"
        />
        <StatCard
          label="Labour Earned Today"
          value="—"
          icon={Wallet}
          color="bg-purple-50 text-purple-600"
          to="/production"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="p-5">
            <h2 className="text-base font-semibold text-slate-900 mb-3">Quick Actions</h2>
            <div className="space-y-2">
              <QuickLink to="/workers" icon={Users} label="Manage Workers" />
              <QuickLink to="/departments" icon={Building2} label="Configure Departments" />
              <QuickLink to="/production" icon={Package} label="Record Production" />
              <QuickLink to="/users" icon={Activity} label="Manage Users & Roles" />
              <QuickLink to="/backup" icon={Clock} label="Create Backup" />
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <h2 className="text-base font-semibold text-slate-900 mb-3">System Status</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Logged in as</span>
                <span className="font-medium text-slate-900">{user?.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Role</span>
                <span className="font-medium text-slate-900">{user?.roleName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Permissions</span>
                <span className="font-medium text-slate-900">{user?.permissions.length ?? 0} granted</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Today's date</span>
                <span className="font-medium text-slate-900">{formatDate(new Date().toISOString())}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Platform</span>
                <span className="font-medium text-slate-900 capitalize">{window.erp?.info?.platform || 'unknown'}</span>
              </div>
            </div>

            {user?.mustChangePassword && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-xs">
                <strong>Important:</strong> You are using the default password. Please change it from the Settings page.
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <div className="p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-2">Welcome to Brick Kiln ERP</h2>
          <p className="text-sm text-slate-600 mb-3">
            This is Phase 1 of the system, which includes:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <FeatureItem text="Authentication with bcrypt password hashing" />
            <FeatureItem text="Role-based access control (10 default roles, 40+ permissions)" />
            <FeatureItem text="Department management (CRUD + enable/disable)" />
            <FeatureItem text="Worker management with auto-generated barcode & QR code" />
            <FeatureItem text="Worker ledger derived from transactions" />
            <FeatureItem text="Production entry (4 stages: raw brick, transport, kiln loading, unloading)" />
            <FeatureItem text="Automatic labour amount calculation" />
            <FeatureItem text="Audit logging of every significant action" />
            <FeatureItem text="Backup & restore with safety checks" />
            <FeatureItem text="Auto-update via GitHub Releases" />
            <FeatureItem text="Offline-first operation (SQLite embedded)" />
            <FeatureItem text="GitHub Actions CI/CD pipeline" />
          </div>
        </div>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, to }: { label: string; value: string; icon: React.ElementType; color: string; to: string }) {
  return (
    <Link to={to} className="block">
      <div className="card p-4 hover:shadow-md hover:border-brand-300 transition">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
          </div>
          <div className={`h-9 w-9 rounded-md flex items-center justify-center ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function QuickLink({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 p-2.5 rounded-md hover:bg-slate-50 transition">
      <Icon className="h-4 w-4 text-slate-500" />
      <span className="text-sm text-slate-700 font-medium">{label}</span>
    </Link>
  );
}

function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="h-1.5 w-1.5 rounded-full bg-brand-500 mt-1.5 flex-shrink-0" />
      <span className="text-slate-700">{text}</span>
    </div>
  );
}
