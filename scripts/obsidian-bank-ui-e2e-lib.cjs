// Pure fixture, shim, and assertion helpers for the bank UI real-Obsidian e2e.
// Offline self-test imports these so missing cards, math leaks, and argv
// mistakes fail without launching Obsidian.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FIXTURE_TODAY = "2026-11-12";
const FIXTURE_HISTORICAL = "2026-11-01";
const IMPORTED_WAITING_ID = "aaa111";
const IMPORTED_ACKED_ID = "1c0e77aa";
const CUSTOM_BLOCK_ID = "custom-row";

const HELP_TEXT = [
  "Usage: node scripts/obsidian-bank-ui-e2e.cjs [OPTIONS]",
  "",
  "Drive bob-bank cards, the Bank Badge, row marks, typing, ack, and guards",
  "in an isolated scratch vault through CDP. Never opens the live vault.",
  "Run under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -h, --help              Print this help and exit",
  "  -o, --out DIRECTORY     Screenshot output directory",
  "  -r, --report PATH       Write the structured JSON report to PATH",
  "  -s, --self-test         Run offline self-tests (no Obsidian needed)",
].join("\n");

function scratchRoot(repoRoot) {
  return path.join(path.resolve(repoRoot), ".tmp-bank-e2e");
}

function makeScratch(repoRoot, prefix) {
  const root = scratchRoot(repoRoot);
  fs.mkdirSync(root, { recursive: true });
  const safe = String(prefix || "run").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "") || "run";
  return fs.mkdtempSync(path.join(root, `${safe}-`));
}

