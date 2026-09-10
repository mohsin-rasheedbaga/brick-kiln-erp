import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import {
  stock as stockApi, brickCategories as catApi, batches as batchApi,
} from '../lib/ipc';
import type { StockBalance, StockMovement, BrickCategory, Batch } from '../types';
import { formatNumber, formatDate } from '../lib/utils';
import { Plus, Boxes, ArrowDownCircle, ArrowUpCircle, History } from 'lucide-react';

type Tab = 'balance' | 'adjustments' | 'history';

export default function StockPage() {
  const [tab, setTab] = useState<Tab>('balance');
  const [balance, setBalance] = useState<StockBalance[]>([]);
  const [adjustments, setAdjustments] = useState<StockMovement[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [categories, setCategories] = useState<BrickCategory[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const [bal, adjs, movs] = await Promise.all([
        stockApi.balance(),
        stockApi.adjustmentsList({ limit: 100 }),
        stockApi.movements({ limit: 100 }),
      ]);
      setBalance(bal);
      setAdjustments(adjs.items);
      setMovements(movs.items);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    catApi.list(false, false).then(setCategories).catch(() => {});
    batchApi.list({ limit: 100 }).then((r) => setBatches(r.items)).catch(() => {});
    load();
  }, []);

  return (
    <div>
      <PageHeader
        title="Stock Management"
        subtitle="View stock levels, manual adjustments, and full movement history"
        actions={
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" /> New Adjustment
          </button>
        }
      />

      <div className="card p-3 mb-4">
        <div className="flex bg-slate-100 rounded-md p-0.5 w-fit">
          <TabBtn active={tab === 'balance'} onClick={() => setTab('balance')} icon={Boxes} label="Stock Levels" />
          <TabBtn active={tab === 'adjustments'} onClick={() => setTab('adjustments')} icon={History} label="Adjustments" />
          <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={History} label="Movement History" />
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : tab === 'balance' ? (
        <StockBalanceView balance={balance} />
      ) : tab === 'adjustments' ? (
        <AdjustmentsView items={adjustments} />
      ) : (
        <HistoryView items={movements} />
      )}

      {showModal && (
        <AdjustmentModal
          categories={categories}
          batches={batches}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded transition ${active ? 'bg-white shadow text-brand-700' : 'text-slate-600 hover:text-slate-900'}`}
    >
      <Icon className="h-4 w-4 inline mr-1.5" />{label}
    </button>
  );
}

function StockBalanceView({ balance }: { balance: StockBalance[] }) {
  const totalQty = balance.reduce((s, b) => s + b.quantity, 0);
  const totalValue = balance.reduce((s, b) => s + (b.quantity * b.default_selling_rate), 0);
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="card p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Total Stock</div>
          <div className="text-2xl font-bold text-slate-900">{formatNumber(totalQty)}</div>
          <div className="text-xs text-slate-500 mt-1">bricks across {balance.length} categories</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Estimated Value</div>
          <div className="text-2xl font-bold text-emerald-700">Rs. {formatNumber(totalValue)}</div>
          <div className="text-xs text-slate-500 mt-1">at default selling rates</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Lowest Stock</div>
          <div className="text-2xl font-bold text-amber-700">
            {balance.length > 0 ? formatNumber(Math.min(...balance.map((b) => b.quantity))) : '0'}
          </div>
          <div className="text-xs text-slate-500 mt-1">lowest category quantity</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Code</th>
              <th className="text-left px-4 py-3 font-semibold">Category</th>
              <th className="text-right px-4 py-3 font-semibold">Quantity</th>
              <th className="text-right px-4 py-3 font-semibold">Default Rate</th>
              <th className="text-right px-4 py-3 font-semibold">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {balance.map((b) => (
              <tr key={b.category_id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{b.category_code}</td>
                <td className="px-4 py-2 font-medium text-slate-900">{b.category_name}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{formatNumber(b.quantity)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">Rs. {b.default_selling_rate.toFixed(0)}</td>
                <td className="px-4 py-2 text-right font-mono text-emerald-700">Rs. {formatNumber(b.quantity * b.default_selling_rate)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50">
            <tr>
              <td colSpan={2} className="px-4 py-2 font-semibold text-slate-700">Total</td>
              <td className="px-4 py-2 text-right font-mono font-bold text-slate-900">{formatNumber(totalQty)}</td>
              <td></td>
              <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">Rs. {formatNumber(totalValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function AdjustmentsView({ items }: { items: StockMovement[] }) {
  if (items.length === 0) return <EmptyState title="No manual adjustments" message="Click 'New Adjustment' to record a stock correction, opening balance, or wastage." icon={<Plus className="h-8 w-8" />} />;
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
          <tr>
            <th className="text-left px-4 py-3 font-semibold">Date</th>
            <th className="text-left px-4 py-3 font-semibold">Category</th>
            <th className="text-left px-4 py-3 font-semibold">Direction</th>
            <th className="text-right px-4 py-3 font-semibold">Quantity</th>
            <th className="text-left px-4 py-3 font-semibold">Reason / Notes</th>
            <th className="text-left px-4 py-3 font-semibold">By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((m) => (
            <tr key={m.id} className="hover:bg-slate-50">
              <td className="px-4 py-2 text-slate-700">{formatDate(m.date)}</td>
              <td className="px-4 py-2 font-medium text-slate-900">{m.category_name || '—'}</td>
              <td className="px-4 py-2">
                {m.movement_type === 'adjustment_in'
                  ? <span className="badge-success"><ArrowDownCircle className="h-3 w-3 inline mr-1" />IN</span>
                  : <span className="badge-danger"><ArrowUpCircle className="h-3 w-3 inline mr-1" />OUT</span>}
              </td>
              <td className={`px-4 py-2 text-right font-mono font-semibold ${m.quantity >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {m.quantity >= 0 ? '+' : ''}{formatNumber(m.quantity)}
              </td>
              <td className="px-4 py-2 text-xs text-slate-600">{m.notes || '—'}</td>
              <td className="px-4 py-2 text-xs text-slate-500">{m.entered_by_name || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryView({ items }: { items: StockMovement[] }) {
  if (items.length === 0) return <EmptyState title="No stock movements yet" message="Stock movements are created automatically from sales, production, and manual adjustments." icon={<History className="h-8 w-8" />} />;
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
          <tr>
            <th className="text-left px-4 py-3 font-semibold">Date</th>
            <th className="text-left px-4 py-3 font-semibold">Category</th>
            <th className="text-left px-4 py-3 font-semibold">Type</th>
            <th className="text-right px-4 py-3 font-semibold">Quantity</th>
            <th className="text-left px-4 py-3 font-semibold">Reference</th>
            <th className="text-left px-4 py-3 font-semibold">Notes</th>
            <th className="text-left px-4 py-3 font-semibold">By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((m) => (
            <tr key={m.id} className="hover:bg-slate-50">
              <td className="px-4 py-2 text-slate-700">{formatDate(m.date)}</td>
              <td className="px-4 py-2 font-medium text-slate-900">{m.category_name || '—'}</td>
              <td className="px-4 py-2"><span className="badge-info">{m.movement_type.replace(/_/g, ' ')}</span></td>
              <td className={`px-4 py-2 text-right font-mono font-semibold ${m.quantity >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {m.quantity >= 0 ? '+' : ''}{formatNumber(m.quantity)}
              </td>
              <td className="px-4 py-2 text-xs text-slate-500">{m.reference_type || '—'} {m.batch_number ? `(${m.batch_number})` : ''}</td>
              <td className="px-4 py-2 text-xs text-slate-600">{m.notes || '—'}</td>
              <td className="px-4 py-2 text-xs text-slate-500">{m.entered_by_name || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdjustmentModal({ categories, batches, onClose, onSaved }: { categories: BrickCategory[]; batches: Batch[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    categoryId: '',
    direction: 'in' as 'in' | 'out',
    quantity: 0,
    reason: '',
    batchId: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    if (!form.categoryId) { pushToast('warning', 'Brick category is required.'); return; }
    if (!Number.isInteger(form.quantity) || form.quantity <= 0) { pushToast('warning', 'Quantity must be a positive integer.'); return; }
    if (!form.reason.trim()) { pushToast('warning', 'Reason is required.'); return; }
    setSaving(true);
    try {
      await stockApi.adjustment({
        date: form.date,
        categoryId: form.categoryId,
        direction: form.direction,
        quantity: Number(form.quantity),
        reason: form.reason,
        batchId: form.batchId || undefined,
        notes: form.notes || undefined,
      });
      pushToast('success', `Stock adjustment recorded: ${form.direction.toUpperCase()} ${form.quantity}`);
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
      title="Stock Adjustment"
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Save Adjustment'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className="label">Direction *</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, direction: 'in' })}
                className={`flex-1 py-2 px-3 rounded-md border text-sm font-medium ${form.direction === 'in' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-600'}`}
              >
                <ArrowDownCircle className="h-4 w-4 inline mr-1" /> IN (+)
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, direction: 'out' })}
                className={`flex-1 py-2 px-3 rounded-md border text-sm font-medium ${form.direction === 'out' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-300 text-slate-600'}`}
              >
                <ArrowUpCircle className="h-4 w-4 inline mr-1" /> OUT (−)
              </button>
            </div>
          </div>
        </div>
        <div>
          <label className="label">Brick Category *</label>
          <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Select category...</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Quantity *</label>
            <input type="number" min={1} step={1} className="input" value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Batch (optional)</label>
            <select className="input" value={form.batchId} onChange={(e) => setForm({ ...form, batchId: e.target.value })}>
              <option value="">— None —</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_number}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Reason *</label>
          <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Opening stock, broken pieces, recount correction" />
        </div>
        <div>
          <label className="label">Additional Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className={`p-3 rounded-md text-xs ${form.direction === 'in' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
          <strong>{form.direction === 'in' ? 'Increase' : 'Decrease'}</strong> stock of selected category by <strong>{form.quantity || 0}</strong> bricks.
          This will be recorded in the audit log with your name and reason.
        </div>
      </div>
    </Modal>
  );
}
