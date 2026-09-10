import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { batches as batchApi, kilns as kilnApi } from '../lib/ipc';
import type { Batch, Kiln } from '../types';
import { formatCurrency, formatDate, formatNumber } from '../lib/utils';
import { Plus, Edit2, Trash2, Play, CheckCircle2, XCircle, Flame } from 'lucide-react';

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  open:       { label: 'Open',         cls: 'badge-info' },
  firing:     { label: 'Firing',       cls: 'badge-warning' },
  completed:  { label: 'Completed',     cls: 'badge-success' },
  closed:     { label: 'Closed',        cls: 'badge-default' },
  cancelled:  { label: 'Cancelled',     cls: 'badge-danger' },
};

export default function BatchesPage() {
  const [items, setItems] = useState<Batch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Batch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Batch | null>(null);
  const pageSize = 25;
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const r = await batchApi.list({
        status: statusFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
      setItems(r.items);
      setTotal(r.total);
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { kilnApi.list(false).then(setKilns).catch(() => {}); }, []);
  useEffect(() => { load(); }, [statusFilter, page]);

  const handleStatus = async (batch: Batch, newStatus: string) => {
    try {
      await batchApi.setStatus(batch.id, newStatus);
      pushToast('success', `Batch ${batch.batch_number} marked as ${newStatus}.`);
      load();
    } catch (err: any) { pushToast('error', err.message); }
  };

  return (
    <div>
      <PageHeader
        title="Batches"
        subtitle={`${total} batch${total === 1 ? '' : 'es'}`}
        actions={
          <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
            <Plus className="h-4 w-4" /> New Batch
          </button>
        }
      />

      <div className="card p-3 mb-4">
        <div className="flex flex-wrap gap-3">
          <select className="input max-w-xs" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_BADGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No batches yet" message="Create your first batch to track a production cycle." icon={<Plus className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Batch #</th>
                <th className="text-left px-4 py-3 font-semibold">Start Date</th>
                <th className="text-left px-4 py-3 font-semibold">Kiln</th>
                <th className="text-right px-4 py-3 font-semibold">Loaded</th>
                <th className="text-right px-4 py-3 font-semibold">Unloaded</th>
                <th className="text-right px-4 py-3 font-semibold">Total Cost</th>
                <th className="text-right px-4 py-3 font-semibold">Revenue</th>
                <th className="text-right px-4 py-3 font-semibold">P/L</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-slate-900">{b.batch_number}</td>
                  <td className="px-4 py-2 text-slate-600">{formatDate(b.start_date)}</td>
                  <td className="px-4 py-2 text-slate-600">{b.kiln_name || '—'}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatNumber(b.raw_bricks_loaded)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatNumber(b.baked_bricks_unloaded)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(b.total_cost)}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-700">{formatCurrency(b.sales_revenue)}</td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${b.profit_loss >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatCurrency(b.profit_loss)}
                  </td>
                  <td className="px-4 py-2"><span className={STATUS_BADGES[b.status]?.cls || 'badge-default'}>{STATUS_BADGES[b.status]?.label || b.status}</span></td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      {b.status === 'open' && (
                        <button onClick={() => handleStatus(b, 'firing')} className="btn-ghost btn-sm text-amber-600" title="Mark firing">
                          <Flame className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {b.status === 'firing' && (
                        <button onClick={() => handleStatus(b, 'completed')} className="btn-ghost btn-sm text-emerald-600" title="Mark completed">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {(b.status === 'completed' || b.status === 'open' || b.status === 'firing') && (
                        <button onClick={() => handleStatus(b, 'closed')} className="btn-ghost btn-sm text-slate-600" title="Close batch">
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button onClick={() => { setEditing(b); setShowModal(true); }} className="btn-ghost btn-sm" title="Edit">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setDeleteTarget(b)} className="btn-ghost btn-sm text-red-600" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
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
        <BatchModal batch={editing} kilns={kilns} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await batchApi.delete(deleteTarget.id);
            pushToast('success', `Batch ${deleteTarget.batch_number} deleted.`);
            load();
          } catch (err: any) { pushToast('error', err.message); }
          setDeleteTarget(null);
        }}
        title="Delete Batch"
        message={`Delete batch "${deleteTarget?.batch_number}"? This can only be done if no transactions exist.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}

function BatchModal({ batch, kilns, onClose, onSaved }: { batch: Batch | null; kilns: Kiln[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    kilnId: batch?.kiln_id ?? '',
    startDate: batch?.start_date ?? new Date().toISOString().slice(0, 10),
    notes: batch?.notes ?? '',
    fuelCost: batch?.fuel_cost ?? 0,
    otherCost: batch?.other_cost ?? 0,
    brokenQuantity: batch?.broken_quantity ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      if (batch) {
        await batchApi.update(batch.id, {
          kilnId: form.kilnId || null,
          startDate: form.startDate,
          notes: form.notes,
          fuelCost: Number(form.fuelCost),
          otherCost: Number(form.otherCost),
          brokenQuantity: Number(form.brokenQuantity),
        });
        pushToast('success', 'Batch updated.');
      } else {
        await batchApi.create({
          kilnId: form.kilnId || undefined,
          startDate: form.startDate,
          notes: form.notes,
        });
        pushToast('success', 'Batch created.');
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
      title={batch ? `Edit ${batch.batch_number}` : 'New Batch'}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : batch ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Kiln</label>
          <select className="input" value={form.kilnId} onChange={(e) => setForm({ ...form, kilnId: e.target.value })}>
            <option value="">— None —</option>
            {kilns.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.status})</option>)}
          </select>
        </div>
        <div>
          <label className="label">Start Date</label>
          <input type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </div>
        {batch && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Fuel Cost</label>
                <input type="number" min={0} step={0.01} className="input" value={form.fuelCost}
                  onChange={(e) => setForm({ ...form, fuelCost: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">Other Cost</label>
                <input type="number" min={0} step={0.01} className="input" value={form.otherCost}
                  onChange={(e) => setForm({ ...form, otherCost: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">Broken Qty</label>
                <input type="number" min={0} step={1} className="input" value={form.brokenQuantity}
                  onChange={(e) => setForm({ ...form, brokenQuantity: Number(e.target.value) })} />
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Labour cost (auto from production): <span className="font-mono font-semibold text-slate-700">{formatCurrency(batch.labour_cost)}</span><br />
              Transport cost (auto from production): <span className="font-mono font-semibold text-slate-700">{formatCurrency(batch.transport_cost)}</span>
            </div>
          </>
        )}
        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
