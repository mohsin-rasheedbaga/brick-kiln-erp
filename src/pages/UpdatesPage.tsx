import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { Spinner } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { updates as updateApi } from '../lib/ipc';
import { RefreshCw, Download, RotateCcw, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface UpdateInfo {
  currentVersion: string;
  autoUpdateEnabled: boolean;
  lastChecked: string | null;
  channel: string;
}
interface UpdateCheckResult {
  available: boolean;
  version?: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export default function UpdatesPage() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ percent: number; transferred: number; total: number } | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const loadInfo = async () => {
    try {
      setInfo(await updateApi.getInfo());
    } catch (err: any) { pushToast('error', err.message); }
  };

  useEffect(() => {
    loadInfo();
    // Subscribe to download progress events from main process
    const unsub = window.erp.on('update:download-progress', (progress: any) => {
      setDownloadProgress({
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      });
    });
    const unsub2 = window.erp.on('update:downloaded', () => {
      setDownloading(false);
      pushToast('success', 'Update downloaded. Click "Install & Restart" to apply.');
    });
    return () => { unsub(); unsub2(); };
  }, []);

  const handleCheck = async () => {
    setChecking(true);
    setUpdateResult(null);
    try {
      const r = await updateApi.check();
      setUpdateResult(r);
      if (r.available) {
        pushToast('info', `Version ${r.version} is available!`);
      } else {
        pushToast('success', 'You are on the latest version.');
      }
      loadInfo();
    } catch (err: any) {
      pushToast('error', err.message);
    } finally { setChecking(false); }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadProgress({ percent: 0, transferred: 0, total: 0 });
    try {
      await updateApi.download();
    } catch (err: any) {
      setDownloading(false);
      pushToast('error', err.message);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await updateApi.install();
    } catch (err: any) {
      setInstalling(false);
      pushToast('error', err.message);
    }
  };

  if (!info) return <Spinner className="mx-auto mt-12" />;

  return (
    <div>
      <PageHeader title="Updates" subtitle="Check for and install software updates" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Current Installation</h2>
          <dl className="text-sm space-y-2">
            <div className="flex justify-between"><dt className="text-slate-500">Version</dt><dd className="font-mono font-semibold text-slate-900">{info.currentVersion}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Channel</dt><dd className="text-slate-900">{info.channel}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Auto-update</dt><dd>{info.autoUpdateEnabled ? <span className="badge-success">Enabled</span> : <span className="badge-default">Disabled</span>}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Last checked</dt><dd className="text-slate-900">{info.lastChecked || 'Never'}</dd></div>
          </dl>

          <button className="btn-primary mt-5" onClick={handleCheck} disabled={checking}>
            {checking ? <><Spinner size="sm" className="border-white" /> Checking...</> : <><RefreshCw className="h-4 w-4" /> Check for Updates</>}
          </button>
        </div>

        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Update Status</h2>

          {!updateResult && !downloading && (
            <div className="text-sm text-slate-500 py-4 text-center">
              Click "Check for Updates" to see if a new version is available.
            </div>
          )}

          {updateResult && !downloading && (
            <div>
              {updateResult.available ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-md">
                    <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-amber-900">Version {updateResult.version} is available!</div>
                      <div className="text-xs text-amber-700 mt-1">Current: {info.currentVersion} → New: {updateResult.version}</div>
                    </div>
                  </div>

                  {updateResult.releaseNotes && (
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Release Notes</div>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {updateResult.releaseNotes}
                      </div>
                    </div>
                  )}

                  <button className="btn-primary w-full" onClick={handleDownload} disabled={downloading}>
                    <Download className="h-4 w-4" /> Download Update
                  </button>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-md">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-emerald-900">You are on the latest version!</div>
                    <div className="text-xs text-emerald-700 mt-1">Version {info.currentVersion}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {downloading && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Spinner size="sm" /> Downloading update...
              </div>
              {downloadProgress && (
                <div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>{downloadProgress.percent.toFixed(1)}%</span>
                    <span>{(downloadProgress.transferred / 1024 / 1024).toFixed(1)} MB / {(downloadProgress.total / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                  <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-600 transition-all" style={{ width: `${downloadProgress.percent}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {!downloading && updateResult?.available && (
            <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-md">
              <div className="text-sm text-emerald-800 mb-2">Update downloaded and ready to install!</div>
              <button className="btn-primary w-full" onClick={handleInstall} disabled={installing}>
                {installing ? <Spinner size="sm" className="border-white" /> : <RotateCcw className="h-4 w-4" />} Install & Restart
              </button>
              <p className="text-xs text-emerald-700 mt-2">The app will close, install the update, and restart automatically.</p>
            </div>
          )}
        </div>
      </div>

      <div className="card p-4 mt-6 bg-blue-50 border-blue-200">
        <div className="text-sm text-blue-800">
          <strong>Update source:</strong> GitHub Releases (mohsin-rasheedbaga/brick-kiln-erp)
          <br />
          Updates are delivered via electron-updater with differential (blockmap) downloads where supported.
        </div>
      </div>
    </div>
  );
}
