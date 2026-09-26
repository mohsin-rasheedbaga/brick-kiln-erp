import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { investors as invApi } from '../lib/ipc';
import type { Investor, InvestorTransaction } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';
import { Plus, Edit2, Eye, Wallet, TrendingUp, Calculator } from 'lucide-react';

export default function InvestorsPage() {
  const [items, setItems] = useState<Investor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Investor | null>(null);
  const [viewing, setViewing] = useState<Investor | null>(null);
  const [viewingTxns, setViewingTxns] = useState<InvestorTransaction[]>([]);
  const [showProfitModal, setShowProfitModal] = useState(false);
  const [profitData, setProfitData] = useState<any>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const list = await invApi.list({ search: search || undefined, includeInactive: true });
      setItems(list);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [search]);

  const totalInvestment = items.reduce((s, i) => s + (i.current_balance || 0), 0);
  const totalProfitShare = items.reduce((s, i) => s + i.profit_share_pct, 0);

  return (
    <div>
      <PageHeader
        title="Investors"
        subtitle={`${items.length} investors — Total: ${formatCurrency(totalInvestment)} — Profit share: ${totalProfitShare}%`}
        actions={
          <>
            <button className="btn-secondary" onClick={async () => {
              const month = new Date().toISOString().slice(0, 7);
              try {
                const r = await invApi.monthlyProfit(month);
                setProfitData({ ...r, month });
                setShowProfitModal(true);
              } catch (err: any) { pushToast('error', err.message); }
            }}>
              <Calculator className="h-4 w-4" /> Monthly Profit
            </button>
            <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
              <Plus className="h-4 w-4" /> Add Investor
            </button>
          </>
        }
      />

      <div className="card p-3 mb-4">
        <input className="input" placeholder="Search investors..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No investors found" message="Add investors to track investments and profit shares." icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Code</th>
                <th className="text-left px-4 py-3 font-semibold">Name</th>
                <th className="text-right px-4 py-3 font-semibold">Investment</th>
                <th className="text-right px-4 py-3 font-semibold">Balance</th>
                <th className="text-right px-4 py-3 font-semibold">Profit %</th>
                <th className="text-right px-4 py-3 font-semibold">Profit Paid</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{inv.investor_code}</td>
                  <td className="px-4 py-2 font-medium text-slate-900">{inv.name}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(inv.total_investment)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700">{formatCurrency(inv.current_balance || 0)}</td>
                  <td className="px-4 py-2 text-right font-mono text-blue-700">{inv.profit_share_pct}%</td>
                  <td className="px-4 py-2 text-right font-mono text-purple-700">{formatCurrency(inv.total_profit_paid || 0)}</td>
                  <td className="px-4 py-2">
                    {inv.status === 'active' ? <span className="badge-success">Active</span> : <span className="badge-default">Inactive</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={async () => {
                        try {
                          const r = await invApi.get(inv.id);
                          setViewing(r.investor);
                          setViewingTxns(r.transactions);
                        } catch (err: any) { pushToast('error', err.message); }
                      }} className="btn-ghost btn-sm" title="View account">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => { setEditing(inv); setShowModal(true); }} className="btn-ghost btn-sm" title="Edit">
                        <Edit2 className="h-3.5 w-3.5" />
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
        <InvestorModal investor={editing} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}

      {viewing && (
        <InvestorDetailModal
          investor={viewing}
          transactions={viewingTxns}
          onClose={() => { setViewing(null); setViewingTxns([]); }}
          onTransactionAdded={() => {
            invApi.get(viewing.id).then((r) => { setViewing(r.investor); setViewingTxns(r.transactions); });
            load();
          }}
        />
      )}

      {showProfitModal && profitData && (
        <ProfitModal data={profitData} onClose={() => setShowProfitModal(false)} />
      )}
    </div>
  );
}

