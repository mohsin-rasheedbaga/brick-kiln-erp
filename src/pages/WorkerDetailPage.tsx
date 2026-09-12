import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { PageHeader } from '../components/Card';
import { Modal } from '../components/Modal';
import { Spinner, EmptyState, ErrorState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import {
  workers as workerApi, workTypes as wtApi,
  workerFamily as familyApi, workerAccount as accountApi,
} from '../lib/ipc';
import type { WorkerLedger, WorkType, WorkerFamily, WorkerAccountSummary } from '../types';
import { formatCurrency, formatDate, formatNumber } from '../lib/utils';
import { ArrowLeft, QrCode, Printer, Package, Wallet, TrendingUp, TrendingDown, Users2, Pencil } from 'lucide-react';
import { WorkerCardPrint } from '../components/WorkerCardPrint';

export default function WorkerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<WorkerLedger | null>(null);
  const [family, setFamily] = useState<WorkerFamily | null>(null);
  const [account, setAccount] = useState<WorkerAccountSummary | null>(null);
  const [printing, setPrinting] = useState(false);
  const [showFamilyModal, setShowFamilyModal] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [data, fam, acc] = await Promise.all([
        workerApi.ledger(id),
        familyApi.get(id),
        accountApi.summary(id),
      ]);
      setLedger(data);
      setFamily(fam);
      setAccount(acc);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  if (loading) return <Spinner className="mx-auto mt-12" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!ledger) return <EmptyState title="Worker not found" />;

  const { worker, production, advances, payments, totals } = ledger;
  // Use account summary if available (more accurate + includes last activity)
  const acc = account;

  return (
    <div>
      <PageHeader
        title={worker.full_name}
        subtitle={`${worker.worker_code} · ${worker.department_name || '—'}`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /> Back</button>
            <button className="btn-primary" onClick={() => setPrinting(true)}><Printer className="h-4 w-4" /> Print Card</button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Worker info */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-12 w-12 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-lg">
              {worker.full_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-semibold text-slate-900">{worker.full_name}</div>
              <div className="text-xs text-slate-500">{worker.worker_code}</div>
            </div>
          </div>

          <dl className="text-sm space-y-2">
            <div className="flex justify-between">
              <dt className="text-slate-500">Father's Name</dt>
              <dd className="text-slate-900">{worker.father_name || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Mobile</dt>
              <dd className="text-slate-900">{worker.mobile || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">CNIC</dt>
              <dd className="text-slate-900 font-mono">{worker.cnic || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Joining Date</dt>
              <dd className="text-slate-900">{formatDate(worker.joining_date)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Department</dt>
              <dd className="text-slate-900">{worker.department_name || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Work Type</dt>
              <dd className="text-slate-900">{worker.work_type_name || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Rate / 1000</dt>
              <dd className="text-slate-900 font-mono">{formatCurrency(worker.rate_per_1000)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd>
                {worker.status === 'active' ? <span className="badge-success">Active</span>
                  : worker.status === 'left' ? <span className="badge-danger">Left</span>
                  : <span className="badge-default">Inactive</span>}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Address</dt>
              <dd className="text-slate-900 text-right max-w-[60%]">{worker.address || '—'}</dd>
            </div>
          </dl>

          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Identification</div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-slate-500">Barcode:</span><span className="font-mono text-slate-900">{worker.barcode}</span></div>
              <div className="flex justify-between items-center"><span className="text-slate-500">QR Token:</span><span className="font-mono text-slate-900 text-[10px] break-all max-w-[60%]">{worker.qr_token}</span></div>
            </div>
          </div>

          {/* Phase 4: Family / Emergency Contact */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Users2 className="h-3.5 w-3.5" /> Family / Gharana
              </div>
              <button
                onClick={() => setShowFamilyModal(true)}
                className="text-xs text-brand-600 hover:underline flex items-center gap-1"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-slate-500">Family Number:</span><span className="font-mono text-slate-900">{family?.family_number || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Contact Name:</span><span className="text-slate-900">{family?.family_contact_name || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Relation:</span><span className="text-slate-900">{family?.relation || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Alt Number:</span><span className="font-mono text-slate-900">{family?.alt_number || '—'}</span></div>
            </div>
          </div>
        </div>

        {/* Phase 4: Worker Account Card (live, with last activity) */}
        {acc && (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="h-5 w-5 text-brand-600" />
              <h2 className="text-base font-semibold text-slate-900">Worker Account</h2>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Total Earned</span><span className="font-mono font-semibold text-emerald-700">{formatCurrency(acc.earned)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Advances Taken</span><span className="font-mono text-amber-700">{formatCurrency(acc.advances_total)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Payments Received</span><span className="font-mono text-purple-700">{formatCurrency(acc.payments_total)}</span></div>
              <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between items-center">
                <span className="text-slate-700 font-semibold">Current Balance</span>
                <span className={`font-mono text-lg font-bold ${acc.balance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {formatCurrency(acc.balance)}
                </span>
              </div>
              {acc.balance > 0 && (
                <p className="text-[10px] text-slate-500 mt-1">Payable to worker (earned − advances − payments)</p>
              )}
              {acc.last_activity_date && (
                <div className="pt-2 mt-2 border-t border-slate-100 text-xs text-slate-500">
                  <div className="flex justify-between"><span>Last activity:</span><span>{formatDate(acc.last_activity_date)}</span></div>
                  {acc.last_advance_date && (
                    <div className="flex justify-between mt-1">
                      <span>Last advance:</span>
                      <span>{formatCurrency(acc.last_advance_amount)} on {formatDate(acc.last_advance_date)}</span>
                    </div>
                  )}
                  {acc.last_payment_date && (
                    <div className="flex justify-between mt-1">
                      <span>Last payment:</span>
                      <span>{formatCurrency(acc.last_payment_amount)} on {formatDate(acc.last_payment_date)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ledger summary */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Ledger Summary</h2>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatBox label="Production Qty" value={formatNumber(totals.total_production_quantity)} icon={Package} color="text-blue-600 bg-blue-50" />
            <StatBox label="Labour Earned" value={formatCurrency(totals.total_labour_earned)} icon={TrendingUp} color="text-emerald-600 bg-emerald-50" />
            <StatBox label="Advances" value={formatCurrency(totals.total_advances)} icon={TrendingDown} color="text-amber-600 bg-amber-50" />
            <StatBox label="Payments" value={formatCurrency(totals.total_payments)} icon={Wallet} color="text-purple-600 bg-purple-50" />
          </div>

          <div className={`p-4 rounded-lg border-2 ${totals.remaining_balance >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wider">Remaining Balance</div>
                <div className={`text-2xl font-bold ${totals.remaining_balance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {formatCurrency(totals.remaining_balance)}
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>= Earned − Advances − Payments</div>
                <div className="mt-1">{formatCurrency(totals.total_labour_earned)} − {formatCurrency(totals.total_advances)} − {formatCurrency(totals.total_payments)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Production entries */}
      <div className="card mt-6 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Production History ({production.length})</h2>
        </div>
        {production.length === 0 ? (
          <EmptyState title="No production recorded yet" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Date</th>
                <th className="text-left px-4 py-2 font-semibold">Stage</th>
                <th className="text-right px-4 py-2 font-semibold">Qty</th>
                <th className="text-right px-4 py-2 font-semibold">Rate / 1000</th>
                <th className="text-right px-4 py-2 font-semibold">Labour</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {production.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-700">{formatDate(p.date)}</td>
                  <td className="px-4 py-2">
                    <span className="badge-info">{p.stage.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatNumber(p.quantity)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatCurrency(p.rate_per_1000)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{formatCurrency(p.labour_amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr>
                <td colSpan={2} className="px-4 py-2 font-semibold text-slate-700">Total</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-slate-900">{formatNumber(totals.total_production_quantity)}</td>
                <td></td>
                <td className="px-4 py-2 text-right font-mono font-bold text-slate-900">{formatCurrency(totals.total_labour_earned)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Advances & Payments side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-amber-50">
            <h2 className="text-sm font-semibold text-amber-900">Advances ({advances.length})</h2>
          </div>
          {advances.length === 0 ? <EmptyState title="No advances" /> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Date</th>
                  <th className="text-right px-4 py-2 font-semibold">Amount</th>
                  <th className="text-left px-4 py-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {advances.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2 text-slate-700">{formatDate(a.date)}</td>
                    <td className="px-4 py-2 text-right font-mono text-amber-700">{formatCurrency(a.amount)}</td>
                    <td className="px-4 py-2 text-slate-600 text-xs">{a.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-purple-50">
            <h2 className="text-sm font-semibold text-purple-900">Payments ({payments.length})</h2>
          </div>
          {payments.length === 0 ? <EmptyState title="No payments" /> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Date</th>
                  <th className="text-right px-4 py-2 font-semibold">Amount</th>
                  <th className="text-left px-4 py-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-slate-700">{formatDate(p.date)}</td>
                    <td className="px-4 py-2 text-right font-mono text-purple-700">{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-2 text-slate-600 text-xs">{p.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {printing && <WorkerCardPrint worker={worker} onClose={() => setPrinting(false)} />}

      {showFamilyModal && (
        <FamilyEditModal
          workerId={worker.id}
          initial={family}
          onClose={() => setShowFamilyModal(false)}
          onSaved={() => { setShowFamilyModal(false); load(); }}
        />
      )}
    </div>
  );
}

function FamilyEditModal({ workerId, initial, onClose, onSaved }: {
  workerId: string;
  initial: WorkerFamily | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    familyNumber: initial?.family_number ?? '',
    familyContactName: initial?.family_contact_name ?? '',
    relation: initial?.relation ?? '',
    altNumber: initial?.alt_number ?? '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSave = async () => {
    setSaving(true);
    try {
      await familyApi.set(workerId, {
        familyNumber: form.familyNumber || undefined,
        familyContactName: form.familyContactName || undefined,
        relation: form.relation || undefined,
        altNumber: form.altNumber || undefined,
      });
      pushToast('success', 'Family contact saved.');
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
      title="Family / Emergency Contact (Gharana Number)"
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Family Number (Gharana Number) *</label>
          <input
            className="input"
            value={form.familyNumber}
            onChange={(e) => setForm({ ...form, familyNumber: e.target.value })}
            placeholder="03XX-XXXXXXX"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Contact Name</label>
            <input
              className="input"
              value={form.familyContactName}
              onChange={(e) => setForm({ ...form, familyContactName: e.target.value })}
              placeholder="e.g. Muhammad Ali (father)"
            />
          </div>
          <div>
            <label className="label">Relation</label>
            <input
              className="input"
              value={form.relation}
              onChange={(e) => setForm({ ...form, relation: e.target.value })}
              placeholder="Father / Brother / Spouse"
            />
          </div>
        </div>
        <div>
          <label className="label">Alternative Number</label>
          <input
            className="input"
            value={form.altNumber}
            onChange={(e) => setForm({ ...form, altNumber: e.target.value })}
            placeholder="Optional"
          />
        </div>
        <p className="text-xs text-slate-500">
          This contact will be shown on the worker's card and is used in case of emergency.
        </p>
      </div>
    </Modal>
  );
}

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color: string }) {
  return (
    <div className="p-3 border border-slate-200 rounded-md">
      <div className="flex items-center gap-2 mb-1">
        <div className={`h-7 w-7 rounded flex items-center justify-center ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</div>
      </div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}
