/** Parses YNAB's dollar formatting ("$1,450.00", "-$7.41", "$0.00") into integer cents. */
export function parseDollarsToCents(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;

  const negative = trimmed.startsWith("-");
  const cleaned = trimmed.replace(/^-/, "").replace(/[$,]/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    throw new Error(`invalid dollar amount: ${raw}`);
  }

  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Parses "MM/DD/YYYY" (Register.csv Date column) into "YYYY-MM-DD". */
export function parseUsDate(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error(`invalid date: ${raw}`);
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/** Parses "Mon YYYY" (Plan.csv Month column) into the first-of-month "YYYY-MM-01". */
export function parseMonthYear(raw: string): string {
  const m = raw.trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) throw new Error(`invalid month: ${raw}`);
  const idx = MONTH_NAMES.indexOf(m[1]);
  if (idx === -1) throw new Error(`unknown month: ${raw}`);
  return `${m[2]}-${String(idx + 1).padStart(2, "0")}-01`;
}
