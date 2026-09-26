import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import {
  departmentRates as rateApi, departments as deptApi,
  workTypes as wtApi, brickCategories as catApi,
} from '../lib/ipc';
import type { DepartmentRate, Department, WorkType, BrickCategory } from '../types';
import { formatCurrency } from '../lib/utils';
import { Plus, Edit2, Trash2, Search } from 'lucide-react';

export default function RatesPage() {
  const [rates, setRates] = useState<DepartmentRate[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [categories, setCategories] = useState<BrickCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDept, setFilterDept] = useState('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DepartmentRate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DepartmentRate | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const [r, ds, wts, cats] = await Promise.all([
        rateApi.list({ departmentId: filterDept || undefined }),
        deptApi.list(false),
        wtApi.list(false),
        catApi.list(false, false),
      ]);
      setRates(r);
      setDepartments(ds);
      setWorkTypes(wts);
      setCategories(cats);
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filterDept]);

  const filtered = rates.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.department_name?.toLowerCase().includes(q) ||
      r.work_type_name?.toLowerCase().includes(q) ||
      r.brick_category_name?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title="Labour Rates Management"
        subtitle="Configure per-department, per-grade rates — applied automatically across the app"
        actions={
          <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
            <Plus className="h-4 w-4" /> Set Rate
          </button>
        }
      />

      <div className="card p-4 mb-4 bg-blue-50 border-blue-200">
        <div className="text-sm text-blue-800">
          <strong>How rates work:</strong> When a production entry is recorded, the rate is looked up in this order:
          <ol className="list-decimal list-inside mt-1 ml-2 space-y-0.5 text-xs">
            <li>Exact match: Department + Work Type + Brick Grade</li>
            <li>General: Department + Work Type (any grade)</li>
            <li>Worker's personal rate_per_1000</li>
            <li>Work type's default rate</li>
          </ol>
          <div className="mt-2">Set rates here to standardize all labour calculations across your kiln.</div>
        </div>
      </div>

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search by department, work type, or grade..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="input max-w-xs" value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No rates configured"
          message="Click 'Set Rate' to configure per-department labour rates. Until then, the worker's personal rate or the work type default will be used."
          icon={<Plus className="h-8 w-8" />}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Department</th>
                <th className="text-left px-4 py-3 font-semibold">Work Type</th>
                <th className="text-left px-4 py-3 font-semibold">Brick Grade</th>
                <th className="text-right px-4 py-3 font-semibold">Rate / 1000</th>
                <th className="text-left px-4 py-3 font-semibold">Notes</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-900">{r.department_name || '—'}</td>
                  <td className="px-4 py-2 text-slate-700">{r.work_type_name || '—'}</td>
                  <td className="px-4 py-2">
                    {r.brick_category_name ? (
                      <span className="badge-info">{r.brick_category_name}</span>
                    ) : (
                      <span className="badge-default">All Grades</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700">
                    {formatCurrency(r.rate_per_1000)}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{r.notes || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => { setEditing(r); setShowModal(true); }}
                        className="btn-ghost btn-sm"
                        title="Edit"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="btn-ghost btn-sm text-red-600"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <RateModal
          rate={editing}
          departments={departments}
          workTypes={workTypes}
          categories={categories}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await rateApi.delete(deleteTarget.id);
            pushToast('success', 'Rate deleted.');
            load();
          } catch (err: any) {
            pushToast('error', err.message);
          }
          setDeleteTarget(null);
        }}
        title="Delete Rate"
        message={`Delete this rate? Production entries will fall back to the next available rate source.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}

function RateModal({ rate, departments, workTypes, categories, onClose, onSaved }: {
  rate: DepartmentRate | null;
  departments: Department[];
  workTypes: WorkType[];
  categories: BrickCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    departmentId: rate?.department_id ?? '',
    workTypeId: rate?.work_type_id ?? '',
    brickCategoryId: rate?.brick_category_id ?? '',
    ratePer1000: rate?.rate_per_1000 ?? 0,
    notes: rate?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    if (!form.departmentId) { pushToast('warning', 'Department is required.'); return; }
    if (!form.workTypeId) { pushToast('warning', 'Work type is required.'); return; }
    if (isNaN(form.ratePer1000) || form.ratePer1000 < 0) {
      pushToast('warning', 'Rate must be a non-negative number.');
      return;
    }
    setSaving(true);
    try {
      await rateApi.upsert({
        departmentId: form.departmentId,
        workTypeId: form.workTypeId,
        brickCategoryId: form.brickCategoryId || null,
        ratePer1000: Number(form.ratePer1000),
        notes: form.notes || undefined,
      });
      pushToast('success', rate ? 'Rate updated.' : 'Rate set.');
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
      title={rate ? 'Edit Rate' : 'Set New Rate'}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : rate ? 'Save' : 'Set Rate'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Department *</label>
          <select
            className="input"
            value={form.departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
            disabled={saving || !!rate}
          >
            <option value="">Select department...</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Work Type *</label>
          <select
            className="input"
            value={form.workTypeId}
            onChange={(e) => setForm({ ...form, workTypeId: e.target.value })}
            disabled={saving || !!rate}
          >
            <option value="">Select work type...</option>
            {workTypes.map((w) => <option key={w.id} value={w.id}>{w.name} (default: {formatCurrency(w.default_rate_per_1000)})</option>)}
          </select>
        </div>
        <div>
          <label className="label">Brick Grade (optional — leave empty to apply to all grades)</label>
          <select
            className="input"
            value={form.brickCategoryId}
            onChange={(e) => setForm({ ...form, brickCategoryId: e.target.value })}
            disabled={saving || !!rate}
          >
            <option value="">— All Grades —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Rate per 1000 (Rs.) *</label>
          <input
            type="number"
            min={0}
            step={0.01}
            className="input"
            value={form.ratePer1000 || ''}
            onChange={(e) => setForm({ ...form, ratePer1000: Number(e.target.value) })}
            disabled={saving}
            autoFocus
          />
          <p className="text-xs text-slate-500 mt-1">
            This rate will be used for all production entries matching this combination.
          </p>
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <textarea
            className="input"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            disabled={saving}
          />
        </div>
      </div>
    </Modal>
  );
}
