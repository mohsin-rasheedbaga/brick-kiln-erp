import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import {
  sales as salesApi, customers as custApi, batches as batchApi,
  brickCategories as catApi, stock as stockApi,
} from '../lib/ipc';
import type { SalesInvoice, Customer, Batch, BrickCategory, StockBalance } from '../types';
import { formatCurrency, formatDate, formatNumber } from '../lib/utils';
import { Plus, Eye, Ban, Search, FileText, Trash2, Plus as PlusIcon, Boxes } from 'lucide-react';

export default function SalesPage() {
  const [items, setItems] = useState<SalesInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [viewing, setViewing] = useState<SalesInvoice | null>(null);
  const [voidTarget, setVoidTarget] = useState<SalesInvoice | null>(null);
  const [stockBalance, setStockBalance] = useState<StockBalance[]>([]);
  const pageSize = 25;
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const [r, stock] = await Promise.all([
        salesApi.list({
          search: search || undefined,
          status: statusFilter || undefined,
          limit: pageSize,
          offset: page * pageSize,
        }),
        stockApi.balance(),
      ]);
      setItems(r.items);
      setTotal(r.total);
      setStockBalance(stock);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [search, statusFilter, page]);

  const totalStock = stockBalance.reduce((s, b) => s + b.quantity, 0);
  const totalStockValue = stockBalance.reduce((s, b) => s + (b.quantity * b.default_selling_rate), 0);

  return (
    <div>
      <PageHeader
        title="Sales Invoices"
        subtitle={`${total} invoice${total === 1 ? '' : 's'}`}
        actions={
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" /> New Invoice
          </button>
        }
      />

      {/* Baked Brick Stock Panel */}
      <div className="card p-4 mb-4 bg-emerald-50 border-emerald-200">
        <div className="flex items-center gap-3 mb-3">
          <Boxes className="h-5 w-5 text-emerald-700" />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-emerald-900">Baked Brick Stock on Hand</h2>
            <p className="text-xs text-emerald-700">
              {formatNumber(totalStock)} bricks · Est. value: {formatCurrency(totalStockValue)}
            </p>
          </div>
        </div>
        {stockBalance.length === 0 ? (
          <p className="text-sm text-emerald-700 text-center py-2">No stock available. Record production entries (baked brick unloading) to add stock.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {stockBalance.map((s) => (
              <div key={s.category_id} className={`p-3 rounded-md border ${s.quantity > 0 ? 'bg-white border-emerald-200' : 'bg-slate-100 border-slate-200 opacity-60'}`}>
                <div className="text-xs text-slate-500 uppercase tracking-wider">{s.category_name}</div>
                <div className={`text-lg font-bold ${s.quantity > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                  {formatNumber(s.quantity)}
                </div>
                <div className="text-[10px] text-slate-400">@ {formatCurrency(s.default_selling_rate)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search by invoice #, customer name or code..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          <select className="input max-w-xs" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}>
            <option value="">All statuses</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="overpaid">Overpaid</option>
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No invoices yet" message="Create your first sales invoice to begin." icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Date</th>
                <th className="text-left px-4 py-3 font-semibold">Invoice #</th>
                <th className="text-left px-4 py-3 font-semibold">Customer</th>
                <th className="text-right px-4 py-3 font-semibold">Total</th>
                <th className="text-right px-4 py-3 font-semibold">Paid</th>
                <th className="text-right px-4 py-3 font-semibold">Remaining</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-700">{formatDate(inv.date)}</td>
                  <td className="px-4 py-2 font-mono text-slate-900">{inv.invoice_number}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-900">{inv.customer_name}</div>
                    <div className="text-xs text-slate-500 font-mono">{inv.customer_code}</div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(inv.total)}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatCurrency(inv.paid)}</td>
                  <td className="px-4 py-2 text-right font-mono text-amber-700">{formatCurrency(inv.remaining)}</td>
                  <td className="px-4 py-2">
                    <span className={
                      inv.payment_status === 'paid' ? 'badge-success'
                      : inv.payment_status === 'partial' ? 'badge-warning'
                      : inv.payment_status === 'overpaid' ? 'badge-info'
                      : 'badge-default'
                    }>{inv.payment_status}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={async () => {
                        const full = await salesApi.get(inv.id);
                        setViewing(full);
                      }} className="btn-ghost btn-sm" title="View"><Eye className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setVoidTarget(inv)} className="btn-ghost btn-sm text-red-600" title="Void"><Ban className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <NewInvoiceModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}

      {viewing && (
        <InvoiceViewModal invoice={viewing} onClose={() => setViewing(null)} />
      )}

      {voidTarget && (
        <VoidInvoiceDialog invoice={voidTarget} onClose={() => setVoidTarget(null)} onDone={() => { setVoidTarget(null); load(); }} />
      )}
    </div>
  );
}

function NewInvoiceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [categories, setCategories] = useState<BrickCategory[]>([]);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    customerId: '',
    batchId: '',
    items: [] as Array<{ category_id: string; quantity: number; rate: number }>,
    discount: 0,
    paid: 0,
    paymentMethod: 'cash',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    Promise.all([
      custApi.list({ limit: 1000 }),
      batchApi.list({ limit: 100 }),
      catApi.list(false, true),
    ]).then(([cs, bs, cats]) => {
      setCustomers(cs.items);
      setBatches(bs.items);
      setCategories(cats);
    }).catch(() => {});
  }, []);

  const subtotal = form.items.reduce((s, i) => s + (Number(i.quantity) * Number(i.rate)), 0);
  const total = Math.max(0, subtotal - Number(form.discount || 0));

  const addItem = () => {
    if (categories.length === 0) return;
    setForm({ ...form, items: [...form.items, { category_id: categories[0].id, quantity: 1000, rate: categories[0].default_selling_rate }] });
  };
  const updateItem = (idx: number, field: 'category_id' | 'quantity' | 'rate', value: any) => {
    const newItems = [...form.items];
    (newItems[idx] as any)[field] = field === 'category_id' ? value : Number(value);
    setForm({ ...form, items: newItems });
  };
  const removeItem = (idx: number) => {
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  };

  const handleSubmit = async () => {
    if (!form.customerId) { pushToast('warning', 'Customer is required.'); return; }
    if (form.items.length === 0) { pushToast('warning', 'Add at least one line item.'); return; }
    for (const item of form.items) {
      if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
        pushToast('warning', 'All quantities must be positive integers.');
        return;
      }
    }
    setSaving(true);
    try {
      const result = await salesApi.create({
        date: form.date,
        customerId: form.customerId,
        batchId: form.batchId || undefined,
        items: form.items,
        discount: Number(form.discount) || 0,
        paid: Number(form.paid) || 0,
        paymentMethod: form.paymentMethod,
        notes: form.notes || undefined,
      });
      pushToast('success', `Invoice created: ${result.invoice_number}`);
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
      title="New Sales Invoice"
      size="xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : <><FileText className="h-4 w-4" /> Create Invoice</>}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className="label">Customer *</label>
            <select className="input" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              <option value="">Select customer...</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.customer_code}){c.current_balance ? ` - Bal: ${formatCurrency(c.current_balance)}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Batch (optional)</label>
            <select className="input" value={form.batchId} onChange={(e) => setForm({ ...form, batchId: e.target.value })}>
              <option value="">— None —</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_number} ({b.status})</option>)}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Line Items</label>
            <button className="btn-secondary btn-sm" onClick={addItem} disabled={categories.length === 0}>
              <PlusIcon className="h-3.5 w-3.5" /> Add Item
            </button>
          </div>
          {form.items.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-md">
              Click "Add Item" to add brick categories to this invoice.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Category</th>
                    <th className="text-right px-3 py-2 font-semibold">Quantity</th>
                    <th className="text-right px-3 py-2 font-semibold">Rate</th>
                    <th className="text-right px-3 py-2 font-semibold">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {form.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">
                        <select className="input" value={item.category_id} onChange={(e) => updateItem(idx, 'category_id', e.target.value)}>
                          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={1} step={1} className="input text-right" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={0} step={0.01} className="input text-right" value={item.rate} onChange={(e) => updateItem(idx, 'rate', e.target.value)} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{formatCurrency(Number(item.quantity) * Number(item.rate))}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => removeItem(idx)} className="btn-ghost btn-sm text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="space-y-2 p-3 bg-slate-50 border border-slate-200 rounded-md">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Subtotal</span>
              <span className="font-mono text-slate-900">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm items-center">
              <span className="text-slate-500">Discount</span>
              <input type="number" min={0} step={0.01} className="input w-32 text-right py-1" value={form.discount} onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} />
            </div>
            <div className="flex justify-between text-base font-semibold border-t border-slate-200 pt-2">
              <span className="text-slate-700">Total</span>
              <span className="font-mono text-slate-900">{formatCurrency(total)}</span>
            </div>
            <div className="flex justify-between text-sm items-center">
              <span className="text-slate-500">Paid Now</span>
              <input type="number" min={0} step={0.01} className="input w-32 text-right py-1" value={form.paid} onChange={(e) => setForm({ ...form, paid: Number(e.target.value) })} />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Remaining</span>
              <span className="font-mono text-amber-700">{formatCurrency(total - Number(form.paid || 0))}</span>
            </div>
            <div>
              <label className="label">Payment Method</label>
              <select className="input py-1" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="cheque">Cheque</option>
                <option value="credit">Credit (later)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
          <strong>Note:</strong> Creating an invoice will <strong>automatically deduct stock</strong> for each brick category. If "Paid Now" is greater than 0, a customer payment receipt will also be created and cash register updated.
        </div>
      </div>
    </Modal>
  );
}

function InvoiceViewModal({ invoice, onClose }: { invoice: SalesInvoice; onClose: () => void }) {
  return (
    <Modal open={true} onClose={onClose} title={`Invoice ${invoice.invoice_number}`} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-500">Date:</span> <span className="font-medium text-slate-900">{formatDate(invoice.date)}</span></div>
          <div><span className="text-slate-500">Customer:</span> <span className="font-medium text-slate-900">{invoice.customer_name}</span></div>
          <div><span className="text-slate-500">Batch:</span> <span className="font-medium text-slate-900">{invoice.batch_number || '—'}</span></div>
          <div><span className="text-slate-500">Sales User:</span> <span className="font-medium text-slate-900">{invoice.sales_user_name || '—'}</span></div>
        </div>

        <table className="w-full text-sm border border-slate-200 rounded-md">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Category</th>
              <th className="text-right px-3 py-2 font-semibold">Qty</th>
              <th className="text-right px-3 py-2 font-semibold">Rate</th>
              <th className="text-right px-3 py-2 font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(invoice.items || []).map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2 text-slate-900">{item.category_name || '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNumber(item.quantity)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatCurrency(item.rate)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(item.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50">
            <tr>
              <td colSpan={3} className="px-3 py-2 text-right font-semibold text-slate-700">Subtotal</td>
              <td className="px-3 py-2 text-right font-mono">{formatCurrency(invoice.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-3 py-2 text-right text-slate-500">Discount</td>
              <td className="px-3 py-2 text-right font-mono text-red-700">- {formatCurrency(invoice.discount)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-3 py-2 text-right font-bold text-slate-900">Total</td>
              <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{formatCurrency(invoice.total)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-3 py-2 text-right text-emerald-700">Paid</td>
              <td className="px-3 py-2 text-right font-mono text-emerald-700">{formatCurrency(invoice.paid)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-3 py-2 text-right font-semibold text-amber-700">Remaining</td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700">{formatCurrency(invoice.remaining)}</td>
            </tr>
          </tfoot>
        </table>

        {invoice.notes && (
          <div>
            <div className="text-xs text-slate-500 uppercase mb-1">Notes</div>
            <div className="text-sm text-slate-700">{invoice.notes}</div>
          </div>
        )}

        <div className="text-right">
          <span className={
            invoice.payment_status === 'paid' ? 'badge-success'
            : invoice.payment_status === 'partial' ? 'badge-warning'
            : invoice.payment_status === 'overpaid' ? 'badge-info'
            : 'badge-default'
          }>{invoice.payment_status.toUpperCase()}</span>
        </div>
      </div>
    </Modal>
  );
}

function VoidInvoiceDialog({ invoice, onClose, onDone }: { invoice: SalesInvoice; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleVoid = async () => {
    if (!reason.trim()) { pushToast('warning', 'Reason is required.'); return; }
    setSaving(true);
    try {
      await salesApi.void(invoice.id, reason);
      pushToast('success', `Invoice ${invoice.invoice_number} voided. Stock & payments reversed.`);
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
      title={`Void Invoice ${invoice.invoice_number}`}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-danger" onClick={handleVoid} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Void Invoice'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          <strong>Warning:</strong> Voiding this invoice will:
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            <li>Mark it as voided (preserved in audit log)</li>
            <li>Reverse stock deductions for all line items</li>
            <li>Void any linked customer payments</li>
            <li>Reverse cash register entries</li>
          </ul>
        </div>
        <div>
          <label className="label">Reason *</label>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer returned bricks; incorrect entry..." />
        </div>
      </div>
    </Modal>
  );
}
