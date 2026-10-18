// Amounts sit in fixed-width table columns, so the longer the formatted figure,
// the smaller it is drawn (like YNAB). "$1,500.00" is the widest figure that
// fits at the base size; each extra character takes 1px off, down to a floor
// that stays legible.
const FITS_AT_BASE = 9;
const MIN_PX = 10;

export function amountFontSize(formatted: string, basePx: number, minPx = MIN_PX): number {
  const extra = Math.max(0, formatted.length - FITS_AT_BASE);
  return Math.max(minPx, basePx - extra);
}
