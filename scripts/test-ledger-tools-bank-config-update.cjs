// Guarded bank config update service and Category-card New category stage
// (bob-cli-lt category-new). Fixture JSON only; no live bob.
const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;
const {
  BANK_CONFIG_UPDATE_SCHEMA_VERSION,
  BANK_CONFIG_UPDATE_TIMEOUT_MS,
  BANK_CONFIG_UPDATE_MAX_BUFFER,
  BANK_CONFIG_UPDATE_PREVIEW_DEBOUNCE_MS,
  BANK_CONFIG_UPDATE_HUB_PATH,
  bankConfigUpdateArgs,
  bankConfigUpdateEnvelope,
  bankConfigUpdateEnvelopeText,
  bankConfigVaultSyncArgs,
  bankDecodeConfigUpdateReport,
  bankIsStaleConfigUpdateCode,
  bankConfigUpdateErrorModel,
  bankConfigAddOp,
  bankConfigFreeHotkeys,
  bankConfigFingerprintFromReport,
  createBankConfigUpdateSession,
  createGuardedUpdateSession,
  bankCategoryNewStageInit,
  bankCategoryNewDefaultGroup,
  bankCategoryNewCycleGroup,
  bankCategoryNewHotkeyStatus,
  bankCategoryNewDraftOp,
  bankCategoryNewCanApply,
  bankCategoryNewAddedKey,
  bankCategoryCardKeysText,
  bankDecodeList,
  GUARDED_UPDATE_LOCK_WAIT_HINT,
} = h;

class FakeTimers {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }
  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.tasks.set(id, { id, callback, due: this.now + delay });
    return id;
  }
  clearTimeout(id) { this.tasks.delete(id); }
  tick(milliseconds) {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.tasks.values()]
        .filter((task) => task.due <= target)
        .sort((left, right) => left.due - right.due || left.id - right.id)[0];
      if (!next) break;
      this.now = next.due;
      this.tasks.delete(next.id);
      next.callback();
    }
    this.now = target;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let i = 0; i < 24; i += 1) await Promise.resolve();
}

function categories() {
  return [
    { key: "coffee", emoji: "☕", label: "Coffee", hotkey: "c", group: "Everyday", hidden: false },
    { key: "groceries", emoji: "🛒", label: "Groceries", hotkey: "g", group: "Everyday", hidden: false },
    { key: "home", emoji: "🏠", label: "Housing", hotkey: "1", group: "Bills", hidden: false },
  ];
}

function updateReport(overrides = {}) {
  return {
    ok: true,
    schema_version: 1,
    command: "update",
    dry_run: true,
    changed: true,
    before_fingerprint: "sha256:before",
    after_fingerprint: "sha256:after",
    consequence: "adds 🍔 Fast food to Everyday · key b · stored as fast_food",
    per_op: [{
      index: 0,
      op: "category.add",
      summary: "adds 🍔 Fast food · stored as fast_food",
      key: "fast_food",
      hotkey: "b",
      rows: 0,
      rule_refs: 0,
    }],
    hotkeys: { shifted: [], free: ["d", "e"] },
    categories: [
      ...categories(),
      { key: "fast_food", emoji: "🍔", label: "Fast food", hotkey: "b", group: "Everyday", hidden: false },
    ],
    inverse_ops: [{ op: "category.remove", key: "fast_food" }],
    changes: [{ path: "bank.md", diff: "@@\n" }],
    commit: null,
    sync: { pre: "skipped", post: "skipped" },
    warnings: [],
    failure: null,
    ...overrides,
  };
}

