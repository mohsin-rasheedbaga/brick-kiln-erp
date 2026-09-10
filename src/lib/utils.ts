import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, symbol = 'Rs.'): string {
  if (isNaN(amount)) return `${symbol} 0`;
  return `${symbol} ${amount.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatNumber(n: number): string {
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-PK');
}

export function formatDate(date: string | null | undefined, format = 'DD/MM/YYYY'): string {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  switch (format) {
    case 'YYYY-MM-DD': return `${year}-${month}-${day}`;
    case 'DD-MM-YYYY': return `${day}-${month}-${year}`;
    case 'MM/DD/YYYY': return `${month}/${day}/${year}`;
    case 'DD/MM/YYYY':
    default: return `${day}/${month}/${year}`;
  }
}

export function formatDateTime(date: string | null | undefined, format = 'DD/MM/YYYY'): string {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const time = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${formatDate(date, format)} ${time}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function downloadFile(filename: string, content: string, mimeType = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
