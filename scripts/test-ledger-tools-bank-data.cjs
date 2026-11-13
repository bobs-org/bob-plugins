// Bank data path: spawn env, stale-while-revalidate cache, coalescing,
// generation guards, filtered invalidation, local midnight, and unload.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const {
  BANK_CACHE_SIZE,
  BANK_REVALIDATE_DEBOUNCE_MS,
  BOB_SPAWN_MAX_BUFFER,
  BOB_SPAWN_TIMEOUT_MS,
  bankBuildArgs,
  bankCacheKey,
  bankDecodeList,
  bankDecodeReport,
  bankLocalDate,
} = LedgerToolsPlugin.helpers;

const fixtureDir = path.join(
  __dirname,
  "../plugins/bob-ledger-tools/scripts/fixtures/bank",
);

function readFixture(name) {
  return fs.readFileSync(path.join(fixtureDir, name), "utf8");
}

const listDocument = JSON.parse(readFixture("list-waiting.json"));
const reportDocument = JSON.parse(readFixture("report-month.json"));
const listDecoded = bankDecodeList(JSON.stringify(listDocument), "");
const reportDecoded = bankDecodeReport(JSON.stringify(reportDocument), "");
const listArgs = bankBuildArgs({ command: "list" });
const reportArgs = bankBuildArgs({ command: "report", month: "2026-11" });
const listKey = bankCacheKey(listArgs);
const reportKey = bankCacheKey(reportArgs);

class FakeTimers {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }

  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.tasks.set(id, { id, callback, due: this.now + delay, interval: 0 });
    return id;
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  setInterval(callback, interval) {
    const id = this.nextId++;
    this.tasks.set(id, { id, callback, due: this.now + interval, interval });
    return id;
  }

  clearInterval(id) {
    this.tasks.delete(id);
  }

  tick(milliseconds) {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.tasks.values()]
        .filter((task) => task.due <= target)
        .sort((left, right) => left.due - right.due || left.id - right.id)[0];
      if (!next) break;
      this.now = next.due;
      if (next.interval > 0) {
        next.due += next.interval;
      } else {
        this.tasks.delete(next.id);
      }
      next.callback();
    }
    this.now = target;
  }
}

function eventSource() {
  const handlers = new Map();
  return {
    on(event, callback) {
      const list = handlers.get(event) || [];
      list.push(callback);
      handlers.set(event, list);
      return { event, callback };
    },
    emit(event, ...args) {
      for (const callback of handlers.get(event) || []) callback(...args);
    },
  };
}

