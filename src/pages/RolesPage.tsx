import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { roles as roleApi } from '../lib/ipc';
import type { Role, Permission } from '../types';
import { Plus, Edit2, Trash2, ShieldCheck } from 'lucide-react';

export default function RolesPage() {
  const [items, setItems] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Role | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [permissionsModal, setPermissionsModal] = useState<Role | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const list = await roleApi.list(showInactive);
      setItems(list);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [showInactive]);

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Define roles and assign granular permissions"
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowInactive((v) => !v)}>{showInactive ? 'Hide inactive' : 'Show inactive'}</button>
            <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}><Plus className="h-4 w-4" /> New Role</button>
          </>
        }
      />

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No roles found" icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Name</th>
                <th className="text-left px-4 py-3 font-semibold">Description</th>
                <th className="text-right px-4 py-3 font-semibold">Users</th>
                <th className="text-left px-4 py-3 font-semibold">Type</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-900">{r.name}</td>
                  <td className="px-4 py-2 text-slate-600">{r.description || '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.userCount ?? 0}</td>
                  <td className="px-4 py-2">{r.is_system ? <span className="badge-info">System</span> : <span className="badge-default">Custom</span>}</td>
                  <td className="px-4 py-2">{r.is_active ? <span className="badge-success">Active</span> : <span className="badge-default">Inactive</span>}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setPermissionsModal(r)} className="btn-ghost btn-sm" title="Manage permissions"><ShieldCheck className="h-3.5 w-3.5" /></button>
                      <button onClick={() => { setEditing(r); setShowModal(true); }} className="btn-ghost btn-sm" title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>
                      {!r.is_system && (
                        <button onClick={() => setDeleteTarget(r)} className="btn-ghost btn-sm text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
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
        <RoleModal role={editing} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}

      {permissionsModal && (
        <PermissionsModal role={permissionsModal} onClose={() => setPermissionsModal(null)} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await roleApi.delete(deleteTarget.id);
            pushToast('success', `Role "${deleteTarget.name}" deleted.`);
            load();
          } catch (err: any) { pushToast('error', err.message); }
        }}
        title="Delete Role"
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}

function RoleModal({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    if (!name.trim()) { pushToast('warning', 'Name is required.'); return; }
    setSaving(true);
    try {
      if (role) {
        await roleApi.update(role.id, { name, description });
        pushToast('success', 'Role updated.');
      } else {
        await roleApi.create({ name, description });
        pushToast('success', 'Role created.');
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
      title={role ? `Edit ${role.name}` : 'New Role'}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : role ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} autoFocus />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} />
        </div>
      </div>
    </Modal>
  );
}

function PermissionsModal({ role, onClose }: { role: Role; onClose: () => void }) {
  const [allPerms, setAllPerms] = useState<Permission[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    (async () => {
      try {
        const [perms, roleDetail] = await Promise.all([
          roleApi.listPermissions(),
          roleApi.get(role.id),
        ]);
        setAllPerms(perms);
        setSelected(new Set(roleDetail?.permission_codes || []));
      } catch (err: any) {
        pushToast('error', err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [role.id]);

  // Group permissions by module
  const grouped = allPerms.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {});

  const toggle = (permId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
  };

  const toggleModule = (modulePerms: Permission[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = modulePerms.every((p) => next.has(p.id));
      if (allSelected) {
        modulePerms.forEach((p) => next.delete(p.id));
      } else {
        modulePerms.forEach((p) => next.add(p.id));
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await roleApi.setPermissions(role.id, Array.from(selected));
      pushToast('success', `Permissions updated for ${role.name}.`);
      onClose();
    } catch (err: any) {
      pushToast('error', err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Permissions: ${role.name}`}
      size="xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? <Spinner size="sm" className="border-white" /> : `Save (${selected.size} permissions)`}
          </button>
        </>
      }
    >
      {loading ? (
        <Spinner className="mx-auto" />
      ) : (
        <div className="space-y-4">
          {role.is_system && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-xs">
              <strong>Note:</strong> This is a system role. Permission changes are allowed but use caution — overriding defaults may break expected behaviour.
            </div>
          )}
          {Object.entries(grouped).map(([mod, perms]) => (
            <div key={mod} className="border border-slate-200 rounded-md">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="font-semibold text-slate-700 text-sm capitalize">{mod}</div>
                <button className="text-xs text-brand-600 hover:underline" onClick={() => toggleModule(perms)}>
                  Toggle all
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
                {perms.map((p) => (
                  <label key={p.id} className="flex items-start gap-2 p-2 rounded hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
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
    </Modal>
  );
}
