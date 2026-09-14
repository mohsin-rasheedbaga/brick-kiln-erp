/**
 * Worker Card Scanner Component
 *
 * Uses the browser's built-in BarcodeDetector API (available in Electron 32+)
 * to scan a worker's barcode or QR code directly from the camera, then
 * looks up the worker via IPC.
 *
 * Fallback: if BarcodeDetector is not available, shows a manual input
 * where the user can type/scan via USB barcode scanner (which types
 * characters + Enter automatically).
 */

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Spinner } from './Feedback';
import { workers as workerApi, workTypes as wtApi, departments as deptApi, brickCategories as catApi } from '../lib/ipc';
import type { Worker, WorkType, Department, BrickCategory } from '../types';
import { useToastStore } from '../stores/toast';
import { formatCurrency } from '../lib/utils';
import { Camera, Search, Package, CheckCircle2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onWorkerFound: (worker: Worker) => void;
}

export function WorkerScanModal({ open, onClose, onWorkerFound }: Props) {
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cameraSupported, setCameraSupported] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!open) return;
    // Check if BarcodeDetector is available
    const supported = typeof (window as any).BarcodeDetector !== 'undefined';
    setCameraSupported(supported);
    if (supported) {
      startCamera();
    }
    return () => stopCamera();
  }, [open]);

  const startCamera = async () => {
    try {
      setScanning(true);
      setError(null);

      // Request camera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Create detector for common 1D + 2D formats
      detectorRef.current = new (window as any).BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e'],
      });

      // Poll for barcodes every 500ms
      intervalRef.current = setInterval(async () => {
        if (!videoRef.current || !detectorRef.current) return;
        try {
          const barcodes = await detectorRef.current.detect(videoRef.current);
          if (barcodes && barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            if (code) {
              stopCamera();
              await lookupAndProceed(code);
            }
          }
        } catch (e) {
          // detection errors are normal during scanning
        }
      }, 500);
    } catch (err: any) {
      setError('Camera access failed: ' + (err?.message || err) + '. Use manual entry below or plug in a USB barcode scanner.');
      setScanning(false);
    }
  };

  const stopCamera = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const lookupAndProceed = async (code: string) => {
    setError(null);
    try {
      const worker = await workerApi.lookupByCode(code.trim());
      if (!worker) {
        setError(`No worker found for code: ${code}`);
        pushToast('error', 'Worker not found.');
        // Restart camera if supported
        if (cameraSupported) startCamera();
        return;
      }
      pushToast('success', `Worker found: ${worker.full_name}`);
      onWorkerFound(worker);
    } catch (err: any) {
      setError(err.message);
      if (cameraSupported) startCamera();
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    stopCamera();
    lookupAndProceed(manualCode.trim());
    setManualCode('');
  };

  if (!open) return null;

  return (
    <Modal
      open={true}
      onClose={() => { stopCamera(); onClose(); }}
      title="Scan Worker Card"
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={() => { stopCamera(); onClose(); }}>Close</button>
          {cameraSupported && !scanning && (
            <button className="btn-primary" onClick={startCamera}>
              <Camera className="h-4 w-4" /> Start Camera
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-sm">
            {error}
          </div>
        )}

        {/* Camera view */}
        {cameraSupported && (
          <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
            />
            {/* Scanning overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="border-2 border-emerald-400 rounded-lg w-3/4 h-1/3 relative">
                <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-emerald-400 rounded-tl" />
                <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-emerald-400 rounded-tr" />
                <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-emerald-400 rounded-bl" />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-emerald-400 rounded-br" />
                {scanning && (
                  <div className="absolute inset-x-0 top-1/2 h-0.5 bg-emerald-400 animate-pulse" />
                )}
              </div>
            </div>
            {scanning && (
              <div className="absolute bottom-2 left-2 right-2 text-center text-white text-xs bg-black/50 rounded px-2 py-1">
                <Spinner size="sm" className="border-white inline mr-2" />
                Point camera at worker card barcode/QR...
              </div>
            )}
          </div>
        )}

        {/* Manual entry / USB scanner */}
        <div className="border-t border-slate-200 pt-4">
          <label className="label flex items-center gap-2">
            <Search className="h-4 w-4" />
            Manual Entry or USB Barcode Scanner
          </label>
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              type="text"
              className="input flex-1"
              placeholder="Type worker code, barcode, or scan with USB scanner..."
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              autoFocus={!cameraSupported}
            />
            <button type="submit" className="btn-primary">
              <Search className="h-4 w-4" /> Search
            </button>
          </form>
          <p className="text-xs text-slate-500 mt-2">
            USB barcode scanners work like keyboards — they type the code and press Enter automatically.
            Just focus the input field above and scan the card.
          </p>
        </div>

        {/* Hint card */}
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">
          <div className="font-medium flex items-center gap-2">
            <Package className="h-4 w-4" /> Quick Production Entry Flow
          </div>
          <ol className="list-decimal list-inside mt-1 text-xs space-y-0.5">
            <li>Scan worker card (camera or USB scanner)</li>
            <li>Worker details appear</li>
            <li>Choose work type + enter quantity</li>
            <li>Rate auto-applied from department rates</li>
            <li>Save — entry recorded with audit trail</li>
          </ol>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Quick Production Entry Modal
 * Opens after a worker is scanned, pre-fills worker info,
 * lets user record a production entry in seconds.
 */
export function QuickProductionEntry({
  worker,
  workTypes,
  departments,
  categories,
  onClose,
  onSaved,
}: {
  worker: Worker;
  workTypes: WorkType[];
  departments: Department[];
  categories: BrickCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Determine the stage based on worker's department
  const workerDeptId = worker.department_id;
  const DEPT_STAGE_MAP: Record<string, string> = {
    'dept-raw-brick': 'raw_brick_making',
    'dept-transport': 'raw_brick_transport',
    'dept-kiln-loading': 'kiln_loading',
    'dept-kiln-firing': 'kiln_loading',
    'dept-kiln-unloading': 'baked_brick_unloading',
    'dept-grading': 'baked_brick_unloading',
  };
  const autoStage = DEPT_STAGE_MAP[workerDeptId] || 'raw_brick_making';

  const [form, setForm] = useState({
    stage: autoStage,
    date: new Date().toISOString().slice(0, 10),
    workTypeId: worker.work_type_id || '',
    departmentId: worker.department_id,
    kilnId: '',
    quantity: 0,
    ratePer1000: worker.rate_per_1000 || 0,
    notes: '',
    categoryId: '',
  });
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // Filter work types by worker's department
  const filteredWorkTypes = workTypes.filter(
    (wt) => !wt.department_id || wt.department_id === worker.department_id
  );

  // If work type selected, auto-fill rate from department rates
  useEffect(() => {
    if (form.workTypeId) {
      // Try to fetch department rate
      (async () => {
        try {
          const { departmentRates } = await import('../lib/ipc');
          const result = await departmentRates.getByContext(form.departmentId, form.workTypeId, form.categoryId || undefined);
          if (result.rate_per_1000 > 0) {
            setForm((f) => ({ ...f, ratePer1000: result.rate_per_1000 }));
          }
        } catch (e) {
          // Fall back to worker's rate
        }
      })();
    }
  }, [form.workTypeId, form.categoryId, form.departmentId]);

  const labourAmount = (Number(form.quantity) / 1000) * Number(form.ratePer1000);

  const handleSubmit = async () => {
    if (!form.workTypeId) { pushToast('warning', 'Work type is required.'); return; }
    if (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) <= 0) {
      pushToast('warning', 'Quantity must be a positive integer.');
      return;
    }
    setSaving(true);
    try {
      const { production } = await import('../lib/ipc');
      await production.create({
        stage: form.stage,
        date: form.date,
        workerId: worker.id,
        departmentId: form.departmentId,
        workTypeId: form.workTypeId,
        kilnId: form.kilnId || undefined,
        quantity: Number(form.quantity),
        ratePer1000: Number(form.ratePer1000),
        notes: form.notes || undefined,
        categoryId: form.stage === 'baked_brick_unloading' ? (form.categoryId || categories[0]?.id) : undefined,
      });
      pushToast('success', `Production entry recorded for ${worker.full_name}`);
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
      title={`Quick Entry: ${worker.full_name}`}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Close</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" className="border-white" /> : <><CheckCircle2 className="h-4 w-4" /> Save Entry</>}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Worker info banner */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold">
              {worker.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="font-semibold text-slate-900">{worker.full_name}</div>
              <div className="text-xs text-slate-500">
                {worker.worker_code} · {worker.department_name || '—'} · {worker.work_type_name || '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">Personal Rate</div>
              <div className="font-mono font-semibold text-slate-900">{formatCurrency(worker.rate_per_1000)}/1000</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Stage (auto from department)</label>
            <select
              className="input"
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value })}
            >
              {/* Show all stages but pre-select based on worker's department */}
              <option value="raw_brick_making">Raw Brick Making</option>
              <option value="raw_brick_transport">Raw Brick Transport</option>
              <option value="kiln_loading">Kiln Loading</option>
              <option value="baked_brick_unloading">Baked Brick Unloading</option>
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">Work Type *</label>
          <select
            className="input"
            value={form.workTypeId}
            onChange={(e) => setForm({ ...form, workTypeId: e.target.value })}
          >
            <option value="">Select work type...</option>
            {filteredWorkTypes.map((wt) => (
              <option key={wt.id} value={wt.id}>
                {wt.name} (default: {formatCurrency(wt.default_rate_per_1000)}/1000)
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Quantity *</label>
            <input
              type="number"
              min={1}
              step={1}
              className="input"
              value={form.quantity || ''}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Rate per 1000 (auto)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              className="input bg-slate-100"
              value={form.ratePer1000 || ''}
              readOnly
            />
            <p className="text-xs text-slate-400 mt-1">Auto-filled from worker profile. Rate is fixed.</p>
          </div>
        </div>

        {form.stage === 'baked_brick_unloading' && (
          <div>
            <label className="label">Brick Category</label>
            <select
              className="input"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {/* Live labour calculation */}
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md">
          <div className="text-xs text-emerald-700 uppercase tracking-wider font-medium">Calculated Labour Amount</div>
          <div className="text-2xl font-bold text-emerald-900 mt-1">{formatCurrency(labourAmount)}</div>
          <div className="text-xs text-emerald-700 mt-0.5">
            {form.quantity || 0} ÷ 1000 × {formatCurrency(form.ratePer1000)} = {formatCurrency(labourAmount)}
          </div>
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <input
            className="input"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="e.g. first shift, machine #2..."
          />
        </div>
      </div>
    </Modal>
  );
}

