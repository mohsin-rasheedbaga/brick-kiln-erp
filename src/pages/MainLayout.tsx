import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Boxes, Building2, Package, ShieldCheck,
  Settings as SettingsIcon, History, DatabaseBackup, RefreshCw, LogOut,
  Menu, X, UserCircle, ChevronDown, ShoppingCart, Wallet, Users2,
  BarChart3, Package as PackageIcon, Tags, CalendarCheck, Calculator,
} from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useToastStore } from '../stores/toast';
import { cn } from '../lib/utils';
import { settings as settingsApi } from '../lib/ipc';
import type { Settings } from '../types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  permission?: string;
  group?: string;
}

const NAV_ITEMS: NavItem[] = [
  // Operations
  { to: '/dashboard',         label: 'Dashboard',       icon: LayoutDashboard, permission: 'dashboard.view', group: 'Operations' },
  { to: '/daily-summary',     label: 'Daily Summary',    icon: CalendarCheck,  permission: 'dashboard.view', group: 'Operations' },
  { to: '/production',        label: 'Production',       icon: Package,         permission: 'production.view', group: 'Operations' },
  { to: '/batches',           label: 'Batches',          icon: Boxes,           permission: 'batches.view', group: 'Operations' },
  { to: '/workers',           label: 'Workers',          icon: Users,           permission: 'workers.view', group: 'Operations' },
  { to: '/rates',             label: 'Labour Rates',     icon: Tags,             permission: 'settings.manage', group: 'Operations' },

  // Sales & Customers
  { to: '/sales',             label: 'Sales',            icon: ShoppingCart,    permission: 'sales.view', group: 'Sales & Finance' },
  { to: '/customers',         label: 'Customers',         icon: Users2,          permission: 'customers.view', group: 'Sales & Finance' },

  // Accounts
  { to: '/expenses',          label: 'Expenses',         icon: Wallet,          permission: 'expenses.view', group: 'Accounts' },
  { to: '/worker-payments',   label: 'Worker Pay',        icon: Users,           permission: 'worker_payments.view', group: 'Accounts' },
  { to: '/payroll',           label: 'Payroll Runs',      icon: Calculator,       permission: 'worker_payments.view', group: 'Accounts' },
  { to: '/cash',              label: 'Cash Register',     icon: Wallet,          permission: 'accounts.view', group: 'Accounts' },
  { to: '/stock',             label: 'Stock',            icon: PackageIcon,     permission: 'stock.view', group: 'Accounts' },

  // Reports
  { to: '/reports',           label: 'Reports',          icon: BarChart3,        permission: 'reports.view', group: 'Reports' },

  // Administration
  { to: '/departments',       label: 'Departments',      icon: Building2,       permission: 'departments.manage', group: 'Administration' },
  { to: '/users',             label: 'Users',            icon: ShieldCheck,     permission: 'users.manage', group: 'Administration' },
  { to: '/roles',             label: 'Roles & Perms',    icon: ShieldCheck,     permission: 'roles.manage', group: 'Administration' },
  { to: '/settings',          label: 'Settings',         icon: SettingsIcon,    permission: 'settings.manage', group: 'Administration' },
  { to: '/audit',             label: 'Audit Log',        icon: History,         permission: 'system.audit', group: 'Administration' },
  { to: '/backup',            label: 'Backup & Restore', icon: DatabaseBackup,  permission: 'system.backup', group: 'Administration' },
  { to: '/updates',           label: 'Updates',          icon: RefreshCw, group: 'Administration' },
];

export default function MainLayout() {
  const { user, logout, hasPermission, hasAnyPermission } = useAuthStore();
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    settingsApi.get().then(setSettings).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await logout();
    pushToast('info', 'You have been logged out.');
    navigate('/login');
  };

  const filteredNav = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar - desktop */}
      <aside className={cn(
        'fixed lg:static inset-y-0 left-0 z-30 w-64 bg-slate-900 text-slate-100 flex flex-col transition-transform duration-200',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-800">
          <div className="h-9 w-9 rounded-md bg-brand-600 flex items-center justify-center font-bold text-white">
            BK
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">{settings?.kiln_name || 'Brick Kiln ERP'}</div>
            <div className="text-xs text-slate-400 leading-tight">Production & Accounts</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {(() => {
            // Group items by their `group` field
            const groups: Record<string, NavItem[]> = {};
            for (const item of filteredNav) {
              const g = item.group || 'Other';
              if (!groups[g]) groups[g] = [];
              groups[g].push(item);
            }
            return Object.entries(groups).map(([groupName, items]) => (
              <div key={groupName} className="mb-1">
                <div className="px-5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {groupName}
                </div>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 px-5 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-brand-600 text-white border-r-2 border-white'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      )
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ));
          })()}
        </nav>

        <div className="border-t border-slate-800 p-4 text-xs text-slate-400">
          <div className="mb-1">v{settings?.app_version || '1.0.0'}</div>
          <div>© 2026 Brick Kiln ERP</div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center justify-between px-4 lg:px-6 py-3 bg-white border-b border-slate-200 shadow-sm">
          <button
            className="lg:hidden text-slate-500 hover:text-slate-900"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="hidden sm:flex items-center text-sm text-slate-500">
            <span>Welcome back, <span className="font-medium text-slate-900">{user?.fullName}</span></span>
          </div>

          <div className="relative">
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-100 transition"
            >
              <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 font-medium text-sm">
                {user?.fullName?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-sm font-medium text-slate-900 leading-tight">{user?.username}</div>
                <div className="text-xs text-slate-500 leading-tight">{user?.roleName}</div>
              </div>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-md shadow-lg z-20 py-1">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <div className="text-sm font-medium text-slate-900">{user?.fullName}</div>
                    <div className="text-xs text-slate-500">{user?.email || 'No email set'}</div>
                  </div>
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate('/updates'); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
                  >
                    <RefreshCw className="h-4 w-4 text-slate-500" /> Check for Updates
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                  >
                    <LogOut className="h-4 w-4" /> Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Routed page */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
