/**
 * Worker Account Modal
 *
 * Opens when accountant searches/clicks a worker in Worker Pay page.
 * Shows:
 *   - Weekly breakdown (earned this week, advances this week)
 *   - Total account (earned, advances, paid, balance)
 *   - Withdraw button: opens withdrawal form with advance deduction option
 *   - Print receipt after payment
 */

import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Spinner } from './Feedback';
import { useToastStore } from '../stores/toast';
import { workerAccount as accountApi, withdraw as withdrawApi } from '../lib/ipc';
import type { WorkerAccountSummary } from '../types';
import { formatCurrency, formatDate, formatNumber } from '../lib/utils';
import { printHtml, reportHeader } from '../lib/export';
import {
  Wallet, TrendingUp, TrendingDown, ArrowDownCircle, Printer, Calculator,
} from 'lucide-react';

interface Props {
  workerId: string;
  workerName: string;
  workerCode: string;
  onClose: () => void;
  onSaved: () => void;
}

export function WorkerAccountModal({ workerId, workerName, workerCode, onClose, onSaved }: Props) {
  const [account, setAccount] = useState<WorkerAccountSummary | null>(null);
  const [weekly, setWeekly] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const [acc, wk] = await Promise.all([
        accountApi.summary(workerId),
        withdrawApi.weeklySummary(workerId),
      ]);
      setAccount(acc);
      setWeekly(wk);
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [workerId]);

  const handlePrintReceipt = (result: any) => {
    const body = reportHeader('Brick Kiln ERP', 'Payment Receipt') + `
      <div style="text-align: center; margin-bottom: 20px;">
        <h2>Payment Receipt</h2>
      </div>
      <table>
        <tr><td><strong>Worker:</strong></td><td>${workerName} (${workerCode})</td></tr>
        <tr><td><strong>Date:</strong></td><td>${formatDate(new Date().toISOString())}</td></tr>
        <tr><td><strong>Receipt #:</strong></td><td>${result.payment_number}</td></tr>
        ${result.advance_number ? `<tr><td><strong>Advance Ref #:</strong></td><td>${result.advance_number}</td></tr>` : ''}
        <tr><td><strong>Amount Paid:</strong></td><td>Rs. ${result.payAmount.toFixed(2)}</td></tr>
        ${result.deductionAmount > 0 ? `<tr><td><strong>Advance Deduction:</strong></td><td>Rs. ${result.deductionAmount.toFixed(2)}</td></tr>` : ''}
        <tr style="border-top: 2px solid #0f172a;"><td><strong>Total Settled:</strong></td><td>Rs. ${(result.payAmount + result.deductionAmount).toFixed(2)}</td></tr>
        <tr><td><strong>Remaining Balance:</strong></td><td>Rs. ${result.newBalance.toFixed(2)}</td></tr>
      </table>
      <div style="margin-top: 40px; display: flex; justify-content: space-between;">
        <div>
          <div style="border-top: 1px solid #0f172a; width: 150px; margin-top: 40px;"></div>
          <div style="font-size: 11px; color: #64748b;">Worker Signature</div>
        </div>
        <div>
          <div style="border-top: 1px solid #0f172a; width: 150px; margin-top: 40px;"></div>
          <div style="font-size: 11px; color: #64748b;">Accountant Signature</div>
        </div>
      </div>
    `;
    printHtml(`Receipt - ${workerName}`, body);
  };

  if (loading) return <Modal open={true} onClose={onClose} title="Loading..."><Spinner className="mx-auto" /></Modal>;

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Account: ${workerName} (${workerCode})`}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Close</button>
          {lastResult && (
            <button className="btn-secondary" onClick={() => handlePrintReceipt(lastResult)}>
              <Printer className="h-4 w-4" /> Print Receipt
            </button>
          )}
          <button className="btn-primary" onClick={() => setShowWithdraw(true)} disabled={!account || account.balance <= 0}>
            <Wallet className="h-4 w-4" /> Withdraw / Pay
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Weekly Summary */}
        {weekly && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
            <div className="text-sm font-semibold text-blue-900 mb-2">This Week ({formatDate(weekly.week_start)} → {formatDate(weekly.week_end)})</div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-blue-600">Earned This Week</div>
                <div className="font-bold text-emerald-700">{formatCurrency(weekly.earned_this_week)}</div>
              </div>
              <div>
                <div className="text-xs text-blue-600">Advances This Week</div>
                <div className="font-bold text-amber-700">{formatCurrency(weekly.advances_this_week)}</div>
              </div>
              <div>
                <div className="text-xs text-blue-600">Paid This Week</div>
                <div className="font-bold text-purple-700">{formatCurrency(weekly.payments_this_week)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Total Account */}
        {account && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 border border-emerald-200 bg-emerald-50 rounded-md cursor-pointer hover:shadow-md transition" onClick={() => setShowWithdraw(true)}>
              <div className="text-xs text-emerald-700 uppercase">Total Earned</div>
              <div className="text-lg font-bold text-emerald-700">{formatCurrency(account.earned)}</div>
              <div className="text-xs text-emerald-600 mt-0.5">{formatNumber(account.total_production_qty)} bricks</div>
            </div>
            <div className="p-3 border border-amber-200 bg-amber-50 rounded-md">
              <div className="text-xs text-amber-700 uppercase">Advances Taken</div>
              <div className="text-lg font-bold text-amber-700">{formatCurrency(account.advances_total)}</div>
            </div>
            <div className="p-3 border border-purple-200 bg-purple-50 rounded-md">
              <div className="text-xs text-purple-700 uppercase">Already Paid</div>
              <div className="text-lg font-bold text-purple-700">{formatCurrency(account.payments_total)}</div>
            </div>
            <div className={`p-3 border rounded-md ${account.balance > 0 ? 'border-brand-300 bg-brand-50' : account.balance < 0 ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
              <div className={`text-xs uppercase ${account.balance > 0 ? 'text-brand-700' : account.balance < 0 ? 'text-red-700' : 'text-slate-500'}`}>Balance</div>
              <div className={`text-lg font-bold ${account.balance > 0 ? 'text-brand-700' : account.balance < 0 ? 'text-red-700' : 'text-slate-500'}`}>
                {account.balance > 0 ? formatCurrency(account.balance) : account.balance < 0 ? `${formatCurrency(Math.abs(account.balance))} (owes)` : 'Rs. 0'}
              </div>
            </div>
          </div>
        )}

        {/* Last payment result */}
        {lastResult && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md">
            <div className="text-sm font-semibold text-emerald-900 mb-2">✓ Payment Recorded</div>
            <div className="text-xs text-emerald-800 space-y-1">
              <div>Receipt #: <span className="font-mono">{lastResult.payment_number}</span></div>
              <div>Paid to worker: <span className="font-mono">{formatCurrency(lastResult.payAmount)}</span></div>
              {lastResult.deductionAmount > 0 && <div>Advance deduction: <span className="font-mono">{formatCurrency(lastResult.deductionAmount)}</span></div>}
              <div>Remaining balance: <span className="font-mono font-bold">{formatCurrency(lastResult.newBalance)}</span></div>
            </div>
          </div>
        )}

        {/* History link */}
        {account && (
          <div className="text-xs text-slate-500">
            Last activity: {account.last_activity_date ? formatDate(account.last_activity_date) : 'Never'}
            {account.last_advance_date && ` · Last advance: ${formatCurrency(account.last_advance_amount)}`}
            {account.last_payment_date && ` · Last payment: ${formatCurrency(account.last_payment_amount)}`}
          </div>
        )}
      </div>

      {showWithdraw && account && (
        <WithdrawModal
          workerId={workerId}
          workerName={workerName}
          earned={account.earned}
          advances={account.advances_total}
          paid={account.payments_total}
          balance={account.balance}
          onClose={() => setShowWithdraw(false)}
          onDone={(result) => {
            setShowWithdraw(false);
            setLastResult(result);
            load();
            onSaved();
          }}
        />
      )}
    </Modal>
  );
}

function WithdrawModal({ workerId, workerName, earned, advances, paid, balance, onClose, onDone }: {
  workerId: string;
  workerName: string;
  earned: number;
  advances: number;
  paid: number;
  balance: number;
  onClose: () => void;
  onDone: (result: any) => void;
}) {
  // Default: pay full balance, no deduction
  const [payAmount, setPayAmount] = useState(balance > 0 ? balance : 0);
  const [deductFromAdvance, setDeductFromAdvance] = useState(false);
  const [deductionAmount, setDeductionAmount] = useState(0);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const totalOutflow = Number(payAmount) + (deductFromAdvance ? Number(deductionAmount) : 0);
  const remainingAfterPayment = balance - totalOutflow;

  const handleSubmit = async () => {
    if (payAmount <= 0) { pushToast('warning', 'Pay amount must be positive.'); return; }
    if (totalOutflow > balance + 0.01) { pushToast('warning', `Total (${formatCurrency(totalOutflow)}) exceeds balance (${formatCurrency(balance)}).`); return; }
    if (deductFromAdvance && deductionAmount > advances) { pushToast('warning', `Deduction (${formatCurrency(deductionAmount)}) exceeds total advances (${formatCurrency(advances)}).`); return; }

    setSaving(true);
    try {
      const result = await withdrawApi.earnings({
        workerId,
        payAmount: Number(payAmount),
        deductFromAdvance,
        deductionAmount: deductFromAdvance ? Number(deductionAmount) : 0,
        description: description || undefined,
      });
      pushToast('success', `Payment recorded: ${result.payment_number}`);
      onDone(result);
    } catch (err: any) {
      pushToast('error', err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Withdraw / Pay — ${workerName}`}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving || balance <= 0}>
            {saving ? <Spinner size="sm" className="border-white" /> : <Wallet className="h-4 w-4" />} Pay Now
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Summary */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Total Earned:</span><span className="font-mono text-emerald-700">{formatCurrency(earned)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Advances Taken:</span><span className="font-mono text-amber-700">{formatCurrency(advances)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Already Paid:</span><span className="font-mono text-purple-700">{formatCurrency(paid)}</span></div>
          <div className="flex justify-between font-semibold border-t border-slate-200 pt-1"><span>Current Balance:</span><span className="font-mono text-brand-700">{formatCurrency(balance)}</span></div>
        </div>

        {/* Pay amount */}
        <div>
          <label className="label">Amount to Pay Worker (Rs.) *</label>
          <input
            type="number" min={0} max={balance} step={0.01}
            className="input"
            value={payAmount || ''}
            onChange={(e) => setPayAmount(Number(e.target.value))}
            autoFocus
          />
          <p className="text-xs text-slate-500 mt-1">
            This is the cash the worker will receive. Default = full balance.
          </p>
        </div>

        {/* Advance deduction */}
        {advances > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
            <label className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <input
                type="checkbox"
                checked={deductFromAdvance}
                onChange={(e) => {
                  setDeductFromAdvance(e.target.checked);
                  if (e.target.checked && deductionAmount === 0) {
                    // Default deduction = balance - payAmount (remaining after pay)
                    const remaining = balance - Number(payAmount);
                    setDeductionAmount(Math.max(0, remaining));
                  }
                }}
              />
              Deduct from Advance Balance (total advances: {formatCurrency(advances)})
            </label>
            {deductFromAdvance && (
              <div className="mt-2">
                <label className="label text-amber-800">Deduction Amount (Rs.)</label>
                <input
                  type="number" min={0} max={advances} step={0.01}
                  className="input"
                  value={deductionAmount || ''}
                  onChange={(e) => setDeductionAmount(Number(e.target.value))}
                />
                <p className="text-xs text-amber-700 mt-1">
                  This amount will be deducted from the worker's advance balance.
                  Example: Earned Rs. 5,000, pay Rs. 4,000, deduct Rs. 1,000 from advance.
                  Advance goes from {formatCurrency(advances)} → {formatCurrency(advances - deductionAmount)}.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Calculation summary */}
        <div className="p-3 bg-brand-50 border border-brand-200 rounded-md">
          <div className="text-xs text-brand-700 uppercase font-medium mb-1">Payment Summary</div>
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span>Cash to worker:</span><span className="font-mono">{formatCurrency(Number(payAmount))}</span></div>
            {deductFromAdvance && (
              <div className="flex justify-between"><span>Advance deduction:</span><span className="font-mono text-amber-700">{formatCurrency(Number(deductionAmount))}</span></div>
            )}
            <div className="flex justify-between font-semibold border-t border-brand-300 pt-1"><span>Total settled:</span><span className="font-mono">{formatCurrency(totalOutflow)}</span></div>
            <div className="flex justify-between"><span className="text-brand-600">Remaining balance:</span><span className="font-mono font-bold text-brand-700">{formatCurrency(remainingAfterPayment)}</span></div>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="label">Description (optional)</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. weekly payment + advance deduction" />
        </div>
      </div>
    </Modal>
  );
}
