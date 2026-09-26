import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import {
  payroll as payrollApi, departments as deptApi,
} from '../lib/ipc';
import type { PayrollRun, PayrollRunItem, Department } from '../types';
import { formatCurrency, formatDate, formatNumber } from '../lib/utils';
import {
  Plus, Eye, Ban, Trash2, CheckCircle2, Wallet, Calendar, Users,
  ArrowRight, Pencil,
} from 'lucide-react';
import { exportToCsv } from '../lib/export';

export default function PayrollPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<PayrollRun | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PayrollRun | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const r = await payrollApi.listRuns({ status: statusFilter || undefined, limit: 50 });
      setRuns(r.items);
      setTotal(r.total);
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    deptApi.list(false).then(setDepartments).catch(() => {});
    load();
  }, [statusFilter]);

  return (
    <div>
      <PageHeader
        title="Payroll Runs"
        subtitle={`${total} run${total === 1 ? '' : 's'} — bulk salary payments for workers`}
        actions={
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4" /> New Payroll Run
          </button>
        }
      />

      <div className="card p-4 mb-4 bg-blue-50 border-blue-200">
        <div className="text-sm text-blue-800">
          <strong>How payroll runs work:</strong>
          <ol className="list-decimal list-inside mt-1 ml-2 space-y-0.5 text-xs">
            <li>Select cycle (weekly/monthly/custom) + date range</li>
            <li>System auto-calculates each worker's earned, advances, and net payable</li>
            <li>Adjust payment amounts per worker, deselect workers you don't want to pay</li>
            <li>Post the run — bulk worker_payments created + cash register updated</li>
          </ol>
          <div className="mt-2 text-xs">
            Each worker has a <strong>payroll_cycle</strong> (weekly/monthly/daily) set on their profile.
            Filter by cycle to process weekly and monthly workers separately.
          </div>
        </div>
      </div>

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3">
          <select className="input max-w-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="draft">Draft (not posted)</option>
            <option value="posted">Posted (paid)</option>
            <option value="void">Voided</option>
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : runs.length === 0 ? (
        <EmptyState
          title="No payroll runs yet"
          message="Create your first payroll run to bulk-pay workers."
          icon={<Plus className="h-8 w-8" />}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Run #</th>
                <th className="text-left px-4 py-3 font-semibold">Cycle</th>
                <th className="text-left px-4 py-3 font-semibold">Period</th>
                <th className="text-right px-4 py-3 font-semibold">Workers</th>
                <th className="text-right px-4 py-3 font-semibold">Net Payable</th>
                <th className="text-right px-4 py-3 font-semibold">Paid</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-slate-900">{r.run_number}</td>
                  <td className="px-4 py-2"><span className="badge-info">{r.cycle_type}</span></td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {formatDate(r.period_start)} → {formatDate(r.period_end)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{r.workers_count}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{formatCurrency(r.total_net_payable)}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatCurrency(r.total_paid)}</td>
                  <td className="px-4 py-2">
                    {r.status === 'draft' && <span className="badge-warning">Draft</span>}
                    {r.status === 'posted' && <span className="badge-success">Posted</span>}
                    {r.status === 'void' && <span className="badge-danger">Voided</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setViewingRunId(r.id)} className="btn-ghost btn-sm" title="View / Edit">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      {r.status === 'posted' && (
                        <button onClick={() => setVoidTarget(r)} className="btn-ghost btn-sm text-red-600" title="Void (reverse)">
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {r.status === 'draft' && (
                        <button onClick={() => setDeleteTarget(r)} className="btn-ghost btn-sm text-red-600" title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <CreateRunModal
          departments={departments}
          onClose={() => setShowCreateModal(false)}
          onCreated={(runId) => {
            setShowCreateModal(false);
            setViewingRunId(runId);
            load();
          }}
        />
      )}

      {viewingRunId && (
        <RunDetailModal
          runId={viewingRunId}
          onClose={() => { setViewingRunId(null); load(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await payrollApi.deleteRun(deleteTarget.id);
            pushToast('success', `Draft run ${deleteTarget.run_number} deleted.`);
            load();
          } catch (err: any) {
            pushToast('error', err.message);
          }
          setDeleteTarget(null);
        }}
        title="Delete Draft Run"
        message={`Delete draft payroll run "${deleteTarget?.run_number}"? This cannot be undone.`}
        confirmText="Delete"
        danger
      />

      {voidTarget && (
        <VoidRunDialog
          run={voidTarget}
          onClose={() => setVoidTarget(null)}
          onDone={() => { setVoidTarget(null); load(); }}
        />
      )}
    </div>
  );
}

function CreateRunModal({ departments, onClose, onCreated }: {
  departments: Department[];
  onClose: () => void;
  onCreated: (runId: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

  const [form, setForm] = useState({
    cycleType: 'weekly' as 'weekly' | 'monthly' | 'daily' | 'custom',
    periodStart: weekAgo,
    periodEnd: today,
    paymentMethod: 'cash',
    departmentId: '',
    cycleFilter: 'all' as 'weekly' | 'monthly' | 'daily' | 'all',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // Auto-adjust dates when cycle type changes
  const handleCycleChange = (cycle: typeof form.cycleType) => {
    let start = weekAgo;
    if (cycle === 'monthly') {
      start = monthStart;
    } else if (cycle === 'daily') {
      start = today;
    }
    setForm({ ...form, cycleType: cycle, periodStart: start, cycleFilter: cycle === 'custom' ? 'all' : cycle });
  };

  const handleCreate = async () => {
    if (!form.periodStart || !form.periodEnd) {
      pushToast('warning', 'Period start and end dates are required.');
      return;
    }
    if (form.periodStart > form.periodEnd) {
      pushToast('warning', 'Period start must be before or equal to period end.');
      return;
    }
    setSaving(true);
    try {
      const result = await payrollApi.createRun({
        cycleType: form.cycleType,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        paymentMethod: form.paymentMethod,
        departmentId: form.departmentId || undefined,
        cycleFilter: form.cycleFilter,
        notes: form.notes || undefined,
      });
      pushToast('success', `Payroll run ${result.run_number} created with ${result.workers_count} workers.`);
      onCreated(result.id);
    } catch (err: any) {
      pushToast('error', err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="New Payroll Run"
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleCreate} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Create Run'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Cycle Type</label>
          <div className="grid grid-cols-4 gap-2">
            {(['weekly', 'monthly', 'daily', 'custom'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleCycleChange(c)}
                className={`py-2 px-2 rounded-md border text-xs font-medium ${form.cycleType === c ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'}`}
              >
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Period Start</label>
            <input type="date" className="input" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
          </div>
          <div>
            <label className="label">Period End</label>
            <input type="date" className="input" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="label">Worker Filter — Payroll Cycle</label>
          <select className="input" value={form.cycleFilter} onChange={(e) => setForm({ ...form, cycleFilter: e.target.value as any })}>
            <option value="all">All workers</option>
            <option value="weekly">Weekly workers only</option>
            <option value="monthly">Monthly workers only</option>
            <option value="daily">Daily workers only</option>
          </select>
          <p className="text-xs text-slate-500 mt-1">
            Set each worker's cycle on their profile page. Filter here to process them separately.
          </p>
        </div>

        <div>
          <label className="label">Department (optional)</label>
          <select className="input" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Payment Method</label>
          <select className="input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
            <option value="cash">Cash</option>
            <option value="bank">Bank Transfer</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. September week 2 payroll" />
        </div>
      </div>
    </Modal>
  );
}

function RunDetailModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [items, setItems] = useState<PayrollRunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [editingItem, setEditingItem] = useState<PayrollRunItem | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const r = await payrollApi.getRun(runId);
      setRun(r.run);
      setItems(r.items);
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [runId]);

  const handleToggleSelect = async (item: PayrollRunItem) => {
    if (!run || run.status !== 'draft') return;
    try {
      await payrollApi.updateItem(item.id, { isSelected: !item.is_selected });
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    }
  };

  const handlePost = async () => {
    if (!run) return;
    const selected = items.filter((i) => i.is_selected && i.payment_amount > 0).length;
    if (selected === 0) {
      pushToast('warning', 'No workers selected with payment > 0. Select at least one.');
      return;
    }
    if (!confirm(`Post this payroll run? This will create ${selected} worker payments totaling ${formatCurrency(items.filter(i => i.is_selected).reduce((s, i) => s + i.payment_amount, 0))}.`)) return;
    setPosting(true);
    try {
      const result = await payrollApi.postRun(runId);
      pushToast('success', `Payroll posted: ${result.posted_count} payments, total ${formatCurrency(result.total_paid)}.`);
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setPosting(false);
    }
  };

  const handleExport = () => {
    if (items.length === 0) return;
    exportToCsv(`payroll-${run?.run_number || 'run'}`, items.map((i) => ({
      worker_code: i.worker_code,
      worker_name: i.worker_name,
      department: i.department_name,
      days_worked: i.days_worked,
      total_qty: i.total_qty,
      earned: i.earned_in_period.toFixed(2),
      advances: i.advances_in_period.toFixed(2),
      previous_balance: i.previous_balance.toFixed(2),
      net_payable: i.net_payable.toFixed(2),
      payment_amount: i.payment_amount.toFixed(2),
      selected: i.is_selected ? 'Yes' : 'No',
    })));
    pushToast('success', 'CSV exported.');
  };

  if (loading) return <Modal open={true} onClose={onClose} title="Loading..."><Spinner className="mx-auto" /></Modal>;
  if (!run) return <Modal open={true} onClose={onClose} title="Not Found"><p>Run not found.</p></Modal>;

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Payroll Run ${run.run_number}`}
      size="xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Close</button>
          {run.status === 'draft' && (
            <>
              <button className="btn-secondary" onClick={handleExport}>
                Export CSV
              </button>
              <button className="btn-primary" onClick={handlePost} disabled={posting}>
                {posting ? <Spinner size="sm" className="border-white" /> : <><CheckCircle2 className="h-4 w-4" /> Post & Pay</>}
              </button>
            </>
          )}
          {run.status === 'posted' && (
            <button className="btn-secondary" onClick={handleExport}>
              Export CSV
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3 border border-slate-200 rounded-md">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Period</div>
            <div className="text-sm font-semibold text-slate-900">{formatDate(run.period_start)} → {formatDate(run.period_end)}</div>
          </div>
          <div className="p-3 border border-slate-200 rounded-md">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Workers</div>
            <div className="text-lg font-bold text-slate-900">{run.workers_count}</div>
          </div>
          <div className="p-3 border border-emerald-200 bg-emerald-50 rounded-md">
            <div className="text-xs text-emerald-700 uppercase tracking-wider">Earned</div>
            <div className="text-lg font-bold text-emerald-700">{formatCurrency(run.total_earned)}</div>
          </div>
          <div className="p-3 border border-amber-200 bg-amber-50 rounded-md">
            <div className="text-xs text-amber-700 uppercase tracking-wider">Advances</div>
            <div className="text-lg font-bold text-amber-700">{formatCurrency(run.total_advances)}</div>
          </div>
          <div className="p-3 border border-brand-200 bg-brand-50 rounded-md">
            <div className="text-xs text-brand-700 uppercase tracking-wider">Net Payable</div>
            <div className="text-lg font-bold text-brand-700">{formatCurrency(run.total_net_payable)}</div>
          </div>
        </div>

        {/* Items table */}
        <div className="border border-slate-200 rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                {run.status === 'draft' && <th className="px-2 py-2 w-8"></th>}
                <th className="text-left px-3 py-2 font-semibold">Code</th>
                <th className="text-left px-3 py-2 font-semibold">Worker</th>
                <th className="text-left px-3 py-2 font-semibold">Dept</th>
                <th className="text-right px-3 py-2 font-semibold">Days</th>
                <th className="text-right px-3 py-2 font-semibold">Qty</th>
                <th className="text-right px-3 py-2 font-semibold">Earned</th>
                <th className="text-right px-3 py-2 font-semibold">Advances</th>
                <th className="text-right px-3 py-2 font-semibold">Prev Bal</th>
                <th className="text-right px-3 py-2 font-semibold">Net Payable</th>
                <th className="text-right px-3 py-2 font-semibold">Payment</th>
                {run.status === 'draft' && <th className="px-2 py-2"></th>}
                {run.status === 'posted' && <th className="text-left px-3 py-2 font-semibold">Payment #</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className={item.is_selected ? '' : 'opacity-40'}>
                  {run.status === 'draft' && (
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={item.is_selected}
                        onChange={() => handleToggleSelect(item)}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{item.worker_code}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{item.worker_name}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs">{item.department_name || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">{item.days_worked}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">{formatNumber(item.total_qty)}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">{formatCurrency(item.earned_in_period)}</td>
                  <td className="px-3 py-2 text-right font-mono text-amber-700">{formatCurrency(item.advances_in_period)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${item.previous_balance >= 0 ? 'text-slate-700' : 'text-red-700'}`}>{formatCurrency(item.previous_balance)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{formatCurrency(item.net_payable)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-brand-700">{formatCurrency(item.payment_amount)}</td>
                  {run.status === 'draft' && (
                    <td className="px-2 py-2">
                      <button onClick={() => setEditingItem(item)} className="btn-ghost btn-sm" title="Adjust payment">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                  {run.status === 'posted' && (
                    <td className="px-3 py-2 font-mono text-xs text-emerald-700">{item.payment_number || '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold">
              <tr>
                {run.status === 'draft' && <td></td>}
                <td colSpan={4} className="px-3 py-2 text-right">Totals:</td>
                <td colSpan={4}></td>
                <td className="px-3 py-2 text-right font-mono text-slate-900">{formatCurrency(run.total_net_payable)}</td>
                <td className="px-3 py-2 text-right font-mono text-brand-700">{formatCurrency(run.total_paid)}</td>
                {run.status === 'draft' && <td></td>}
                {run.status === 'posted' && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>

        {run.status === 'posted' && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 inline mr-2" />
            Posted on {formatDate(run.posted_at)} — {items.filter(i => i.worker_payment_id).length} payments created.
          </div>
        )}
      </div>

      {editingItem && (
        <EditItemModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => { setEditingItem(null); load(); }}
        />
      )}
    </Modal>
  );
}

function EditItemModal({ item, onClose, onSaved }: {
  item: PayrollRunItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [paymentAmount, setPaymentAmount] = useState(item.payment_amount);
  const [isSelected, setIsSelected] = useState(item.is_selected);
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSave = async () => {
    setSaving(true);
    try {
      await payrollApi.updateItem(item.id, {
        paymentAmount: Number(paymentAmount),
        isSelected,
        notes: notes || undefined,
      });
      pushToast('success', 'Item updated.');
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
      title={`Adjust: ${item.worker_name}`}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Earned:</span><span className="font-mono text-emerald-700">{formatCurrency(item.earned_in_period)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Advances:</span><span className="font-mono text-amber-700">{formatCurrency(item.advances_in_period)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Previous Balance:</span><span className="font-mono text-slate-700">{formatCurrency(item.previous_balance)}</span></div>
          <div className="flex justify-between font-semibold border-t border-slate-200 pt-1"><span>Net Payable:</span><span className="font-mono text-slate-900">{formatCurrency(item.net_payable)}</span></div>
        </div>
        <div>
          <label className="label">Payment Amount (Rs.)</label>
          <input
            type="number"
            min={0}
            step={0.01}
            className="input"
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(Number(e.target.value))}
          />
          <p className="text-xs text-slate-500 mt-1">
            Default = net payable. You can pay less (partial) or more (advance for next cycle).
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isSelected} onChange={(e) => setIsSelected(e.target.checked)} />
          Include this worker in the payroll run
        </label>
        <div>
          <label className="label">Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. partial payment, advance adjustment" />
        </div>
      </div>
    </Modal>
  );
}

function VoidRunDialog({ run, onClose, onDone }: {
  run: PayrollRun;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleVoid = async () => {
    if (!reason.trim()) { pushToast('warning', 'Reason is required.'); return; }
    setSaving(true);
    try {
      const result = await payrollApi.voidRun(run.id, reason);
      pushToast('success', `Run voided: ${result.voided_count} payments reversed.`);
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
      title={`Void Payroll Run ${run.run_number}`}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-danger" onClick={handleVoid} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Void Run'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          <strong>Warning:</strong> Voiding will:
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            <li>Mark all linked worker_payments as void</li>
            <li>Reverse cash register entries (if cash payments)</li>
            <li>Mark the run as voided (preserved in audit log)</li>
          </ul>
        </div>
        <div>
          <label className="label">Reason *</label>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. incorrect calculation, worker disputed amounts" />
        </div>
      </div>
    </Modal>
  );
}
