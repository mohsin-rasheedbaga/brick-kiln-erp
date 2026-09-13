/**
 * Worker Card Print Component
 *
 * Renders a printable worker ID card with:
 *   - Brick kiln name + logo placeholder
 *   - Worker name + worker code
 *   - Department + work type
 *   - Barcode (Code128, generated via JsBarcode)
 *   - QR code (PNG data URL, generated via qrcode library)
 *
 * The QR encodes ONLY the worker's qr_token (a random UUID-like string),
 * which the application maps to a worker_id when scanned. No sensitive
 * data is embedded in the QR.
 *
 * Print: triggers window.print() with a print-only stylesheet that hides
 * the rest of the UI and renders just the card centered on the page.
 */

import { useEffect, useState, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { Modal } from './Modal';
import { Spinner } from './Feedback';
import { Printer } from 'lucide-react';
import type { Worker } from '../types';

interface Props {
  worker: Worker;
  onClose: () => void;
}

export function WorkerCardPrint({ worker, onClose }: Props) {
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string>('');
  const [familyNumber, setFamilyNumber] = useState<string | null>(null);
  const [accountBalance, setAccountBalance] = useState<number | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    async function generate() {
      try {
        // Generate barcode SVG via JsBarcode
        const svgEl = document.createElement('svg');
        JsBarcode(svgEl, worker.barcode, {
          format: 'CODE128',
          width: 2,
          height: 50,
          displayValue: true,
          fontSize: 12,
          margin: 4,
        });
        const svgString = new XMLSerializer().serializeToString(svgEl);
        const barcodeUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;

        // Generate QR code
        const qrUrl = await QRCode.toDataURL(worker.qr_token, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 180,
          color: { dark: '#0f172a', light: '#ffffff' },
        });

        // Phase 4: Load family number + account balance in parallel
        try {
          const { workerFamily, workerAccount } = await import('../lib/ipc');
          const [fam, acc] = await Promise.all([
            workerFamily.get(worker.id),
            workerAccount.summary(worker.id),
          ]);
          if (mounted) {
            setFamilyNumber(fam?.family_number ?? null);
            setAccountBalance(acc.balance);
          }
        } catch (e) {
          // Not critical — card still prints without these
        }

        if (mounted) {
          setBarcodeDataUrl(barcodeUrl);
          setQrDataUrl(qrUrl);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          console.error('Card generation failed:', err);
          setLoading(false);
        }
      }
    }

    generate();
    return () => { mounted = false; };
  }, [worker]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Worker Card"
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={handlePrint} disabled={loading}>
            <Printer className="h-4 w-4" /> Print Card
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="flex justify-center">
          {/* Card - 8.5cm x 5.4cm (CR80 standard) */}
          <div
            ref={printRef}
            className="print-area bg-white border-2 border-slate-300 rounded-lg shadow-lg"
            style={{ width: '8.5cm', height: '5.4cm', padding: '0.3cm', position: 'relative', overflow: 'hidden' }}
          >
            {/* Header band */}
            <div className="bg-brand-700 text-white px-2 py-1 rounded flex items-center justify-between text-[10px]">
              <div className="font-bold">BRICK KILN ERP</div>
              <div className="text-brand-100">{new Date().getFullYear()}</div>
            </div>

            {/* Body */}
            <div className="flex gap-2 mt-1.5">
              {/* Left: photo + name */}
              <div className="flex-1">
                <div className="text-[8px] text-slate-500 uppercase">Worker</div>
                <div className="font-bold text-slate-900 text-[11px] leading-tight">{worker.full_name}</div>
                {worker.father_name && (
                  <div className="text-[8px] text-slate-500">S/o {worker.father_name}</div>
                )}
                <div className="mt-1 text-[9px]">
                  <div className="text-slate-500">Code: <span className="font-mono font-bold text-slate-900">{worker.worker_code}</span></div>
                  <div className="text-slate-500">Dept: <span className="font-semibold text-slate-900">{worker.department_name || '—'}</span></div>
                  <div className="text-slate-500">Work: <span className="font-semibold text-slate-900">{worker.work_type_name || '—'}</span></div>
                  {familyNumber && (
                    <div className="text-slate-500">Gharana: <span className="font-mono text-slate-900">{familyNumber}</span></div>
                  )}
                  {accountBalance !== null && (
                    <div className="text-slate-500">
                      Bal: <span className={`font-mono font-bold ${accountBalance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        Rs. {accountBalance.toFixed(0)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {/* Right: QR code */}
              <div className="flex flex-col items-center">
                <img src={qrDataUrl} alt="QR" style={{ width: '2cm', height: '2cm' }} />
                <div className="text-[6px] text-slate-400 mt-0.5">Scan to lookup</div>
              </div>
            </div>

            {/* Barcode at bottom */}
            <div className="absolute bottom-1 left-2 right-2">
              <img src={barcodeDataUrl} alt="Barcode" style={{ width: '100%', height: '1cm', objectFit: 'contain' }} />
            </div>
          </div>
        </div>
      )}

      {/* Preview in modal (always visible on screen, hidden on print) */}
      {!loading && (
        <div className="no-print flex justify-center mt-4">
          <div className="text-xs text-slate-500">Card preview ready. Click "Print Card" to send to printer.</div>
        </div>
      )}
    </Modal>
  );
}
