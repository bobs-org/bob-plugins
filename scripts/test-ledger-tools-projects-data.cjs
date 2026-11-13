const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
} = require("./ledger-tools-harness.cjs");

const {
  PROJECTS_REPORT_SCHEMA_VERSION,
  PROJECTS_LIST_TIMEOUT_MS,
  PROJECTS_LIST_MAX_BUFFER,
  PROJECTS_REVALIDATE_DEBOUNCE_MS,
  PROJECTS_SYNC_DEBOUNCE_MS,
  projectsListArgs,
  projectsSyncArgs,
  projectsDecodeListReport,
  projectsDecodeSyncReport,
  projectsTypeNames,
  projectsNormalizeParent,
  projectsNormalizeStatus,
  projectsLifecycleFingerprint,
  projectsFingerprint,
  projectsFingerprintNeedsSync,
  projectsRelevantPath,
  projectsReportPath,
  projectsLocalDate,
  projectsErrorModel,
} = LedgerToolsPlugin.helpers;

function healthyProject(overrides = {}) {
  return {
    path: "sase.md",
    stem: "sase",
    status: "wip",
    state: "open",
    criterion: "Ship the parent outcome!",
    parent: "dev.md",
    children: ["sase_agents.md"],
    closed_on: null,
    prj: { line: 6, mark: " ", hidden: true, scheduled: null },
    blocked: null,
    tasks: { open: 3, shown: 1, today: 1 },
    ...overrides,
  };
}

function scheduledProject(overrides = {}) {
  return healthyProject({
    path: "sase_decks.md",
    stem: "sase_decks",
    state: "scheduled",
    criterion: "Ship the deck pipeline!",
    parent: "sase.md",
    children: [],
    prj: { line: 6, mark: " ", hidden: true, scheduled: "2026-12-08" },
    blocked: { kind: "scheduled", date: "2026-12-08" },
    tasks: { open: 1, shown: 0, today: 0 },
    ...overrides,
  });
}

function blockedProject(overrides = {}) {
  return healthyProject({
    path: "sase_post_blog.md",
    stem: "sase_post_blog",
    state: "blocked",
    criterion: "Plan features to launch after sase_blog post!",
    parent: "sase.md",
    children: [],
    prj: { line: 6, mark: "?", hidden: true, scheduled: null },
    blocked: { kind: "dependency", waits_on: ["sase_blog#^ship"] },
    tasks: { open: 2, shown: 0, today: null },
    ...overrides,
  });
}

function inheritedProject(overrides = {}) {
  return healthyProject({
    path: "sase_child.md",
    stem: "sase_child",
    state: "blocked",
    parent: "sase.md",
    children: [],
    prj: { line: 6, mark: "?", hidden: true, scheduled: null },
    blocked: { kind: "inherited" },
    tasks: { open: 1, shown: 0, today: 0 },
    ...overrides,
  });
}

function warningProject(overrides = {}) {
  return healthyProject({
    path: "sase_scratch.md",
    stem: "sase_scratch",
    state: "warning",
    criterion: "no valid `^prj` task",
    parent: "sase.md",
    children: [],
    prj: { line: null, mark: null, hidden: null, scheduled: null },
    blocked: null,
    tasks: { open: 0, shown: 0, today: 0 },
    ...overrides,
  });
}

function doneProject(overrides = {}) {
  return healthyProject({
    path: "sase_agent_history.md",
    stem: "sase_agent_history",
    status: "done",
    state: "done",
    criterion: "Migrate agent artifacts tab!",
    parent: "sase.md",
    children: [],
    closed_on: "2026-11-12",
    prj: { line: 6, mark: "x", hidden: false, scheduled: null },
    blocked: null,
    tasks: { open: 0, shown: 0, today: 0 },
    ...overrides,
  });
}

function canceledProject(overrides = {}) {
  return healthyProject({
    path: "sase_back_policy.md",
    stem: "sase_back_policy",
    status: "canceled",
    state: "canceled",
    criterion: "Develop architecture policy!",
    parent: "sase.md",
    children: [],
    closed_on: "2026-11-11",
    prj: { line: 6, mark: "-", hidden: false, scheduled: null },
    blocked: null,
    tasks: { open: 0, shown: 0, today: 0 },
    ...overrides,
  });
}

function listCatalog(overrides = {}) {
  return {
    host: "sase",
    path: "sase.md",
    kind: "project",
    state: "missing",
    rows: { open: 4, blocked: 2, warning: 1, closed: 2 },
    issues: [{
      code: "projects_catalog_stale",
      severity: "warning",
      line: null,
      message: "the generated projects catalog in sase.md is missing; run `bob projects sync`",
    }],
    ...overrides,
  };
}

