import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { users as userApi, roles as rolesApi, departments as deptApi } from '../lib/ipc';
import type { User, Role, Department, Permission } from '../types';
import { formatDate } from '../lib/utils';
import { Plus, Edit2, Power, KeyRound, Trash2 } from 'lucide-react';

export default function UsersPage() {
  const [items, setItems] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<User | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const [list, rs, ds] = await Promise.all([
        userApi.list(search || undefined, showInactive),
        rolesApi.list(true),
        deptApi.list(true),
      ]);
      setItems(list as User[]);
      setRoles(rs);
      setDepartments(ds);
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [search, showInactive]);

  const handleToggle = async (u: User) => {
    try {
      await userApi.setActive(u.id, !u.isActive);
      pushToast('success', `${u.username} ${u.isActive ? 'disabled' : 'enabled'}.`);
      load();
    } catch (err: any) { pushToast('error', err.message); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await userApi.delete(deleteTarget.id);
      pushToast('success', `User "${deleteTarget.username}" deleted.`);
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    }
    setDeleteTarget(null);
  };

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Manage user accounts and access"
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowInactive((v) => !v)}>{showInactive ? 'Hide inactive' : 'Show inactive'}</button>
            <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}><Plus className="h-4 w-4" /> Add User</button>
          </>
        }
      />

      <div className="card p-3 mb-4">
        <input className="input" placeholder="Search users by name or username..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No users found" icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Username<br/><span className="text-[10px] text-slate-400 normal-case">یوزر نیم</span></th>
                <th className="text-left px-4 py-3 font-semibold">Name<br/><span className="text-[10px] text-slate-400 normal-case">نام</span></th>
                <th className="text-left px-4 py-3 font-semibold">Role<br/><span className="text-[10px] text-slate-400 normal-case">رول</span></th>
                <th className="text-left px-4 py-3 font-semibold">Department<br/><span className="text-[10px] text-slate-400 normal-case">ڈیپارٹمنٹ</span></th>
                <th className="text-left px-4 py-3 font-semibold">Last Login<br/><span className="text-[10px] text-slate-400 normal-case">آخری لاگ ان</span></th>
                <th className="text-left px-4 py-3 font-semibold">Status<br/><span className="text-[10px] text-slate-400 normal-case">حالت</span></th>
                <th className="text-right px-4 py-3 font-semibold">Actions<br/><span className="text-[10px] text-slate-400 normal-case">عمل</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-slate-900">{u.username}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-900">{u.fullName}</div>
                    {u.email && <div className="text-xs text-slate-500">{u.email}</div>}
                  </td>
                  <td className="px-4 py-2"><span className="badge-info">{u.roleName || roles.find((r) => r.id === u.roleId)?.name || '—'}</span></td>
                  <td className="px-4 py-2 text-slate-700">{u.departmentName || departments.find((d) => d.id === u.departmentId)?.name || '—'}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never'}</td>
                  <td className="px-4 py-2">
                    {u.isActive ? <span className="badge-success">Active</span> : <span className="badge-default">Disabled</span>}
                    {u.mustChangePassword && <span className="badge-warning ml-1">Reset Pwd</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => { setEditing(u); setShowModal(true); }} className="btn-ghost btn-sm" title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setResetTarget(u)} className="btn-ghost btn-sm" title="Reset password"><KeyRound className="h-3.5 w-3.5" /></button>
                      {u.isActive ? (
                        <button onClick={() => handleToggle(u)} className="btn-ghost btn-sm text-amber-600" title="Disable user"><Power className="h-3.5 w-3.5" /></button>
                      ) : (
                        <button onClick={() => handleToggle(u)} className="btn-ghost btn-sm text-emerald-600" title="Enable user"><Power className="h-3.5 w-3.5" /></button>
                      )}
                      {u.username !== 'admin' && (
                        <button onClick={() => setDeleteTarget(u)} className="btn-ghost btn-sm text-red-600" title="Delete user"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <UserModal user={editing} roles={roles} departments={departments} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}

      {resetTarget && (
        <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} onDone={() => { setResetTarget(null); load(); }} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete User"
        message={`Delete user "${deleteTarget?.username}" (${deleteTarget?.fullName})? This cannot be undone. All their sessions will be revoked. Audit records will be preserved but anonymized.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}

function UserModal({ user, roles, departments, onClose, onSaved }: {
  user: User | null;
  roles: Role[];
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    username: user?.username ?? '',
    password: '',
    full_name: user?.fullName ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    role_id: user?.roleId ?? '',
    department_id: user?.departmentId ?? '',
    must_change_password: user?.mustChangePassword ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [useCustomPerms, setUseCustomPerms] = useState(false);
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    rolesApi.listPermissions().then(setAllPermissions).catch(() => {});
  }, []);

  // When role changes and not using custom perms, pre-fill from role
  useEffect(() => {
    if (!useCustomPerms && form.role_id) {
      rolesApi.get(form.role_id).then((r) => {
        if (r?.permission_codes) {
          setSelectedPerms(new Set(r.permission_codes));
        }
      }).catch(() => {});
    }
  }, [form.role_id, useCustomPerms]);

  const togglePerm = (code: string) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleModule = (modulePerms: Permission[]) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      const allSelected = modulePerms.every((p) => next.has(p.code));
      if (allSelected) {
        modulePerms.forEach((p) => next.delete(p.code));
      } else {
        modulePerms.forEach((p) => next.add(p.code));
      }
      return next;
    });
  };

  // Group permissions by module
  const grouped = allPermissions.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {});

  const handleSubmit = async () => {
    if (!form.username.trim() || !form.full_name.trim() || !form.role_id) {
      pushToast('warning', 'Username, name and role are required.');
      return;
    }
    if (!user && !form.password) {
      pushToast('warning', 'Password is required for new users.');
      return;
    }
    setSaving(true);
    try {
      const customPerms = useCustomPerms ? Array.from(selectedPerms) : undefined;
      if (user) {
        await userApi.update(user.id, {
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          role_id: form.role_id,
          department_id: form.department_id || undefined,
          must_change_password: form.must_change_password,
          custom_permissions: useCustomPerms ? Array.from(selectedPerms) : [],
        });
        pushToast('success', 'User updated.');
      } else {
        await userApi.create({
          username: form.username,
          password: form.password,
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          role_id: form.role_id,
          department_id: form.department_id || undefined,
          must_change_password: form.must_change_password,
          custom_permissions: useCustomPerms ? Array.from(selectedPerms) : undefined,
        });
        pushToast('success', 'User created.');
      }
      onSaved();
    } catch (err: any) {
      pushToast('error', err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={user ? `Edit ${user.username}` : 'New User'}
      size="xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : user ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Basic Info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Username *</label>
            <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={saving || !!user} />
          </div>
          {!user && (
            <div>
              <label className="label">Password *</label>
              <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} disabled={saving} />
            </div>
          )}
          <div>
            <label className="label">Full Name *</label>
            <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} disabled={saving} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={saving} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={saving} />
          </div>
          <div>
            <label className="label">Department</label>
            <select className="input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} disabled={saving}>
              <option value="">— None —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Role *</label>
            <select className="input" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })} disabled={saving}>
              <option value="">Select role...</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.must_change_password} onChange={(e) => setForm({ ...form, must_change_password: e.target.checked })} disabled={saving} />
              Force password change on next login
            </label>
          </div>
        </div>

        {/* Permission Selection */}
        <div className="border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Permissions</label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useCustomPerms}
                onChange={(e) => {
                  setUseCustomPerms(e.target.checked);
                  if (!e.target.checked && form.role_id) {
                    // Re-load role permissions
                    rolesApi.get(form.role_id).then((r) => {
                      if (r?.permission_codes) setSelectedPerms(new Set(r.permission_codes));
                    });
                  }
                }}
              />
              <span className="text-slate-700">Customize permissions (override role defaults)</span>
            </label>
          </div>

          {!useCustomPerms ? (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-600">
              User will inherit all permissions from the <strong>{roles.find(r => r.id === form.role_id)?.name || 'selected role'}</strong> role.
              Check "Customize permissions" above to select specific permissions.
            </div>
          ) : (
            <div className="text-xs text-slate-500 mb-2">
              Selected: <strong className="text-slate-700">{selectedPerms.size}</strong> permissions.
              Uncheck items this user should NOT have access to.
            </div>
          )}

          {useCustomPerms && (
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-md p-3 space-y-3">
              {Object.entries(grouped).map(([mod, perms]) => (
                <div key={mod} className="border-b border-slate-100 pb-2 last:border-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-semibold text-slate-700 text-sm capitalize">{mod}</div>
                    <button
                      className="text-xs text-brand-600 hover:underline"
                      onClick={() => toggleModule(perms)}
                    >
                      Toggle all
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                    {perms.map((p) => (
                      <label key={p.id} className="flex items-start gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedPerms.has(p.code)}
                          onChange={() => togglePerm(p.code)}
                          className="mt-0.5"
                        />
                        <div>
                          <div className="text-xs font-medium text-slate-900">{p.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{p.code}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [forceChange, setForceChange] = useState(true);
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    if (!password || password.length < 6) { pushToast('warning', 'Password must be at least 6 characters.'); return; }
    setSaving(true);
    try {
      await userApi.resetPassword(user.id, password, forceChange);
      pushToast('success', `Password reset for ${user.username}.`);
      onDone();
    } catch (err: any) {
      pushToast('error', err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Reset Password: ${user.username}`}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Reset Password'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">New Password</label>
          <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} disabled={saving} autoFocus />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={forceChange} onChange={(e) => setForceChange(e.target.checked)} disabled={saving} />
          Force user to change this password on next login
        </label>
      </div>
    </Modal>
  );
}
