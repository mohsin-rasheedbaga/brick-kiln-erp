import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import {
  expenses as expApi, expenseCategories as catApi,
  departments as deptApi, batches as batchApi,
} from '../lib/ipc';
import type { Expense, ExpenseCategory, Department, Batch } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';
import { Plus, Ban, Search, FileText } from 'lucide-react';

export default function ExpensesPage() {
  const [items, setItems] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const pageSize = 25;
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const r = await expApi.list({
        search: search || undefined,
        categoryId: categoryFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
      setItems(r.items);
      setTotal(r.total);
      setTotalAmount(r.totalAmount);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { catApi.list(false).then(setCategories).catch(() => {}); }, []);
  useEffect(() => { load(); }, [search, categoryFilter, page]);

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={`${total} expense${total === 1 ? '' : 's'} · Total: ${formatCurrency(totalAmount)}`}
        actions={
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" /> New Expense
          </button>
        }
      />

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search by expense #, paid to, or description..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          <select className="input max-w-xs" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No expenses found" message="Record your first expense to begin." icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Date</th>
                <th className="text-left px-4 py-3 font-semibold">Expense #</th>
                <th className="text-left px-4 py-3 font-semibold">Category</th>
                <th className="text-left px-4 py-3 font-semibold">Paid To</th>
                <th className="text-left px-4 py-3 font-semibold">Department / Batch</th>
                <th className="text-right px-4 py-3 font-semibold">Amount</th>
                <th className="text-left px-4 py-3 font-semibold">Method</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-700">{formatDate(e.date)}</td>
                  <td className="px-4 py-2 font-mono text-slate-900">{e.expense_number}</td>
                  <td className="px-4 py-2 text-slate-700">{e.category_name}</td>
                  <td className="px-4 py-2 text-slate-700">{e.paid_to || '—'}</td>
                  <td className="px-4 py-2 text-slate-700 text-xs">
                    {e.department_name && <div>{e.department_name}</div>}
                    {e.batch_number && <div className="font-mono text-slate-500">{e.batch_number}</div>}
                    {!e.department_name && !e.batch_number && '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-red-700">{formatCurrency(e.amount)}</td>
                  <td className="px-4 py-2"><span className="badge-info">{e.payment_method}</span></td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setVoidTarget(e)} className="btn-ghost btn-sm text-red-600" title="Void">
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr>
                <td colSpan={5} className="px-4 py-2 font-semibold text-slate-700">Total ({total} entries)</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-red-700">{formatCurrency(totalAmount)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showModal && (
        <NewExpenseModal categories={categories} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}

      <VoidExpenseDialog expense={voidTarget} onClose={() => setVoidTarget(null)} onDone={() => { setVoidTarget(null); load(); }} />
    </div>
  );
}

function NewExpenseModal({ categories, onClose, onSaved }: { categories: ExpenseCategory[]; onClose: () => void; onSaved: () => void }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    categoryId: '',
    departmentId: '',
    batchId: '',
    amount: 0,
    paymentMethod: 'cash',
    referenceNo: '',
    paidTo: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    Promise.all([deptApi.list(false), batchApi.list({ limit: 100 })])
      .then(([ds, bs]) => { setDepartments(ds); setBatches(bs.items); })
      .catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!form.categoryId) { pushToast('warning', 'Category is required.'); return; }
    if (!form.amount || form.amount <= 0) { pushToast('warning', 'Amount must be positive.'); return; }
    setSaving(true);
    try {
      await expApi.create({
        date: form.date,
        categoryId: form.categoryId,
        departmentId: form.departmentId || undefined,
        batchId: form.batchId || undefined,
        amount: Number(form.amount),
        paymentMethod: form.paymentMethod,
        referenceNo: form.referenceNo || undefined,
        paidTo: form.paidTo || undefined,
        description: form.description || undefined,
      });
      pushToast('success', 'Expense recorded.');
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
      title="New Expense"
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : <><FileText className="h-4 w-4" /> Record</>}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div>
          <label className="label">Category *</label>
          <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Select...</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
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
            <option value="credit">Credit</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="label">Department (optional)</label>
          <select className="input" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">— None —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Batch (optional)</label>
          <select className="input" value={form.batchId} onChange={(e) => setForm({ ...form, batchId: e.target.value })}>
            <option value="">— None —</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_number}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Paid To</label>
          <input className="input" value={form.paidTo} onChange={(e) => setForm({ ...form, paidTo: e.target.value })} placeholder="e.g. XYZ Trader" />
        </div>
        <div>
          <label className="label">Reference No</label>
          <input className="input" value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} placeholder="Bill #, cheque #" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description</label>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </div>
      <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
        <strong>Note:</strong> If payment method is "Cash", the amount will be deducted from the cash register.
        {form.batchId && ' The cost will also be added to the batch totals.'}
      </div>
    </Modal>
  );
}

function VoidExpenseDialog({ expense, onClose, onDone }: { expense: Expense | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  if (!expense) return null;

  const handleVoid = async () => {
    if (!reason.trim()) { pushToast('warning', 'Reason is required.'); return; }
    setSaving(true);
    try {
      await expApi.void(expense.id, reason);
      pushToast('success', `Expense ${expense.expense_number} voided.`);
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
      title={`Void Expense ${expense.expense_number}`}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-danger" onClick={handleVoid} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Void Expense'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          Voiding this expense will reverse the cash register entry and batch cost impact (if linked to a batch).
        </div>
        <div>
          <label className="label">Reason *</label>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
