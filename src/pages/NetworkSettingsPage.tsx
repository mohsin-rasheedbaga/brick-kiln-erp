import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Spinner } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { network as netApi } from '../lib/ipc';
import {
  Server, Monitor, Wifi, ShieldCheck, Network as NetworkIcon,
  CheckCircle2, XCircle, Loader2, RefreshCw, Power, AlertTriangle, Copy,
} from 'lucide-react';

type Mode = 'standalone' | 'server' | 'client';

interface NetStatus {
  mode: Mode;
  host: string;
  port: number;
  serverRunning: boolean;
  serverPort: number;
  ips: string[];
  isWindows: boolean;
}

export default function NetworkSettingsPage() {
  const pushToast = useToastStore((s) => s.push);
  const [status, setStatus] = useState<NetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ reachable: boolean; message: string; serverInfo?: any } | null>(null);
  const [firewallStatus, setFirewallStatus] = useState<{ exists: boolean; port: number } | null>(null);
  const [addingFirewall, setAddingFirewall] = useState(false);

  const [mode, setMode] = useState<Mode>('standalone');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(8765);
  const [accessCode, setAccessCode] = useState('');
  const [machineName, setMachineName] = useState('');
  const [autoFirewall, setAutoFirewall] = useState(true);

  const [pendingApply, setPendingApply] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const s = await netApi.getStatus();
      setStatus(s);
      setMode(s.mode);
      setHost(s.host);
      setPort(s.port);
      const cfg = await netApi.getConfig();
      setAccessCode(cfg.accessCode || '');
      setMachineName(cfg.machineName || '');
      if (s.isWindows) {
        const fw = await netApi.checkFirewall(s.port);
        setFirewallStatus(fw);
      }
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleApply = async () => {
    if (mode === 'client' && !host.trim()) {
      pushToast('warning', 'سرور کا IP ایڈریس درج کریں — Please enter the server IP address.');
      return;
    }
    setSaving(true);
    try {
      const result = await netApi.saveConfig({
        mode,
        host: host.trim(),
        port,
        accessCode,
        machineName,
        autoFirewall: mode === 'server' ? autoFirewall : false,
      });
      pushToast('success', `سیٹنگز محفوظ ہو گئیں — Settings saved. Mode: ${mode}.`);
      if (mode === 'server' && result.firewall) {
        pushToast(result.firewall.success ? 'success' : 'warning', result.firewall.message || 'Firewall rule not added.');
      }
      if (mode !== 'standalone') {
        pushToast('info', 'تبدیلیوں کے لیے ایپ دوبارہ چلائیں — Please restart the app for changes to take full effect.');
      }
      setPendingApply(false);
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!host.trim()) {
      pushToast('warning', 'سرور کا IP درج کریں — Please enter server IP.');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await netApi.testConnection(host.trim(), port);
      setTestResult(result);
      pushToast(result.reachable ? 'success' : 'error', result.message);
    } catch (err: any) {
      setTestResult({ reachable: false, message: err.message });
      pushToast('error', err.message);
    } finally {
      setTesting(false);
    }
  };

  const handleAddFirewall = async () => {
    setAddingFirewall(true);
    try {
      const result = await netApi.addFirewall(port);
      pushToast(result.success ? 'success' : 'warning', result.message);
      const fw = await netApi.checkFirewall(port);
      setFirewallStatus(fw);
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setAddingFirewall(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Network Sharing (نیٹ ورک شیئرنگ)" subtitle="Configure multi-PC data sharing over Wi-Fi" />
        <Spinner className="mx-auto mt-12" />
      </div>
    );
  }

  const isClient = (window as any).erp?.info?.isClient === true;

  return (
    <div>
      <PageHeader
        title="Network Sharing (نیٹ ورک شیئرنگ)"
        subtitle="ایک وقت میں کئی کمپیوٹرز پر سافٹ ویئر استعمال کریں — Run on multiple PCs over the same Wi-Fi"
      />

      {isClient && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-md flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <strong>Client Mode Active:</strong> یہ کمپیوٹر سرور سے جڑا ہوا ہے۔ نیٹ ورک سیٹنگز تبدیل کرنے کے لیے ایپ دوبارہ چلائیں۔<br/>
            <span className="text-xs">This PC is connected to server <code className="bg-amber-100 px-1 rounded">{status?.host}</code>.</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-5">
          <h3 className="text-base font-semibold text-slate-800 mb-4">1. Mode Selection — موڈ کا انتخاب</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={() => setMode('standalone')}
              className={`p-4 border-2 rounded-lg text-left transition ${mode === 'standalone' ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <Monitor className={`h-6 w-6 mb-2 ${mode === 'standalone' ? 'text-brand-600' : 'text-slate-400'}`} />
              <div className="font-semibold text-slate-800">Standalone</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">تنہا</div>
              <div className="text-xs text-slate-500 mt-2">ایک کمپیوٹر پر تمام ڈیٹا — All data on this PC only.</div>
            </button>

            <button
              onClick={() => setMode('server')}
              className={`p-4 border-2 rounded-lg text-left transition ${mode === 'server' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <Server className={`h-6 w-6 mb-2 ${mode === 'server' ? 'text-emerald-600' : 'text-slate-400'}`} />
              <div className="font-semibold text-slate-800">Server (Host)</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">سرور (مین کمپیوٹر)</div>
              <div className="text-xs text-slate-500 mt-2">ڈیٹا اس PC پر رہے گا، باقی PC اس سے جڑیں گے — Hosts the data; other PCs connect to this.</div>
            </button>

            <button
              onClick={() => setMode('client')}
              className={`p-4 border-2 rounded-lg text-left transition ${mode === 'client' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <Wifi className={`h-6 w-6 mb-2 ${mode === 'client' ? 'text-blue-600' : 'text-slate-400'}`} />
              <div className="font-semibold text-slate-800">Client</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">کلائنٹ</div>
              <div className="text-xs text-slate-500 mt-2">سرور PC سے وائی فائی کے ذریعے جڑیں — Connects to a server PC over Wi-Fi.</div>
            </button>
          </div>

          {mode === 'server' && (
            <div className="mt-5 p-4 bg-emerald-50/50 border border-emerald-200 rounded-md space-y-3">
              <div className="flex items-center gap-2 text-emerald-800">
                <Server className="h-4 w-4" />
                <span className="font-semibold text-sm">Server Configuration — سرور کنفیگریشن</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">PC Name (کمپیوٹر کا نام)</label>
                  <input className="input" value={machineName} onChange={(e) => setMachineName(e.target.value)} placeholder="e.g. Office-PC" />
                </div>
                <div>
                  <label className="label">Port (پورٹ)</label>
                  <input type="number" className="input" value={port} onChange={(e) => setPort(Number(e.target.value) || 8765)} min={1024} max={65535} />
                </div>
              </div>

              <div>
                <label className="label">Access Code (اختیاری — رسائی کوڈ)</label>
                <input className="input" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Leave empty for no protection (LAN only)" />
                <p className="text-xs text-slate-500 mt-1">If set, clients must enter this code to connect. صرف قابل اعتماد صارفین کو کوڈ دیں۔</p>
              </div>

              {status?.isWindows && (
                <label className="flex items-start gap-2 text-sm text-slate-700 mt-2">
                  <input type="checkbox" checked={autoFirewall} onChange={(e) => setAutoFirewall(e.target.checked)} className="mt-0.5" />
                  <span>
                    Automatically add Windows Firewall rule (UAC permission required once)
                    <br/>
                    <span className="text-xs text-slate-500">ونڈوز فائر وال میں خودکار اجازت — ایک بار "Yes" کلک کرنا ہوگا</span>
                  </span>
                </label>
              )}

              {status && status.ips.length > 0 && (
                <div className="bg-white border border-slate-200 rounded p-3">
                  <div className="text-xs font-semibold text-slate-600 mb-1">Server IP Addresses — سرور کے IP ایڈریس (کلائنٹس کو یہ دیں):</div>
                  {status.ips.map((ip) => (
                    <div key={ip} className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-sm text-slate-800">{ip}:{port}</span>
                      <button
                        onClick={() => { navigator.clipboard?.writeText(ip); pushToast('success', `کاپی ہو گیا: ${ip}`); }}
                        className="text-slate-400 hover:text-brand-600"
                        title="Copy"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {status?.isWindows && firewallStatus && (
                <div className="flex items-center gap-2 text-sm">
                  <ShieldCheck className={`h-4 w-4 ${firewallStatus.exists ? 'text-emerald-600' : 'text-amber-600'}`} />
                  <span className={firewallStatus.exists ? 'text-emerald-700' : 'text-amber-700'}>
                    {firewallStatus.exists
                      ? `Firewall rule exists for port ${firewallStatus.port}. — فائر وال اجازت موجود ہے`
                      : `No firewall rule yet. Click "Add Firewall Rule" below. — اجازت نہیں ہے`}
                  </span>
                </div>
              )}
            </div>
          )}

          {mode === 'client' && (
            <div className="mt-5 p-4 bg-blue-50/50 border border-blue-200 rounded-md space-y-3">
              <div className="flex items-center gap-2 text-blue-800">
                <Wifi className="h-4 w-4" />
                <span className="font-semibold text-sm">Client Configuration — کلائنٹ کنفیگریشن</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Server IP Address — سرور کا IP</label>
                  <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="e.g. 192.168.1.10" />
                </div>
                <div>
                  <label className="label">Port (پورٹ)</label>
                  <input type="number" className="input" value={port} onChange={(e) => setPort(Number(e.target.value) || 8765)} min={1024} max={65535} />
                </div>
              </div>
              <div>
                <label className="label">Access Code (رسائی کوڈ)</label>
                <input className="input" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Enter the code shared by the server admin" />
              </div>
              <button className="btn-secondary btn-sm" onClick={handleTestConnection} disabled={testing || !host.trim()}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Test Connection — کنکشن ٹیسٹ کریں
              </button>
              {testResult && (
                <div className={`flex items-start gap-2 p-2 rounded text-sm ${testResult.reachable ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                  {testResult.reachable ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <XCircle className="h-4 w-4 mt-0.5" />}
                  <div>
                    <div>{testResult.message}</div>
                    {testResult.serverInfo && (
                      <div className="text-xs mt-1 opacity-75">Server: {testResult.serverInfo.machineName}, Version: {testResult.serverInfo.version}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={load} disabled={saving}>Cancel — منسوخ</button>
            <button className="btn-primary" onClick={() => setPendingApply(true)} disabled={saving}>
              <Power className="h-4 w-4" /> Apply &amp; Save — محفوظ کریں
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <NetworkIcon className="h-4 w-4" /> Current Status — موجودہ حالت
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Mode (موڈ):</dt>
                <dd className="font-semibold text-slate-800 capitalize">{status?.mode}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Server running:</dt>
                <dd className={status?.serverRunning ? 'text-emerald-600' : 'text-slate-400'}>
                  {status?.serverRunning ? 'Yes (چل رہا ہے)' : 'No'}
                </dd>
              </div>
              {status?.serverPort ? (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Port:</dt>
                  <dd className="font-mono text-slate-800">{status.serverPort}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-slate-500">Platform:</dt>
                <dd className="text-slate-800">{status?.isWindows ? 'Windows' : 'Other'}</dd>
              </div>
            </dl>
            <button className="btn-ghost btn-sm w-full mt-3" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh — تازہ کریں
            </button>
          </div>

          {status?.isWindows && mode === 'server' && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Firewall Permission — فائر وال اجازت
              </h3>
              <p className="text-xs text-slate-500 mb-3">
                Windows فائر وال کو پورٹ کھولنے کی اجازت دیں۔ "Add Firewall Rule" دبائیں اور UAC پر "Yes" کلک کریں۔
              </p>
              <button
                className="btn-secondary btn-sm w-full"
                onClick={handleAddFirewall}
                disabled={addingFirewall || (firewallStatus?.exists ?? false)}
              >
                {addingFirewall ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {firewallStatus?.exists ? 'Rule already added — پہلے سے ہے' : 'Add Firewall Rule — اجازت دیں'}
              </button>
            </div>
          )}

          <div className="card p-5 bg-slate-50">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">How it works — کیسے کام کرتا ہے</h3>
            <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside">
              <li>ایک PC پر <strong>Server mode</strong> منتخب کریں — وہاں ڈیٹا محفوظ رہے گا۔</li>
              <li>وہاں کا IP ایڈریس (جیسے 192.168.1.10) نوٹ کر لیں۔</li>
              <li>فائر وال کی اجازت دیں (ایک بار UAC پر Yes)۔</li>
              <li>باقی PC پر <strong>Client mode</strong> منتخب کر کے وہ IP درج کریں۔</li>
              <li>Test Connection دبائیں، پھر Apply کریں۔</li>
              <li>دونوں PC ایک ہی Wi-Fi/انٹرنیٹ پر ہونے چاہئیں۔</li>
            </ol>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingApply}
        onClose={() => setPendingApply(false)}
        onConfirm={handleApply}
        title="Apply Network Settings — نیٹ ورک سیٹنگز لگائیں"
        message={
          mode === 'standalone'
            ? 'Switch to Standalone mode? Other PCs will not be able to connect to this one.'
            : mode === 'server'
              ? `Start Server mode on port ${port}? Other PCs on your Wi-Fi will be able to connect to this PC.`
              : `Switch to Client mode and connect to ${host}:${port}?`
        }
        confirmText="Apply (لگائیں)"
        danger={false}
      />
    </div>
  );
}