function parseArgs(argv) {
  const args = { executable: null, help: false, out: null, report: null, selfTest: false };
  const list = Array.isArray(argv) ? argv.slice() : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "-e" || token === "--executable" || token === "--obsidian-bin") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = value;
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else if (token === "-o" || token === "--out") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = value;
    } else if (token === "-r" || token === "--report") {
      const value = list[++index];
      if (!value || value.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = value;
    } else if (token === "-s" || token === "--self-test") {
      args.selfTest = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function dailyPathFor(iso) {
  const [year, month, day] = String(iso).split("-");
  return `${year}/${year}${month}${day}.md`;
}

function hubNote() {
  return [
    "---",
    'parent: "[[cash]]"',
    'type: "[[area]]"',
    "color: magenta",
    "bank:",
    "  accounts:",
    "    checking:",
    "      label: WF Checking",
    "      kind: checking",
    "      start: 2026-10-01",
    "  categories:",
    "    groceries: 🛒 Groceries",
    "    dining: 🍽️ Dining",
    "    coffee: { label: ☕ Coffee, hotkey: c, group: Everyday }",
    "---",
    "",
    "# 🏦 Bank",
    "",
    "```bob-bank",
    "view: queue",
    "```",
    "",
  ].join("\n");
}

function octoberNote() {
  return [
    "---",
    'parent: "[[bank]]"',
    'type: "[[bank_month]]"',
    "month: 2026-10",
    "---",
    "",
    "# 🏦 October 2026",
    "",
    "```bob-bank",
    "view: month",
    "```",
    "",
    "## Sat Oct 31",
    "",
    `- [ ] $4.25 Halloween candy [cat:: groceries]`,
    `- [ ] $12.00 Imported snack [cat:: groceries] ^bank-${IMPORTED_WAITING_ID}`,
    "",
  ].join("\n");
}

function novemberNote() {
  return [
    "---",
    'parent: "[[bank]]"',
    'type: "[[bank_month]]"',
    "month: 2026-11",
    "---",
    "",
    "# 🏦 November 2026",
    "",
    "```bob-bank",
    "view: month",
    "```",
    "",
    "## Notes",
    "Not a day heading.",
    "",
    "- [ ] $12.00 Inside a non-day section",
    "",
    "## Sun Nov 1",
    "",
    "- [x] $8.00 Historical coffee [cat:: dining]",
    "",
    "## Wed Nov 11",
    "",
    "## Thu Nov 12",
    "",
    "- [x] +$2,000.00 Salary [cat:: income]",
    "- [x] **$13.71** Smashburger [cat:: dining]",
    "- [x] $1,234.56 Big shop [cat:: groceries]",
    "- [x] −$4.25 fee",
    "- [x] $100.00 Card payment [cat:: transfer]",
    "- [x] +$100.00 From card [cat:: transfer]",
    `- [x] $63.50 ATM withdrawal [cat:: cash] ^bank-${IMPORTED_ACKED_ID}`,
    "- [ ] $61.20 ShopRite [cat:: groceries] ⚑ -- with Kelly [[shoprite]]",
    "- [ ] $9.99 Flagged bang !! — extra note",
    `- [x] $3.00 Custom id row [cat:: dining] ^${CUSTOM_BLOCK_ID}`,
    "- [x] $",
    "- [ ] $",
    "  - [ ] $9.99 indented child",
    "- [ ] 3 things",
    "",
    "```",
    "- [ ] $8.00 inside a fence",
    "```",
    "",
  ].join("\n");
}

function emptyMonthNote() {
  return [
    "---",
    'parent: "[[bank]]"',
    'type: "[[bank_month]]"',
    "month: 2026-09",
    "---",
    "",
    "# 🏦 September 2026",
    "",
    "```bob-bank",
    "view: month",
    "```",
    "",
  ].join("\n");
}

function invalidFenceNote() {
  return [
    "---",
    'parent: "[[bank]]"',
    'type: "[[bank_month]]"',
    "month: 2026-08",
    "---",
    "",
    "# 🏦 August 2026",
    "",
    "```bob-bank",
    "view: nope",
    "```",
    "",
  ].join("\n");
}

function dailyNote(iso, extra = "") {
  return [
    "---",
    `date: ${iso}`,
    "---",
    "",
    `# ${iso}`,
    "",
    "```bob-plan",
    "```",
    "",
    extra,
  ].join("\n");
}

function ordinaryNote() {
  return [
    "---",
    'type: "[[note]]"',
    "---",
    "",
    "# Ordinary tasks",
    "",
    "- [ ] #task Ship the ordinary checklist",
    "",
    "Ordinary math elsewhere: $x^2+y^2$ stays math.",
    "",
  ].join("\n");
}

function cashNote() {
  return [
    "---",
    'type: "[[area]]"',
    "---",
    "",
    "# Cash",
    "",
  ].join("\n");
}

function shopriteNote() {
  return ["---", 'type: "[[note]]"', "---", "", "# ShopRite", "", "A grocery store.", ""].join("\n");
}

function fixtureNotes() {
  return {
    "bank.md": hubNote(),
    "cash.md": cashNote(),
    "shoprite.md": shopriteNote(),
    "bank/2026-10.md": octoberNote(),
    "bank/2026-11.md": novemberNote(),
    "bank/2026-09.md": emptyMonthNote(),
    "bank/2026-08.md": invalidFenceNote(),
    [dailyPathFor(FIXTURE_TODAY)]: dailyNote(FIXTURE_TODAY),
    [dailyPathFor(FIXTURE_HISTORICAL)]: dailyNote(FIXTURE_HISTORICAL),
    "tasks/ordinary.md": ordinaryNote(),
  };
}

function checkingAccount(extra = {}) {
  return {
    alias: "checking",
    label: "WF Checking",
    kind: "checking",
    default: true,
    start: "2026-10-01",
    status: "unverified",
    last_import: null,
    balance_cents: null,
    balance_asof: null,
    delta_cents: null,
    hint: "No import yet — bob bank import FILE",
    ...extra,
  };
}

function categories() {
  return [
    { key: "groceries", emoji: "🛒", label: "Groceries", builtin: false, hotkey: "g", group: "Everyday", hidden: false },
    { key: "dining", emoji: "🍽️", label: "Dining", builtin: false, hotkey: "e", group: "Everyday", hidden: false },
    { key: "coffee", emoji: "☕", label: "Coffee", builtin: false, hotkey: "c", group: "Everyday", hidden: false },
    { key: "income", emoji: "💵", label: "Income", builtin: true, hotkey: "i", group: "Money moves", hidden: false },
    { key: "refund", emoji: "↩️", label: "Refund", builtin: true, hotkey: "r", group: "Money moves", hidden: false },
    { key: "transfer", emoji: "🔁", label: "Transfer", builtin: true, hotkey: "t", group: "Money moves", hidden: false },
    { key: "cash", emoji: "🏧", label: "Cash out", builtin: true, hotkey: "a", group: "Money moves", hidden: false },
  ];
}

function listWaitingJson() {
  return {
    ok: true,
    schema_version: 1,
    today: FIXTURE_TODAY,
    categories: categories(),
    accounts: [checkingAccount()],
    issues: { errors: 0, warnings: 0 },
    filter: "waiting",
    month: null,
    days: [
      {
        date: "2026-10-31",
        heading: "Sat Oct 31",
        path: "bank/2026-10.md",
        line: 12,
        rows: [
          {
            path: "bank/2026-10.md",
            line: 14,
            date: "2026-10-31",
            account: "checking",
            cents: -425,
            payee: "Halloween candy",
            category: "groceries",
            links: [],
            note: null,
            flagged: false,
            acknowledged: false,
            id: null,
            origin: "typed",
          },
          {
            path: "bank/2026-10.md",
            line: 15,
            date: "2026-10-31",
            account: "checking",
            cents: -1200,
            payee: "Imported snack",
            category: "groceries",
            links: [],
            note: null,
            flagged: false,
            acknowledged: false,
            id: IMPORTED_WAITING_ID,
            origin: "imported",
          },
        ],
      },
      {
        date: FIXTURE_TODAY,
        heading: "Thu Nov 12",
        path: "bank/2026-11.md",
        line: 24,
        rows: [
          {
            path: "bank/2026-11.md",
            line: 32,
            date: FIXTURE_TODAY,
            account: "checking",
            cents: -6120,
            payee: "ShopRite",
            category: "groceries",
            links: ["[[shoprite]]"],
            note: "with Kelly",
            flagged: true,
            acknowledged: false,
            id: null,
            origin: "typed",
          },
          {
            path: "bank/2026-11.md",
            line: 33,
            date: FIXTURE_TODAY,
            account: "checking",
            cents: -999,
            payee: "Flagged bang",
            category: null,
            links: [],
            note: "extra note",
            flagged: true,
            acknowledged: false,
            id: null,
            origin: "typed",
          },
        ],
      },
    ],
    counts: { rows: 4, waiting: 4, flagged: 2 },
  };
}

function emptyListJson() {
  const body = listWaitingJson();
  body.days = [];
  body.counts = { rows: 0, waiting: 0, flagged: 0 };
  return body;
}

function reportMonthJson(month) {
  const waitingAll = 4;
  if (month === "2026-10") {
    return {
      ok: true,
      schema_version: 1,
      today: FIXTURE_TODAY,
      categories: categories(),
      accounts: [checkingAccount()],
      issues: { errors: 0, warnings: 0 },
      period: {
        kind: "month",
        key: "2026-10",
        start: "2026-10-01",
        end: "2026-10-31",
        label: "October 2026",
        so_far: false,
        note: null,
      },
      totals: {
        out_cents: 1625,
        in_cents: 0,
        net_cents: -1625,
        refund_cents: 0,
        transfer_out_cents: 0,
        transfer_in_cents: 0,
        cash_out_cents: 0,
        cash_traced_cents: 0,
        unclassified_out_cents: 0,
        unclassified_in_cents: 0,
      },
      breakdown: [
        { key: "groceries", emoji: "🛒", label: "Groceries", out_cents: 1625, share: 1, rows: 2 },
      ],
      days: [
        {
          date: "2026-10-31",
          heading: "Sat Oct 31",
          path: "bank/2026-10.md",
          line: 12,
          out_cents: 1625,
          in_cents: 0,
          rows: [],
          waiting: 2,
          flagged: 0,
        },
      ],
      waiting: { period: 2, all: waitingAll, oldest: "2026-10-31" },
      flagged: 0,
    };
  }
  if (month === "2026-09") {
    return {
      ok: true,
      schema_version: 1,
      today: FIXTURE_TODAY,
      categories: categories(),
      accounts: [checkingAccount()],
      issues: { errors: 0, warnings: 0 },
      period: {
        kind: "month",
        key: "2026-09",
        start: "2026-09-01",
        end: "2026-09-30",
        label: "September 2026",
        so_far: false,
        note: null,
      },
      totals: {
        out_cents: 0,
        in_cents: 0,
        net_cents: 0,
        refund_cents: 0,
        transfer_out_cents: 0,
        transfer_in_cents: 0,
        cash_out_cents: 0,
        cash_traced_cents: 0,
        unclassified_out_cents: 0,
        unclassified_in_cents: 0,
      },
      breakdown: [],
      days: [],
      waiting: { period: 0, all: waitingAll, oldest: "2026-10-31" },
      flagged: 0,
    };
  }
  return {
    ok: true,
    schema_version: 1,
    today: FIXTURE_TODAY,
    categories: categories(),
    accounts: [checkingAccount()],
    issues: { errors: 0, warnings: 0 },
    period: {
      kind: "month",
      key: "2026-11",
      start: "2026-11-01",
      end: "2026-11-30",
      label: "November 2026",
      so_far: true,
      note: null,
    },
    totals: {
      out_cents: 142621,
      in_cents: 210000,
      net_cents: 67379,
      refund_cents: 0,
      transfer_out_cents: 10000,
      transfer_in_cents: 10000,
      cash_out_cents: 6350,
      cash_traced_cents: 0,
      unclassified_out_cents: 425,
      unclassified_in_cents: 0,
    },
    breakdown: [
      { key: "groceries", emoji: "🛒", label: "Groceries", out_cents: 123456, share: 0.8656, rows: 1 },
      { key: "dining", emoji: "🍽️", label: "Dining", out_cents: 1371, share: 0.0096, rows: 1 },
      { key: "cash", emoji: "🏧", label: "Cash out", out_cents: 6350, share: 0.0445, rows: 1 },
      { key: "unclassified", emoji: "·", label: "Unclassified", out_cents: 425, share: 0.003, rows: 1 },
    ],
    days: [
      {
        date: FIXTURE_HISTORICAL,
        heading: "Sun Nov 1",
        path: "bank/2026-11.md",
        line: 18,
        out_cents: 800,
        in_cents: 0,
        rows: [],
        waiting: 0,
        flagged: 0,
      },
      {
        date: "2026-11-11",
        heading: "Wed Nov 11",
        path: "bank/2026-11.md",
        line: 22,
        out_cents: 0,
        in_cents: 0,
        rows: [],
        waiting: 0,
        flagged: 0,
      },
      {
        date: FIXTURE_TODAY,
        heading: "Thu Nov 12",
        path: "bank/2026-11.md",
        line: 24,
        out_cents: 141821,
        in_cents: 210000,
        rows: [],
        waiting: 2,
        flagged: 2,
      },
    ],
    waiting: { period: 2, all: waitingAll, oldest: "2026-10-31" },
    flagged: 2,
  };
}

function reportDayJson(day) {
  const month = String(day || "").slice(0, 7);
  const report = reportMonthJson(month === "2026-10" ? "2026-10" : "2026-11");
  const match = (report.days || []).find((entry) => entry.date === day) || {
    date: day,
    heading: day,
    path: `bank/${month}.md`,
    line: 1,
    out_cents: 0,
    in_cents: 0,
    rows: [],
    waiting: 0,
    flagged: 0,
  };
  report.period = {
    kind: "day",
    key: day,
    start: day,
    end: day,
    label: day,
    so_far: day === FIXTURE_TODAY,
    note: null,
  };
  report.totals = {
    ...report.totals,
    out_cents: match.out_cents || 0,
    in_cents: match.in_cents || 0,
    net_cents: (match.in_cents || 0) - (match.out_cents || 0),
  };
  report.days = [match];
  return report;
}

function ensureJson(day) {
  const iso = day && day !== "today" ? day : FIXTURE_TODAY;
  const month = iso.slice(0, 7);
  return {
    ok: true,
    schema_version: 1,
    today: FIXTURE_TODAY,
    path: `bank/${month}.md`,
    line: iso === FIXTURE_TODAY ? 32 : 20,
    day: iso,
    created_note: false,
    created_heading: false,
    categories: categories(),
    accounts: [checkingAccount()],
  };
}

function ackJson(ids) {
  return {
    ok: true,
    schema_version: 1,
    today: FIXTURE_TODAY,
    acknowledged: Array.isArray(ids) ? ids.slice() : [],
    already: [],
    unknown: [],
  };
}

function fixtureJsonForArgv(argv) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
  const command = args[1] || args[0];
  if (command === "list") return listWaitingJson();
  if (command === "report") {
    const monthIndex = args.indexOf("-m");
    const dayIndex = args.indexOf("-D");
    if (dayIndex >= 0) return reportDayJson(args[dayIndex + 1]);
    if (monthIndex >= 0) return reportMonthJson(args[monthIndex + 1]);
    return reportMonthJson("2026-11");
  }
  if (command === "ensure") {
    const dayIndex = args.indexOf("-D");
    return ensureJson(dayIndex >= 0 ? args[dayIndex + 1] : "today");
  }
  if (command === "ack") {
    const ids = args.slice(2).filter((token) => token && !token.startsWith("-") && token !== "json");
    return ackJson(ids);
  }
  return { ok: false, schema_version: 1, error: { code: "unknown", message: `unhandled ${command}` } };
}

function shimScriptSource() {
  return `#!/usr/bin/env node
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.dirname(__filename);
const logPath = path.join(root, "argv.jsonl");
const controlPath = path.join(root, "control.json");
const realBobPath = path.join(root, "real-bob-path.txt");
const fixturesPath = path.join(root, "fixtures.json");
const argv = process.argv.slice(2);
const record = {
  t: Date.now(),
  argv,
  cwd: process.cwd(),
  bobDir: process.env.BOB_DIR || "",
};
fs.appendFileSync(logPath, JSON.stringify(record) + "\\n");
let control = { mode: "passthrough" };
try { control = JSON.parse(fs.readFileSync(controlPath, "utf8")); } catch {}
const mode = control && control.mode ? String(control.mode) : "passthrough";
if (mode === "missing") process.exit(127);
if (mode === "timeout") {
  const until = Date.now() + 25000;
  while (Date.now() < until) {}
  process.exit(1);
}
if (mode === "schema") {
  process.stdout.write(JSON.stringify({ ok: true, schema_version: 2, totals: { out_cents: 0, in_cents: 0, net_cents: 0 } }));
  process.exit(0);
}
if (mode === "malformed") {
  process.stdout.write("{not-json");
  process.exit(0);
}
if (mode === "error") {
  process.stdout.write(JSON.stringify({
    ok: false,
    schema_version: 1,
    error: { code: "shim-error", message: "shim induced failure" },
  }));
  process.exit(0);
}
if (mode === "empty-queue") {
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
  process.stdout.write(JSON.stringify(fixtures.emptyList));
  process.exit(0);
}
if (mode === "fixture") {
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
  process.stdout.write(JSON.stringify(serve(fixtures, argv)));
  process.exit(0);
}
let realBob = "";
try { realBob = fs.readFileSync(realBobPath, "utf8").trim(); } catch {}
if (realBob) {
  const env = { ...process.env, NO_COLOR: "1" };
  const spawned = spawnSync(realBob, argv, { encoding: "utf8", env, timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
  if (spawned.status === 0 && spawned.stdout && String(spawned.stdout).trim().startsWith("{")) {
    process.stdout.write(spawned.stdout);
    if (spawned.stderr) process.stderr.write(spawned.stderr);
    process.exit(0);
  }
}
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
process.stdout.write(JSON.stringify(serve(fixtures, argv)));
process.exit(0);
function serve(fixtures, args) {
  const command = args[1] || args[0];
  if (command === "list") return fixtures.list;
  if (command === "report") {
    const monthIndex = args.indexOf("-m");
    const dayIndex = args.indexOf("-D");
    if (dayIndex >= 0) return fixtures.days[args[dayIndex + 1]] || fixtures.report;
    if (monthIndex >= 0) return fixtures.months[args[monthIndex + 1]] || fixtures.report;
    return fixtures.report;
  }
  if (command === "ensure") {
    const dayIndex = args.indexOf("-D");
    return fixtures.ensure[dayIndex >= 0 ? args[dayIndex + 1] : "today"] || fixtures.ensure.today;
  }
  if (command === "ack") {
    const ids = args.slice(2).filter((token) => token && !token.startsWith("-") && token !== "json");
    return { ok: true, schema_version: 1, today: fixtures.today, acknowledged: ids, already: [], unknown: [] };
  }
  return { ok: false, schema_version: 1, error: { code: "unknown", message: "unhandled " + command } };
}
`;
}

function writeShim(dir, realBob) {
  fs.mkdirSync(dir, { recursive: true });
  const shimPath = path.join(dir, "bob");
  fs.writeFileSync(shimPath, shimScriptSource(), { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "control.json"), JSON.stringify({ mode: "passthrough" }));
  fs.writeFileSync(path.join(dir, "argv.jsonl"), "");
  fs.writeFileSync(path.join(dir, "real-bob-path.txt"), realBob ? String(realBob) : "");
  fs.writeFileSync(
    path.join(dir, "fixtures.json"),
    JSON.stringify({
      today: FIXTURE_TODAY,
      list: listWaitingJson(),
      emptyList: emptyListJson(),
      report: reportMonthJson("2026-11"),
      months: {
        "2026-09": reportMonthJson("2026-09"),
        "2026-10": reportMonthJson("2026-10"),
        "2026-11": reportMonthJson("2026-11"),
      },
      days: {
        [FIXTURE_TODAY]: reportDayJson(FIXTURE_TODAY),
        [FIXTURE_HISTORICAL]: reportDayJson(FIXTURE_HISTORICAL),
      },
      ensure: {
        today: ensureJson("today"),
        [FIXTURE_TODAY]: ensureJson(FIXTURE_TODAY),
        [FIXTURE_HISTORICAL]: ensureJson(FIXTURE_HISTORICAL),
      },
    }),
  );
  return shimPath;
}

function setShimMode(dir, mode) {
  fs.writeFileSync(path.join(dir, "control.json"), JSON.stringify({ mode: mode || "passthrough" }));
}

function readArgvLog(dir) {
  const text = fs.existsSync(path.join(dir, "argv.jsonl"))
    ? fs.readFileSync(path.join(dir, "argv.jsonl"), "utf8")
    : "";
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function argvHas(entries, predicate) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => predicate(entry && entry.argv ? entry.argv : []));
}