function projectsListReport(overrides = {}) {
  return {
    schema_version: 1,
    ok: false,
    command: "list",
    today: "2026-11-13",
    projects: [
      healthyProject(),
      scheduledProject(),
      blockedProject(),
      inheritedProject(),
      warningProject(),
      doneProject(),
      canceledProject(),
    ],
    catalogs: [
      listCatalog(),
      {
        host: "dev",
        path: "dev.md",
        kind: "area",
        state: "damaged",
        rows: { open: 0, blocked: 0, warning: 0, closed: 0 },
        issues: [{
          code: "projects_catalog_damaged",
          severity: "error",
          line: 9,
          message: "the generated projects catalog in dev.md is damaged",
        }],
      },
    ],
    findings: [{
      host: "dev",
      path: "dev.md",
      code: "projects_catalog_damaged",
      severity: "error",
      line: 9,
      message: "the generated projects catalog in dev.md is damaged",
    }],
    counts: { projects: 7, catalogs: 2, errors: 1, warnings: 1 },
    ...overrides,
  };
}

function decodedList(overrides = {}) {
  return projectsDecodeListReport(JSON.stringify(projectsListReport(overrides)), "");
}

function syncCatalog(overrides = {}) {
  return {
    host: "sase",
    path: "sase.md",
    kind: "project",
    state: "current",
    open: 4,
    blocked: 2,
    warning: 1,
    closed: 2,
    issues: [],
    ...overrides,
  };
}

function syncReport(ok = true, overrides = {}) {
  return {
    schema_version: 1,
    ok,
    command: "sync",
    dry_run: false,
    changed: ok ? ["sase.md"] : [],
    changes: ok ? [{ path: "sase.md", action: "update" }] : [],
    events: ok ? [{ kind: "catalog_written", host: "sase", path: "sase.md" }] : [],
    catalogs: [syncCatalog()],
    findings: [],
    commit: ok ? { sha: "abc", subject: "bob projects sync" } : null,
    sync: ok ? { pre: "ok", post: "ok" } : null,
    warnings: [],
    ...overrides,
  };
}

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

function projectNote(frontmatter, body = "- [ ] #task #prj Ship it #hide ^prj\n") {
  const yaml = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}: [${value.join(", ")}]`;
    }
    return `${key}: ${value}`;
  }).join("\n");
  return `---\n${yaml}\n---\n\n# Note\n\n${body}`;
}

