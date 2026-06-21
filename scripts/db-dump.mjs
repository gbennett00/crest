#!/usr/bin/env node
// Create a data-only snapshot of the remote database with pg_dump. Writes a
// COPY-format .sql file to ../crest-snapshots (a sibling of the repo, NOT tracked
// by git — the repo is public and these dumps contain real financial data).
//
// Restore one with: npm run db:reset -- path/to/dump.sql
//
// Usage:
//   npm run db:dump                        # -> ../crest-snapshots/YYYY-MM-DD.sql
//   npm run db:dump -- path/to/out.sql     # write to a specific file
//
// Connection params come from .env (gitignored) — the same vars db:reset uses.
// The password is requested interactively (hidden) and never stored; set
// SUPABASE_DB_PASSWORD only if you prefer to skip the prompt.
//
// Required in .env:
//   SUPABASE_DB_HOST=aws-0-<region>.pooler.supabase.com   # Session pooler host
//   SUPABASE_DB_USER=postgres.<project-ref>
// Optional:
//   SUPABASE_DB_PORT=5432            (default)
//   SUPABASE_DB_NAME=postgres        (default)
//   SUPABASE_DB_PASSWORD=...         (skips the prompt)
//   PG_DUMP_BIN=C:/path/to/pg_dump.exe   (if pg_dump is not on PATH)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file — fall back to the real environment.
}

const {
  SUPABASE_DB_HOST: HOST,
  SUPABASE_DB_USER: USER,
  SUPABASE_DB_PORT: PORT = "5432",
  SUPABASE_DB_NAME: DBNAME = "postgres",
  SUPABASE_DB_PASSWORD,
  PG_DUMP_BIN = "pg_dump",
} = process.env;

// The app tables, dumped data-only. Order matters for restore: parents before
// children so FK references resolve as rows are COPYed in. (plan_members also
// references auth.users, which must already exist in the target database.)
const TABLES = [
  "plans",
  "plan_members",
  "category_groups",
  "categories",
  "accounts",
  "transactions",
  "transaction_allocations",
  "monthly_budgets",
  "targets",
  "budget_settings",
];

const SNAPSHOT_DIR = resolve("..", "crest-snapshots"); // sibling of the repo

function fail(msg) {
  console.error(`\n[x] ${msg}\n`);
  process.exit(1);
}

if (!HOST || !USER) {
  fail(
    "Missing SUPABASE_DB_HOST and/or SUPABASE_DB_USER.\n" +
      "Add them to .env (gitignored), e.g.:\n" +
      "  SUPABASE_DB_HOST=aws-0-us-west-2.pooler.supabase.com\n" +
      "  SUPABASE_DB_USER=postgres.<project-ref>",
  );
}

function resolveOutfile() {
  const arg = process.argv[2];
  if (arg) {
    return isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
  }
  if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(SNAPSHOT_DIR, `${date}.sql`);
}

function promptHidden(query) {
  // Control characters built via char code so no raw bytes live in the source.
  const ETX = String.fromCharCode(3); // Ctrl-C
  const EOT = String.fromCharCode(4); // Ctrl-D
  const BS = String.fromCharCode(8); // backspace
  const DEL = String.fromCharCode(127); // delete
  return new Promise((res) => {
    const input = process.stdin;
    if (!input.isTTY) {
      fail("No interactive terminal for the password prompt. Set SUPABASE_DB_PASSWORD instead.");
    }
    process.stdout.write(query);
    input.resume();
    input.setRawMode(true);
    input.setEncoding("utf8");
    let pw = "";
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      if (s.includes(ETX)) {
        process.stdout.write("\n");
        process.exit(130);
      }
      if (s === "\r" || s === "\n" || s === EOT) {
        input.setRawMode(false);
        input.pause();
        input.removeListener("data", onData);
        process.stdout.write("\n");
        res(pw);
      } else if (s === DEL || s === BS) {
        pw = pw.slice(0, -1);
      } else {
        pw += s;
      }
    };
    input.on("data", onData);
  });
}

const outfile = resolveOutfile();

if (existsSync(outfile)) {
  console.log(`\n[!] ${outfile} already exists and will be overwritten.`);
}

console.log("\n[!] Database DUMP (data-only)");
console.log(`    Source : ${USER}@${HOST}:${PORT}/${DBNAME}`);
console.log(`    Tables : ${TABLES.join(", ")}`);
console.log(`    Output : ${outfile}\n`);

const password = SUPABASE_DB_PASSWORD ?? (await promptHidden("DB password: "));
if (!password) fail("No password provided.");

const args = [
  "-h", HOST,
  "-p", PORT,
  "-U", USER,
  "-d", DBNAME,
  "--data-only",
  "--no-owner",
  "--no-privileges",
  // COPY format (default) restores faster and is what db:reset expects.
  ...TABLES.flatMap((t) => ["--table", `public.${t}`]),
  "-f", outfile,
];

const result = spawnSync(PG_DUMP_BIN, args, {
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, PGPASSWORD: password },
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    fail(
      `Could not find pg_dump ("${PG_DUMP_BIN}"). Add the Postgres bin folder to PATH, ` +
        "or set PG_DUMP_BIN in .env to the full path of pg_dump.exe.",
    );
  }
  fail(`Failed to run pg_dump: ${result.error.message}`);
}
if (result.status !== 0) {
  fail(`pg_dump exited with code ${result.status}. No usable snapshot written.`);
}

const bytes = existsSync(outfile) ? statSync(outfile).size : 0;
console.log(`\n[ok] Snapshot written: ${outfile} (${(bytes / 1024).toFixed(1)} KB)\n`);