function assertMonthCard(card) {
  if (!card) return { ok: false, reason: "missing month card" };
  const problems = [];
  if (!/November 2026/i.test(String(card.title || ""))) problems.push(`title=${JSON.stringify(card.title)}`);
  if (card.soFar !== true && !/so far/i.test(String(card.soFarText || ""))) problems.push("missing so far");
  if (!Array.isArray(card.accounts) || card.accounts.length < 1) problems.push("missing accounts");
  else {
    const account = card.accounts[0];
    if (!/WF Checking/i.test(String(account.name || ""))) problems.push("account name");
    if (!/unverified/i.test(String(account.status || ""))) problems.push("account status");
    if (!account.hint) problems.push("account caveat");
  }
  if (!/Out/i.test(String(card.metrics && card.metrics.join(" ")))) problems.push("missing Out");
  if (!/In/i.test(String(card.metrics && card.metrics.join(" ")))) problems.push("missing In");
  if (!/Net/i.test(String(card.metrics && card.metrics.join(" ")))) problems.push("missing Net");
  if (!card.waitingText || !/waiting/i.test(card.waitingText)) problems.push("missing waiting");
  if (!card.flaggedText || !/flagged/i.test(card.flaggedText)) problems.push("missing flagged");
  const cats = Array.isArray(card.categories) ? card.categories : [];
  if (!cats.some((row) => /Groceries/i.test(row))) problems.push("missing groceries bar");
  if (!/Unclassified/i.test(String(card.extras || ""))) problems.push("missing unclassified");
  if (!/destination unknown/i.test(String(card.extras || ""))) problems.push("missing cash destination");
  if (problems.length) return { ok: false, reason: problems.join("; "), card };
  return { ok: true, card };
}