function makeProjectsPlugin(initial = []) {
  const app = makeFreshnessApp({ tasks: [] });
  const vaultEvents = eventSource();
  const metadataEvents = eventSource();
  const workspaceEvents = eventSource();
  const cache = new Map();
  const files = initial.map(({ path, frontmatter, text }) => {
    const file = { path, extension: "md" };
    cache.set(path, { frontmatter, text: text || projectNote(frontmatter || {}) });
    return file;
  });
  let ready = null;
  app.vault = {
    adapter: { basePath: "/fixture-vault" },
    getMarkdownFiles: () => files,
    on: vaultEvents.on.bind(vaultEvents),
    cachedRead: (file) => {
      const entry = cache.get(file && file.path);
      return Promise.resolve(entry && typeof entry.text === "string" ? entry.text : "");
    },
  };
  app.metadataCache = {
    on: metadataEvents.on.bind(metadataEvents),
    getFileCache: (file) => cache.get(file && file.path) || null,
  };
  app.workspace = {
    on: workspaceEvents.on.bind(workspaceEvents),
    onLayoutReady: (callback) => { ready = callback; },
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.projectsTimers = new FakeTimers();
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupProjectsData();
  return {
    plugin,
    app,
    cache,
    files,
    timers: plugin.projectsTimers,
    ready: () => ready && ready(),
    addFile: (path, frontmatter, text) => {
      const file = { path, extension: "md" };
      files.push(file);
      cache.set(path, { frontmatter, text: text || projectNote(frontmatter || {}) });
      return file;
    },
    metadataChanged: (file, payload) => {
      const next = typeof payload === "string"
        ? { ...(cache.get(file.path) || {}), text: payload }
        : { ...(cache.get(file.path) || {}), ...payload };
      cache.set(file.path, next);
      metadataEvents.emit("changed", file, payload);
    },
    vaultEvent: (name, file, oldPath) => vaultEvents.emit(name, file, oldPath),
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

test("projects list and sync use fixed JSON argv and the versioned report decoders", () => {
  assert.equal(PROJECTS_REPORT_SCHEMA_VERSION, 1);
  assert.deepEqual(projectsListArgs(), ["projects", "list", "-f", "json"]);
  assert.deepEqual(projectsSyncArgs(), ["projects", "sync", "-f", "json"]);
  assert.equal(PROJECTS_LIST_TIMEOUT_MS, 20000);
  assert.equal(PROJECTS_LIST_MAX_BUFFER, 32 * 1024 * 1024);
  assert.equal(PROJECTS_REVALIDATE_DEBOUNCE_MS, 300);
  assert.equal(PROJECTS_SYNC_DEBOUNCE_MS, 3000);

  const valid = decodedList();
  assert.equal(valid.ok, true);
  assert.equal(valid.report.ok, false, "a valid report with damage stays visible with ok:false");
  assert.equal(valid.report.command, "list");
  assert.equal(valid.report.today, "2026-11-13");
  assert.equal(valid.report.projectsByPath.get("sase.md").state, "open");
  assert.equal(valid.report.projectsByPath.get("sase.md").tasks.today, 1);
  assert.equal(valid.report.projectsByPath.get("sase_decks.md").blocked.kind, "scheduled");
  assert.equal(valid.report.projectsByPath.get("sase_post_blog.md").blocked.waits_on[0], "sase_blog#^ship");
  assert.equal(valid.report.projectsByPath.get("sase_child.md").blocked.kind, "inherited");
  assert.equal(valid.report.projectsByPath.get("sase_scratch.md").state, "warning");
  assert.equal(valid.report.projectsByPath.get("sase_scratch.md").prj.line, null);
  assert.equal(valid.report.projectsByPath.get("sase_agent_history.md").state, "done");
  assert.equal(valid.report.projectsByPath.get("sase_back_policy.md").state, "canceled");
  assert.equal(valid.report.catalogsByHostPath.get("sase.md").rows.open, 4);
  assert.equal(valid.report.catalogsByHostPath.get("dev.md").state, "damaged");
  assert.equal(valid.report.projectsByStem.get("sase").length, 1);

  assert.equal(projectsDecodeListReport("not JSON", "first stderr").code, "bad-json");
  assert.equal(projectsDecodeListReport("[]", "").code, "bad-shape");
  assert.equal(
    projectsDecodeListReport(JSON.stringify({ ...projectsListReport(), schema_version: 2 }), "").code,
    "schema-mismatch",
  );
  assert.equal(
    projectsDecodeListReport(JSON.stringify({ ...projectsListReport(), command: "sync" }), "").code,
    "bad-shape",
    "sync envelopes cannot be installed as list reports",
  );
  assert.equal(
    projectsDecodeListReport(JSON.stringify({
      ...projectsListReport(),
      projects: [{ ...healthyProject(), tasks: { open: 0, shown: 0 } }],
    }), "").code,
    "bad-shape",
    "missing nullable today is not coerced to zero",
  );
  assert.equal(
    projectsDecodeListReport(JSON.stringify({
      ...projectsListReport(),
      projects: [{ ...healthyProject(), state: "ready" }],
    }), "").code,
    "bad-shape",
    "unknown state is not coerced to ready",
  );
  assert.equal(
    projectsDecodeListReport(JSON.stringify({
      ...projectsListReport(),
      projects: [{ ...healthyProject(), blocked: { kind: "scheduled" } }],
    }), "").code,
    "bad-shape",
    "scheduled blocked.date cannot be omitted",
  );

  const sync = projectsDecodeSyncReport(JSON.stringify(syncReport()), "");
  assert.equal(sync.ok, true);
  assert.equal(sync.report.command, "sync");
  assert.equal(sync.report.catalogs[0].open, 4);
  assert.equal(sync.report.catalogs[0].rows, undefined);
  const refused = projectsDecodeSyncReport(JSON.stringify(syncReport(false, {
    error: { code: "damaged", message: "Repair the markers first." },
  })), "");
  assert.equal(refused.ok, true, "a structured refusal is a valid sync response");
  assert.equal(refused.report.ok, false);
  assert.equal(projectsDecodeSyncReport("unsupported command", "").code, "bad-json");
  assert.equal(
    projectsDecodeSyncReport(JSON.stringify({
      ...syncReport(),
      catalogs: [{ ...syncCatalog(), rows: { open: 1, blocked: 0, warning: 0, closed: 0 } }],
    }), "").ok,
    true,
    "extra list-shaped fields on a sync catalog are ignored",
  );
});

test("duplicate stems keep path identity; nullable fields stay null", () => {
  const decoded = decodedList({
    projects: [
      healthyProject({ path: "alpha/sase.md", stem: "sase" }),
      healthyProject({ path: "beta/sase.md", stem: "sase", parent: null, tasks: { open: null, shown: null, today: null } }),
    ],
  });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.projectsByPath.get("alpha/sase.md").parent, "dev.md");
  assert.equal(decoded.report.projectsByPath.get("beta/sase.md").parent, null);
  assert.equal(decoded.report.projectsByPath.get("beta/sase.md").tasks.open, null);
  assert.equal(decoded.report.projectsByStem.get("sase").length, 2);
});

test("type encodings, scalar parent, and lifecycle fingerprints stay structural", () => {
  assert.deepEqual(projectsTypeNames("[[project]]"), ["project"]);
  assert.deepEqual(projectsTypeNames(["[[project]]"]), ["project"]);
  assert.equal(projectsNormalizeParent("[[dev.md|Dev]]"), "dev");
  assert.equal(projectsNormalizeParent(["[[a]]", "[[b]]"]).startsWith("\u0001list:"), true);
  assert.equal(projectsNormalizeStatus("WIP"), "wip");
  assert.equal(projectsNormalizeStatus(0).startsWith("\u0001value:"), true);

  const openBody = projectNote({ type: "[[project]]", parent: "[[dev]]", status: "wip" });
  const open = projectsFingerprint({ type: "[[project]]", parent: "[[dev]]", status: "wip" }, openBody);
  assert.equal(open.isProject, true);
  assert.equal(open.isHost, true);
  assert.equal(open.parent, "dev");
  assert.equal(open.status, "wip");
  assert.equal(open.prjKind, "one");
  assert.equal(open.prjMark, " ");

  const same = projectsFingerprint({ type: "project", parent: "dev", status: "wip" }, openBody);
  assert.equal(projectsFingerprintNeedsSync(open, same), false);

  const blockedBody = projectNote(
    { type: "[[project]]", parent: "[[dev]]", status: "wip" },
    "- [?] #task #prj Wait #hide ^prj\n",
  );
  const blocked = projectsFingerprint({ type: "[[project]]", parent: "[[dev]]", status: "wip" }, blockedBody);
  assert.equal(blocked.prjMark, "?");
  assert.equal(projectsFingerprintNeedsSync(open, blocked), true, "lifecycle checkbox changes sync");

  const fenced = projectsLifecycleFingerprint([
    "---",
    "type: [[project]]",
    "---",
    "",
    "```md",
    "- [x] #task #prj Example ^prj",
    "```",
    "",
    "- [ ] #task #prj Real #hide ^prj",
  ].join("\n"));
  assert.equal(fenced.kind, "one");
  assert.equal(fenced.mark, " ");

  const yamlOnly = projectsLifecycleFingerprint([
    "---",
    "type: [[project]]",
    "example: '- [x] #task #prj Fake ^prj'",
    "---",
    "",
    "# Note",
  ].join("\n"));
  assert.equal(yamlOnly.kind, "missing");

  const missing = projectsLifecycleFingerprint("# No lifecycle\n- [ ] #task ordinary\n");
  assert.equal(missing.kind, "missing");
  const duplicate = projectsLifecycleFingerprint([
    "- [ ] #task #prj One ^prj",
    "- [x] #task #prj Two ^prj",
  ].join("\n"));
  assert.equal(duplicate.kind, "duplicate");
  assert.equal(duplicate.count, 2);
  assert.equal(duplicate.mark, null, "duplicate lifecycle is not derived into a state");

  const area = projectsFingerprint({ type: "[[area]]" }, "# Area\n");
  assert.equal(area.isArea, true);
  assert.equal(area.isProject, false);
  assert.equal(projectsRelevantPath("ideas.md"), true);
  assert.equal(projectsRelevantPath("done/old.md"), false);
  assert.equal(projectsRelevantPath("projects/done/live.md"), true);
  assert.equal(projectsRelevantPath(".obsidian/plugins/x.md"), false);
  assert.equal(projectsRelevantPath("attachment.pdf"), false);
  assert.equal(projectsReportPath(".\\sase\\one.md"), "sase/one.md");
  assert.match(projectsLocalDate(new Date(2026, 10, 13)), /^2026-11-13$/);
  assert.match(projectsErrorModel({
    code: "bob-not-found",
    message: "Spawning bob needs the desktop app.",
  }).hint, /desktop Obsidian/);
  assert.match(projectsErrorModel({ code: "bad-json" }).hint, /Update bob-cli/);
});

test("projects subprocess uses bobSpawnJson with vault, timeout, buffer, and nonzero JSON", async () => {
  const { plugin } = makeProjectsPlugin();
  try {
    const seen = {};
    const result = await plugin.projectsSpawnList({
      execFile: (command, args, options, callback) => {
        seen.command = command;
        seen.args = args;
        seen.options = options;
        callback(null, JSON.stringify(projectsListReport()), "");
      },
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
      vaultPath: "/fixture-vault",
    });
    assert.equal(result.ok, true);
    assert.equal(seen.command, "/fixture/bin/bob");
    assert.deepEqual(seen.args, projectsListArgs());
    assert.equal(seen.options.env.BOB_DIR, "/fixture-vault");
    assert.equal(seen.options.env.NO_COLOR, "1");
    assert.equal(seen.options.timeout, PROJECTS_LIST_TIMEOUT_MS);
    assert.equal(seen.options.maxBuffer, PROJECTS_LIST_MAX_BUFFER);

    const nonzero = await plugin.projectsSpawnList({
      execFile: (command, args, options, callback) => {
        const error = new Error("Command failed: bob projects list");
        error.code = 1;
        callback(error, JSON.stringify(projectsListReport()), "catalog damaged");
      },
      resolved: { path: "/fixture/bin/bob", source: "candidate" },
    });
    assert.equal(nonzero.ok, true, "nonzero exit with JSON still decodes");
    assert.equal(nonzero.report.ok, false);

    const missing = await plugin.projectsSpawnList({
      execFile: (command, args, options, callback) => {
        const error = new Error("spawn ENOENT");
        error.code = "ENOENT";
        callback(error, "", "");
      },
      resolved: { path: "bob", source: "path" },
    });
    assert.equal(missing.code, "bob-not-found");
  } finally {
    plugin.teardownProjectsData();
  }
});

test("one vault-scoped list flight serves simultaneous subscribers", async () => {
  const { plugin } = makeProjectsPlugin();
  const flight = deferred();
  let spawns = 0;
  plugin.projectsSpawnList = () => {
    spawns += 1;
    return flight.promise;
  };
  try {
    const first = plugin.apiProjectsReport({ wait: true });
    const second = plugin.apiProjectsReport({ wait: true });
    await flushMicrotasks();
    assert.equal(spawns, 1);
    flight.resolve(decodedList());
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.report.projectsByPath.get("sase.md").stem, "sase");
    assert.strictEqual(right.report, left.report);
    assert.equal(left.stale, false);
  } finally {
    plugin.teardownProjectsData();
  }
});

test("a change during list fetch coalesces into one later generation", async () => {
  const { plugin, timers } = makeProjectsPlugin();
  const firstFlight = deferred();
  let spawns = 0;
  plugin.projectsSubscribers.add(() => {});
  plugin.projectsSpawnList = () => {
    spawns += 1;
    if (spawns === 1) return firstFlight.promise;
    return Promise.resolve(decodedList());
  };
  try {
    const first = plugin.apiProjectsReport({ wait: true });
    await flushMicrotasks();
    plugin.apiProjectsInvalidate("note-change-one");
    plugin.apiProjectsInvalidate("note-change-two");
    assert.equal(plugin.projectsQueuedGeneration, 2);
    firstFlight.resolve(decodedList());
    const firstState = await first;
    assert.equal(firstState.reportGeneration, 0);
    assert.equal(firstState.stale, true, "the old response does not satisfy newer demand");
    assert.equal(spawns, 1, "debounce prevents a parallel or premature second request");
    timers.tick(PROJECTS_REVALIDATE_DEBOUNCE_MS);
    const latestPromise = plugin.apiProjectsReport({ wait: true });
    await flushMicrotasks();
    assert.equal(spawns, 2);
    const latest = await latestPromise;
    assert.equal(latest.reportGeneration, 2);
    assert.equal(latest.stale, false);
  } finally {
    plugin.teardownProjectsData();
  }
});

test("failed refresh keeps last good data stale and retries only on new demand", async () => {
  const { plugin } = makeProjectsPlugin();
  let spawns = 0;
  plugin.projectsSpawnList = async () => {
    spawns += 1;
    if (spawns === 1 || spawns === 3) return decodedList();
    return { ok: false, code: "timeout", message: "list timed out" };
  };
  try {
    const first = await plugin.apiProjectsReport({ wait: true });
    assert.equal(first.stale, false);
    const failed = await plugin.apiProjectsReport({ force: true, wait: true });
    assert.strictEqual(failed.report, first.report);
    assert.equal(failed.stale, true);
    assert.equal(failed.error.code, "timeout");
    assert.equal(failed.unavailable, false);
    const retried = await plugin.apiProjectsReport({ force: true, wait: true });
    assert.equal(retried.stale, false);
    assert.equal(retried.error, null);
    assert.equal(spawns, 3, "a failure does not create a retry loop");
  } finally {
    plugin.teardownProjectsData();
  }
});

test("unload clears subscriptions and prevents a late list result from repainting", async () => {
  const { plugin } = makeProjectsPlugin();
  const flight = deferred();
  let notifications = 0;
  plugin.projectsSpawnList = () => flight.promise;
  const unsubscribe = plugin.apiProjectsSubscribe(() => { notifications += 1; });
  await flushMicrotasks();
  const beforeUnload = notifications;
  unsubscribe();
  plugin.teardownProjectsData();
  flight.resolve(decodedList());
  await flushMicrotasks();
  assert.equal(notifications, beforeUnload);
  assert.equal(plugin.projectsReport, null);
  assert.equal(plugin.projectsSubscribers.size, 0);
  assert.equal(plugin.projectsRolloverTimer, null);
  const after = await plugin.apiProjectsSync({ automatic: true });
  assert.equal(after.error.code, "unloaded");
});

function seedProjectsVault() {
  const projectFrontmatter = { type: "[[project]]", parent: "[[dev]]", status: "wip" };
  const areaFrontmatter = { type: "[[area]]" };
  const otherFrontmatter = { type: "[[note]]" };
  const projectText = projectNote(projectFrontmatter);
  const areaText = projectNote(areaFrontmatter, "# Dev\n");
  const otherText = projectNote(otherFrontmatter, "# Scratch\n");
  const dailyText = "# 2026-11-13\n\n## Pomodoros\n";
  const harness = makeProjectsPlugin([
    { path: "sase.md", frontmatter: projectFrontmatter, text: projectText },
    { path: "dev.md", frontmatter: areaFrontmatter, text: areaText },
    { path: "scratch.md", frontmatter: otherFrontmatter, text: otherText },
    { path: "2026/20261113.md", frontmatter: {}, text: dailyText },
  ]);
  return {
    ...harness,
    projectFile: { path: "sase.md", extension: "md" },
    areaFile: { path: "dev.md", extension: "md" },
    otherFile: { path: "scratch.md", extension: "md" },
    dailyFile: { path: "2026/20261113.md", extension: "md" },
    projectFrontmatter,
    areaFrontmatter,
    otherFrontmatter,
    projectText,
    areaText,
    otherText,
  };
}

test("vault create replay before layout-ready does not read note bodies", async () => {
  const { plugin, ready, vaultEvent, projectFile, cache, projectText } = seedProjectsVault();
  let reads = 0;
  plugin.app.vault.cachedRead = (file) => {
    reads += 1;
    const entry = cache.get(file && file.path);
    return Promise.resolve(entry && typeof entry.body === "string" ? entry.body : projectText);
  };
  for (const [path, entry] of cache) {
    cache.set(path, { frontmatter: entry.frontmatter, body: entry.text });
  }
  try {
    vaultEvent("create", projectFile);
    vaultEvent("modify", projectFile);
    assert.equal(reads, 0, "Obsidian startup create replay must not read vault files");
    assert.equal(plugin.projectsFingerprintByPath.size, 0);
    ready();
    await flushMicrotasks();
    assert.ok(reads > 0, "layout-ready seed reads markdown bodies");
    assert.equal(plugin.projectsFingerprintByPath.get("sase.md").isProject, true);
  } finally {
    plugin.teardownProjectsData();
  }
});

test("startup seeds fingerprints silently; only structural project edits debounce sync", async () => {
  const { plugin, ready, timers, projectFile, projectFrontmatter, projectText, metadataChanged } = seedProjectsVault();
  try {
    ready();
    await flushMicrotasks();
    assert.equal(plugin.projectsMetadataReady, true);
    assert.equal(plugin.projectsSyncDebounceTimer, null, "startup baseline never starts a sync storm");
    const seeded = plugin.projectsFingerprintByPath.get("sase.md");
    assert.equal(seeded.isProject, true);
    assert.equal(seeded.prjMark, " ");
    metadataChanged(projectFile, { frontmatter: projectFrontmatter, text: projectText });
    assert.equal(plugin.projectsSyncDebounceTimer, null, "unchanged metadata does not sync");
    metadataChanged(projectFile, {
      frontmatter: { ...projectFrontmatter, parent: "[[body]]" },
      text: projectNote({ ...projectFrontmatter, parent: "[[body]]" }),
    });
    const timer = plugin.projectsSyncDebounceTimer;
    assert.notEqual(timer, null, "parent edits schedule sync");
    metadataChanged(projectFile, {
      frontmatter: { ...projectFrontmatter, parent: "[[body]]", status: "waiting" },
      text: projectNote({ ...projectFrontmatter, parent: "[[body]]", status: "waiting" }),
    });
    assert.notEqual(plugin.projectsSyncDebounceTimer, timer, "edits reset the trailing debounce");
    timers.tick(PROJECTS_SYNC_DEBOUNCE_MS - 1);
    assert.equal(plugin.projectsSyncFlight, null);
    assert.notEqual(plugin.projectsSyncDebounceTimer, null);
  } finally {
    plugin.teardownProjectsData();
  }
});

test("body, callout, and unrelated notes invalidate without syncing", async () => {
  const {
    plugin, ready, timers, projectFile, otherFile, dailyFile,
    projectFrontmatter, projectText, otherFrontmatter, metadataChanged, vaultEvent,
  } = seedProjectsVault();
  try {
    ready();
    await flushMicrotasks();
    plugin.projectsSpawnList = async () => decodedList();
    plugin.projectsSubscribers.add(() => {});
    const before = plugin.projectsVaultGeneration;
    const calloutText = `${projectText}\n\n## Projects\n\n> [!projects]\n> - **[[kid]]** — ship it\n`;
    metadataChanged(projectFile, { frontmatter: projectFrontmatter, text: calloutText });
    assert.ok(plugin.projectsVaultGeneration > before, "generated callout writes invalidate list data");
    assert.equal(plugin.projectsSyncDebounceTimer, null, "callout writes do not sync");

    vaultEvent("modify", projectFile);
    metadataChanged(projectFile, { frontmatter: projectFrontmatter, text: `${calloutText}\nprose\n` });
    assert.equal(plugin.projectsSyncDebounceTimer, null, "ordinary prose edits do not sync");
    assert.notEqual(plugin.projectsRevalidateTimer, null, "mounted data revalidates after a body edit");
    timers.tick(PROJECTS_REVALIDATE_DEBOUNCE_MS);
    plugin.projectsClearTimeout(plugin.projectsRevalidateTimer);
    plugin.projectsRevalidateTimer = null;
    await flushMicrotasks();

    metadataChanged(otherFile, { frontmatter: { ...otherFrontmatter, summary: "New." }, text: "# Scratch\n" });
    assert.equal(plugin.projectsSyncDebounceTimer, null, "unrelated notes do not sync");

    const dailyBefore = plugin.projectsVaultGeneration;
    vaultEvent("modify", dailyFile);
    assert.ok(plugin.projectsVaultGeneration > dailyBefore, "ledger edits invalidate live chips");
    assert.equal(plugin.projectsSyncDebounceTimer, null, "ledger edits do not sync catalogs");
  } finally {
    plugin.teardownProjectsData();
  }
});

test("promotion, status, type, checkbox, rename, and deletion are structural", async () => {
  const {
    plugin, ready, otherFile, projectFile, projectFrontmatter, projectText,
    otherFrontmatter, metadataChanged, vaultEvent, addFile, cache,
  } = seedProjectsVault();
  try {
    ready();
    await flushMicrotasks();

    metadataChanged(otherFile, {
      frontmatter: { type: "[[project]]", parent: "[[dev]]", status: "wip" },
      text: projectNote({ type: "[[project]]", parent: "[[dev]]", status: "wip" }),
    });
    assert.notEqual(plugin.projectsSyncDebounceTimer, null, "promoting a note to a project syncs");
    plugin.projectsClearTimeout(plugin.projectsSyncDebounceTimer);
    plugin.projectsSyncDebounceTimer = null;

    metadataChanged(projectFile, {
      frontmatter: { ...projectFrontmatter, status: "done" },
      text: projectNote({ ...projectFrontmatter, status: "done" }, "- [x] #task #prj Ship it ^prj\n"),
    });
    assert.notEqual(plugin.projectsSyncDebounceTimer, null, "status and checkbox changes sync");
    plugin.projectsClearTimeout(plugin.projectsSyncDebounceTimer);
    plugin.projectsSyncDebounceTimer = null;

    metadataChanged(projectFile, {
      frontmatter: { type: "[[area]]", parent: "[[dev]]" },
      text: projectNote({ type: "[[area]]", parent: "[[dev]]" }, "# Area now\n"),
    });
    assert.notEqual(plugin.projectsSyncDebounceTimer, null, "project-to-nonproject transitions sync");
    plugin.projectsClearTimeout(plugin.projectsSyncDebounceTimer);
    plugin.projectsSyncDebounceTimer = null;

    vaultEvent("delete", projectFile);
    assert.notEqual(plugin.projectsSyncDebounceTimer, null, "project deletes schedule sync");
    plugin.projectsClearTimeout(plugin.projectsSyncDebounceTimer);
    plugin.projectsSyncDebounceTimer = null;

    const moved = addFile("moved.md", projectFrontmatter, projectText);
    cache.set("sase/renamed.md", { frontmatter: projectFrontmatter, text: projectText });
    vaultEvent("rename", { path: "sase/renamed.md", extension: "md" }, moved.path);
    assert.notEqual(plugin.projectsSyncDebounceTimer, null, "renames keep old identity and sync");
    void otherFrontmatter;
  } finally {
    plugin.teardownProjectsData();
  }
});

test("a late cached read cannot undo a newer fingerprint", async () => {
  const { plugin, ready, projectFile, projectFrontmatter, cache } = seedProjectsVault();
  const firstRead = deferred();
  const secondRead = deferred();
  let reads = 0;
  plugin.app.vault.cachedRead = () => {
    reads += 1;
    return reads === 1 ? firstRead.promise : secondRead.promise;
  };
  try {
    ready();
    await flushMicrotasks();
    plugin.projectsMetadataReady = true;
    cache.set(projectFile.path, { frontmatter: projectFrontmatter });
    plugin.projectsHandleVaultEvent("modify", projectFile);
    cache.set(projectFile.path, { frontmatter: projectFrontmatter });
    plugin.projectsHandleVaultEvent("modify", projectFile);
    firstRead.resolve(projectNote(projectFrontmatter, "- [?] #task #prj Wait ^prj\n"));
    await flushMicrotasks();
    assert.notEqual(plugin.projectsFingerprintByPath.get("sase.md").prjMark, "?", "stale read is ignored");
    secondRead.resolve(projectNote(projectFrontmatter, "- [x] #task #prj Done ^prj\n"));
    await flushMicrotasks();
    assert.equal(plugin.projectsFingerprintByPath.get("sase.md").prjMark, "x");
  } finally {
    plugin.teardownProjectsData();
  }
});

test("generated catalog writes during sync do not restart a loop", async () => {
  const { plugin, ready, projectFile, projectFrontmatter, projectText, metadataChanged } = seedProjectsVault();
  const syncFlight = deferred();
  let syncCalls = 0;
  let listCalls = 0;
  plugin.projectsSpawnSync = () => {
    syncCalls += 1;
    return syncFlight.promise;
  };
  plugin.projectsSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  try {
    ready();
    await flushMicrotasks();
    const manual = plugin.apiProjectsSync();
    await flushMicrotasks();
    assert.equal(plugin.projectsSyncBusy, true);
    metadataChanged(projectFile, { frontmatter: projectFrontmatter, text: `${projectText}\n> [!projects]\n` });
    assert.equal(plugin.projectsSyncDebounceTimer, null, "self-write events do not restart a sync loop");
    assert.equal(plugin.projectsSyncTrailing, false);
    syncFlight.resolve({ ok: true, report: syncReport() });
    const result = await manual;
    assert.equal(result.ok, true);
    assert.equal(syncCalls, 1);
    assert.equal(listCalls, 1, "the catalog report refreshes after sync");
    assert.equal(plugin.projectsSyncBusy, false);
  } finally {
    plugin.teardownProjectsData();
  }
});

test("a real fingerprint change during sync coalesces one trailing sync", async () => {
  const { plugin, ready, timers, projectFile, projectFrontmatter, metadataChanged } = seedProjectsVault();
  const syncFlight = deferred();
  let syncCalls = 0;
  let listCalls = 0;
  plugin.projectsSpawnSync = () => {
    syncCalls += 1;
    if (syncCalls === 1) return syncFlight.promise;
    return Promise.resolve({ ok: true, report: syncReport() });
  };
  plugin.projectsSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  try {
    ready();
    await flushMicrotasks();
    const manual = plugin.apiProjectsSync();
    await flushMicrotasks();
    metadataChanged(projectFile, {
      frontmatter: { ...projectFrontmatter, parent: "[[body]]" },
      text: projectNote({ ...projectFrontmatter, parent: "[[body]]" }),
    });
    assert.equal(plugin.projectsSyncTrailing, true, "the change is remembered, not discarded");
    assert.equal(plugin.projectsSyncDebounceTimer, null, "no second flight starts mid-sync");
    syncFlight.resolve({ ok: true, report: syncReport() });
    await manual;
    await flushMicrotasks();
    assert.equal(syncCalls, 1);
    assert.notEqual(plugin.projectsSyncDebounceTimer, null, "a trailing sync is scheduled after the flight");
    timers.tick(PROJECTS_SYNC_DEBOUNCE_MS);
    await flushMicrotasks();
    await plugin.projectsSyncFlight;
    assert.equal(syncCalls, 2, "exactly one trailing sync runs");
    assert.equal(listCalls, 2, "the trailing sync revalidates the report");
  } finally {
    plugin.teardownProjectsData();
  }
});

test("partial sync failure keeps its report and still revalidates the list", async () => {
  const { plugin, ready } = seedProjectsVault();
  let listCalls = 0;
  plugin.projectsSpawnSync = async () => ({
    ok: true,
    report: syncReport(false, { error: { code: "damaged", message: "Catalog markers are damaged." } }),
  });
  plugin.projectsSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  try {
    ready();
    await flushMicrotasks();
    const manual = plugin.apiProjectsSync();
    const automatic = plugin.apiProjectsSync({ automatic: true });
    assert.strictEqual(manual, automatic);
    const result = await manual;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "damaged");
    assert.equal(listCalls, 1, "a partial sync failure still revalidates list data");
    assert.equal(result.refreshed.report.projectsByPath.get("sase.md").stem, "sase");
    assert.equal(plugin.projectsSyncError.code, "damaged");
    assert.equal(plugin.projectsSyncBusy, false);
    assert.equal(plugin.projectsSyncDebounceTimer, null, "a refusal does not tight-loop");
  } finally {
    plugin.teardownProjectsData();
  }
});