function makeBankPlugin(initial = []) {
  const app = makeFreshnessApp({ tasks: [] });
  const vaultEvents = eventSource();
  const metadataEvents = eventSource();
  const workspaceEvents = eventSource();
  const files = initial.map((path) => ({ path, extension: "md" }));
  app.vault = {
    adapter: { basePath: "/fixture-vault" },
    getMarkdownFiles: () => files,
    on: vaultEvents.on.bind(vaultEvents),
  };
  app.metadataCache = {
    on: metadataEvents.on.bind(metadataEvents),
  };
  app.workspace = {
    on: workspaceEvents.on.bind(workspaceEvents),
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.bankTimers = new FakeTimers();
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupBankData();
  return {
    plugin,
    app,
    files,
    timers: plugin.bankTimers,
    vaultEvent: (name, file, oldPath) => vaultEvents.emit(name, file, oldPath),
    metadataChanged: (file) => metadataEvents.emit("changed", file),
    workspaceEvent: (name, ...args) => workspaceEvents.emit(name, ...args),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function okList() {
  return { ok: true, report: listDecoded.report };
}

function okReport() {
  return { ok: true, report: reportDecoded.report };
}

test("bank subprocess uses bobSpawnJson with vault, timeout, and bounded output", async () => {
  await withMissingConfig(async () => {
    const { plugin } = makeBankPlugin();
    try {
      const seen = {};
      const result = await plugin.bankSpawnFetch(listArgs, {
        execFile: (command, args, options, callback) => {
          seen.command = command;
          seen.args = args;
          seen.options = options;
          callback(null, JSON.stringify(listDocument), "");
        },
        resolved: { path: "/fixture/bin/bob", source: "candidate" },
        vaultPath: "/fixture-vault",
      });
      assert.equal(result.ok, true);
      assert.equal(seen.command, "/fixture/bin/bob");
      assert.deepEqual(seen.args, listArgs);
      assert.equal(seen.options.env.BOB_DIR, "/fixture-vault");
      assert.equal(seen.options.env.NO_COLOR, "1");
      assert.equal(seen.options.timeout, BOB_SPAWN_TIMEOUT_MS);
      assert.equal(seen.options.maxBuffer, BOB_SPAWN_MAX_BUFFER);
      assert.equal(result.report.counts.waiting, 2);
    } finally {
      plugin.teardownBankData();
    }
  });
});

test("shared bob spawn maps missing binary and timeout failures", async () => {
  await withMissingConfig(async () => {
    const { plugin } = makeBankPlugin();
    try {
      const missing = await plugin.bankSpawnFetch(listArgs, {
        execFile: (command, args, options, callback) => {
          const error = new Error("spawn ENOENT");
          error.code = "ENOENT";
          callback(error, "", "");
        },
        resolved: { path: "bob", source: "path" },
        tried: ["bob (PATH)"],
      });
      assert.equal(missing.code, "bob-not-found");
      const timedOut = await plugin.bankSpawnFetch(listArgs, {
        execFile: (command, args, options, callback) => {
          const error = new Error("timeout");
          error.killed = true;
          callback(error, "", "first stderr line\nsecond line");
        },
        resolved: { path: "bob", source: "path" },
      });
      assert.equal(timedOut.code, "timeout");
      assert.equal(timedOut.detail, "first stderr line");
    } finally {
      plugin.teardownBankData();
    }
  });
});

test("bank cache returns stale data while revalidating and keeps a 16-entry LRU", async () => {
  const { plugin } = makeBankPlugin();
  try {
    let spawns = 0;
    plugin.bankSpawnFetch = async (args) => {
      spawns += 1;
      return args[1] === "report" ? okReport() : okList();
    };
    const first = await plugin.apiBankFetch({ command: "list" });
    assert.equal(first.stale, false);
    assert.equal(first.report.counts.waiting, 2);
    const second = await plugin.apiBankFetch({ command: "list" });
    assert.equal(second.stale, true);
    assert.strictEqual(second.report, first.report);
    await flushMicrotasks();
    const manual = await plugin.apiBankRefresh({ command: "list" });
    assert.equal(manual.stale, false);
    assert.ok(spawns >= 3);

    for (let index = 0; index < BANK_CACHE_SIZE + 1; index += 1) {
      const result = await plugin.apiBankFetch({ command: "report", month: `2025-${String(index + 1).padStart(2, "0")}` });
      assert.equal(result.stale, false);
    }
    assert.equal(plugin.bankCache.size, BANK_CACHE_SIZE);
  } finally {
    plugin.teardownBankData();
  }
});

test("identical list flights coalesce and different keys spawn in parallel", async () => {
  const { plugin } = makeBankPlugin();
  const listGate = deferred();
  const reportGate = deferred();
  let listSpawns = 0;
  let reportSpawns = 0;
  plugin.bankSpawnFetch = async (args) => {
    if (args[1] === "report") {
      reportSpawns += 1;
      await reportGate.promise;
      return okReport();
    }
    listSpawns += 1;
    await listGate.promise;
    return okList();
  };
  try {
    const first = plugin.apiBankFetch({ command: "list" });
    const same = plugin.apiBankFetch({ command: "list" });
    const report = plugin.apiBankFetch({ command: "report", month: "2026-11" });
    await flushMicrotasks();
    assert.equal(listSpawns, 1);
    assert.equal(reportSpawns, 1);
    listGate.resolve();
    reportGate.resolve();
    const [left, right, month] = await Promise.all([first, same, report]);
    assert.strictEqual(left.report, right.report);
    assert.equal(left.stale, false);
    assert.equal(month.report.period.key, "2026-11");
    assert.equal(plugin.bankCache.has(listKey), true);
    assert.equal(plugin.bankCache.has(reportKey), true);
  } finally {
    plugin.teardownBankData();
  }
});

test("a late older generation cannot overwrite a newer cached report", async () => {
  const { plugin } = makeBankPlugin();
  const older = { ...listDecoded.report, filter: "older" };
  const newer = { ...listDecoded.report, filter: "newer" };
  const gate = deferred();
  let spawns = 0;
  plugin.bankSpawnFetch = async () => {
    spawns += 1;
    if (spawns === 1) {
      await gate.promise;
      return { ok: true, report: older };
    }
    return { ok: true, report: newer };
  };
  try {
    const first = plugin.apiBankFetch({ command: "list" });
    await flushMicrotasks();
    plugin.bankCacheSet(listKey, newer, 2);
    plugin.bankLatestStore().set(listKey, 2);
    gate.resolve();
    const late = await first;
    assert.equal(plugin.bankCacheGet(listKey).report.filter, "newer");
    assert.equal(plugin.bankCacheGet(listKey).generation, 2);
    assert.equal(late.report.filter, "older");
  } finally {
    plugin.teardownBankData();
  }
});

test("failed refresh keeps last good data stale without a retry loop", async () => {
  const { plugin } = makeBankPlugin();
  let spawns = 0;
  plugin.bankSpawnFetch = async () => {
    spawns += 1;
    if (spawns === 1 || spawns === 3) return okList();
    return { ok: false, code: "timeout", message: "bob bank list timed out.", detail: "" };
  };
  try {
    const first = await plugin.apiBankFetch({ command: "list" });
    assert.equal(first.stale, false);
    const failed = await plugin.apiBankRefresh({ command: "list" });
    assert.strictEqual(failed.report, first.report);
    assert.equal(failed.stale, true);
    assert.equal(failed.error.code, "timeout");
    const retried = await plugin.apiBankRefresh({ command: "list" });
    assert.equal(retried.stale, false);
    assert.equal(retried.error, null);
    assert.equal(spawns, 3);
  } finally {
    plugin.teardownBankData();
  }
});

test("only hub and canonical month notes invalidate, and debounce coalesces", async () => {
  const { plugin, timers, vaultEvent, metadataChanged } = makeBankPlugin([
    "bank.md",
    "bank/2026-11.md",
    "ideas.md",
    "bank/notes.md",
  ]);
  let spawns = 0;
  plugin.bankSpawnFetch = async () => {
    spawns += 1;
    return okList();
  };
  const states = [];
  try {
    const unsubscribe = plugin.apiBankSubscribe({ command: "list" }, (state) => {
      states.push(state);
    });
    await flushMicrotasks();
    assert.equal(spawns, 1);
    const generation = plugin.bankVaultGeneration;
    vaultEvent("modify", { path: "ideas.md" });
    vaultEvent("modify", { path: "bank/notes.md" });
    metadataChanged({ path: "cash.md" });
    assert.equal(plugin.bankVaultGeneration, generation);
    assert.equal(plugin.bankRevalidateTimer, null);

    vaultEvent("modify", { path: "bank.md" });
    metadataChanged({ path: "bank/2026-11.md" });
    vaultEvent("rename", { path: "ideas.md" }, "bank/2026-10.md");
    assert.ok(plugin.bankVaultGeneration > generation);
    assert.notEqual(plugin.bankRevalidateTimer, null);
    const afterRelevant = spawns;
    timers.tick(BANK_REVALIDATE_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.ok(spawns > afterRelevant, "mounted bank notes revalidate after debounce");
    unsubscribe();
  } finally {
    plugin.teardownBankData();
  }
});

test("local midnight bumps generation and command-mode bank tag invalidates", async () => {
  const { plugin, timers } = makeBankPlugin();
  plugin.bankSpawnFetch = async () => okList();
  try {
    plugin.apiBankSubscribe({ command: "list" }, () => {});
    await flushMicrotasks();
    plugin.bankLocalDay = "2026-11-12";
    assert.equal(plugin.bankRefreshRollover(new Date(2026, 10, 12, 23, 59)), false);
    const before = plugin.bankVaultGeneration;
    assert.equal(plugin.bankRefreshRollover(new Date(2026, 10, 13, 0, 0)), true);
    assert.ok(plugin.bankVaultGeneration > before);
    assert.equal(plugin.bankInvalidationReason, "local-date-rollover");
    assert.equal(plugin.bankLocalDay, "2026-11-13");
    assert.match(bankLocalDate(new Date(2026, 10, 13)), /^2026-11-13$/);

    plugin.refreshCachesForCommandModeRun({ invalidates: ["bank", "plugins"] });
    assert.equal(plugin.bankInvalidationReason, "command-mode");
    timers.tick(BANK_REVALIDATE_DEBOUNCE_MS);
    await flushMicrotasks();
  } finally {
    plugin.teardownBankData();
  }
});

test("unload clears mounts and a late result cannot repaint", async () => {
  const { plugin } = makeBankPlugin();
  const flight = deferred();
  let notifications = 0;
  plugin.bankSpawnFetch = () => flight.promise;
  try {
    const unsubscribe = plugin.apiBankSubscribe({ command: "list" }, () => {
      notifications += 1;
    });
    await flushMicrotasks();
    const beforeUnload = notifications;
    unsubscribe();
    plugin.teardownBankData();
    flight.resolve(okList());
    await flushMicrotasks();
    assert.equal(notifications, beforeUnload);
    assert.equal(plugin.bankMounts.size, 0);
    assert.equal(plugin.bankCache.size, 0);
    const unloaded = await plugin.apiBankFetch({ command: "list" });
    assert.equal(unloaded.error.code, "unloaded");
  } finally {
    plugin.teardownBankData();
  }
});

test("headless setup does not keep the process alive with a browser rollover timer", () => {
  const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
  plugin.setupBankData();
  try {
    assert.equal(plugin.bankRolloverTimer, null);
    const api = plugin.bankApi();
    assert.equal(api.version, 2);
    assert.equal(typeof api.fetch, "function");
    assert.equal(typeof api.subscribe, "function");
    assert.equal(typeof api.invalidate, "function");
  } finally {
    plugin.teardownBankData();
  }
});