function assertHeat(heat) {
  if (!heat) return { ok: false, reason: "missing heat" };
  const weekdays = Array.isArray(heat.weekdays) ? heat.weekdays.join("") : "";
  if (!/^MTWTFSS$/i.test(weekdays.replace(/[^A-Za-z]/g, "").slice(0, 7)) && heat.weekdays[0] !== "M") {
    return { ok: false, reason: `weekdays=${JSON.stringify(heat.weekdays)}`, heat };
  }
  if (!heat.hasToday) return { ok: false, reason: "today not outlined", heat };
  if (!heat.hasWaiting) return { ok: false, reason: "waiting days unmarked", heat };
  return { ok: true, heat };
}

function assertQueue(card) {
  if (!card) return { ok: false, reason: "missing queue card" };
  const days = Array.isArray(card.queueDays) ? card.queueDays : [];
  if (days.length < 2) return { ok: false, reason: `days=${days.length}`, card };
  const dates = days.map((day) => day.date || day.heading);
  const sorted = dates.slice().sort();
  if (dates[0] !== sorted[0]) return { ok: false, reason: `not oldest-first ${JSON.stringify(dates)}`, card };
  for (const day of days) {
    if (!day.lineLinks) return { ok: false, reason: "missing line links", day };
    if (!day.checkboxes) return { ok: false, reason: "missing checkboxes", day };
    const ids = String(day.ackIds || "").trim().split(/\s+/).filter(Boolean);
    if (ids.join(" ") !== (day.drawnIds || []).join(" ")) {
      return { ok: false, reason: `ack ids ${JSON.stringify(ids)} != ${JSON.stringify(day.drawnIds)}`, day };
    }
  }
  if (!/Weekly import: bob bank import/i.test(String(card.importCommand || ""))) {
    return { ok: false, reason: "missing import command", card };
  }
  if (!Array.isArray(card.recentMonths) || card.recentMonths.length === 0 || card.recentMonths.length > 6) {
    return { ok: false, reason: `recent months ${JSON.stringify(card.recentMonths)}`, card };
  }
  return { ok: true, card };
}

