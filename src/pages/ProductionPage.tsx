import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { production as prodApi, workers as workerApi, departments as deptApi, workTypes as wtApi, kilns as kilnApi, brickCategories as catApi } from '../lib/ipc';
import type { ProductionEntry, Worker, Department, WorkType, Kiln, BrickCategory } from '../types';
import { formatCurrency, formatDate, formatNumber } from '../lib/utils';
import { Plus, Filter } from 'lucide-react';

const STAGES = [
  { value: 'raw_brick_making',       label: 'Raw Brick Making' },
  { value: 'raw_brick_transport',     label: 'Raw Brick Transport' },
  { value: 'kiln_loading',           label: 'Kiln Loading / Placement' },
  { value: 'baked_brick_unloading',   label: 'Baked Brick Unloading' },
];

export default function ProductionPage() {
  const [items, setItems] = useState<ProductionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [showModal, setShowModal] = useState(false);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [categories, setCategories] = useState<BrickCategory[]>([]);
  const pushToast = useToastStore((s) => s.push);

  const loadDeps = async () => {
    try {
      const [ws, ds, wts, ks, cs] = await Promise.all([
        workerApi.list({ limit: 1000 }),
        deptApi.list(false),
        wtApi.list(false),
        kilnApi.list(false),
        catApi.list(false, false),
      ]);
      setWorkers(ws.items);
      setDepartments(ds);
      setWorkTypes(wts);
      setKilns(ks);
      setCategories(cs);
    } catch (err: any) {
      pushToast('error', 'Failed to load dependencies.');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await prodApi.list({
        stage: stageFilter || undefined,
        departmentId: deptFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
      setItems(r.items);
      setTotal(r.total);
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDeps(); }, []);
  useEffect(() => { load(); }, [stageFilter, deptFilter, page]);

  return (
    <div>
      <PageHeader
        title="Production"
        subtitle="Record and track brick production across all stages"
        actions={
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" /> New Entry
          </button>
        }
      />

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3">
          <select className="input max-w-xs" value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(0); }}>
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="input max-w-xs" value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(0); }}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No production entries" message="Record your first production entry to begin." icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Date</th>
                <th className="text-left px-4 py-3 font-semibold">Stage</th>
                <th className="text-left px-4 py-3 font-semibold">Worker</th>
                <th className="text-left px-4 py-3 font-semibold">Department</th>
                <th className="text-right px-4 py-3 font-semibold">Qty</th>
                <th className="text-right px-4 py-3 font-semibold">Rate</th>
                <th className="text-right px-4 py-3 font-semibold">Labour</th>
                <th className="text-left px-4 py-3 font-semibold">Entered By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-700">{formatDate(p.date)}</td>
                  <td className="px-4 py-2"><span className="badge-info">{p.stage.replace(/_/g, ' ')}</span></td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-900">{p.worker_name || '—'}</div>
                    <div className="text-xs text-slate-500 font-mono">{p.worker_code}</div>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{p.department_name || '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatNumber(p.quantity)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(p.rate_per_1000)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700">{formatCurrency(p.labour_amount)}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{p.entered_by_name || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr>
                <td colSpan={4} className="px-4 py-2 font-semibold text-slate-700">Total ({total} entries)</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-slate-900">{formatNumber(items.reduce((s, i) => s + i.quantity, 0))}</td>
                <td></td>
                <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">{formatCurrency(items.reduce((s, i) => s + i.labour_amount, 0))}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showModal && (
        <ProductionModal
          workers={workers}
          departments={departments}
          workTypes={workTypes}
          kilns={kilns}
          categories={categories}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}

