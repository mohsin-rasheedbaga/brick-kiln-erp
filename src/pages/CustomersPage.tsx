import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { customers as custApi } from '../lib/ipc';
import type { Customer } from '../types';
import { formatCurrency } from '../lib/utils';
import { Plus, Edit2, Eye, Search, Power, Trash2 } from 'lucide-react';

export default function CustomersPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const pageSize = 25;
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const r = await custApi.list({
        search: search || undefined,
        includeInactive: showInactive,
        limit: pageSize,
        offset: page * pageSize,
      });
      setItems(r.items);
      setTotal(r.total);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [search, showInactive, page]);

  const handleToggle = async (c: Customer) => {
    try {
      await custApi.setActive(c.id, !c.is_active);
      pushToast('success', `${c.name} ${c.is_active ? 'deactivated' : 'activated'}.`);
      load();
    } catch (err: any) { pushToast('error', err.message); }
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${total} customer${total === 1 ? '' : 's'}`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowInactive((v) => !v)}>{showInactive ? 'Hide inactive' : 'Show inactive'}</button>
            <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}><Plus className="h-4 w-4" /> Add Customer</button>
          </>
        }
      />

      <div className="card p-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search by name, code, mobile, or CNIC..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No customers found" message="Add your first customer to begin sales." icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Code</th>
                <th className="text-left px-4 py-3 font-semibold">Name</th>
                <th className="text-left px-4 py-3 font-semibold">Mobile</th>
                <th className="text-right px-4 py-3 font-semibold">Opening</th>
                <th className="text-right px-4 py-3 font-semibold">Total Sales</th>
                <th className="text-right px-4 py-3 font-semibold">Total Paid</th>
                <th className="text-right px-4 py-3 font-semibold">Balance</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{c.customer_code}</td>
                  <td className="px-4 py-2 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-2 text-slate-700">{c.mobile || '—'}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(c.opening_balance)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(c.total_sales ?? 0)}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatCurrency(c.total_paid ?? 0)}</td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${(c.current_balance ?? 0) > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                    {formatCurrency(c.current_balance ?? 0)}
                  </td>
                  <td className="px-4 py-2">{c.is_active ? <span className="badge-success">Active</span> : <span className="badge-default">Inactive</span>}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => navigate(`/customers/${c.id}`)} className="btn-ghost btn-sm" title="View ledger"><Eye className="h-3.5 w-3.5" /></button>
                      <button onClick={() => { setEditing(c); setShowModal(true); }} className="btn-ghost btn-sm" title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>
                      <button onClick={() => handleToggle(c)} className="btn-ghost btn-sm" title={c.is_active ? 'Deactivate' : 'Activate'}><Power className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setDeleteTarget(c)} className="btn-ghost btn-sm text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CustomerModal customer={editing} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await custApi.delete(deleteTarget.id);
            pushToast('success', `Customer "${deleteTarget.name}" deleted.`);
            load();
          } catch (err: any) { pushToast('error', err.message); }
          setDeleteTarget(null);
        }}
        title="Delete Customer"
        message={`Delete "${deleteTarget?.name}"? This can only be done if they have no transactions. Otherwise, deactivate them instead.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}

function CustomerModal({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: customer?.name ?? '',
    mobile: customer?.mobile ?? '',
    phone: customer?.phone ?? '',
    address: customer?.address ?? '',
    cnic: customer?.cnic ?? '',
    openingBalance: customer?.opening_balance ?? 0,
    creditLimit: customer?.credit_limit ?? '',
    notes: customer?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    if (!form.name.trim()) { pushToast('warning', 'Name is required.'); return; }
    setSaving(true);
    try {
      const data = {
        name: form.name,
        mobile: form.mobile || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        cnic: form.cnic || undefined,
        openingBalance: Number(form.openingBalance) || 0,
        creditLimit: form.creditLimit === '' ? undefined : Number(form.creditLimit),
        notes: form.notes || undefined,
      };
      if (customer) {
        await custApi.update(customer.id, data);
        pushToast('success', 'Customer updated.');
      } else {
        await custApi.create(data);
        pushToast('success', 'Customer created.');
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
      title={customer ? `Edit ${customer.name}` : 'New Customer'}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : customer ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="label">Name *</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </div>
        <div>
          <label className="label">Mobile</label>
          <input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="03XX-XXXXXXX" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label className="label">CNIC</label>
          <input className="input" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="XXXXX-XXXXXXX-X" />
        </div>
        <div>
          <label className="label">Opening Balance (Rs.)</label>
          <input type="number" step={0.01} className="input" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">Credit Limit (Rs.)</label>
          <input type="number" step={0.01} className="input" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} placeholder="No limit" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Address</label>
          <textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