function makeSessionDeps(overrides = {}) {
  const timers = new FakeTimers();
  let generation = 0;
  const calls = { preview: 0, apply: 0, vaultSync: 0, saves: [] };
  let previewImpl = async () => ({ ok: true, report: updateReport() });
  let applyImpl = async () => ({
    ok: true,
    report: updateReport({ dry_run: false }),
    refreshed: null,
    wrote: true,
    unknown: false,
  });
  const deps = {
    timers,
    getGeneration: () => generation,
    bumpGeneration: () => { generation += 1; },
    saveEditors: async (paths) => {
      calls.saves.push(paths.slice());
      return { ok: true };
    },
    spawnPreview: async (identity, envelopeText) => {
      calls.preview += 1;
      calls.lastPreviewEnvelope = envelopeText;
      return previewImpl(identity, envelopeText);
    },
    spawnApply: async (identity, envelopeText, applyOptions) => {
      calls.apply += 1;
      calls.lastApplyEnvelope = envelopeText;
      calls.lastApplyOptions = applyOptions;
      return applyImpl(identity, envelopeText, applyOptions);
    },
    spawnVaultSync: async () => {
      calls.vaultSync += 1;
      return { ok: true, report: { ok: true, output: "" } };
    },
    calls,
    setPreviewImpl: (fn) => { previewImpl = fn; },
    setApplyImpl: (fn) => { applyImpl = fn; },
    ...overrides,
  };
  return deps;
}

