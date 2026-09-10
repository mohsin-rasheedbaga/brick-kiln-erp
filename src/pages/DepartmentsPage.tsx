import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { departments as deptApi } from '../lib/ipc';
import type { Department } from '../types';
import { Plus, Edit2, Trash2, Power } from 'lucide-react';

export default function DepartmentsPage() {
  const [items, setItems] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const list = await deptApi.list(showInactive);
      setItems(list);
    } catch (err: any) {
      pushToast('error', err.message || 'Failed to load departments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [showInactive]);

  const handleToggle = async (dept: Department) => {
    try {
      await deptApi.setActive(dept.id, !dept.is_active);
      pushToast('success', `${dept.name} ${dept.is_active ? 'deactivated' : 'activated'}.`);
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deptApi.delete(deleteTarget.id);
      pushToast('success', `Department "${deleteTarget.name}" deleted.`);
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Departments"
        subtitle="Manage kiln operation departments"
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowInactive((v) => !v)}>
              {showInactive ? 'Hide inactive' : 'Show inactive'}
            </button>
            <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
              <Plus className="h-4 w-4" /> Add Department
            </button>
          </>
        }
      />

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No departments found" message="Add your first department to get started." icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Code</th>
                <th className="text-left px-4 py-3 font-semibold">Name</th>
                <th className="text-left px-4 py-3 font-semibold">Description</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-left px-4 py-3 font-semibold">Type</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{d.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{d.name}</td>
                  <td className="px-4 py-3 text-slate-600">{d.description || '—'}</td>
                  <td className="px-4 py-3">
                    {d.is_active ? <span className="badge-success">Active</span> : <span className="badge-default">Inactive</span>}
                  </td>
                  <td className="px-4 py-3">
                    {d.is_system ? <span className="badge-info">System</span> : <span className="badge-default">Custom</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => { setEditing(d); setShowModal(true); }} className="btn-ghost btn-sm" title="Edit">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      {!d.is_system && (
                        <>
                          <button onClick={() => handleToggle(d)} className="btn-ghost btn-sm" title={d.is_active ? 'Deactivate' : 'Activate'}>
                            <Power className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setDeleteTarget(d)} className="btn-ghost btn-sm text-red-600" title="Delete">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
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
        <DepartmentModal
          department={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Department"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}

function DepartmentModal({ department, onClose, onSaved }: { department: Department | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(department?.name ?? '');
  const [code, setCode] = useState(department?.code ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      pushToast('warning', 'Name and code are required.');
      return;
    }
    setSaving(true);
    try {
      if (department) {
        await deptApi.update(department.id, { name, code, description });
        pushToast('success', 'Department updated.');
      } else {
        await deptApi.create({ name, code, description });
        pushToast('success', 'Department created.');
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
      title={department ? `Edit ${department.name}` : 'New Department'}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : department ? 'Save Changes' : 'Create'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="dept-name">Name *</label>
          <input id="dept-name" className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="dept-code">Code * (max 8 chars)</label>
          <input
            id="dept-code"
            className="input font-mono uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
            disabled={saving || !!department?.is_system}
            placeholder="e.g. RAW"
          />
        </div>
        <div>
          <label className="label" htmlFor="dept-desc">Description</label>
          <textarea id="dept-desc" className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} />
        </div>
      </form>
    </Modal>
  );
}
