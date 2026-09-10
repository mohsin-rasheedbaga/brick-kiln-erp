import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Card';
import { ConfirmDialog } from '../components/Modal';
import { Spinner, EmptyState } from '../components/Feedback';
import { useToastStore } from '../stores/toast';
import { backup as backupApi } from '../lib/ipc';
import type { BackupRecord } from '../types';
import { formatDateTime, formatFileSize } from '../lib/utils';
import { DatabaseBackup, RotateCcw, Trash2, Plus } from 'lucide-react';

export default function BackupPage() {
  const [items, setItems] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupRecord | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await backupApi.list(100));
    } catch (err: any) {
      pushToast('error', err.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await backupApi.create(`Manual backup from ${new Date().toLocaleString()}`);
      pushToast('success', `Backup created: ${formatFileSize(result.sizeBytes)}`);
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    } finally { setCreating(false); }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      await backupApi.restore(restoreTarget.id);
      pushToast('info', 'Restore initiated. The application will restart in a moment...');
      // app will relaunch itself; nothing else to do here
    } catch (err: any) {
      pushToast('error', err.message);
    } finally { setRestoreTarget(null); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await backupApi.delete(deleteTarget.id, true);
      pushToast('success', 'Backup deleted.');
      load();
    } catch (err: any) {
      pushToast('error', err.message);
    } finally { setDeleteTarget(null); }
  };

  return (
    <div>
      <PageHeader
        title="Backup & Restore"
        subtitle="Create, restore, and manage database backups"
        actions={
          <button className="btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? <Spinner size="sm" className="border-white" /> : <><Plus className="h-4 w-4" /> Create Backup</>}
          </button>
        }
      />

      <div className="card p-4 mb-4 bg-blue-50 border-blue-200">
        <div className="flex gap-3">
          <DatabaseBackup className="h-5 w-5 text-blue-600 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <strong>How backups work:</strong> Each backup creates a timestamped copy of your SQLite database file in the configured backup folder. Restoring replaces the current database and restarts the app — a safety backup is automatically created first.
          </div>
        </div>
      </div>

      {loading ? (
        <Spinner className="mx-auto mt-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No backups yet" message="Click 'Create Backup' to make your first backup." icon={<DatabaseBackup className="h-8 w-8" />} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Date</th>
                <th className="text-left px-4 py-3 font-semibold">Type</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Size</th>
                <th className="text-left px-4 py-3 font-semibold">Notes</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-700">{formatDateTime(b.backup_date)}</td>
                  <td className="px-4 py-2">
                    {b.backup_type === 'manual' ? <span className="badge-info">Manual</span>
                      : b.backup_type === 'automatic' ? <span className="badge-success">Automatic</span>
                      : b.backup_type === 'pre_restore' ? <span className="badge-warning">Pre-restore</span>
                      : <span className="badge-default">{b.backup_type}</span>}
                  </td>
                  <td className="px-4 py-2">
                    {b.status === 'success' ? <span className="badge-success">Success</span>
                      : b.status === 'failed' ? <span className="badge-danger">Failed</span>
                      : <span className="badge-warning">{b.status}</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{b.file_size_bytes ? formatFileSize(b.file_size_bytes) : '—'}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{b.notes || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setRestoreTarget(b)} className="btn-ghost btn-sm" title="Restore">
                        <RotateCcw className="h-3.5 w-3.5" />
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

      <ConfirmDialog
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={handleRestore}
        title="Restore Database"
        message={`Restore from backup dated ${restoreTarget ? formatDateTime(restoreTarget.backup_date) : ''}? This will REPLACE all current data. A safety backup will be created first. The app will restart after restore.`}
        confirmText="Restore Now"
        danger
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Backup"
        message={`Delete this backup file permanently? This cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