test("sync waits out a pre-write list and then fetches a post-sync report", async () => {
  const { plugin } = makeProjectsPlugin();
  const beforeWrite = deferred();
  let listCalls = 0;
  plugin.projectsSpawnList = () => {
    listCalls += 1;
    if (listCalls === 1) {
      return beforeWrite.promise;
    }
    return Promise.resolve(decodedList({
      catalogs: [listCatalog({ state: "current", issues: [] })],
    }));
  };
  plugin.projectsSpawnSync = async () => ({ ok: true, report: syncReport() });
  try {
    const preWrite = plugin.apiProjectsReport({ wait: true });
    await flushMicrotasks();
    assert.equal(listCalls, 1);
    const sync = plugin.apiProjectsSync();
    await flushMicrotasks();
    assert.equal(plugin.projectsSyncBusy, false, "the sync process can settle while its report refresh waits");
    beforeWrite.resolve(decodedList({
      catalogs: [listCatalog({ state: "stale" })],
    }));
    await preWrite;
    await flushMicrotasks();
    assert.equal(listCalls, 2, "the pre-write list does not satisfy post-sync revalidation");
    const result = await sync;
    assert.equal(result.ok, true);
    assert.equal(result.refreshed.report.catalogsByHostPath.get("sase.md").state, "current");
  } finally {
    plugin.teardownProjectsData();
  }
});