function event(key, options = {}) {
  return {
    key,
    ctrlKey: options.ctrlKey === true,
    shiftKey: options.shiftKey === true,
    isComposing: false,
    target: options.target || null,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

function makeModal(options = {}) {
  const actions = [];
  const modal = new h.BankCategoryCardModal({}, {
    mode: options.mode || "close",
    categories: options.categories === undefined ? categories() : options.categories,
    context: { cardRow: { payee: "Corner Cafe", cents: -645, category: null } },
    plugin: options.plugin || null,
    onChoose: async (category, kind) => actions.push({ category, kind }),
  });
  modal.highlightKey = options.highlightKey === undefined ? "coffee" : options.highlightKey;
  modal.configFingerprint = options.fingerprint === undefined ? "sha256:before" : options.fingerprint;
  if (options.deps) modal.newSessionDeps = options.deps;
  return { modal, actions };
}

test("update argv, envelope, and timeout follow the guarded writer contract", () => {
  assert.equal(BANK_CONFIG_UPDATE_SCHEMA_VERSION, 1);
  assert.equal(BANK_CONFIG_UPDATE_HUB_PATH, "bank.md");
  assert.deepEqual(bankConfigUpdateArgs(), ["bank", "config", "update", "-f", "json", "-i", "-"]);
  assert.deepEqual(
    bankConfigUpdateArgs({ dryRun: true }),
    ["bank", "config", "update", "-f", "json", "-i", "-", "-d"],
  );
  assert.deepEqual(bankConfigVaultSyncArgs(), ["vault-sync"]);
  assert.equal(BANK_CONFIG_UPDATE_PREVIEW_DEBOUNCE_MS, 250);
  assert.equal(typeof BANK_CONFIG_UPDATE_TIMEOUT_MS, "number");
  assert.equal(typeof BANK_CONFIG_UPDATE_MAX_BUFFER, "number");
  assert.deepEqual(bankConfigUpdateEnvelope("sha256:abc", [{ op: "category.add", label: "X" }]), {
    schema_version: 1,
    expect: "sha256:abc",
    ops: [{ op: "category.add", label: "X" }],
  });
  assert.equal(
    bankConfigUpdateEnvelopeText("sha256:abc", []),
    '{"schema_version":1,"expect":"sha256:abc","ops":[]}',
  );
  assert.equal(bankIsStaleConfigUpdateCode("stale_config"), true);
  assert.equal(bankIsStaleConfigUpdateCode("category_exists"), false);
  assert.match(bankConfigUpdateErrorModel({ code: "timeout" }).hint, /never blind-retry/);
  assert.equal(typeof createGuardedUpdateSession, "function");
});

test("update decoder keeps typed refusals and the derived stored key", () => {
  const success = bankDecodeConfigUpdateReport(JSON.stringify(updateReport()), "", 0);
  assert.equal(success.ok, true);
  assert.equal(success.report.ok, true);
  assert.match(success.report.consequence, /stored as fast_food/);
  assert.equal(success.report.per_op[0].key, "fast_food");
  assert.ok(success.report.categories.some((entry) => entry.key === "fast_food"));

  const refused = bankDecodeConfigUpdateReport(
    JSON.stringify(updateReport({
      ok: false,
      changed: false,
      consequence: "",
      per_op: [],
      inverse_ops: [],
      changes: [],
      failure: {
        code: "hotkey_taken",
        message: "hotkey c is already used",
        hint: "pick a free key",
        op_index: 0,
        key_path: null,
        line: null,
        affected: null,
      },
    })),
    "",
    2,
  );
  assert.equal(refused.ok, true, "exit 2 is a valid refusal document");
  assert.equal(refused.report.ok, false);
  assert.equal(refused.report.failure.code, "hotkey_taken");
  assert.equal(refused.report.failure.op_index, 0);

  const stale = bankDecodeConfigUpdateReport(
    JSON.stringify(updateReport({
      ok: false,
      changed: false,
      failure: { code: "stale_config", message: "fingerprint moved", hint: "refresh", op_index: null, key_path: null, line: null, affected: null },
    })),
    "",
    2,
  );
  assert.equal(stale.report.failure.code, "stale_config");
  assert.equal(bankDecodeConfigUpdateReport("not JSON", "boom").code, "bad-json");
  assert.equal(
    bankDecodeConfigUpdateReport(JSON.stringify(updateReport({ schema_version: 2 })), "").code,
    "schema-mismatch",
  );
});

test("list and report keep config_fingerprint for the guarded expect", () => {
  const listed = bankDecodeList(JSON.stringify({
    ok: true,
    schema_version: 1,
    today: "2026-11-12",
    config_fingerprint: "sha256:hub",
    categories: [],
    accounts: [],
    issues: { errors: 0, warnings: 0 },
    findings: [],
    days: [],
    counts: { rows: 0, waiting: 0, flagged: 0 },
    filter: "waiting",
  }), "");
  assert.equal(listed.ok, true);
  assert.equal(listed.report.config_fingerprint, "sha256:hub");
  assert.equal(bankConfigFingerprintFromReport(listed.report), "sha256:hub");
});

test("stdin carries shell-looking labels byte-identical and never as shell text", async () => {
  const plugin = new LedgerToolsPlugin({
    vault: { adapter: { basePath: "/fixture-vault" }, getMarkdownFiles: () => [], on() { return {}; } },
    metadataCache: { on() { return {}; } },
    workspace: { on() { return {}; }, getLeavesOfType: () => [] },
  }, {});
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupBankData();
  try {
    const label = "$(rm -rf ~); echo `hi` && exit | 🍔";
    const ops = [bankConfigAddOp({ label, group: "Everyday" })];
    const envelopeText = bankConfigUpdateEnvelopeText("sha256:before", ops);
    const seen = {};
    const result = await plugin.bankSpawnConfigUpdate(envelopeText, {
      dryRun: true,
      execFile: (command, args, options, callback) => {
        seen.command = command;
        seen.args = args;
        seen.options = options;
        seen.stdinText = null;
        const stdin = {
          write: (text) => { seen.stdinText = String(text); },
          end: () => {},
          on: () => {},
        };
        callback(null, JSON.stringify(updateReport()), "");
        return { stdin };
      },
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
      vaultPath: "/fixture-vault",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(seen.args, ["bank", "config", "update", "-f", "json", "-i", "-", "-d"]);
    assert.equal(JSON.parse(seen.stdinText).ops[0].label, label);
    assert.equal(seen.args.join(" ").includes(label), false);
  } finally {
    plugin.teardownBankData();
  }
});

test("own bank.md echo is suppressed while apply is in flight", () => {
  const plugin = new LedgerToolsPlugin({
    vault: { adapter: { basePath: "/fixture-vault" }, getMarkdownFiles: () => [], on() { return {}; } },
    metadataCache: { on() { return {}; } },
    workspace: { on() { return {}; } },
  }, {});
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupBankData();
  const generations = [];
  const original = plugin.apiBankInvalidate.bind(plugin);
  plugin.apiBankInvalidate = (reason) => {
    generations.push(reason);
    return original(reason);
  };
  plugin.bankConfigUpdateOwnPaths.add("bank.md");
  plugin.bankHandleFileEvent({ path: "bank.md" });
  assert.deepEqual(generations, []);
  plugin.bankHandleFileEvent({ path: "bank/2026-11.md" });
  assert.equal(generations.length, 1);
  plugin.teardownBankData();
});

test("preview debounce, matching apply, and double Enter share one flight", async () => {
  const deps = makeSessionDeps();
  const session = createBankConfigUpdateSession({ expect: "sha256:before" }, deps);
  try {
    session.setDraft([bankConfigAddOp({ label: "🍔 Fast food", group: "Everyday" })]);
    assert.equal(session.getState().status, "preview-pending");
    deps.timers.tick(BANK_CONFIG_UPDATE_PREVIEW_DEBOUNCE_MS - 1);
    await flushMicrotasks();
    assert.equal(deps.calls.preview, 0);
    deps.timers.tick(1);
    await flushMicrotasks();
    assert.equal(session.getState().status, "preview-ready");
    assert.match(session.getState().consequence, /stored as fast_food/);
    const flight = deferred();
    deps.setApplyImpl(() => flight.promise);
    const first = session.apply();
    const second = session.apply();
    await flushMicrotasks();
    assert.equal(deps.calls.apply, 1);
    flight.resolve({
      ok: true,
      report: updateReport({ dry_run: false }),
      wrote: true,
      unknown: false,
    });
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.ok, true);
    assert.equal(right.ok, true);
    assert.deepEqual(deps.calls.saves, [["bank.md"]]);
    assert.equal(deps.calls.lastPreviewEnvelope, deps.calls.lastApplyEnvelope);
  } finally {
    session.close();
  }
});

test("Enter is inert without a matching preview; apply failure files nothing", async () => {
  const deps = makeSessionDeps();
  const session = createBankConfigUpdateSession({ expect: "sha256:before" }, deps);
  try {
    const denied = await session.apply();
    assert.equal(denied.code, "not-previewed");
    assert.equal(deps.calls.apply, 0);
    session.setDraft([bankConfigAddOp({ label: "🍔 Fast food" })]);
    deps.timers.tick(BANK_CONFIG_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({
        ok: false,
        changed: false,
        failure: { code: "category_exists", message: "already there", hint: "", op_index: 0 },
      }),
    }));
    const refused = await session.apply();
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "category_exists");
    assert.deepEqual(session.getState().draftOps[0].op, "category.add");
  } finally {
    session.close();
  }
});

