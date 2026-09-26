import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { brickCategories as catApi, stock as stockApi } from '../lib/ipc';
import type { BrickCategory, StockBalance } from '../types';
import { formatCurrency, formatNumber } from '../lib/utils';
import { Plus, Edit2, Boxes, Power, TrendingUp } from 'lucide-react';

export default function ProductsPage() {
  const [items, setItems] = useState<BrickCategory[]>([]);
  const [stock, setStock] = useState<StockBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<BrickCategory | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<BrickCategory | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const [cats, stk] = await Promise.all([
        catApi.list(true, true),
        stockApi.balance(),
      ]);
      setItems(cats);
      setStock(stk);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [showInactive]);

  const getStockQty = (catId: string) => stock.find((s) => s.category_id === catId)?.quantity || 0;
  const totalStock = stock.reduce((s, b) => s + b.quantity, 0);
  const totalValue = stock.reduce((s, b) => s + (b.quantity * b.default_selling_rate), 0);

  const handleToggle = async (cat: BrickCategory) => {
    try {
      await catApi.setActive(cat.id, !cat.is_active);
      pushToast('success', `${cat.name} ${cat.is_active ? 'deactivated' : 'activated'}.`);
      load();
    } catch (err: any) { pushToast('error', err.message); }
  };

  return (
    <div>
      <PageHeader
        title="Products Management"
        subtitle={`${items.length} products · ${formatNumber(totalStock)} bricks in stock · Est. value: ${formatCurrency(totalValue)}`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowInactive((v) => !v)}>
              {showInactive ? 'Hide inactive' : 'Show inactive'}
            </button>
            <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
              <Plus className="h-4 w-4" /> Add Product
            </button>
          </>
        }
      />

      <div className="card p-4 mb-4 bg-blue-50 border-blue-200">
        <div className="text-sm text-blue-800">
          <strong>How products work:</strong> Each product represents a brick grade (A, B, C, etc.).
          Set the <strong>Default Rate</strong>, <strong>Min Rate</strong>, and <strong>Max Rate</strong>.
          When selling via POS, the rate cannot go below Min or above Max.
          Stock is automatically updated from production (baked brick unloading) and sales.
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No products found" message="Add your first product (brick grade) to start selling." icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Code</th>
                <th className="text-left px-4 py-3 font-semibold">Product Name</th>
                <th className="text-right px-4 py-3 font-semibold">Stock</th>
                <th className="text-right px-4 py-3 font-semibold">Stock Value</th>
                <th className="text-right px-4 py-3 font-semibold">Default Rate</th>
                <th className="text-right px-4 py-3 font-semibold">Min Rate</th>
                <th className="text-right px-4 py-3 font-semibold">Max Rate</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((cat) => {
                const qty = getStockQty(cat.id);
                const value = qty * cat.default_selling_rate;
                return (
                  <tr key={cat.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{cat.code}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{cat.name}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${qty > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {formatNumber(qty)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{formatCurrency(value)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{formatCurrency(cat.default_selling_rate)}</td>
                    <td className="px-4 py-3 text-right font-mono text-amber-600">{cat.min_selling_rate > 0 ? formatCurrency(cat.min_selling_rate) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-600">{cat.max_selling_rate > 0 ? formatCurrency(cat.max_selling_rate) : '—'}</td>
                    <td className="px-4 py-3">
                      {cat.is_active ? <span className="badge-success">Active</span> : <span className="badge-default">Inactive</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => { setEditing(cat); setShowModal(true); }} className="btn-ghost btn-sm" title="Edit">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setToggleTarget(cat)} className="btn-ghost btn-sm" title={cat.is_active ? 'Deactivate' : 'Activate'}>
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr>
                <td colSpan={2} className="px-4 py-2 font-semibold text-slate-700">Total</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">{formatNumber(totalStock)}</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-slate-900">{formatCurrency(totalValue)}</td>
                <td colSpan={5}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showModal && (
        <ProductModal
          product={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}

      <ConfirmDialog
        open={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => { if (toggleTarget) handleToggle(toggleTarget); setToggleTarget(null); }}
        title={toggleTarget?.is_active ? 'Deactivate Product' : 'Activate Product'}
        message={`${toggleTarget?.is_active ? 'Deactivate' : 'Activate'} "${toggleTarget?.name}"?`}
        confirmText={toggleTarget?.is_active ? 'Deactivate' : 'Activate'}
      />
    </div>
  );
}

function ProductModal({ product, onClose, onSaved }: {
  product: BrickCategory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: product?.name ?? '',
    code: product?.code ?? '',
    description: product?.description ?? '',
    default_selling_rate: product?.default_selling_rate ?? 0,
    min_selling_rate: product?.min_selling_rate ?? 0,
    max_selling_rate: product?.max_selling_rate ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    const name = form.name.trim();
    const code = form.code.trim().toUpperCase();
    if (!name) { pushToast('warning', 'Product name is required.'); return; }
    if (!code) { pushToast('warning', 'Product code is required.'); return; }
    if (form.min_selling_rate > 0 && form.max_selling_rate > 0 && form.min_selling_rate > form.max_selling_rate) {
      pushToast('warning', 'Min rate cannot be greater than Max rate.');
      return;
    }
    setSaving(true);
    try {
      if (product) {
        await catApi.update(product.id, {
          name, code, description: form.description || undefined,
          default_selling_rate: Number(form.default_selling_rate),
          min_selling_rate: Number(form.min_selling_rate),
          max_selling_rate: Number(form.max_selling_rate),
        } as any);
        pushToast('success', 'Product updated.');
      } else {
        await catApi.create({
          name, code, description: form.description || undefined,
          defaultSellingRate: Number(form.default_selling_rate),
          minSellingRate: Number(form.min_selling_rate),
          maxSellingRate: Number(form.max_selling_rate),
        });
        pushToast('success', 'Product created.');
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
      title={product ? `Edit ${product.name}` : 'New Product'}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : product ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Product Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. A Grade" autoFocus disabled={saving || !!product} />
          </div>
          <div>
            <label className="label">Code *</label>
            <input className="input font-mono uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().slice(0, 8) })} placeholder="e.g. A" disabled={saving || !!product} />
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Premium quality first-class bricks" disabled={saving} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Default Rate (Rs.) *</label>
            <input type="number" min={0} step={1} className="input" value={form.default_selling_rate || ''} onChange={(e) => setForm({ ...form, default_selling_rate: Number(e.target.value) })} disabled={saving} />
            <p className="text-xs text-slate-500 mt-1">Per brick</p>
          </div>
          <div>
            <label className="label">Min Rate (Rs.)</label>
            <input type="number" min={0} step={1} className="input" value={form.min_selling_rate || ''} onChange={(e) => setForm({ ...form, min_selling_rate: Number(e.target.value) })} disabled={saving} />
            <p className="text-xs text-amber-600 mt-1">Cannot sell below this</p>
          </div>
          <div>
            <label className="label">Max Rate (Rs.)</label>
            <input type="number" min={0} step={1} className="input" value={form.max_selling_rate || ''} onChange={(e) => setForm({ ...form, max_selling_rate: Number(e.target.value) })} disabled={saving} />
            <p className="text-xs text-red-600 mt-1">Cannot sell above this</p>
          </div>
        </div>
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
          <strong>Rate Range Example:</strong> If Default = 535, Min = 500, Max = 570,
          then in POS the selling rate can only be set between Rs. 500 and Rs. 570 per brick.
        </div>
      </div>
    </Modal>
  );
}