test("a view-show demand refreshes the shared report and day rollover invalidates", async () => {
  const { plugin, timers, workspaceEvent } = makeProjectsPlugin();
  let listCalls = 0;
  plugin.projectsSpawnList = async () => {
    listCalls += 1;
    return decodedList();
  };
  const unsubscribe = plugin.apiProjectsSubscribe(() => {});
  try {
    await flushMicrotasks();
    assert.equal(listCalls, 1);
    workspaceEvent("file-open");
    timers.tick(PROJECTS_REVALIDATE_DEBOUNCE_MS);
    await flushMicrotasks();
    assert.equal(listCalls, 2);
    const before = plugin.projectsVaultGeneration;
    const nextDay = new Date(2027, 0, 2);
    assert.notEqual(projectsLocalDate(nextDay), plugin.projectsLocalDay);
    assert.equal(plugin.projectsRefreshRollover(nextDay), true);
    assert.ok(plugin.projectsVaultGeneration > before, "day rollover invalidates today chips");
  } finally {
    unsubscribe();
    plugin.teardownProjectsData();
  }
});

test("headless setup does not keep the process alive with a browser rollover timer", () => {
  const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
  plugin.setupProjectsData();
  try {
    assert.equal(plugin.projectsRolloverTimer, null);
  } finally {
    plugin.teardownProjectsData();
  }
});
