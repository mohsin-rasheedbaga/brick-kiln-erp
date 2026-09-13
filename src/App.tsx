import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import { useToastStore } from './stores/toast';
import LoginPage from './pages/LoginPage';
import MainLayout from './pages/MainLayout';
import DashboardPage from './pages/DashboardPage';
import DepartmentsPage from './pages/DepartmentsPage';
import WorkersPage from './pages/WorkersPage';
import WorkerDetailPage from './pages/WorkerDetailPage';
import ProductionPage from './pages/ProductionPage';
import UsersPage from './pages/UsersPage';
import RolesPage from './pages/RolesPage';
import SettingsPage from './pages/SettingsPage';
import AuditLogPage from './pages/AuditLogPage';
import BackupPage from './pages/BackupPage';
import UpdatesPage from './pages/UpdatesPage';
// Phase 2 pages
import BatchesPage from './pages/BatchesPage';
import CustomersPage from './pages/CustomersPage';
import CustomerDetailPage from './pages/CustomerDetailPage';
import SalesPage from './pages/SalesPage';
import ExpensesPage from './pages/ExpensesPage';
import WorkerPaymentsPage from './pages/WorkerPaymentsPage';
import CashPage from './pages/CashPage';
// Phase 3 pages
import StockPage from './pages/StockPage';
import ReportsPage from './pages/ReportsPage';
import RatesPage from './pages/RatesPage';
import DailySummaryPage from './pages/DailySummaryPage';
import PayrollPage from './pages/PayrollPage';
import CloudSyncPage from './pages/CloudSyncPage';
import { ToastContainer } from './components/Toast';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuthStore();
  const location = useLocation();
  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

function RequirePermission({ code, children }: { code: string; children: React.ReactNode }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  if (!hasPermission(code)) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Access Denied</h2>
          <p className="text-slate-500">You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  const { loadCurrentUser, token } = useAuthStore();
  const pushToast = useToastStore((s) => s.push);

  // On first load, attempt to restore the session
  useEffect(() => {
    if (token) {
      loadCurrentUser().catch(() => {
        pushToast('error', 'Session expired. Please log in again.');
      });
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <MainLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="departments" element={<RequirePermission code="departments.manage"><DepartmentsPage /></RequirePermission>} />
          <Route path="workers" element={<RequirePermission code="workers.view"><WorkersPage /></RequirePermission>} />
          <Route path="workers/:id" element={<RequirePermission code="workers.view"><WorkerDetailPage /></RequirePermission>} />
          <Route path="production" element={<RequirePermission code="production.view"><ProductionPage /></RequirePermission>} />
          <Route path="batches" element={<RequirePermission code="batches.view"><BatchesPage /></RequirePermission>} />
          <Route path="customers" element={<RequirePermission code="customers.view"><CustomersPage /></RequirePermission>} />
          <Route path="customers/:id" element={<RequirePermission code="customers.view"><CustomerDetailPage /></RequirePermission>} />
          <Route path="sales" element={<RequirePermission code="sales.view"><SalesPage /></RequirePermission>} />
          <Route path="expenses" element={<RequirePermission code="expenses.view"><ExpensesPage /></RequirePermission>} />
          <Route path="worker-payments" element={<RequirePermission code="worker_payments.view"><WorkerPaymentsPage /></RequirePermission>} />
          <Route path="cash" element={<RequirePermission code="accounts.view"><CashPage /></RequirePermission>} />
          <Route path="stock" element={<RequirePermission code="stock.view"><StockPage /></RequirePermission>} />
          <Route path="reports" element={<RequirePermission code="reports.view"><ReportsPage /></RequirePermission>} />
          <Route path="daily-summary" element={<RequirePermission code="dashboard.view"><DailySummaryPage /></RequirePermission>} />
          <Route path="rates" element={<RequirePermission code="settings.manage"><RatesPage /></RequirePermission>} />
          <Route path="payroll" element={<RequirePermission code="worker_payments.view"><PayrollPage /></RequirePermission>} />
          <Route path="cloud-sync" element={<RequirePermission code="settings.manage"><CloudSyncPage /></RequirePermission>} />
          <Route path="users" element={<RequirePermission code="users.manage"><UsersPage /></RequirePermission>} />
          <Route path="roles" element={<RequirePermission code="roles.manage"><RolesPage /></RequirePermission>} />
          <Route path="settings" element={<RequirePermission code="settings.manage"><SettingsPage /></RequirePermission>} />
          <Route path="audit" element={<RequirePermission code="system.audit"><AuditLogPage /></RequirePermission>} />
          <Route path="backup" element={<RequirePermission code="system.backup"><BackupPage /></RequirePermission>} />
          <Route path="updates" element={<UpdatesPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer />
    </>
  );
}
