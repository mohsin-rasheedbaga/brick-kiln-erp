import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { useAuthStore } from '../stores/auth';
import { workers as workerApi, departments as deptApi, workTypes as wtApi } from '../lib/ipc';
import type { Worker, Department, WorkType } from '../types';
import { Plus, Edit2, Search, Eye, QrCode, Barcode, FileText, Filter } from 'lucide-react';
import { WorkerCardPrint } from '../components/WorkerCardPrint';

export default function WorkersPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuthStore();
  const canCreateWorker = hasPermission('workers.create');
  const canEditWorker = hasPermission('workers.edit');
  const canDeleteWorker = hasPermission('workers.delete');
  const [items, setItems] = useState<Worker[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const [departments, setDepartments] = useState<Department[]>([]);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [printingWorker, setPrintingWorker] = useState<Worker | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const loadDeps = async () => {
    try {
      const [depts] = await Promise.all([deptApi.list(false)]);
      setDepartments(depts);
    } catch {}
  };

  const load = async () => {
    setLoading(true);
    try {
      const result = await workerApi.list({
        search: search || undefined,
        departmentId: departmentFilter || undefined,
        status: statusFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err: any) {
      pushToast('error', err.message || 'Failed to load workers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDeps(); }, []);
  useEffect(() => { load(); }, [search, departmentFilter, statusFilter, page]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <PageHeader
        title="Workers"
        subtitle={`${total} worker${total === 1 ? '' : 's'} total`}
        actions={
          canCreateWorker && (
            <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
              <Plus className="h-4 w-4" /> Add Worker
            </button>
          )
        }
      />

      <div className="card p-3 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              className="input pl-9"
              placeholder="Search by name, code, barcode, or mobile..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <select className="input" value={departmentFilter} onChange={(e) => { setDepartmentFilter(e.target.value); setPage(0); }}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="left">Left</option>
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No workers found" message="Add your first worker to begin recording production." icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Code</th>
                <th className="text-left px-4 py-3 font-semibold">Name</th>
                <th className="text-left px-4 py-3 font-semibold">Department</th>
                <th className="text-left px-4 py-3 font-semibold">Work Type</th>
                <th className="text-right px-4 py-3 font-semibold">Rate / 1000</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{w.worker_code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{w.full_name}</div>
                    {w.mobile && <div className="text-xs text-slate-500">{w.mobile}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{w.department_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{w.work_type_name || '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{w.rate_per_1000.toFixed(0)}</td>
                  <td className="px-4 py-3">
                    {w.status === 'active' ? <span className="badge-success">Active</span>
                      : w.status === 'left' ? <span className="badge-danger">Left</span>
                      : <span className="badge-default">Inactive</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => navigate(`/workers/${w.id}`)} className="btn-ghost btn-sm" title="View / Ledger">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setPrintingWorker(w)} className="btn-ghost btn-sm" title="Print card">
                        <QrCode className="h-3.5 w-3.5" />
                      </button>
                      {canEditWorker && (
                        <button onClick={() => { setEditing(w); setShowModal(true); }} className="btn-ghost btn-sm" title="Edit">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
              <div className="text-slate-500">Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}</div>
              <div className="flex gap-1">
                <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <span className="px-3 py-1.5 text-slate-700">Page {page + 1} of {totalPages}</span>
                <button className="btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <WorkerModal
          worker={editing}
          departments={departments}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}

      {printingWorker && (
        <WorkerCardPrint worker={printingWorker} onClose={() => setPrintingWorker(null)} />
      )}
    </div>
  );
}

function WorkerModal({ worker, departments, onClose, onSaved }: {
  worker: Worker | null;
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    full_name: worker?.full_name ?? '',
    father_name: worker?.father_name ?? '',
    mobile: worker?.mobile ?? '',
    address: worker?.address ?? '',
    cnic: worker?.cnic ?? '',
    joining_date: worker?.joining_date ?? new Date().toISOString().slice(0, 10),
    department_id: worker?.department_id ?? '',
    work_type_id: worker?.work_type_id ?? '',
    rate_per_1000: worker?.rate_per_1000 ?? 0,
    employment_type: (worker?.employment_type || 'piece_rate') as 'piece_rate' | 'salary',
    monthly_salary: worker?.monthly_salary ?? 0,
    allowed_leaves: worker?.allowed_leaves ?? 4,
    notes: worker?.notes ?? '',
  });
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    wtApi.list(false).then(setWorkTypes).catch(() => {});
  }, []);

  // Filter work types based on selected department
  const filteredWorkTypes = useMemo(() => {
    if (!form.department_id) return workTypes;
    const deptFiltered = workTypes.filter((w) => !w.department_id || w.department_id === form.department_id);
    return deptFiltered.length > 0 ? deptFiltered : workTypes;
  }, [workTypes, form.department_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) { pushToast('warning', 'Name is required.'); return; }
    if (!form.department_id) { pushToast('warning', 'Department is required.'); return; }
    setSaving(true);
    try {
      if (worker) {
        await workerApi.update(worker.id, form);
        pushToast('success', 'Worker updated.');
      } else {
        const created = await workerApi.create(form);
        pushToast('success', `Worker created: ${created.worker_code}`);
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
      title={worker ? `Edit ${worker.full_name}` : 'New Worker'}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : worker ? 'Save Changes' : 'Create Worker'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="label">Full Name *</label>
          <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} disabled={saving} autoFocus />
        </div>
        <div>
          <label className="label">Father's Name</label>
          <input className="input" value={form.father_name} onChange={(e) => setForm({ ...form, father_name: e.target.value })} disabled={saving} />
        </div>
        <div>
          <label className="label">Mobile</label>
          <input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} disabled={saving} placeholder="03XX-XXXXXXX" />
        </div>
        <div>
          <label className="label">CNIC</label>
          <input className="input" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} disabled={saving} placeholder="XXXXX-XXXXXXX-X" />
        </div>
        <div>
          <label className="label">Joining Date</label>
          <input type="date" className="input" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} disabled={saving} />
        </div>
        <div>
          <label className="label">Department *</label>
          <select className="input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value, work_type_id: '' })} disabled={saving}>
            <option value="">Select department...</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Work Type</label>
          <select className="input" value={form.work_type_id} onChange={(e) => setForm({ ...form, work_type_id: e.target.value })} disabled={saving}>
            <option value="">— Auto-rate —</option>
            {filteredWorkTypes.map((w) => <option key={w.id} value={w.id}>{w.name} (Rs. {w.default_rate_per_1000}/1000)</option>)}
          </select>
        </div>

        {/* Employment Type Selector */}
        <div className="sm:col-span-2">
          <label className="label">Employment Type *</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, employment_type: 'piece_rate' })}
              className={`py-2 px-3 rounded-md border text-sm font-medium ${form.employment_type === 'piece_rate' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'}`}
            >
              ٹھیکے پر (Piece Rate) — per 1000 bricks
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, employment_type: 'salary' })}
              className={`py-2 px-3 rounded-md border text-sm font-medium ${form.employment_type === 'salary' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'}`}
            >
              تنخواہ (Salary) — monthly fixed
            </button>
          </div>
        </div>

        {/* Piece Rate fields */}
        {form.employment_type === 'piece_rate' && (
          <div>
            <label className="label">Rate per 1000 (Rs.)</label>
            <input type="number" min={0} step="1" className="input" value={form.rate_per_1000} onChange={(e) => setForm({ ...form, rate_per_1000: Number(e.target.value) })} disabled={saving} />
          </div>
        )}

        {/* Salary fields */}
        {form.employment_type === 'salary' && (
          <>
            <div>
              <label className="label">Monthly Salary (Rs.)</label>
              <input type="number" min={0} step="0.01" className="input" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: Number(e.target.value) })} disabled={saving} />
              <p className="text-xs text-slate-500 mt-1">Fixed monthly salary for guards, drivers, etc.</p>
            </div>
            <div>
              <label className="label">Allowed Leaves per Month</label>
              <input type="number" min={0} step="1" className="input" value={form.allowed_leaves} onChange={(e) => setForm({ ...form, allowed_leaves: Number(e.target.value) })} disabled={saving} />
              <p className="text-xs text-slate-500 mt-1">Leave days allowed without salary deduction</p>
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <label className="label">Address</label>
          <textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} disabled={saving} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={saving} />
        </div>

        {worker && (
          <div className="sm:col-span-2 p-3 bg-slate-50 border border-slate-200 rounded-md">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Worker Identification</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-500 text-xs">Worker Code</div>
                <div className="font-mono text-slate-900">{worker.worker_code}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs flex items-center gap-1"><Barcode className="h-3 w-3" /> Barcode</div>
                <div className="font-mono text-slate-900">{worker.barcode}</div>
              </div>
              <div className="col-span-2">
                <div className="text-slate-500 text-xs flex items-center gap-1"><QrCode className="h-3 w-3" /> QR Token</div>
                <div className="font-mono text-xs text-slate-700 break-all">{worker.qr_token}</div>
              </div>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
