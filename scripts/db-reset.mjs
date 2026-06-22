#!/usr/bin/env node
// Reset the remote database to a snapshot: TRUNCATE the app tables, then replay a
// pg_dump data-only file — all in one transaction (rolls back on any error).
//
// Usage:
//   npm run db:reset                       # restore newest snapshot in ../crest-snapshots
//   npm run db:reset -- path/to/dump.sql   # restore a specific file
//
// Connection params come from .env (gitignored). The password is requested
// interactively (hidden) and never stored — set SUPABASE_DB_PASSWORD only if you
// prefer to skip the prompt.
//
// Required in .env:
//   SUPABASE_DB_HOST=aws-0-<region>.pooler.supabase.com   # Session pooler host
//   SUPABASE_DB_USER=postgres.<project-ref>
// Optional:
//   SUPABASE_DB_PORT=5432            (default)
//   SUPABASE_DB_NAME=postgres        (default)
//   SUPABASE_DB_PASSWORD=...         (skips the prompt)
//   PSQL_BIN=C:/path/to/psql.exe     (if psql is not on PATH)

import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
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
  PSQL_BIN = "psql",
} = process.env;

// FK-safe set; TRUNCATE ... CASCADE clears them together regardless of order.
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

function resolveSnapshot() {
  const arg = process.argv[2];
  if (arg) {
    const p = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
    if (!existsSync(p)) fail(`Snapshot not found: ${p}`);
    return p;
  }
  if (!existsSync(SNAPSHOT_DIR)) {
    fail(`No snapshot path given and ${SNAPSHOT_DIR} does not exist.`);
  }
  const sqls = readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => join(SNAPSHOT_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (sqls.length === 0) fail(`No .sql snapshots found in ${SNAPSHOT_DIR}.`);
  return sqls[0];
}

function question(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(query, (a) => { rl.close(); res(a); }));
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

const snapshot = resolveSnapshot();

console.log("\n[!] Database RESET");
console.log(`    Target : ${USER}@${HOST}:${PORT}/${DBNAME}`);
console.log(`    Tables : ${TABLES.join(", ")}`);
console.log(`    Restore: ${snapshot}`);
console.log("\n    This ERASES all data in those tables and replays the snapshot.\n");

const confirm = await question("Type 'reset' to continue: ");
if (confirm.trim() !== "reset") fail("Aborted.");

const password = SUPABASE_DB_PASSWORD ?? (await promptHidden("DB password: "));
if (!password) fail("No password provided.");

const args = [
  "-h", HOST,
  "-p", PORT,
  "-U", USER,
  "-d", DBNAME,
  "-v", "ON_ERROR_STOP=1",
  "--single-transaction",
  "-c", `TRUNCATE ${TABLES.map((t) => `public.${t}`).join(", ")} RESTART IDENTITY CASCADE;`,
  "-f", snapshot,
  // The dump sets search_path to '' for its session; restore it before COMMIT so
  // the DEFERRED constraint triggers (which reference tables unqualified) can
  // resolve them when they fire at commit time.
  "-c", "SET search_path TO public, pg_catalog;",
];

const result = spawnSync(PSQL_BIN, args, {
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, PGPASSWORD: password },
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    fail(
      `Could not find psql ("${PSQL_BIN}"). Add the Postgres bin folder to PATH, ` +
        "or set PSQL_BIN in .env to the full path of psql.exe.",
    );
  }
  fail(`Failed to run psql: ${result.error.message}`);
}
if (result.status !== 0) {
  fail(`psql exited with code ${result.status}. Database left unchanged (transaction rolled back).`);
}

console.log("\n[ok] Database reset from snapshot.\n");