function assertEmptyQueue(card) {
  if (!card) return { ok: false, reason: "missing queue card" };
  if (!/nothing to acknowledge/i.test(String(card.emptyText || card.text || ""))) {
    return { ok: false, reason: "missing nothing to acknowledge", card };
  }
  if (!Array.isArray(card.accounts) || card.accounts.length < 1 || !card.accounts[0].hint) {
    return { ok: false, reason: "caveats dropped", card };
  }
  return { ok: true, card };
}

function assertBadge(badge, options = {}) {
  if (!badge) return { ok: false, reason: "missing bank badge" };
  const text = String(badge.text || "");
  if (!/BANK/i.test(text)) return { ok: false, reason: `badge text ${JSON.stringify(text)}`, badge };
  if (/\$0\.00/.test(text)) return { ok: false, reason: "badge prints a zero amount", badge };
  if (options.waiting === true && !/waiting/i.test(text)) return { ok: false, reason: "badge missing period waiting", badge };
  if (options.waiting === false && /waiting/i.test(text)) return { ok: false, reason: "historical badge has waiting", badge };
  return { ok: true, badge };
}

function assertAckArgv(entry) {
  const argv = entry && Array.isArray(entry.argv) ? entry.argv : [];
  if (argv[0] !== "bank" || argv[1] !== "ack") return { ok: false, reason: `argv=${JSON.stringify(argv)}` };
  if (argv.includes("-D") || argv.includes("--day")) return { ok: false, reason: "ack used -D", argv };
  const ids = argv.slice(2).filter((token) => token && !token.startsWith("-") && token !== "json");
  if (ids.length === 0) return { ok: false, reason: "ack submitted no ids", argv };
  if (new Set(ids.map((id) => String(id).replace(/^bank-/i, "").toLowerCase())).size !== ids.length) {
    return { ok: false, reason: "ack ids were not unique", argv };
  }
  if (!argv.includes("-f") || !argv.includes("json")) return { ok: false, reason: "ack missing -f json", argv };
  return { ok: true, ids, argv };
}

