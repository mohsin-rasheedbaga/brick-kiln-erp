import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Spinner } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { cloud as cloudApi, settings as settingsApi } from '../lib/ipc';
import { formatDateTime, formatFileSize } from '../lib/utils';
import {
  Cloud, Database, RefreshCw, CheckCircle2, XCircle, Upload,
  Link2, Unlink, ExternalLink, Settings as SettingsIcon, CloudOff,
} from 'lucide-react';

export default function CloudSyncPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<any>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // Supabase form
  const [supabaseForm, setSupabaseForm] = useState({
    enabled: false,
    url: '',
    anonKey: '',
  });
  const [testing, setTesting] = useState(false);

  // Google Drive form
  const [gdriveForm, setGdriveForm] = useState({
    clientId: '',
    clientSecret: '',
    folderId: '',
    autoBackup: true,
  });
  const [authUrl, setAuthUrl] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [connecting, setConnecting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, b] = await Promise.all([
        cloudApi.status(),
        cloudApi.gdrive.listBackups(),
      ]);
      setStatus(s);
      setBackups(b);

      // Load current settings to pre-fill forms
      const settings = await settingsApi.get();
      setSupabaseForm({
        enabled: s.supabase.enabled,
        url: s.supabase.url || '',
        anonKey: '',
      });
      // We need to get gdrive settings from the status
      const gStatus = await cloudApi.gdrive.status();
      setGdriveForm({
        clientId: '',
        clientSecret: '',
        folderId: '',
        autoBackup: gStatus.autoBackup ?? true,
      });
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // === Supabase handlers ===
  const handleSaveSupabase = async () => {
    try {
      await cloudApi.supabase.configure({
        enabled: supabaseForm.enabled,
        url: supabaseForm.url || undefined,
        anonKey: supabaseForm.anonKey || undefined,
      });
      pushToast('success', 'Supabase settings saved.');
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    }
  };

  const handleTestSupabase = async () => {
    setTesting(true);
    try {
      const result = await cloudApi.supabase.test();
      if (result.success) {
        pushToast('success', result.message);
      } else {
        pushToast('error', result.message);
      }
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await cloudApi.supabase.sync();
      if (result.success) {
        pushToast('success', `Sync complete: pushed ${result.total_pushed}, pulled ${result.total_pulled}.`);
      } else {
        pushToast('warning', `Sync partial: pushed ${result.total_pushed}, pulled ${result.total_pulled}, ${result.errors.length} errors.`);
      }
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setSyncing(false);
    }
  };

  // === Google Drive handlers ===
  const handleSaveGdriveConfig = async () => {
    try {
      await cloudApi.gdrive.setConfig({
        clientId: gdriveForm.clientId || undefined,
        clientSecret: gdriveForm.clientSecret || undefined,
        folderId: gdriveForm.folderId || undefined,
        autoBackup: gdriveForm.autoBackup,
      });
      pushToast('success', 'Google Drive config saved.');
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    }
  };

  const handleGetAuthUrl = async () => {
    try {
      const result = await cloudApi.gdrive.authUrl();
      if (result.error) {
        pushToast('error', result.error);
        return;
      }
      setAuthUrl(result.url);
      pushToast('info', 'Authorization URL generated. Click "Open URL" to visit it in your browser.');
    } catch (err: any) {
      pushToast('error', err.message);
    }
  };

  const handleExchangeCode = async () => {
    if (!authCode.trim()) {
      pushToast('warning', 'Paste the authorization code first.');
      return;
    }
    setConnecting(true);
    try {
      const result = await cloudApi.gdrive.exchangeCode(authCode.trim());
      if (result.success) {
        pushToast('success', `Connected as ${result.email}!`);
        setAuthCode('');
        setAuthUrl('');
        load();
      } else {
        pushToast('error', result.error || 'Connection failed.');
      }
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Google Drive? Auto-backup will be disabled.')) return;
    try {
      await cloudApi.gdrive.disconnect();
      pushToast('info', 'Google Drive disconnected.');
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const result = await cloudApi.gdrive.backup();
      if (result.success) {
        pushToast('success', `Backup uploaded: ${result.fileName} (${formatFileSize(result.fileSize || 0)})`);
        load();
      } else {
        pushToast('error', result.error || 'Backup failed.');
      }
    } catch (err: any) {
      pushToast('error', err.message);
    } finally {
      setBackingUp(false);
    }
  };

  if (loading) return <Spinner className="mx-auto mt-12" />;

  const gdriveStatus = status?.gdrive || {};
  const supabaseStatus = status?.supabase || {};

  return (
    <div>
      <PageHeader
        title="Cloud Sync & Backup"
        subtitle="Supabase for online/offline sync + Google Drive for automatic backups"
      />

      {/* Status overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Supabase status */}
        <div className={`card p-4 ${supabaseStatus.enabled ? 'border-emerald-200 bg-emerald-50' : ''}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className={`h-5 w-5 ${supabaseStatus.enabled ? 'text-emerald-600' : 'text-slate-400'}`} />
              <div>
                <div className="text-sm font-semibold text-slate-900">Supabase Sync</div>
                <div className="text-xs text-slate-500">
                  {supabaseStatus.enabled ? 'Enabled' : 'Disabled'}
                  {supabaseStatus.lastSync && ` · Last: ${formatDateTime(supabaseStatus.lastSync)}`}
                </div>
              </div>
            </div>
            {supabaseStatus.enabled ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <CloudOff className="h-5 w-5 text-slate-400" />
            )}
          </div>
        </div>

        {/* Google Drive status */}
        <div className={`card p-4 ${gdriveStatus.connected ? 'border-blue-200 bg-blue-50' : ''}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud className={`h-5 w-5 ${gdriveStatus.connected ? 'text-blue-600' : 'text-slate-400'}`} />
              <div>
                <div className="text-sm font-semibold text-slate-900">Google Drive</div>
                <div className="text-xs text-slate-500">
                  {gdriveStatus.connected ? `Connected: ${gdriveStatus.email}` : 'Not connected'}
                  {gdriveStatus.lastBackup && ` · Last: ${formatDateTime(gdriveStatus.lastBackup)}`}
                </div>
              </div>
            </div>
            {gdriveStatus.connected ? (
              <CheckCircle2 className="h-5 w-5 text-blue-600" />
            ) : (
              <CloudOff className="h-5 w-5 text-slate-400" />
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* === Supabase Section === */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-600" />
            Supabase Configuration
          </h2>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={supabaseForm.enabled}
                onChange={(e) => setSupabaseForm({ ...supabaseForm, enabled: e.target.checked })}
              />
              Enable Supabase cloud sync
            </label>

            <div>
              <label className="label">Supabase Project URL</label>
              <input
                className="input"
                placeholder="https://xxxxx.supabase.co"
                value={supabaseForm.url}
                onChange={(e) => setSupabaseForm({ ...supabaseForm, url: e.target.value })}
              />
            </div>

            <div>
              <label className="label">Anon Key (public)</label>
              <input
                className="input font-mono text-xs"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                value={supabaseForm.anonKey}
                onChange={(e) => setSupabaseForm({ ...supabaseForm, anonKey: e.target.value })}
              />
              <p className="text-xs text-slate-500 mt-1">
                Get these from your Supabase dashboard → Settings → API.
              </p>
            </div>

            <div className="flex gap-2">
              <button className="btn-secondary" onClick={handleSaveSupabase}>
                <SettingsIcon className="h-4 w-4" /> Save
              </button>
              <button
                className="btn-secondary"
                onClick={handleTestSupabase}
                disabled={testing || !supabaseForm.enabled}
              >
                {testing ? <Spinner size="sm" /> : <Link2 className="h-4 w-4" />} Test Connection
              </button>
              <button
                className="btn-primary"
                onClick={handleSync}
                disabled={syncing || !supabaseForm.enabled}
              >
                {syncing ? <Spinner size="sm" className="border-white" /> : <RefreshCw className="h-4 w-4" />} Sync Now
              </button>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
              <strong>How to set up Supabase (free):</strong>
              <ol className="list-decimal list-inside mt-1 space-y-0.5">
                <li>Go to <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="underline">supabase.com</a> and create a free account</li>
                <li>Create a new project (free tier)</li>
                <li>Go to Settings → API → copy Project URL + anon public key</li>
                <li>Paste them above and click Save</li>
                <li>Click "Sync Now" to push your local data to the cloud</li>
              </ol>
              <p className="mt-2">
                Your data stays on your computer. Sync only pushes/pulls changes when you click "Sync Now".
                Works offline — internet needed only during sync.
              </p>
            </div>
          </div>
        </div>

        {/* === Google Drive Section === */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Cloud className="h-5 w-5 text-blue-600" />
            Google Drive Backup
          </h2>

          {gdriveStatus.connected ? (
            // Connected view
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-blue-600" />
                  <div>
                    <div className="text-sm font-medium text-blue-900">Connected as {gdriveStatus.email}</div>
                    {gdriveStatus.lastBackup && (
                      <div className="text-xs text-blue-700">Last backup: {formatDateTime(gdriveStatus.lastBackup)}</div>
                    )}
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={gdriveForm.autoBackup}
                  onChange={(e) => {
                    setGdriveForm({ ...gdriveForm, autoBackup: e.target.checked });
                    cloudApi.gdrive.setConfig({ autoBackup: e.target.checked });
                  }}
                />
                Auto-backup every 24 hours
              </label>

              <div className="flex gap-2">
                <button className="btn-primary" onClick={handleBackup} disabled={backingUp}>
                  {backingUp ? <Spinner size="sm" className="border-white" /> : <Upload className="h-4 w-4" />} Backup Now
                </button>
                <button className="btn-danger" onClick={handleDisconnect}>
                  <Unlink className="h-4 w-4" /> Disconnect
                </button>
              </div>
            </div>
          ) : (
            // Setup view
            <div className="space-y-3">
              <div>
                <label className="label">Google OAuth Client ID</label>
                <input
                  className="input"
                  placeholder="xxxxx.apps.googleusercontent.com"
                  value={gdriveForm.clientId}
                  onChange={(e) => setGdriveForm({ ...gdriveForm, clientId: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Google OAuth Client Secret</label>
                <input
                  className="input"
                  type="password"
                  placeholder="GOCSPX-xxxxx"
                  value={gdriveForm.clientSecret}
                  onChange={(e) => setGdriveForm({ ...gdriveForm, clientSecret: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Google Drive Folder ID (optional)</label>
                <input
                  className="input"
                  placeholder="Leave empty to use root folder"
                  value={gdriveForm.folderId}
                  onChange={(e) => setGdriveForm({ ...gdriveForm, folderId: e.target.value })}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Get folder ID from Google Drive URL when you open a folder.
                </p>
              </div>

              <button className="btn-secondary" onClick={handleSaveGdriveConfig}>
                <SettingsIcon className="h-4 w-4" /> Save Config
              </button>

              {authUrl && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md space-y-2">
                  <div className="text-sm font-medium text-amber-900">Step 1: Authorize</div>
                  <p className="text-xs text-amber-700">
                    Click the link below, sign in with your Google account, and grant permission.
                    You'll get a code — paste it in the field below.
                  </p>
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => cloudApi.gdrive.openLink(authUrl)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open Authorization URL
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <button className="btn-secondary" onClick={handleGetAuthUrl}>
                  <Link2 className="h-4 w-4" /> Get Auth URL
                </button>
              </div>

              {authUrl && (
                <div>
                  <label className="label">Authorization Code</label>
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="Paste the code from the redirect URL here..."
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                  />
                  <button
                    className="btn-primary mt-2"
                    onClick={handleExchangeCode}
                    disabled={connecting || !authCode.trim()}
                  >
                    {connecting ? <Spinner size="sm" className="border-white" /> : <CheckCircle2 className="h-4 w-4" />} Connect
                  </button>
                </div>
              )}

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
                <strong>How to set up Google Drive backup:</strong>
                <ol className="list-decimal list-inside mt-1 space-y-0.5">
                  <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline">Google Cloud Console</a></li>
                  <li>Create a project → enable Google Drive API</li>
                  <li>Create OAuth 2.0 credentials (Desktop app type)</li>
                  <li>Copy Client ID + Client Secret → paste above</li>
                  <li>Click "Save Config" then "Get Auth URL"</li>
                  <li>Open URL → grant permission → copy code back</li>
                  <li>Paste code → click "Connect"</li>
                </ol>
                <p className="mt-2">
                  After connecting, enable "Auto-backup every 24 hours" and the app will
                  automatically upload your database to Google Drive daily.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Backup history */}
      {backups.length > 0 && (
        <div className="card p-5 mt-6">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Google Drive Backup History</h2>
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2">File Name</th>
                <th className="text-right py-2">Size</th>
                <th className="text-left py-2">Type</th>
                <th className="text-left py-2">Status</th>
                <th className="text-right py-2">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {backups.slice(0, 20).map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="py-2 text-slate-600">{formatDateTime(b.backup_date)}</td>
                  <td className="py-2 font-mono text-xs text-slate-900">{b.file_name}</td>
                  <td className="py-2 text-right font-mono text-slate-700">
                    {b.file_size_bytes ? formatFileSize(b.file_size_bytes) : '—'}
                  </td>
                  <td className="py-2">
                    {b.backup_type === 'auto' ? <span className="badge-info">Auto</span> : <span className="badge-default">Manual</span>}
                  </td>
                  <td className="py-2">
                    {b.status === 'success' ? <span className="badge-success">Success</span> : <span className="badge-danger">Failed</span>}
                  </td>
                  <td className="py-2 text-right">
                    {b.drive_link && (
                      <button
                        onClick={() => cloudApi.gdrive.openLink(b.drive_link)}
                        className="btn-ghost btn-sm"
                        title="Open in Google Drive"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
