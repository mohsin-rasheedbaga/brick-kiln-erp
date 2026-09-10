import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import {
  workerAdvances as advApi, workerPayments as payApi, workers as workerApi,
} from '../lib/ipc';
import type { WorkerAdvance, WorkerPayment, Worker } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';
import { Plus, Ban, Search, Wallet, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

type TabKind = 'advances' | 'payments';

export default function WorkerPaymentsPage() {
  const [tab, setTab] = useState<TabKind>('advances');
  const [advances, setAdvances] = useState<WorkerAdvance[]>([]);
  const [payments, setPayments] = useState<WorkerPayment[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [advTotal, setAdvTotal] = useState(0);
  const [payTotal, setPayTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string; type: TabKind } | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const [adv, pay, ws] = await Promise.all([
        advApi.list({
          workerId: workerFilter || undefined,
          limit: 100,
        }),
        payApi.list({
          workerId: workerFilter || undefined,
          limit: 100,
        }),
        workerApi.list({ limit: 1000 }),
      ]);
      setAdvances(adv.items);
      setPayments(pay.items);
      setAdvTotal(adv.totalAmount);
      setPayTotal(pay.totalAmount);
      setWorkers(ws.items);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [workerFilter]);

  const filterBySearch = <T extends { worker_name?: string; worker_code?: string; advance_number?: string; payment_number?: string }>(arr: T[]): T[] => {
    if (!search) return arr;
    const q = search.toLowerCase();
    return arr.filter((i) =>
      (i.worker_name?.toLowerCase().includes(q)) ||
      (i.worker_code?.toLowerCase().includes(q)) ||
      (i.advance_number?.toLowerCase().includes(q)) ||
      (i.payment_number?.toLowerCase().includes(q))
    );
  };

  const items = tab === 'advances' ? filterBySearch(advances) : filterBySearch(payments);

  return (
    <div>
      <PageHeader
        title="Worker Advances & Payments"
        subtitle={
          tab === 'advances'
            ? `Total advances: ${formatCurrency(advTotal)}`
            : `Total payments: ${formatCurrency(payTotal)}`
        }
        actions={
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" /> New {tab === 'advances' ? 'Advance' : 'Payment'}
          </button>
        }
      />

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex bg-slate-100 rounded-md p-0.5">
            <button
              onClick={() => setTab('advances')}
              className={`px-3 py-1.5 text-sm font-medium rounded ${tab === 'advances' ? 'bg-white shadow text-brand-700' : 'text-slate-600'}`}
            >
              <ArrowDownCircle className="h-4 w-4 inline mr-1" /> Advances ({advances.length})
            </button>
            <button
              onClick={() => setTab('payments')}
              className={`px-3 py-1.5 text-sm font-medium rounded ${tab === 'payments' ? 'bg-white shadow text-brand-700' : 'text-slate-600'}`}
            >
              <ArrowUpCircle className="h-4 w-4 inline mr-1" /> Payments ({payments.length})
            </button>
          </div>
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search by worker name, code, or number..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input max-w-xs" value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)}>
            <option value="">All workers</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{w.worker_code} — {w.full_name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title={`No ${tab} found`} message={`Record your first ${tab === 'advances' ? 'worker advance' : 'worker payment'}.`} icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Date</th>
                <th className="text-left px-4 py-3 font-semibold">{tab === 'advances' ? 'Advance #' : 'Payment #'}</th>
                <th className="text-left px-4 py-3 font-semibold">Worker</th>
                <th className="text-right px-4 py-3 font-semibold">Amount</th>
                <th className="text-left px-4 py-3 font-semibold">Method</th>
                <th className="text-left px-4 py-3 font-semibold">Reference</th>
                <th className="text-left px-4 py-3 font-semibold">Description</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item: any) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-700">{formatDate(item.date)}</td>
                  <td className="px-4 py-2 font-mono text-slate-900">{item.advance_number || item.payment_number}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-900">{item.worker_name}</div>
                    <div className="text-xs text-slate-500 font-mono">{item.worker_code}</div>
                  </td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${tab === 'advances' ? 'text-amber-700' : 'text-purple-700'}`}>
                    {formatCurrency(item.amount)}
                  </td>
                  <td className="px-4 py-2"><span className="badge-info">{item.payment_method}</span></td>
                  <td className="px-4 py-2 text-xs text-slate-500 font-mono">{item.reference_no || '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">{item.description || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setVoidTarget({ id: item.id, number: item.advance_number || item.payment_number, type: tab })} className="btn-ghost btn-sm text-red-600" title="Void">
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr>
                <td colSpan={3} className="px-4 py-2 font-semibold text-slate-700">Total</td>
                <td className={`px-4 py-2 text-right font-mono font-bold ${tab === 'advances' ? 'text-amber-700' : 'text-purple-700'}`}>
                  {formatCurrency(items.reduce((s, i) => s + i.amount, 0))}
                </td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showModal && (
        <NewRecordModal
          type={tab}
          workers={workers}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}

      {voidTarget && (
        <VoidDialog
          target={voidTarget}
          onClose={() => setVoidTarget(null)}
          onDone={() => { setVoidTarget(null); load(); }}
        />
      )}
    </div>
  );
}

function NewRecordModal({ type, workers, onClose, onSaved }: {
  type: TabKind;
  workers: Worker[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    workerId: '',
    amount: 0,
    paymentMethod: 'cash',
    referenceNo: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    if (!form.workerId) { pushToast('warning', 'Worker is required.'); return; }
    if (!form.amount || form.amount <= 0) { pushToast('warning', 'Amount must be positive.'); return; }
    setSaving(true);
    try {
      const data = {
        date: form.date,
        workerId: form.workerId,
        amount: Number(form.amount),
        paymentMethod: form.paymentMethod,
        referenceNo: form.referenceNo || undefined,
        description: form.description || undefined,
      };
      if (type === 'advances') {
        const result = await advApi.create(data);
        pushToast('success', `Advance recorded: ${result.advance_number}`);
      } else {
        const result = await payApi.create(data);
        pushToast('success', `Payment recorded: ${result.payment_number}`);
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
      title={type === 'advances' ? 'New Worker Advance' : 'New Worker Payment'}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : <><Wallet className="h-4 w-4" /> Record</>}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div>
          <label className="label">Worker *</label>
          <select className="input" value={form.workerId} onChange={(e) => setForm({ ...form, workerId: e.target.value })}>
            <option value="">Select worker...</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{w.worker_code} — {w.full_name} ({w.department_name})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount (Rs.) *</label>
            <input type="number" min={0.01} step={0.01} className="input" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Payment Method</label>
            <select className="input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Reference No</label>
          <input className="input" value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

function VoidDialog({ target, onClose, onDone }: {
  target: { id: string; number: string; type: TabKind };
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
      if (target.type === 'advances') {
        await advApi.void(target.id, reason);
      } else {
        await payApi.void(target.id, reason);
      }
      pushToast('success', `${target.type === 'advances' ? 'Advance' : 'Payment'} ${target.number} voided.`);
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
      title={`Void ${target.type === 'advances' ? 'Advance' : 'Payment'} ${target.number}`}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-danger" onClick={handleVoid} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Void'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          Voiding will reverse the cash register impact and update the worker's ledger balance.
        </div>
        <div>
          <label className="label">Reason *</label>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