test("stale_config rebases; sync retry never replays the mutation", async () => {
  const deps = makeSessionDeps();
  const session = createBankConfigUpdateSession({ expect: "sha256:before" }, deps);
  try {
    session.setDraft([bankConfigAddOp({ label: "🍔 Fast food" })]);
    deps.timers.tick(BANK_CONFIG_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    deps.bumpGeneration();
    session.noteGenerationChanged();
    assert.equal(session.getState().status, "refused");
    assert.equal((await session.apply()).code, "not-previewed");
    deps.setApplyImpl(async () => ({
      ok: true,
      report: updateReport({
        dry_run: false,
        sync: { pre: "ok", post: "failed" },
        warnings: ["Saved locally; sync failed."],
      }),
      wrote: true,
    }));
    session.rebase("sha256:before");
    session.setDraft([bankConfigAddOp({ label: "🍔 Fast food" })]);
    deps.timers.tick(BANK_CONFIG_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    const applied = await session.apply();
    assert.equal(applied.ok, true);
    assert.equal(session.getState().status, "saved-with-sync-warning");
    const retried = await session.retrySync();
    assert.equal(retried.ok, true);
    assert.equal(deps.calls.vaultSync, 1);
    assert.equal(deps.calls.apply, 1, "retry never replays the mutation");
  } finally {
    session.close();
  }
});

test("stage defaults the group, cycles it, and keeps taken or reserved keys inert", () => {
  const cats = categories();
  assert.equal(bankCategoryNewDefaultGroup(cats, "coffee"), "Everyday");
  const stage = bankCategoryNewStageInit(cats, "coffee");
  assert.equal(stage.group, "Everyday");
  assert.equal(stage.hotkey, bankConfigFreeHotkeys(cats)[0]);
  assert.equal(bankCategoryNewCycleGroup(stage, "forward"), "Bills");
  assert.equal(bankCategoryNewCycleGroup({ ...stage, group: "Bills" }, "back"), "Everyday");
  assert.equal(bankCategoryNewHotkeyStatus(cats, "c").kind, "taken");
  assert.equal(bankCategoryNewHotkeyStatus(cats, "c").canApply, false);
  assert.match(bankCategoryNewHotkeyStatus(cats, "c").text, /Coffee/);
  assert.equal(bankCategoryNewHotkeyStatus(cats, "q").kind, "reserved");
  assert.equal(bankCategoryNewHotkeyStatus(cats, "q").canApply, false);
  assert.equal(bankCategoryNewHotkeyStatus(cats, "b").kind, "free");
  assert.deepEqual(bankCategoryNewDraftOp({ label: "🍔 Fast food", group: "Everyday", hotkey: "b" }), {
    op: "category.add",
    label: "🍔 Fast food",
    group: "Everyday",
    hotkey: "b",
  });
  assert.equal(bankCategoryNewCanApply(stage, { canApply: true }, cats), false, "empty label");
  assert.match(bankCategoryCardKeysText("close", "card"), /\+ new category/);
});

test("+ and = open the stage; letters type; they never file; Esc closes the stage first", async () => {
  const { modal, actions } = makeModal();
  await modal.onKeyDown(event("+"));
  assert.ok(modal.newStage);
  assert.equal(modal.newStage.group, "Everyday");
  assert.equal(modal.closed, false);
  assert.equal(actions.length, 0);
  modal.closeNewCategoryStage();

  const equals = makeModal();
  await equals.modal.onKeyDown(event("="));
  assert.ok(equals.modal.newStage);

  const typed = makeModal();
  await typed.modal.onKeyDown(event("+"));
  await typed.modal.onKeyDown(event("g"));
  assert.equal(typed.actions.length, 0);
  assert.equal(typed.modal.newStage.label, "g");
  await typed.modal.onKeyDown(event("Escape"));
  assert.equal(typed.modal.newStage, null);
  assert.equal(typed.modal.closed, false);
  await typed.modal.onKeyDown(event("Escape"));
  assert.equal(typed.modal.closed, true);
});

test("the new-category tile click opens the stage; missing fingerprint refuses", async () => {
  const { modal } = makeModal();
  modal.onClick({
    target: { closest: (sel) => sel === "button[data-bank-new-category]" ? { disabled: false } : null },
    preventDefault() {},
    stopPropagation() {},
  });
  assert.ok(modal.newStage);
  const old = makeModal({ fingerprint: "" });
  await old.modal.onKeyDown(event("+"));
  assert.equal(old.modal.newStage, null);
  assert.match(old.modal.reason, /newer bob/);
});

test("Enter is inert on a taken key and without a matching preview", async () => {
  const { modal, actions } = makeModal();
  await modal.onKeyDown(event("+"));
  modal.newStage.label = "🍔 Fast food";
  modal.newStage.hotkey = "c";
  await modal.onKeyDown(event("Enter"));
  assert.equal(actions.length, 0);
  assert.ok(modal.newStage);

  const ready = makeModal();
  await ready.modal.onKeyDown(event("+"));
  ready.modal.newStage.label = "🍔 Fast food";
  ready.modal.newStage.hotkey = "b";
  ready.modal.newSession = {
    getState: () => ({ canApply: false }),
    apply: async () => { throw new Error("should not apply"); },
    close() {},
  };
  await ready.modal.onKeyDown(event("Enter"));
  assert.equal(ready.actions.length, 0);
});

test("apply-then-file uses the derived key and one choose; failure files nothing", async () => {
  const { modal, actions } = makeModal();
  await modal.onKeyDown(event("+"));
  modal.newStage.label = "🍔 Fast food";
  modal.newStage.hotkey = "b";
  const report = updateReport({ dry_run: false });
  modal.newSession = {
    getState: () => ({ canApply: true, syncWarning: null }),
    apply: async () => ({ ok: true, changed: true, report }),
    close() {},
  };
  await modal.applyNewCategoryAndFile();
  assert.deepEqual(actions, [{ category: "fast_food", kind: "pick" }]);
  assert.equal(bankCategoryNewAddedKey(report), "fast_food");
  assert.equal(modal.newStage, null);
  assert.ok(modal.categories.some((entry) => entry.key === "fast_food"));

  const failing = makeModal();
  await failing.modal.onKeyDown(event("+"));
  failing.modal.newStage.label = "🍔 Fast food";
  failing.modal.newStage.hotkey = "b";
  failing.modal.newSession = {
    getState: () => ({ canApply: true }),
    apply: async () => ({ ok: false, code: "lock_busy", message: "locked" }),
    close() {},
  };
  await failing.modal.applyNewCategoryAndFile();
  assert.equal(failing.actions.length, 0);
  assert.ok(failing.modal.newStage);
  assert.equal(failing.modal.newStage.refusal.code, "lock_busy");
});

test("setCategories repaints after interaction; setReport stays ignored then", () => {
  const { modal } = makeModal();
  modal.didInteract = true;
  assert.equal(modal.setReport({ categories: [{ key: "x", label: "X" }], config_fingerprint: "sha256:next" }), false);
  assert.equal(modal.configFingerprint, "sha256:next");
  assert.equal(modal.categories[0].key, "coffee");
  assert.equal(modal.setCategories([{ key: "fast_food", label: "Fast food", hotkey: "b" }]), true);
  assert.equal(modal.categories[0].key, "fast_food");
});

test("bank lock_busy waits then retries the same envelope", async () => {
  const deps = makeSessionDeps();
  let applies = 0;
  deps.setApplyImpl(async () => {
    applies += 1;
    if (applies === 1) {
      return {
        ok: true,
        report: updateReport({
          ok: false,
          dry_run: false,
          changed: false,
          failure: { code: "lock_busy", message: "another Bob vault maintenance run is already active", hint: "retry" },
        }),
        refreshed: null,
        wrote: false,
        unknown: false,
      };
    }
    return {
      ok: true,
      report: updateReport({ dry_run: false }),
      refreshed: null,
      wrote: true,
      unknown: false,
    };
  });
  const session = createBankConfigUpdateSession(
    { expect: "sha256:before", lockRetryMs: 50, lockWaitBudgetMs: 1000 },
    deps,
  );
  try {
    session.setDraft([{ op: "category.add", label: "🍔 Fast food", hotkey: "b", group: "Everyday" }]);
    deps.timers.tick(BANK_CONFIG_UPDATE_PREVIEW_DEBOUNCE_MS);
    await flushMicrotasks();
    const applying = session.apply();
    await flushMicrotasks();
    assert.equal(session.getState().lockWait.attempts, 1);
    deps.timers.tick(50);
    await flushMicrotasks();
    const result = await applying;
    assert.equal(result.ok, true);
    assert.equal(applies, 2);
    assert.equal(deps.calls.saves.length, 1);
    assert.equal(session.getState().undoAvailable, true);
  } finally {
    session.close();
  }
});

test("the bank service skips forced revalidate on lock_busy", async () => {
  const plugin = new LedgerToolsPlugin({
    vault: { adapter: { basePath: "/fixture-vault" }, getMarkdownFiles: () => [], on() { return {}; } },
    metadataCache: { on() { return {}; } },
    workspace: { on() { return {}; }, getLeavesOfType: () => [] },
  }, {});
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupBankData();
  try {
    let refreshes = 0;
    plugin.apiBankRefresh = async () => {
      refreshes += 1;
      return { report: null };
    };
    plugin.bankSpawnConfigUpdate = async () => ({
      ok: true,
      report: updateReport({
        ok: false,
        dry_run: false,
        changed: false,
        failure: { code: "lock_busy", message: "locked", hint: "retry" },
      }),
    });
    const result = await plugin.apiBankConfigUpdateApply("{}", { ownPath: "bank.md" });
    assert.equal(result.ok, true);
    assert.equal(result.report.failure.code, "lock_busy");
    assert.equal(refreshes, 0, "lock_busy never forces a post-apply config refresh");
  } finally {
    plugin.teardownBankData();
  }
});

test("new-category Esc during a lock wait stops waiting and keeps the stage open", async () => {
  const { modal } = makeModal();
  await modal.onKeyDown(event("+"));
  modal.newStage.label = "🍔 Fast food";
  modal.newStage.hotkey = "b";
  let stopped = 0;
  modal.newSession = {
    getState: () => ({
      canApply: false,
      lockWait: modal.newStage && modal.newStage.lockWait,
      lockNotice: modal.newStage && modal.newStage.lockNotice,
    }),
    stopWaiting() {
      stopped += 1;
      modal.newStage.lockWait = null;
      modal.newStage.lockNotice = { message: "Stopped", hint: GUARDED_UPDATE_LOCK_WAIT_HINT };
      modal.newStage.canApply = true;
    },
    apply: async () => ({ ok: false, code: "lock-wait-stopped" }),
    close() {},
  };
  modal.newStage.lockWait = { since: 0, elapsedMs: 42000, attempts: 2, stopping: false };
  await modal.onKeyDown(event("Escape"));
  assert.equal(stopped, 1);
  assert.ok(modal.newStage, "Esc during a wait keeps the new-category stage open");
  assert.notEqual(modal.closed, true);
  await modal.onKeyDown(event("Escape"));
  assert.equal(modal.newStage, null, "the next Esc closes the stage");
});

test("apply-busy refuses a second plugin apply; timeout is never a blind retry", async () => {
  const plugin = new LedgerToolsPlugin({
    vault: { adapter: { basePath: "/fixture-vault" }, getMarkdownFiles: () => [], on() { return {}; } },
    metadataCache: { on() { return {}; } },
    workspace: { on() { return {}; }, getLeavesOfType: () => [] },
  }, {});
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupBankData();
  try {
    const flight = deferred();
    plugin.bankSpawnConfigUpdate = () => flight.promise;
    plugin.apiBankRefresh = async () => ({ report: null });
    const first = plugin.apiBankConfigUpdateApply("{}", { ownPath: "bank.md" });
    await flushMicrotasks();
    const busy = await plugin.apiBankConfigUpdateApply("{}", { ownPath: "bank.md" });
    assert.equal(busy.code, "apply-busy");
    flight.resolve({
      ok: false,
      code: "timeout",
      message: "killed",
    });
    const timed = await first;
    assert.equal(timed.code, "timeout");
    assert.equal(timed.unknown, true);
    assert.equal(plugin.bankConfigUpdateOwnPaths.has("bank.md"), false);
  } finally {
    plugin.teardownBankData();
  }
});