function InvestorModal({ investor, onClose, onSaved }: {
  investor: Investor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: investor?.name ?? '',
    mobile: investor?.mobile ?? '',
    address: investor?.address ?? '',
    cnic: investor?.cnic ?? '',
    profit_share_pct: investor?.profit_share_pct ?? 0,
    initial_investment: 0,
    notes: investor?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    if (!form.name.trim()) { pushToast('warning', 'Name is required.'); return; }
    setSaving(true);
    try {
      if (investor) {
        await invApi.update(investor.id, {
          name: form.name, mobile: form.mobile, address: form.address, cnic: form.cnic,
          profit_share_pct: Number(form.profit_share_pct), notes: form.notes,
        });
        pushToast('success', 'Investor updated.');
      } else {
        await invApi.create({
          name: form.name, mobile: form.mobile, address: form.address, cnic: form.cnic,
          profit_share_pct: Number(form.profit_share_pct), initial_investment: Number(form.initial_investment),
          notes: form.notes,
        });
        pushToast('success', 'Investor created.');
      }
      onSaved();
    } catch (err: any) {
      pushToast('error', err.message);
      setSaving(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title={investor ? `Edit ${investor.name}` : 'New Investor'} size="md"
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? <Spinner size="sm" className="border-white" /> : investor ? 'Save' : 'Create'}
        </button>
      </>}>
      <div className="space-y-3">
        <div><label className="label">Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Mobile</label><input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
          <div><label className="label">CNIC</label><input className="input" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} /></div>
        </div>
        <div><label className="label">Address</label><textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Profit Share %</label>
            <input type="number" min={0} max={100} step={0.5} className="input" value={form.profit_share_pct} onChange={(e) => setForm({ ...form, profit_share_pct: Number(e.target.value) })} />
            <p className="text-xs text-slate-500 mt-1">% of monthly profit</p>
          </div>
          {!investor && (
            <div>
              <label className="label">Initial Investment (Rs.)</label>
              <input type="number" min={0} step={0.01} className="input" value={form.initial_investment || ''} onChange={(e) => setForm({ ...form, initial_investment: Number(e.target.value) })} />
            </div>
          )}
        </div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

function InvestorDetailModal({ investor, transactions, onClose, onTransactionAdded }: {
  investor: Investor;
  transactions: InvestorTransaction[];
  onClose: () => void;
  onTransactionAdded: () => void;
}) {
  const [showTxnModal, setShowTxnModal] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  return (
    <Modal open={true} onClose={onClose} title={`Investor: ${investor.name}`} size="xl"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Close</button>
        <button className="btn-primary" onClick={() => setShowTxnModal(true)}><Plus className="h-4 w-4" /> Add Transaction</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 border border-slate-200 rounded-md">
            <div className="text-xs text-slate-500 uppercase">Total Invested</div>
            <div className="text-lg font-bold text-slate-900">{formatCurrency(investor.total_investment)}</div>
          </div>
          <div className="p-3 border border-emerald-200 bg-emerald-50 rounded-md">
            <div className="text-xs text-emerald-700 uppercase">Current Balance</div>
            <div className="text-lg font-bold text-emerald-700">{formatCurrency(investor.current_balance || 0)}</div>
          </div>
          <div className="p-3 border border-blue-200 bg-blue-50 rounded-md">
            <div className="text-xs text-blue-700 uppercase">Profit Share</div>
            <div className="text-lg font-bold text-blue-700">{investor.profit_share_pct}%</div>
          </div>
          <div className="p-3 border border-purple-200 bg-purple-50 rounded-md">
            <div className="text-xs text-purple-700 uppercase">Profit Paid</div>
            <div className="text-lg font-bold text-purple-700">{formatCurrency(investor.total_profit_paid || 0)}</div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100"><h3 className="text-sm font-semibold">Transaction History ({transactions.length})</h3></div>
          {transactions.length === 0 ? <EmptyState title="No transactions yet" /> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Txn #</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-right px-4 py-2">Amount</th>
                  <th className="text-left px-4 py-2">Method</th>
                  <th className="text-left px-4 py-2">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((t) => (
                  <tr key={t.id} className={t.is_void ? 'opacity-50' : ''}>
                    <td className="px-4 py-2">{formatDate(t.date)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{t.transaction_number}</td>
                    <td className="px-4 py-2">
                      {t.type === 'investment_in' && <span className="badge-success">Investment In</span>}
                      {t.type === 'profit_paid' && <span className="badge-info">Profit Paid</span>}
                      {t.type === 'capital_withdraw' && <span className="badge-warning">Withdraw</span>}
                      {t.type === 'adjustment' && <span className="badge-default">Adjustment</span>}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono font-semibold ${t.type === 'investment_in' || t.type === 'adjustment' ? 'text-emerald-700' : 'text-red-700'}`}>
                      {t.type === 'investment_in' || t.type === 'adjustment' ? '+' : '-'}{formatCurrency(t.amount)}
                    </td>
                    <td className="px-4 py-2 text-xs">{t.payment_method}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">{t.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showTxnModal && (
        <TransactionModal investorId={investor.id} onClose={() => setShowTxnModal(false)} onSaved={() => { setShowTxnModal(false); onTransactionAdded(); }} />
      )}
    </Modal>
  );
}

function TransactionModal({ investorId, onClose, onSaved }: {
  investorId: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    type: 'investment_in' as 'investment_in' | 'profit_paid' | 'capital_withdraw' | 'adjustment',
    date: new Date().toISOString().slice(0, 10),
    amount: 0,
    paymentMethod: 'cash',
    referenceNo: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    if (!form.amount || form.amount <= 0) { pushToast('warning', 'Amount required.'); return; }
    setSaving(true);
    try {
      await invApi.addTransaction({
        investorId, type: form.type, amount: Number(form.amount), date: form.date,
        paymentMethod: form.paymentMethod, referenceNo: form.referenceNo || undefined, description: form.description || undefined,
      });
      pushToast('success', 'Transaction recorded.');
      onSaved();
    } catch (err: any) { pushToast('error', err.message); setSaving(false); }
  };

  return (
    <Modal open={true} onClose={onClose} title="Add Investor Transaction" size="md"
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? <Spinner size="sm" className="border-white" /> : 'Save'}</button>
      </>}>
      <div className="space-y-3">
        <div>
          <label className="label">Type *</label>
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
            <option value="investment_in">Investment In (cash received from investor)</option>
            <option value="profit_paid">Profit Paid (cash paid to investor)</option>
            <option value="capital_withdraw">Capital Withdraw (investor withdrawing capital)</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date</label><input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div><label className="label">Amount (Rs.) *</label><input type="number" min={0.01} step={0.01} className="input" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} autoFocus /></div>
        </div>
        <div><label className="label">Payment Method</label><select className="input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="cash">Cash</option><option value="bank">Bank</option><option value="cheque">Cheque</option></select></div>
        <div><label className="label">Reference No</label><input className="input" value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} /></div>
        <div><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

function ProfitModal({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <Modal open={true} onClose={onClose} title={`Monthly Profit — ${data.month}`} size="md"
      footer={<button className="btn-secondary" onClick={onClose}>Close</button>}>
      <div className="space-y-4">
        <div className="p-4 rounded-md bg-gradient-to-br from-emerald-50 to-blue-50 border border-emerald-200">
          <div className="text-xs text-slate-500 uppercase">Total Monthly Profit</div>
          <div className={`text-3xl font-bold ${data.total_monthly_profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(data.total_monthly_profit)}</div>
        </div>
        {data.investors.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No active investors with profit share {'>'} 0%.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase">
              <tr><th className="text-left px-4 py-2">Investor</th><th className="text-right px-4 py-2">Share %</th><th className="text-right px-4 py-2">Profit Amount</th><th className="text-right px-4 py-2">Balance</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.investors.map((inv: any) => (
                <tr key={inv.id}>
                  <td className="px-4 py-2 font-medium">{inv.name}</td>
                  <td className="px-4 py-2 text-right font-mono text-blue-700">{inv.profit_share_pct}%</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">{formatCurrency(inv.profit_amount)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(inv.current_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