function assertEnsureArgv(entry, day) {
  const argv = entry && Array.isArray(entry.argv) ? entry.argv : [];
  if (argv[0] !== "bank" || argv[1] !== "ensure") return { ok: false, reason: `argv=${JSON.stringify(argv)}` };
  if (!argv.includes("-D") || !argv.includes(day)) return { ok: false, reason: `ensure day missing ${day}`, argv };
  if (argv.includes("-o")) return { ok: false, reason: "ensure passed -o", argv };
  if (!argv.includes("-f") || !argv.includes("json")) return { ok: false, reason: "ensure missing -f json", argv };
  return { ok: true, argv };
}

function assertNoMath(probe) {
  const count = Number(probe && probe.mathCount);
  if (count !== 0) return { ok: false, reason: `mathCount=${count}`, probe };
  return { ok: true };
}

function assertHasMath(probe) {
  const count = Number(probe && probe.mathCount);
  if (!(count > 0)) return { ok: false, reason: `mathCount=${count}`, probe };
  return { ok: true };
}

function BANK_UI_PROBE() {
  return `(() => { try {
    const visible = (el) => {
      if (!el || !el.getClientRects || el.getClientRects().length === 0) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const textOf = (el) => String(el && el.textContent || "").replace(/\\s+/g, " ").trim();
    const cards = Array.from(document.querySelectorAll(".bob-bank-card")).map((card) => {
      const heatDays = Array.from(card.querySelectorAll(".bob-bank-heat-day"));
      const weekdays = Array.from(card.querySelectorAll(".bob-bank-weekday")).map(textOf);
      const queueDays = Array.from(card.querySelectorAll(".bob-bank-queue-day")).map((day) => {
        const ack = day.querySelector(".bob-bank-ack-day");
        const ids = ack ? String(ack.getAttribute("data-ack-ids") || "").trim() : "";
        return {
          heading: textOf(day.querySelector(".bob-bank-day-link")),
          date: (() => {
            const label = ack && ack.getAttribute("aria-label") || "";
            const match = label.match(/(\\d{4}-\\d{2}-\\d{2})/);
            return match ? match[1] : "";
          })(),
          ackIds: ids,
          drawnIds: ids ? ids.split(/\\s+/).filter(Boolean) : [],
          lineLinks: day.querySelectorAll(".bob-bank-row-link").length,
          checkboxes: day.querySelectorAll("input[type=checkbox]").length,
          idLess: textOf(day.querySelector(".bob-bank-idless-note")),
        };
      });
      return {
        kind: card.classList.contains("bob-bank-card-queue") ? "queue" : "month",
        title: textOf(card.querySelector("h2")),
        soFar: Boolean(card.querySelector(".bob-bank-so-far")),
        soFarText: textOf(card.querySelector(".bob-bank-so-far")),
        accounts: Array.from(card.querySelectorAll(".bob-bank-account")).map((account) => ({
          name: textOf(account.querySelector(".bob-bank-account-name")),
          status: textOf(account.querySelector(".bob-bank-account-state")),
          hint: textOf(account.querySelector(".bob-bank-account-hint")),
        })),
        metrics: Array.from(card.querySelectorAll(".bob-bank-metric")).map((metric) => textOf(metric)),
        waitingText: textOf(card.querySelector(".bob-bank-waiting")),
        flaggedText: textOf(card.querySelector(".bob-bank-flagged")),
        categories: Array.from(card.querySelectorAll(".bob-bank-category")).map(textOf),
        extras: textOf(card.querySelector(".bob-bank-extra-totals")),
        emptyText: textOf(card.querySelector(".bob-bank-empty-month, .bob-bank-empty-queue")),
        teaching: textOf(card.querySelector(".bob-bank-teaching")),
        error: textOf(card.querySelector(".bob-bank-card-error, [role=alert]")),
        importCommand: textOf(card.querySelector(".bob-bank-import-command")),
        recentMonths: Array.from(card.querySelectorAll(".bob-bank-recent-months a, .bob-bank-recent-months button")).map(textOf),
        footer: Array.from(card.querySelectorAll(".bob-bank-card-footer a, .bob-bank-card-footer button, .bob-bank-footer-muted")).map(textOf),
        footerHrefs: Array.from(card.querySelectorAll(".bob-bank-card-footer a")).map((a) => a.getAttribute("href") || a.getAttribute("data-href") || ""),
        heat: {
          weekdays,
          hasToday: heatDays.some((day) => day.classList.contains("is-today")),
          hasWaiting: heatDays.some((day) => day.classList.contains("has-waiting") || day.querySelector(".bob-bank-heat-waiting")),
          days: heatDays.map((day) => ({
            date: day.getAttribute("data-date") || "",
            disabled: Boolean(day.disabled),
            today: day.classList.contains("is-today"),
            waiting: Boolean(day.querySelector(".bob-bank-heat-waiting")),
            label: textOf(day),
          })),
        },
        queueDays,
        text: textOf(card),
        width: Math.round(card.getBoundingClientRect().width),
      };
    });
    const badges = Array.from(document.querySelectorAll(".bob-bank-badge")).filter(visible).map((el) => ({
      text: textOf(el),
      count: 1,
      stale: el.getAttribute("data-stale") === "true",
    }));
    const marks = Array.from(document.querySelectorAll(".bob-bank-mark-amount, .bob-bank-mark-chip, .bob-bank-mark-id, .bob-bank-mark-heading")).map((el) => ({
      cls: String(el.className || ""),
      text: textOf(el),
      waiting: Boolean(el.closest(".bob-bank-mark-waiting")),
      acked: Boolean(el.closest(".bob-bank-mark-acked")),
    }));
    const math = document.querySelectorAll(".math, mjx-container, .MathJax, .cm-math, span.MathJax");
    const active = window.app && window.app.workspace && window.app.workspace.getActiveFile && window.app.workspace.getActiveFile();
    const leaf = window.app && window.app.workspace && window.app.workspace.activeLeaf;
    const view = leaf && leaf.view;
    const editor = view && view.editor;
    const cursor = editor && typeof editor.getCursor === "function" ? editor.getCursor() : null;
    const lineText = editor && cursor && typeof editor.getLine === "function" ? editor.getLine(cursor.line) : "";
    const state = view && view.getState && view.getState() || {};
    const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"];
    const cycler = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["task-status-cycler"];
    const bankProp = document.querySelector('.metadata-property[data-property-key="bank"]');
    const hubClass = Boolean(document.body && document.body.classList && document.body.classList.contains("bob-bank-hub-note"));
    return {
      cards,
      badges,
      badgeCount: document.querySelectorAll(".bob-bank-badge").length,
      marks,
      mathCount: math.length,
      path: active && active.path || null,
      mode: state.mode || null,
      source: state.source,
      cursorLine: cursor && cursor.line,
      lineText,
      leaves: window.app.workspace.getLeavesOfType("markdown").map((item) => item.view && item.view.file && item.view.file.path),
      bankPropDisplay: bankProp ? window.getComputedStyle(bankProp).display : null,
      hubClass,
      gate: Boolean(document.body && document.body.classList && document.body.classList.contains("bob-bank-marks")),
      ledger: Boolean(plugin),
      cycler: Boolean(cycler),
      commands: {
        openToday: Boolean(window.app.commands.findCommand("bob-ledger-tools:bank-open-today")),
        ackDay: Boolean(window.app.commands.findCommand("bob-ledger-tools:bank-ack-day")),
        toggleMarks: Boolean(window.app.commands.findCommand("bob-ledger-tools:toggle-bank-marks")),
        cycle: Boolean(window.app.commands.findCommand("task-status-cycler:cycle-task-status-forward")),
      },
      notices: Array.from(document.querySelectorAll(".notice")).map(textOf).slice(-8),
      errors: Array.from(document.querySelectorAll(".bob-bank-card-error, .bob-bank-badge-unavailable, [role=alert]")).map(textOf),
    };
  } catch (error) {
    return { error: String(error && error.message || error), cards: [], badges: [], marks: [], mathCount: 0 };
  } })()`;
}

module.exports = {
  HELP_TEXT,
  FIXTURE_TODAY,
  FIXTURE_HISTORICAL,
  IMPORTED_WAITING_ID,
  IMPORTED_ACKED_ID,
  CUSTOM_BLOCK_ID,
  scratchRoot,
  makeScratch,
  parseArgs,
  dailyPathFor,
  hubNote,
  octoberNote,
  novemberNote,
  emptyMonthNote,
  invalidFenceNote,
  dailyNote,
  ordinaryNote,
  fixtureNotes,
  listWaitingJson,
  emptyListJson,
  reportMonthJson,
  reportDayJson,
  ensureJson,
  fixtureJsonForArgv,
  writeShim,
  setShimMode,
  readArgvLog,
  argvHas,
  assertMonthCard,
  assertHeat,
  assertQueue,
  assertEmptyQueue,
  assertBadge,
  assertAckArgv,
  assertEnsureArgv,
  assertNoMath,
  assertHasMath,
  BANK_UI_PROBE,
};
