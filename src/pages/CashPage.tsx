import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { cash as cashApi } from '../lib/ipc';
import type { CashMovement, CashBalance } from '../types';
import { formatCurrency, formatDateTime } from '../lib/utils';
import { Plus, Wallet, TrendingUp, TrendingDown, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

const MOVEMENT_TYPES = [
  { value: '', label: 'All types' },
  { value: 'opening', label: 'Opening Balance' },
  { value: 'sale', label: 'Sale' },
  { value: 'customer_payment', label: 'Customer Payment' },
  { value: 'expense_out', label: 'Expense (out)' },
  { value: 'worker_payment_out', label: 'Worker Payment (out)' },
  { value: 'advance_out', label: 'Worker Advance (out)' },
  { value: 'income_in', label: 'Other Income' },
  { value: 'adjustment_in', label: 'Adjustment (in)' },
  { value: 'adjustment_out', label: 'Adjustment (out)' },
];

export default function CashPage() {
  const [balance, setBalance] = useState<CashBalance | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const pageSize = 50;
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const [bal, movs] = await Promise.all([
        cashApi.balance(),
        cashApi.movements({
          movementType: typeFilter || undefined,
          limit: pageSize,
          offset: page * pageSize,
        }),
      ]);
      setBalance(bal);
      setMovements(movs.items);
      setTotal(movs.total);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [typeFilter, page]);

  return (
    <div>
      <PageHeader
        title="Cash Register"
        subtitle="Track all cash movements in and out"
        actions={
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" /> New Adjustment
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Current Balance</span>
            <Wallet className="h-5 w-5 text-brand-600" />
          </div>
          <div className={`text-2xl font-bold ${(balance?.balance ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {formatCurrency(balance?.balance ?? 0)}
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Total In</span>
            <TrendingUp className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700">{formatCurrency(balance?.total_in ?? 0)}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Total Out</span>
            <TrendingDown className="h-5 w-5 text-red-600" />
          </div>
          <div className="text-2xl font-bold text-red-700">{formatCurrency(Math.abs(balance?.total_out ?? 0))}</div>
        </div>
      </div>

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <select className="input max-w-xs" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}>
            {MOVEMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <span className="text-sm text-slate-500 ml-auto">{total} movement{total === 1 ? '' : 's'} total</span>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : movements.length === 0 ? (
        <EmptyState title="No cash movements" message="Cash movements are created automatically from sales, expenses, advances, and payments. Use 'New Adjustment' for opening balance or manual entries." icon={<Wallet className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Date</th>
                <th className="text-left px-4 py-3 font-semibold">Type</th>
                <th className="text-left px-4 py-3 font-semibold">Description</th>
                <th className="text-left px-4 py-3 font-semibold">Entered By</th>
                <th className="text-right px-4 py-3 font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-700">{formatDateTime(m.date)}</td>
                  <td className="px-4 py-2">
                    {m.amount >= 0 ? (
                      <span className="badge-success"><ArrowDownToLine className="h-3 w-3 inline mr-1" />{m.movement_type}</span>
                    ) : (
                      <span className="badge-danger"><ArrowUpFromLine className="h-3 w-3 inline mr-1" />{m.movement_type}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{m.description || '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{m.entered_by_name || '—'}</td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${m.amount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {m.amount >= 0 ? '+' : ''}{formatCurrency(m.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <AdjustmentModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}
    </div>
  );
}

function AdjustmentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    movementType: 'opening' as 'opening' | 'income_in' | 'adjustment_in' | 'adjustment_out' | 'transfer',
    amount: 0,
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const isIn = ['opening', 'income_in', 'adjustment_in'].includes(form.movementType);

  const handleSubmit = async () => {
    if (!form.amount || form.amount <= 0) { pushToast('warning', 'Amount must be positive.'); return; }
    if (!form.description.trim()) { pushToast('warning', 'Description is required.'); return; }
    setSaving(true);
    try {
      const result = await cashApi.adjustment({
        date: form.date,
        movementType: form.movementType,
        amount: Number(form.amount),
        description: form.description,
      });
      pushToast('success', `Cash ${form.movementType} recorded: ${formatCurrency(result.amount)}`);
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
      title="Cash Adjustment"
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Type *</label>
          <select className="input" value={form.movementType} onChange={(e) => setForm({ ...form, movementType: e.target.value as any })}>
            <option value="opening">Opening Balance (cash IN)</option>
            <option value="income_in">Other Income (cash IN)</option>
            <option value="adjustment_in">Adjustment IN</option>
            <option value="adjustment_out">Adjustment OUT (expense)</option>
            <option value="transfer">Bank Transfer</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className="label">Amount (Rs.) *</label>
            <input type="number" min={0.01} step={0.01} className="input" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <label className="label">Description *</label>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={isIn ? 'e.g. Opening cash from previous day' : 'e.g. Petty cash for tea'} />
        </div>
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
          {isIn
            ? <span>This will <strong>add</strong> {form.amount || '...'} Rs. to the cash register.</span>
            : <span>This will <strong>deduct</strong> {form.amount || '...'} Rs. from the cash register.</span>}
        </div>
      </div>
    </Modal>
  );
}
