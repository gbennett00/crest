import { parseCsv } from "./csv";
import { parseDollarsToCents, parseUsDate } from "./money";
import type {
  ParsedOpeningBalance,
  ParsedTransaction,
  ParsedTransfer,
  RegisterParseResult,
} from "./types";

const SPLIT_RE = /^Split \((\d+)\/(\d+)\)\s*(.*)$/;
const TRANSFER_RE = /^Transfer : (.+)$/;

type RawRow = {
  account: string;
  date: string;
  payee: string;
  categoryGroup: string;
  category: string;
  memo: string;
  amountCents: number;
  cleared: boolean;
  rowIndex: number;
};

function columnIndex(header: string[], name: string): number {
  const idx = header.indexOf(name);
  if (idx === -1) {
    throw new Error(`Register.csv missing expected column: ${name}`);
  }
  return idx;
}

export function parseRegisterCsv(
  csvText: string,
  options?: { today?: string },
): RegisterParseResult {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return {
      transactions: [],
      openingBalances: [],
      transfers: [],
      offBudgetAccounts: [],
      futureRowsSkipped: 0,
      warnings: [],
    };
  }

  const header = rows[0].map((h) => h.trim());
  const idx = {
    account: columnIndex(header, "Account"),
    date: columnIndex(header, "Date"),
    payee: columnIndex(header, "Payee"),
    categoryGroup: columnIndex(header, "Category Group"),
    category: columnIndex(header, "Category"),
    memo: columnIndex(header, "Memo"),
    outflow: columnIndex(header, "Outflow"),
    inflow: columnIndex(header, "Inflow"),
    cleared: columnIndex(header, "Cleared"),
  };

  const allRaw: RawRow[] = rows.slice(1).map((r, i) => ({
    account: r[idx.account]?.trim() ?? "",
    date: parseUsDate(r[idx.date] ?? ""),
    payee: r[idx.payee]?.trim() ?? "",
    categoryGroup: r[idx.categoryGroup]?.trim() ?? "",
    category: r[idx.category]?.trim() ?? "",
    memo: r[idx.memo] ?? "",
    amountCents:
      parseDollarsToCents(r[idx.inflow] ?? "0") - parseDollarsToCents(r[idx.outflow] ?? "0"),
    cleared: r[idx.cleared]?.trim() === "Cleared" || r[idx.cleared]?.trim() === "Reconciled",
    rowIndex: i,
  }));

  // YYYY-MM-DD strings compare correctly lexicographically. Excluded uniformly
  // here (before split/transfer/opening-balance handling) so a future-dated
  // split group or transfer pair is dropped as a whole, not partially.
  const cutoffDate = options?.today ?? new Date().toISOString().slice(0, 10);
  const raw = allRaw.filter((r) => r.date <= cutoffDate);
  const futureRowsSkipped = allRaw.length - raw.length;

  const warnings: string[] = [];

  // --- Starting Balance rows: on-budget -> opening balance, off-budget -> tracking-account signal.
  const openingBalances: ParsedOpeningBalance[] = [];
  const offBudgetAccounts = new Set<string>();
  const startingBalanceRowIndexes = new Set<number>();

  for (const r of raw) {
    if (r.payee !== "Starting Balance") continue;
    startingBalanceRowIndexes.add(r.rowIndex);
    const onBudget = r.categoryGroup === "Inflow" && r.category === "Ready to Assign";
    openingBalances.push({ account: r.account, date: r.date, amountCents: r.amountCents, onBudget });
    if (!onBudget) offBudgetAccounts.add(r.account);
  }

  // --- Transfer candidates: blank category + "Transfer : <Account>" payee.
  const transferCandidates: (RawRow & { counterpartAccount: string })[] = [];
  const remainingRows: RawRow[] = [];

  for (const r of raw) {
    if (startingBalanceRowIndexes.has(r.rowIndex)) continue;
    const m = r.category === "" && r.categoryGroup === "" ? r.payee.match(TRANSFER_RE) : null;
    if (m) {
      transferCandidates.push({ ...r, counterpartAccount: m[1].trim() });
    } else {
      remainingRows.push(r);
    }
  }

  const transfers: ParsedTransfer[] = [];
  const usedTransferRows = new Set<number>();

  for (const c of transferCandidates) {
    if (usedTransferRows.has(c.rowIndex)) continue;
    const match = transferCandidates.find(
      (o) =>
        !usedTransferRows.has(o.rowIndex) &&
        o.rowIndex !== c.rowIndex &&
        o.date === c.date &&
        o.account === c.counterpartAccount &&
        o.counterpartAccount === c.account &&
        o.amountCents === -c.amountCents,
    );
    if (!match) continue;

    usedTransferRows.add(c.rowIndex);
    usedTransferRows.add(match.rowIndex);
    const [outflowRow, inflowRow] = c.amountCents < 0 ? [c, match] : [match, c];
    transfers.push({
      fromAccount: outflowRow.account,
      toAccount: inflowRow.account,
      date: c.date,
      amountCents: Math.abs(c.amountCents),
      cleared: outflowRow.cleared && inflowRow.cleared,
      rowIndex: Math.min(c.rowIndex, match.rowIndex),
    });
  }

  for (const c of transferCandidates) {
    if (usedTransferRows.has(c.rowIndex)) continue;
    // A transfer to/from an off-budget (tracking) account is asymmetric by design:
    // the tracking side is a blank-category "Transfer : X" row (a transferCandidate,
    // caught here), while the on-budget side carries a real category and simply
    // imports as a normal categorized transaction (handled below, not here). Since
    // tracking accounts are skipped entirely, this half is expected, not a data issue.
    if (offBudgetAccounts.has(c.account) || offBudgetAccounts.has(c.counterpartAccount)) {
      continue;
    }
    warnings.push(
      `Unmatched transfer row: ${c.account} on ${c.date} for $${(Math.abs(c.amountCents) / 100).toFixed(2)} referencing "${c.counterpartAccount}" — no counterpart row found in this export; skipped.`,
    );
  }

  // --- Split-grouping over whatever's left.
  const transactions: ParsedTransaction[] = [];
  let i = 0;
  while (i < remainingRows.length) {
    const row = remainingRows[i];
    const m = row.memo.match(SPLIT_RE);

    if (m && Number(m[1]) === 1) {
      const total = Number(m[2]);
      const group: RawRow[] = [row];
      const memoParts: string[] = m[3] ? [m[3].trim()] : [];
      let j = i + 1;
      let expected = 2;

      while (expected <= total && j < remainingRows.length) {
        const next = remainingRows[j];
        const nm = next.memo.match(SPLIT_RE);
        if (
          nm &&
          Number(nm[1]) === expected &&
          Number(nm[2]) === total &&
          next.account === row.account &&
          next.date === row.date &&
          next.payee === row.payee
        ) {
          group.push(next);
          if (nm[3]) memoParts.push(nm[3].trim());
          j += 1;
          expected += 1;
        } else {
          break;
        }
      }

      if (group.length === total) {
        transactions.push({
          account: row.account,
          date: row.date,
          payee: row.payee,
          memo: memoParts.join("; "),
          amountCents: group.reduce((sum, g) => sum + g.amountCents, 0),
          cleared: group.every((g) => g.cleared),
          allocations: group
            .filter((g) => g.category !== "")
            .map((g) => ({
              categoryGroup: g.categoryGroup,
              category: g.category,
              amountCents: g.amountCents,
            })),
          rowIndex: row.rowIndex,
        });
        i = j;
        continue;
      }

      warnings.push(
        `Split marker "${row.memo}" on ${row.account}/${row.date}/"${row.payee}" did not resolve to a complete group of ${total} rows; imported as individual, unsplit rows instead.`,
      );
    }

    transactions.push({
      account: row.account,
      date: row.date,
      payee: row.payee,
      memo: row.memo,
      amountCents: row.amountCents,
      cleared: row.cleared,
      allocations:
        row.category === ""
          ? []
          : [{ categoryGroup: row.categoryGroup, category: row.category, amountCents: row.amountCents }],
      rowIndex: row.rowIndex,
    });
    i += 1;
  }

  return {
    transactions,
    openingBalances,
    transfers,
    offBudgetAccounts: [...offBudgetAccounts],
    futureRowsSkipped,
    warnings,
  };
}
