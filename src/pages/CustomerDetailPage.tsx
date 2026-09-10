import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Card';
import { Spinner, EmptyState, ErrorState } from '../components/Feedback';
import { Modal } from '../components/Modal';
import { useToastStore } from '../stores/toast';
import { customers as custApi, customerPayments as payApi } from '../lib/ipc';
import type { CustomerLedger, CustomerPayment } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';
import { ArrowLeft, Plus, Wallet } from 'lucide-react';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [showPayment, setShowPayment] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setLedger(await custApi.ledger(id));
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [id]);

  if (loading) return <Spinner className="mx-auto mt-12" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!ledger) return <EmptyState title="Customer not found" />;

  const { customer, invoices, payments, totals } = ledger;

  return (
    <div>
      <PageHeader
        title={customer.name}
        subtitle={`${customer.customer_code} · ${customer.mobile || 'no mobile'}`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /> Back</button>
            <button className="btn-primary" onClick={() => setShowPayment(true)}><Wallet className="h-4 w-4" /> Receive Payment</button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Customer Info</h2>
          <dl className="text-sm space-y-2">
            <div className="flex justify-between"><dt className="text-slate-500">Code</dt><dd className="font-mono text-slate-900">{customer.customer_code}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Mobile</dt><dd className="text-slate-900">{customer.mobile || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Phone</dt><dd className="text-slate-900">{customer.phone || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">CNIC</dt><dd className="font-mono text-slate-900">{customer.cnic || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Credit Limit</dt><dd className="text-slate-900">{customer.credit_limit ? formatCurrency(customer.credit_limit) : 'No limit'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Address</dt><dd className="text-slate-900 text-right max-w-[60%]">{customer.address || '—'}</dd></div>
          </dl>
        </div>

        <div className="card p-5 lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Ledger Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="p-3 border border-slate-200 rounded-md">
              <div className="text-xs text-slate-500 uppercase tracking-wider">Opening Balance</div>
              <div className="text-lg font-bold text-slate-900">{formatCurrency(totals.opening_balance)}</div>
            </div>
            <div className="p-3 border border-slate-200 rounded-md">
              <div className="text-xs text-slate-500 uppercase tracking-wider">Total Sales</div>
              <div className="text-lg font-bold text-slate-900">{formatCurrency(totals.total_sales)}</div>
            </div>
            <div className="p-3 border border-emerald-200 bg-emerald-50 rounded-md">
              <div className="text-xs text-emerald-700 uppercase tracking-wider">Total Paid</div>
              <div className="text-lg font-bold text-emerald-700">{formatCurrency(totals.total_paid)}</div>
            </div>
            <div className={`p-3 border rounded-md ${totals.current_balance > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className={`text-xs uppercase tracking-wider ${totals.current_balance > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>Current Balance</div>
              <div className={`text-lg font-bold ${totals.current_balance > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatCurrency(totals.current_balance)}</div>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Formula: Opening Balance + Total Sales − Total Paid = Current Balance
            <br />
            {formatCurrency(totals.opening_balance)} + {formatCurrency(totals.total_sales)} − {formatCurrency(totals.total_paid)} = <span className="font-semibold">{formatCurrency(totals.current_balance)}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-900">Invoices ({invoices.length})</h2>
          </div>
          {invoices.length === 0 ? <EmptyState title="No invoices" /> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Date</th>
                  <th className="text-left px-4 py-2 font-semibold">Invoice #</th>
                  <th className="text-right px-4 py-2 font-semibold">Total</th>
                  <th className="text-right px-4 py-2 font-semibold">Paid</th>
                  <th className="text-right px-4 py-2 font-semibold">Remaining</th>
                  <th className="text-left px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className={inv.is_void ? 'opacity-50' : ''}>
                    <td className="px-4 py-2 text-slate-700">{formatDate(inv.date)}</td>
                    <td className="px-4 py-2 font-mono text-slate-900">{inv.invoice_number}{inv.is_void && ' (void)'}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-emerald-50">
            <h2 className="text-sm font-semibold text-emerald-900">Payments ({payments.length})</h2>
          </div>
          {payments.length === 0 ? <EmptyState title="No payments" /> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Date</th>
                  <th className="text-left px-4 py-2 font-semibold">Receipt #</th>
                  <th className="text-right px-4 py-2 font-semibold">Amount</th>
                  <th className="text-left px-4 py-2 font-semibold">Method</th>
                  <th className="text-left px-4 py-2 font-semibold">Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-slate-700">{formatDate(p.date)}</td>
                    <td className="px-4 py-2 font-mono text-slate-900">{p.receipt_number}</td>
                    <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-2"><span className="badge-info">{p.payment_method}</span></td>
                    <td className="px-4 py-2 text-xs text-slate-500 font-mono">{p.reference_no || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showPayment && (
        <ReceivePaymentModal
          customerId={customer.id}
          customerName={customer.name}
          currentBalance={totals.current_balance}
          onClose={() => setShowPayment(false)}
          onSaved={() => { setShowPayment(false); load(); }}
        />
      )}
    </div>
  );
}

function ReceivePaymentModal({ customerId, customerName, currentBalance, onClose, onSaved }: {
  customerId: string; customerName: string; currentBalance: number;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: currentBalance > 0 ? currentBalance : 0,
    paymentMethod: 'cash',
    referenceNo: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    if (!form.amount || form.amount <= 0) { pushToast('warning', 'Amount must be positive.'); return; }
    setSaving(true);
    try {
      const result = await payApi.create({
        date: form.date,
        customerId,
        amount: Number(form.amount),
        paymentMethod: form.paymentMethod,
        referenceNo: form.referenceNo || undefined,
        notes: form.notes || undefined,
      });
      pushToast('success', `Payment received: ${result.receipt_number}`);
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
      title={`Receive Payment from ${customerName}`}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : <><Wallet className="h-4 w-4" /> Receive</>}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm">
          <span className="text-amber-700">Current outstanding balance: </span>
          <span className="font-bold text-amber-900">{formatCurrency(currentBalance)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className="label">Amount (Rs.) *</label>
            <input type="number" step={0.01} min={0.01} className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
          </div>
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
          <label className="label">Reference No (cheque / txn id)</label>
          <input className="input" value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
