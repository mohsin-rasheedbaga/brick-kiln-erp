import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Spinner, EmptyState } from '../components/Feedback';
import { audit as auditApi } from '../lib/ipc';
import type { AuditLogEntry } from '../types';
import { formatDateTime } from '../lib/utils';
import { Search } from 'lucide-react';

const ACTION_COLORS: Record<string, string> = {
  login: 'badge-info',
  logout: 'badge-default',
  create: 'badge-success',
  update: 'badge-info',
  delete: 'badge-danger',
  void: 'badge-danger',
  backup: 'badge-info',
  restore: 'badge-warning',
  settings_change: 'badge-warning',
  password_change: 'badge-warning',
  password_reset: 'badge-warning',
};

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const load = async () => {
    setLoading(true);
    try {
      const r = await auditApi.list({
        action: actionFilter || undefined,
        module: moduleFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
      setItems(r.items);
      setTotal(r.total);
    } catch (err) {
      // ignore
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [actionFilter, moduleFilter, page]);

  return (
    <div>
      <PageHeader title="Audit Log" subtitle={`${total} total entries`} />

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3">
          <select className="input max-w-xs" value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}>
            <option value="">All actions</option>
            <option value="login">Login</option>
            <option value="logout">Logout</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="void">Void</option>
            <option value="backup">Backup</option>
            <option value="restore">Restore</option>
            <option value="settings_change">Settings Change</option>
            <option value="password_change">Password Change</option>
            <option value="password_reset">Password Reset</option>
          </select>
          <select className="input max-w-xs" value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); setPage(0); }}>
            <option value="">All modules</option>
            <option value="auth">Auth</option>
            <option value="workers">Workers</option>
            <option value="departments">Departments</option>
            <option value="users">Users</option>
            <option value="roles">Roles</option>
            <option value="production">Production</option>
            <option value="settings">Settings</option>
            <option value="system">System</option>
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No audit entries" icon={<Search className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Timestamp</th>
                <th className="text-left px-4 py-3 font-semibold">User</th>
                <th className="text-left px-4 py-3 font-semibold">Action</th>
                <th className="text-left px-4 py-3 font-semibold">Module</th>
                <th className="text-left px-4 py-3 font-semibold">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-xs text-slate-600">{formatDateTime(e.timestamp)}</td>
                  <td className="px-4 py-2 text-slate-900 font-medium">{e.username || '—'}</td>
                  <td className="px-4 py-2"><span className={ACTION_COLORS[e.action] || 'badge-default'}>{e.action}</span></td>
                  <td className="px-4 py-2 text-slate-700 text-xs">{e.module || '—'}</td>
                  <td className="px-4 py-2 text-slate-700 text-xs">{e.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
