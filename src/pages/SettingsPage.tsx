import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Spinner } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { useAuthStore } from '../stores/auth';
import { settings as settingsApi } from '../lib/ipc';
import type { Settings } from '../types';
import { Save } from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);
  const { user, logout } = useAuthStore();

  const load = async () => {
    setLoading(true);
    try {
      setSettings(await settingsApi.get());
    } catch (err: any) {
      pushToast('error', err.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await settingsApi.update({
        kiln_name: settings.kiln_name,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        currency: settings.currency,
        currency_symbol: settings.currency_symbol,
        date_format: settings.date_format,
        timezone: settings.timezone,
        allow_negative_stock: settings.allow_negative_stock,
        allow_overpayment: settings.allow_overpayment,
        auto_logout_minutes: settings.auto_logout_minutes,
        auto_backup_enabled: settings.auto_backup_enabled,
        auto_backup_interval_hours: settings.auto_backup_interval_hours,
        backup_location: settings.backup_location,
        auto_update_enabled: settings.auto_update_enabled,
        update_channel: settings.update_channel,
      });
      setSettings(updated);
      pushToast('success', 'Settings saved.');
    } catch (err: any) {
      pushToast('error', err.message);
    } finally { setSaving(false); }
  };

  if (loading || !settings) return <Spinner className="mx-auto mt-12" />;

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configure your brick kiln ERP"
        actions={
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : <><Save className="h-4 w-4" /> Save Changes</>}
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* General */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">General</h2>
          <div className="space-y-3">
            <div>
              <label className="label">Kiln Name</label>
              <input className="input" value={settings.kiln_name} onChange={(e) => setSettings({ ...settings, kiln_name: e.target.value })} />
            </div>
            <div>
              <label className="label">Address</label>
              <textarea className="input" rows={2} value={settings.address} onChange={(e) => setSettings({ ...settings, address: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Phone</label>
                <input className="input" value={settings.phone} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" value={settings.email || ''} onChange={(e) => setSettings({ ...settings, email: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Currency</label>
                <input className="input" value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} />
              </div>
              <div>
                <label className="label">Currency Symbol</label>
                <input className="input" value={settings.currency_symbol} onChange={(e) => setSettings({ ...settings, currency_symbol: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Date Format</label>
                <select className="input" value={settings.date_format} onChange={(e) => setSettings({ ...settings, date_format: e.target.value })}>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  <option value="DD-MM-YYYY">DD-MM-YYYY</option>
                </select>
              </div>
              <div>
                <label className="label">Timezone</label>
                <input className="input" value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} />
              </div>
            </div>
          </div>
        </div>

        {/* Operational */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Operational</h2>
          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-md cursor-pointer hover:bg-slate-50">
              <input type="checkbox" className="mt-0.5" checked={settings.allow_negative_stock} onChange={(e) => setSettings({ ...settings, allow_negative_stock: e.target.checked })} />
              <div>
                <div className="text-sm font-medium text-slate-900">Allow Negative Stock</div>
                <div className="text-xs text-slate-500">Permit sales even when stock is insufficient (creates negative balance).</div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-md cursor-pointer hover:bg-slate-50">
              <input type="checkbox" className="mt-0.5" checked={settings.allow_overpayment} onChange={(e) => setSettings({ ...settings, allow_overpayment: e.target.checked })} />
              <div>
                <div className="text-sm font-medium text-slate-900">Allow Overpayment</div>
                <div className="text-xs text-slate-500">Permit customer payments exceeding their outstanding balance.</div>
              </div>
            </label>
            <div>
              <label className="label">Auto Logout (minutes)</label>
              <input type="number" min={1} max={1440} className="input" value={settings.auto_logout_minutes} onChange={(e) => setSettings({ ...settings, auto_logout_minutes: Number(e.target.value) })} />
              <p className="text-xs text-slate-500 mt-1">User will be logged out automatically after this many minutes of inactivity.</p>
            </div>
          </div>
        </div>

        {/* Backup */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Backup</h2>
          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-md cursor-pointer hover:bg-slate-50">
              <input type="checkbox" className="mt-0.5" checked={settings.auto_backup_enabled} onChange={(e) => setSettings({ ...settings, auto_backup_enabled: e.target.checked })} />
              <div>
                <div className="text-sm font-medium text-slate-900">Enable Automatic Backups</div>
                <div className="text-xs text-slate-500">Automatically create database backups at the configured interval.</div>
              </div>
            </label>
            <div>
              <label className="label">Backup Interval (hours)</label>
              <input type="number" min={1} max={168} className="input" value={settings.auto_backup_interval_hours} onChange={(e) => setSettings({ ...settings, auto_backup_interval_hours: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">Backup Location (leave empty for default)</label>
              <input className="input" value={settings.backup_location || ''} onChange={(e) => setSettings({ ...settings, backup_location: e.target.value })} placeholder="e.g. D:\Backups\BrickKiln" />
              <p className="text-xs text-slate-500 mt-1">Default: user data folder → /backups</p>
            </div>
          </div>
        </div>

        {/* Updates */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Updates</h2>
          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-md cursor-pointer hover:bg-slate-50">
              <input type="checkbox" className="mt-0.5" checked={settings.auto_update_enabled} onChange={(e) => setSettings({ ...settings, auto_update_enabled: e.target.checked })} />
              <div>
                <div className="text-sm font-medium text-slate-900">Enable Auto-Update Check</div>
                <div className="text-xs text-slate-500">Periodically check GitHub Releases for new versions.</div>
              </div>
            </label>
            <div>
              <label className="label">Update Channel</label>
              <select className="input" value={settings.update_channel} onChange={(e) => setSettings({ ...settings, update_channel: e.target.value })}>
                <option value="latest">latest (stable)</option>
                <option value="beta">beta (pre-release)</option>
              </select>
            </div>
            <div className="text-xs text-slate-500">
              Current version: <span className="font-mono font-semibold text-slate-700">{settings.app_version}</span>
              <br />
              Schema version: <span className="font-mono">{settings.schema_version}</span>
              <br />
              Last checked: <span className="text-slate-600">{settings.last_update_check || 'Never'}</span>
            </div>
          </div>
        </div>

        {/* Account */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-900 mb-4">My Account</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Username:</span><span className="font-medium text-slate-900">{user?.username}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Full Name:</span><span className="font-medium text-slate-900">{user?.fullName}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Role:</span><span className="font-medium text-slate-900">{user?.roleName}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Permissions:</span><span className="font-medium text-slate-900">{user?.permissions.length ?? 0} granted</span></div>
            </div>
            <div className="flex flex-col gap-2">
              <button className="btn-secondary" onClick={() => pushToast('info', 'Password change form coming in next iteration. Use the Reset Password dialog from Users page if needed.')}>
                Change My Password
              </button>
              <button className="btn-danger" onClick={async () => { await logout(); pushToast('info', 'Logged out.'); }}>Sign Out</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
