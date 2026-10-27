#!/usr/bin/env node
// Fake bob for bob-command-mode tests. Serves a fixture catalog for
// `__catalog --protocol 1`; every other invocation is driven by FAKE_BOB_*
// env vars: sleep, hold on a gate file, emit stdout/stderr (including a split
// multi-byte char and >1MiB output), exit with a code or signal, and write
// BOB_RUN_RECEIPT.
const fs = require("node:fs");

function fixtureCatalog() {
  return {
    schema_version: 1,
    ok: true,
    protocol: 1,
    bob_version: "0.3.1-test",
    features: ["clicolor-force", "progress-env", "run-receipt"],
    sections: [
      { id: "daily", title: "Daily workflow" },
      { id: "vault", title: "Vault" },
    ],
    roots: ["plan", "ref", "capture"],
    aliases: [{ from: ["task-status-hooks"], to: ["task", "reconcile"] }],
    entries: [
      {
        id: "plan", path: ["plan"], fixed: [], title: "Today's plan",
        about: "Show today's plan", section: "daily", keywords: ["plan"],
        effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "plan-budget", path: ["plan", "budget"], fixed: [], title: "Plan budget",
        about: "Show the plan budget", section: "daily", keywords: ["budget"],
        effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 1,
        args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "ref-create", path: ["ref", "create"], fixed: [], title: "Create reference",
        about: "Create a reference", section: "vault", keywords: ["ref"],
        effect: "writes", network: true, presentation: "action",
        policy: "run", preview: ["--dry-run"], confirm: null, budget_secs: 60,
        args: [{ name: "TARGET", slot: "ref-target", required: true, repeat: true }],
        exit_codes: [], adapter: null, hosts: [], invalidates: ["references"],
      },
      {
        id: "ref-rename", path: ["ref", "rename"], fixed: [], title: "Rename a reference",
        about: "Rename a reference", section: "vault", keywords: ["rename"],
        effect: "syncs", network: false, presentation: "action",
        policy: "preview-first", preview: ["--dry-run"], confirm: null, budget_secs: 60,
        args: [
          { name: "REF", slot: "ref", required: true, repeat: false },
          { name: "NAME", slot: "text", required: true, repeat: false },
        ],
        exit_codes: [], adapter: null, hosts: [], invalidates: ["references"],
      },
      {
        id: "task-archive", path: ["task", "archive"], fixed: [], title: "Archive done tasks",
        about: "Archive done tasks", section: "daily", keywords: ["archive"],
        effect: "writes", network: false, presentation: "action",
        policy: "confirm", preview: null, confirm: "Archive every done task?",
        budget_secs: 60, args: [], exit_codes: [{ code: 3, outcome: "attention", meaning: "Nothing to archive" }],
        adapter: null, hosts: [], invalidates: ["tasks"],
      },
      {
        id: "ready", path: ["ready"], fixed: [], title: "Ready lanes",
        about: "Show ready lanes", section: "daily", keywords: ["ready"],
        effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [{ name: "NOTE", slot: "area-note", required: false, repeat: false }],
        exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
    ],
    excluded: [{ path: ["capture"], reason: "Use the named capture rows" }],
  };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "__catalog") {
    const flagIndex = argv.indexOf("--protocol");
    const equals = argv.find((word) => word.startsWith("--protocol="));
    const protocol = equals ? equals.slice("--protocol=".length) : (flagIndex >= 0 ? argv[flagIndex + 1] : null);
    if (protocol !== "1") {
      process.stdout.write(JSON.stringify({
        schema_version: 1, ok: false, code: "unsupported_protocol",
        min: 1, max: 1, message: "unsupported protocol " + String(protocol),
      }));
      process.exitCode = 2;
      return;
    }
    process.stdout.write(JSON.stringify(fixtureCatalog()));
    return;
  }
  const env = process.env;
  const sleepMs = Number(env.FAKE_BOB_SLEEP_MS || 0);
  const startedFile = env.FAKE_BOB_STARTED_FILE;
  if (startedFile) {
    try {
      fs.writeFileSync(startedFile, String(process.pid) + "\n");
    } catch (error) {
      process.stderr.write("fake-bob: cannot write started file\n");
    }
  }
  const finish = (exitOverride) => {
    if (env.FAKE_BOB_ECHO === "1") {
      process.stdout.write(JSON.stringify({
        argv,
        env: {
          BOB_DIR: env.BOB_DIR || null,
          CLICOLOR_FORCE: env.CLICOLOR_FORCE || null,
          BOB_PROGRESS: env.BOB_PROGRESS || null,
          BOB_RUN_RECEIPT: env.BOB_RUN_RECEIPT || null,
          COLUMNS: env.COLUMNS || null,
          NO_COLOR: env.NO_COLOR || null,
          PATH: env.PATH || null,
          BOB_NOW: env.BOB_NOW || null,
        },
      }) + "\n");
    }
    if (env.FAKE_BOB_SPLIT_MBYTE === "1") {
      const bytes = Buffer.from("héllo\n", "utf8");
      const cut = bytes.indexOf(Buffer.from("é", "utf8")) + 1;
      fs.writeSync(1, bytes.slice(0, cut));
      fs.writeSync(1, bytes.slice(cut));
    }
    if (env.FAKE_BOB_BIG === "1") {
      const chunk = "x".repeat(64 * 1024);
      for (let index = 0; index < 20; index += 1) fs.writeSync(1, chunk + "\n");
    }
    if (env.FAKE_BOB_STDOUT) process.stdout.write(env.FAKE_BOB_STDOUT);
    if (env.FAKE_BOB_STDERR) process.stderr.write(env.FAKE_BOB_STDERR);
    if (env.FAKE_BOB_SIGNAL) {
      process.kill(process.pid, env.FAKE_BOB_SIGNAL);
      return;
    }
    const code = exitOverride !== undefined ? Number(exitOverride) : Number(env.FAKE_BOB_EXIT || 0);
    const receiptPath = env.BOB_RUN_RECEIPT;
    if (receiptPath) {
      try {
        fs.writeFileSync(receiptPath, JSON.stringify({
          schema_version: 1, exit_code: code, finished_at: new Date().toISOString(),
        }) + "\n");
      } catch (error) {
        process.stderr.write("fake-bob: cannot write receipt\n");
      }
    }
    process.exitCode = code;
  };
  const waitThenFinish = () => {
    if (Number.isFinite(sleepMs) && sleepMs > 0) setTimeout(finish, sleepMs);
    else finish();
  };
  const gateFile = env.FAKE_BOB_GATE_FILE;
  if (gateFile) {
    const pollMs = Number(env.FAKE_BOB_GATE_POLL_MS || 15);
    const timeoutMs = Number(env.FAKE_BOB_GATE_TIMEOUT_MS || 30000);
    const begun = Date.now();
    const poll = () => {
      try {
        if (fs.existsSync(gateFile)) {
          waitThenFinish();
          return;
        }
      } catch (error) {
        // Retry until the gate timeout.
      }
      if (Number.isFinite(timeoutMs) && timeoutMs > 0 && Date.now() - begun >= timeoutMs) {
        process.stderr.write("fake-bob: gate timed out\n");
        finish(1);
        return;
      }
      setTimeout(poll, Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 15);
    };
    poll();
    return;
  }
  waitThenFinish();
}

main();
