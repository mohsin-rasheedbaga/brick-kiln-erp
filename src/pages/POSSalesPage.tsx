import { useEffect, useState, useRef } from 'react';
import { PageHeader } from '../components/Card';
import { Modal } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import {
  brickCategories as catApi, stock as stockApi, customers as custApi,
  sales as salesApi,
} from '../lib/ipc';
import type { BrickCategory, StockBalance, Customer } from '../types';
import { formatCurrency, formatNumber } from '../lib/utils';
import {
  ShoppingCart, Search, Plus, Minus, Trash2, Calculator,
  Wallet, UserPlus, AlertCircle, Receipt,
} from 'lucide-react';

interface CartItem {
  category_id: string;
  category_name: string;
  quantity: number;
  rate: number;
  min_rate: number;
  max_rate: number;
  amount: number;
  stock_available: number;
}

export default function POSSalesPage() {
  const [categories, setCategories] = useState<BrickCategory[]>([]);
  const [stock, setStock] = useState<StockBalance[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showPendingBills, setShowPendingBills] = useState(false);
  const [pendingBills, setPendingBills] = useState<any[]>([]);
  const [checkoutSaving, setCheckoutSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      const [cats, stk, custs] = await Promise.all([
        catApi.list(false, true),
        stockApi.balance(),
        custApi.list({ limit: 1000 }),
      ]);
      setCategories(cats);
      setStock(stk);
      setCustomers(custs.items);
      // Load pending bills (unpaid/partial invoices)
      const pending = await salesApi.list({ status: 'unpaid', limit: 50 });
      const partial = await salesApi.list({ status: 'partial', limit: 50 });
      setPendingBills([...pending.items, ...partial.items]);
    } catch (err: any) { pushToast('error', err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const getStockQty = (catId: string) => stock.find((s) => s.category_id === catId)?.quantity || 0;

  const addToCart = (cat: BrickCategory) => {
    const available = getStockQty(cat.id);
    if (available <= 0) { pushToast('warning', `${cat.name} is out of stock.`); return; }
    const existing = cart.find((c) => c.category_id === cat.id);
    if (existing) {
      if (existing.quantity + 100 > available) { pushToast('warning', `Only ${available} available.`); return; }
      setCart(cart.map((c) => c.category_id === cat.id ? {
        ...c, quantity: c.quantity + 100, amount: (c.quantity + 100) * c.rate,
      } : c));
    } else {
      setCart([...cart, {
        category_id: cat.id, category_name: cat.name,
        quantity: 100, rate: cat.default_selling_rate,
        min_rate: cat.min_selling_rate, max_rate: cat.max_selling_rate,
        amount: 100 * cat.default_selling_rate,
        stock_available: available,
      }]);
    }
  };

  const updateQty = (catId: string, qty: number) => {
    setCart(cart.map((c) => c.category_id === catId ? {
      ...c, quantity: qty, amount: qty * c.rate,
    } : c));
  };

  const updateRate = (catId: string, rate: number) => {
    const item = cart.find((c) => c.category_id === catId);
    if (!item) return;
    if (item.min_rate > 0 && rate < item.min_rate) {
      pushToast('warning', `Rate cannot be less than Rs. ${item.min_rate} (minimum).`);
      return;
    }
    if (item.max_rate > 0 && rate > item.max_rate) {
      pushToast('warning', `Rate cannot exceed Rs. ${item.max_rate} (maximum).`);
      return;
    }
    setCart(cart.map((c) => c.category_id === catId ? {
      ...c, rate, amount: c.quantity * rate,
    } : c));
  };

  const removeFromCart = (catId: string) => setCart(cart.filter((c) => c.category_id !== catId));

  const subtotal = cart.reduce((s, c) => s + c.amount, 0);
  const total = Math.max(0, subtotal - discount);
  const remaining = total - paidAmount;

  const filteredCustomers = customers.filter((c) =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.customer_code.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.mobile || '').includes(customerSearch)
  );

  const handleCheckout = async () => {
    if (cart.length === 0) { pushToast('warning', 'Cart is empty.'); return; }
    if (!selectedCustomer) { pushToast('warning', 'Please select a customer first.'); return; }
    setCheckoutSaving(true);
    try {
      await salesApi.create({
        customerId: selectedCustomer.id,
        items: cart.map((c) => ({ category_id: c.category_id, quantity: c.quantity, rate: c.rate })),
        discount,
        paid: paidAmount,
        paymentMethod: 'cash',
      });
      pushToast('success', 'Sale completed! Invoice created.');
      setCart([]);
      setSelectedCustomer(null);
      setDiscount(0);
      setPaidAmount(0);
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    } finally { setCheckoutSaving(false); }
  };

  const totalPending = pendingBills.reduce((s, b) => s + b.remaining, 0);

  if (loading) return <Spinner className="mx-auto mt-12" />;

  return (
    <div>
      <PageHeader
        title="POS — Sales Counter"
        subtitle={`${cart.length} items in cart · ${formatNumber(stock.reduce((s, b) => s + b.quantity, 0))} bricks in stock`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowPendingBills(true)}>
              <AlertCircle className="h-4 w-4" /> Pending Bills ({pendingBills.length})
            </button>
            <button className="btn-secondary" onClick={() => setShowCalculator(true)}>
              <Calculator className="h-4 w-4" /> Calculator
            </button>
          </>
        }
      />

      {/* Pending bills summary */}
      {pendingBills.length > 0 && (
        <div className="card p-3 mb-4 bg-amber-50 border-amber-200">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <AlertCircle className="h-4 w-4" />
            <span><strong>{pendingBills.length} pending bills</strong> · Total receivable: {formatCurrency(totalPending)}</span>
            <button onClick={() => setShowPendingBills(true)} className="ml-auto text-xs text-amber-600 hover:underline">View all →</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Product grid */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Select Products (click to add to cart)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {categories.map((cat) => {
              const qty = getStockQty(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => addToCart(cat)}
                  disabled={qty <= 0}
                  className={`p-4 rounded-lg border-2 text-left transition ${qty > 0 ? 'border-emerald-200 bg-white hover:border-brand-400 hover:shadow-md' : 'border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed'}`}
                >
                  <div className="text-sm font-bold text-slate-900">{cat.name}</div>
                  <div className={`text-2xl font-bold mt-1 ${qty > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{formatNumber(qty)}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Rs. {cat.default_selling_rate}/brick
                    {cat.min_selling_rate > 0 || cat.max_selling_rate > 0 ? (
                      <span className="text-[10px] text-slate-400"> ({cat.min_selling_rate}-{cat.max_selling_rate})</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Cart + checkout */}
        <div className="lg:col-span-1">
          <div className="card sticky top-4">
            <div className="p-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" /> Cart ({cart.length})
              </h2>
            </div>

            <div className="p-4 max-h-64 overflow-y-auto">
              {cart.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Cart is empty. Click products to add.</p>
              ) : (
                <div className="space-y-2">
                  {cart.map((item) => (
                    <div key={item.category_id} className="p-2 border border-slate-200 rounded-md">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">{item.category_name}</span>
                        <button onClick={() => removeFromCart(item.category_id)} className="text-red-500 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="flex gap-2 mt-1">
                        <input
                          type="number" min={1} max={item.stock_available}
                          className="input py-1 text-sm w-20"
                          value={item.quantity}
                          onChange={(e) => updateQty(item.category_id, Number(e.target.value))}
                        />
                        <span className="text-xs text-slate-400 self-center">×</span>
                        <input
                          type="number" min={item.min_rate || 0} max={item.max_rate || 99999}
                          className="input py-1 text-sm w-20"
                          value={item.rate}
                          onChange={(e) => updateRate(item.category_id, Number(e.target.value))}
                        />
                        <span className="text-xs font-mono self-center ml-auto">{formatCurrency(item.amount)}</span>
                      </div>
                      {item.min_rate > 0 && <div className="text-[10px] text-slate-400 mt-0.5">Rate range: {item.min_rate} - {item.max_rate}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Customer + totals + checkout */}
            <div className="p-4 border-t border-slate-100 space-y-3">
              {/* Customer selection */}
              <div>
                <label className="label">Customer</label>
                {selectedCustomer ? (
                  <div className="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-md">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-900">{selectedCustomer.name}</div>
                      <div className="text-xs text-slate-500">{selectedCustomer.customer_code} · {selectedCustomer.mobile || '—'}</div>
                    </div>
                    <button onClick={() => setSelectedCustomer(null)} className="text-red-500 text-xs">Change</button>
                  </div>
                ) : (
                  <button onClick={() => setShowCustomerSearch(true)} className="btn-secondary w-full text-sm">
                    <Search className="h-4 w-4" /> Search Customer
                  </button>
                )}
              </div>

              {/* Totals */}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-mono">{formatCurrency(subtotal)}</span></div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Discount</span>
                  <input type="number" min={0} step={0.01} className="input py-1 w-24 text-right" value={discount || ''} onChange={(e) => setDiscount(Number(e.target.value))} />
                </div>
                <div className="flex justify-between font-bold border-t border-slate-200 pt-1"><span>Total</span><span className="font-mono text-brand-700">{formatCurrency(total)}</span></div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Paid Now</span>
                  <input type="number" min={0} step={0.01} className="input py-1 w-24 text-right" value={paidAmount || ''} onChange={(e) => setPaidAmount(Number(e.target.value))} placeholder="0" />
                </div>
                <div className="flex justify-between font-bold">
                  <span className={remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}>{remaining > 0 ? 'Pending' : 'Settled'}</span>
                  <span className={`font-mono ${remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatCurrency(Math.max(0, remaining))}</span>
                </div>
              </div>

              <button className="btn-primary w-full" onClick={handleCheckout} disabled={checkoutSaving || cart.length === 0 || !selectedCustomer}>
                {checkoutSaving ? <Spinner size="sm" className="border-white" /> : <><Receipt className="h-4 w-4" /> Complete Sale</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Customer search modal */}
      {showCustomerSearch && (
        <Modal open={true} onClose={() => setShowCustomerSearch(false)} title="Search Customer" size="md">
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input className="input pl-9" placeholder="Search by name, code, or mobile..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} autoFocus />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filteredCustomers.map((c) => (
                <button key={c.id} onClick={() => { setSelectedCustomer(c); setShowCustomerSearch(false); setCustomerSearch(''); }}
                  className="w-full text-left p-3 rounded-md border border-slate-200 hover:border-brand-400 hover:bg-brand-50 transition">
                  <div className="font-medium text-slate-900">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.customer_code} · {c.mobile || '—'} · Balance: {formatCurrency(c.current_balance || 0)}</div>
                </button>
              ))}
              {filteredCustomers.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No customers found.</p>}
            </div>
          </div>
        </Modal>
      )}

      {/* Calculator modal */}
      {showCalculator && <CalculatorModal onClose={() => setShowCalculator(false)} />}

      {/* Pending bills modal */}
      {showPendingBills && (
        <Modal open={true} onClose={() => setShowPendingBills(false)} title={`Pending Bills (${pendingBills.length})`} size="lg">
          <div className="space-y-2">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800 mb-3">
              <strong>Total Receivable: {formatCurrency(totalPending)}</strong>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase">
                <tr><th className="text-left px-3 py-2">Invoice #</th><th className="text-left px-3 py-2">Customer</th><th className="text-right px-3 py-2">Total</th><th className="text-right px-3 py-2">Paid</th><th className="text-right px-3 py-2">Remaining</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingBills.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-mono text-xs">{b.invoice_number}</td>
                    <td className="px-3 py-2">{b.customer_name}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(b.total)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{formatCurrency(b.paid)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-amber-700">{formatCurrency(b.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CalculatorModal({ onClose }: { onClose: () => void }) {
  const [display, setDisplay] = useState('0');
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const inputDigit = (d: string) => {
    if (waitingForOperand) { setDisplay(d); setWaitingForOperand(false); }
    else { setDisplay(display === '0' ? d : display + d); }
  };

  const inputDecimal = () => {
    if (waitingForOperand) { setDisplay('0.'); setWaitingForOperand(false); }
    else if (!display.includes('.')) { setDisplay(display + '.'); }
  };

  const clear = () => { setDisplay('0'); setPrev(null); setOp(null); setWaitingForOperand(false); };

  const performOp = (nextOp: string) => {
    const current = parseFloat(display);
    if (prev === null) { setPrev(current); }
    else if (op) {
      const result = calculate(prev, current, op);
      setDisplay(String(result));
      setPrev(result);
    }
    setOp(nextOp);
    setWaitingForOperand(true);
  };

  const calculate = (a: number, b: number, op: string): number => {
    switch (op) { case '+': return a + b; case '-': return a - b; case '×': return a * b; case '÷': return b !== 0 ? a / b : 0; default: return b; }
  };

  const equals = () => {
    if (op && prev !== null) {
      const current = parseFloat(display);
      const result = calculate(prev, current, op);
      setDisplay(String(result));
      setPrev(null);
      setOp(null);
      setWaitingForOperand(true);
    }
  };

  // Keyboard support
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') inputDigit(e.key);
      else if (e.key === '.') inputDecimal();
      else if (e.key === '+') performOp('+');
      else if (e.key === '-') performOp('-');
      else if (e.key === '*') performOp('×');
      else if (e.key === '/') { e.preventDefault(); performOp('÷'); }
      else if (e.key === 'Enter' || e.key === '=') equals();
      else if (e.key === 'Escape') clear();
      else if (e.key === 'Backspace') setDisplay(display.length > 1 ? display.slice(0, -1) : '0');
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  });

  const buttons = [
    { label: '7', action: () => inputDigit('7') }, { label: '8', action: () => inputDigit('8') }, { label: '9', action: () => performOp('÷') },
    { label: '4', action: () => inputDigit('4') }, { label: '5', action: () => inputDigit('5') }, { label: '6', action: () => performOp('×') },
    { label: '1', action: () => inputDigit('1') }, { label: '2', action: () => inputDigit('2') }, { label: '3', action: () => performOp('-') },
    { label: '0', action: () => inputDigit('0') }, { label: '.', action: inputDecimal }, { label: '=', action: equals },
  ];

  return (
    <Modal open={true} onClose={onClose} title="Calculator" size="sm">
      <div className="space-y-3">
        <input
          ref={inputRef}
          className="input text-right text-2xl font-mono"
          value={display}
          onChange={(e) => setDisplay(e.target.value)}
          autoFocus
        />
        <div className="grid grid-cols-3 gap-2">
          <button onClick={clear} className="btn-secondary py-3 text-red-600 font-bold col-span-2">C</button>
          <button onClick={() => performOp('+')} className="btn-primary py-3 text-lg font-bold">+</button>
          {buttons.map((b, i) => (
            <button key={i} onClick={b.action} className={`py-3 text-lg font-bold rounded-md border ${b.label === '=' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-slate-300 hover:bg-slate-50'}`}>
              {b.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 text-center">Keyboard supported: 0-9, +, -, *, /, Enter, Esc</p>
      </div>
    </Modal>
  );
}
