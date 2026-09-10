/**
 * Export utilities - CSV, Print, PDF (via browser print).
 *
 * No external libraries - all client-side using browser APIs:
 *   - CSV: build CSV string + download via Blob
 *   - Print: open a new window with HTML + call window.print()
 *   - PDF: triggered via "Save as PDF" in browser print dialog (no library)
 */

/**
 * Convert array of objects to CSV string.
 * Handles commas, quotes, newlines properly.
 */
export function arrayToCsv<T extends Record<string, any>>(rows: T[], columns?: Array<{ key: keyof T; label: string }>): string {
  if (rows.length === 0) return '';

  // Determine columns
  const cols = columns || Object.keys(rows[0]).map((k) => ({ key: k as keyof T, label: k }));

  const escape = (val: any): string => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = cols.map((c) => escape(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => escape(r[c.key])).join(',')).join('\n');
  return `${header}\n${body}`;
}

/**
 * Trigger CSV download in browser.
 */
export function downloadCsv(filename: string, csv: string): void {
  // Add BOM for Excel UTF-8 detection
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Convenience: convert rows to CSV and download.
 */
export function exportToCsv<T extends Record<string, any>>(filename: string, rows: T[], columns?: Array<{ key: keyof T; label: string }>): void {
  const csv = arrayToCsv(rows, columns);
  downloadCsv(filename, csv);
}

/**
 * Print arbitrary HTML content in a new window.
 * The window opens, loads the HTML, calls window.print(), then closes.
 *
 * @param title Document title
 * @param bodyHtml The HTML body to print
 * @param styles Optional CSS to inject in <head>
 */
export function printHtml(title: string, bodyHtml: string, styles?: string): void {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site to print.');
    return;
  }
  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 24px; font-size: 12px; }
          h1 { font-size: 20px; margin: 0 0 8px 0; }
          h2 { font-size: 16px; margin: 16px 0 8px 0; }
          h3 { font-size: 13px; margin: 12px 0 6px 0; }
          table { width: 100%; border-collapse: collapse; margin: 8px 0; }
          th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #e2e8f0; }
          th { background: #f1f5f9; font-weight: 600; font-size: 11px; text-transform: uppercase; }
          td { font-size: 12px; }
          td.right, th.right { text-align: right; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #0f172a; }
          .header-left { flex: 1; }
          .header-right { text-align: right; font-size: 11px; color: #64748b; }
          .summary { background: #f8fafc; padding: 12px; border-radius: 4px; margin: 12px 0; }
          .totals { margin-top: 16px; padding: 12px; background: #fef2f2; border-radius: 4px; }
          .totals-row { display: flex; justify-content: space-between; padding: 4px 0; }
          .totals-row.grand { font-weight: bold; font-size: 14px; border-top: 2px solid #0f172a; margin-top: 8px; padding-top: 8px; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
          .badge-success { background: #d1fae5; color: #065f46; }
          .badge-warning { background: #fef3c7; color: #92400e; }
          .badge-danger { background: #fee2e2; color: #991b1b; }
          .badge-info { background: #dbeafe; color: #1e40af; }
          .badge-default { background: #e2e8f0; color: #475569; }
          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          .text-muted { color: #64748b; font-size: 11px; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .mt-2 { margin-top: 8px; }
          .mb-2 { margin-bottom: 8px; }
          @media print {
            body { margin: 0; }
            .no-print { display: none; }
          }
          ${styles || ''}
        </style>
      </head>
      <body>
        ${bodyHtml}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              setTimeout(function() { window.close(); }, 200);
            }, 250);
          };
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

/**
 * Build a generic table HTML from rows + columns.
 */
export function buildTableHtml<T extends Record<string, any>>(
  rows: T[],
  columns: Array<{ key: keyof T; label: string; align?: 'left' | 'right' | 'center'; format?: (val: any) => string }>,
  options: { emptyText?: string } = {}
): string {
  if (rows.length === 0) {
    return `<p class="text-muted">${options.emptyText || 'No records found.'}</p>`;
  }
  const thead = `<tr>${columns.map((c) => `<th class="${c.align === 'right' ? 'right' : c.align === 'center' ? 'text-center' : ''}">${c.label}</th>`).join('')}</tr>`;
  const tbody = rows.map((r) => {
    return `<tr>${columns.map((c) => {
      const val = c.format ? c.format(r[c.key]) : (r[c.key] ?? '');
      return `<td class="${c.align === 'right' ? 'right' : c.align === 'center' ? 'text-center' : ''}">${val ?? ''}</td>`;
    }).join('')}</tr>`;
  }).join('');
  return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

/**
 * Standard report header HTML (kiln name, report title, date range).
 */
export function reportHeader(kilnName: string, reportTitle: string, dateRange?: { from?: string; to?: string }): string {
  const today = new Date().toLocaleDateString();
  const rangeLabel = dateRange?.from || dateRange?.to
    ? `${dateRange.from || '...'} to ${dateRange.to || '...'}`
    : 'All time';
  return `
    <div class="header">
      <div class="header-left">
        <h1>${kilnName}</h1>
        <h2>${reportTitle}</h2>
      </div>
      <div class="header-right">
        <div><strong>Generated:</strong> ${today}</div>
        <div><strong>Period:</strong> ${rangeLabel}</div>
      </div>
    </div>
  `;
}
