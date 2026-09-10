/**
 * Common validation utilities.
 */

export function isNonEmptyString(s: any): s is string {
  return typeof s === 'string' && s.trim().length > 0;
}

export function isPositiveNumber(n: any): boolean {
  return typeof n === 'number' && isFinite(n) && n > 0;
}

export function isNonNegativeNumber(n: any): boolean {
  return typeof n === 'number' && isFinite(n) && n >= 0;
}

export function isPositiveInteger(n: any): boolean {
  return Number.isInteger(n) && n > 0;
}

export function isISODate(s: any): boolean {
  if (typeof s !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
}

export function sanitizeString(s: any, maxLen = 1000): string {
  if (typeof s !== 'string') return '';
  return s.slice(0, maxLen).trim();
}

/**
 * Generate the next sequential code like WKR-0001, WKR-0002, etc.
 */
export function nextSequentialCode(prefix: string, currentMax: number, padLength = 4): string {
  const next = (currentMax || 0) + 1;
  return `${prefix}-${String(next).padStart(padLength, '0')}`;
}