function ProductionModal({ workers, departments, workTypes, kilns, categories, onClose, onSaved }: {
  workers: Worker[];
  departments: Department[];
  workTypes: WorkType[];
  kilns: Kiln[];
  categories: BrickCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    stage: 'raw_brick_making',
    date: new Date().toISOString().slice(0, 10),
    workerId: '',
    departmentId: '',
    workTypeId: '',
    kilnId: '',
    quantity: 0,
    ratePer1000: 0,
    notes: '',
    transportMethod: '',
    categoryId: '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // Auto-fill worker's department + rate when worker selected
  const handleWorkerChange = (workerId: string) => {
    const w = workers.find((x) => x.id === workerId);
    if (w) {
      setForm((f) => ({
        ...f,
        workerId,
        departmentId: f.departmentId || w.department_id,
        ratePer1000: f.ratePer1000 || w.rate_per_1000 || 0,
      }));
    } else {
      setForm((f) => ({ ...f, workerId }));
    }
  };

  // Filter work types by department
  const filteredWorkTypes = form.departmentId
    ? workTypes.filter((wt) => !wt.department_id || wt.department_id === form.departmentId)
    : workTypes;

  const labourAmount = (form.quantity / 1000) * form.ratePer1000;

  const handleSubmit = async () => {
    if (!form.workerId) { pushToast('warning', 'Worker is required.'); return; }
    if (!form.departmentId) { pushToast('warning', 'Department is required.'); return; }
    if (!form.workTypeId) { pushToast('warning', 'Work type is required.'); return; }
    if (!Number.isInteger(form.quantity) || form.quantity <= 0) { pushToast('warning', 'Quantity must be a positive integer.'); return; }

    setSaving(true);
    try {
      await prodApi.create({
        stage: form.stage,
        date: form.date,
        workerId: form.workerId,
        departmentId: form.departmentId,
        workTypeId: form.workTypeId,
        kilnId: form.kilnId || undefined,
        quantity: form.quantity,
        ratePer1000: form.ratePer1000 || undefined,
        notes: form.notes || undefined,
        transportMethod: form.transportMethod || undefined,
        categoryId: form.stage === 'baked_brick_unloading' ? (form.categoryId || categories[0]?.id) : undefined,
      });
      pushToast('success', 'Production entry recorded.');
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
      title="New Production Entry"
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Save Entry'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Stage *</label>
          <select className="input" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Worker *</label>
          <select className="input" value={form.workerId} onChange={(e) => handleWorkerChange(e.target.value)}>
            <option value="">Select worker...</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{w.worker_code} — {w.full_name} ({w.department_name})</option>)}
          </select>
        </div>
        <div>
          <label className="label">Department *</label>
          <select className="input" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value, workTypeId: '' })}>
            <option value="">Select...</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Work Type *</label>
          <select className="input" value={form.workTypeId} onChange={(e) => setForm({ ...form, workTypeId: e.target.value })}>
            <option value="">Select...</option>
            {filteredWorkTypes.map((w) => <option key={w.id} value={w.id}>{w.name} (Rs. {w.default_rate_per_1000}/1000)</option>)}
          </select>
        </div>
        {(form.stage === 'kiln_loading' || form.stage === 'baked_brick_unloading') && (
          <div>
            <label className="label">Kiln</label>
            <select className="input" value={form.kilnId} onChange={(e) => setForm({ ...form, kilnId: e.target.value })}>
              <option value="">— None —</option>
              {kilns.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
        )}
        {form.stage === 'baked_brick_unloading' && (
          <div>
            <label className="label">Brick Category</label>
            <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">Quantity *</label>
          <input type="number" min={1} step={1} className="input" value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">Rate per 1000 (Rs.)</label>
          <input type="number" min={0} step={1} className="input" value={form.ratePer1000 || ''} onChange={(e) => setForm({ ...form, ratePer1000: Number(e.target.value) })} />
        </div>
        <div className="sm:col-span-2 p-3 bg-emerald-50 border border-emerald-200 rounded-md">
          <div className="text-xs text-emerald-700 uppercase tracking-wider">Computed Labour Amount</div>
          <div className="text-xl font-bold text-emerald-900">{formatCurrency(labourAmount)}</div>
          <div className="text-xs text-emerald-600 mt-0.5">{form.quantity} / 1000 × Rs. {form.ratePer1000} = {formatCurrency(labourAmount)}</div>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
