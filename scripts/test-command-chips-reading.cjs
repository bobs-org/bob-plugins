// Reading-view command chips: the one Markdown post-processor turns `run:`
// spans into real buttons in Reading view, embeds, hover previews, and
// Tasks/Dataview output, and decides each chip's source note apart from its
// payload. A scriptable fake Command Mode, vault, and clock drive every case;
// nothing spawns.
//
// The DOM shapes below mirror what Obsidian 1.15.1 rendered on athena for
// Tasks 8.6.0 and Dataview 0.5.68 in an isolated scratch vault (bob-chips
// 0.9.0 working tree, 2026-11-20):
// - Ordinary sections are post-processed detached (no parent) and carry
//   section info; embeds and hover previews render their own note.
// - Tasks renders each row's description with the task's own path inside
//   `li.plugin-tasks-list-item > span.tasks-list-text > span.task-description`,
//   but `h4.tasks-group-heading` with the query note's path.
// - Dataview renders TASK/list items with `item.path` inside
//   `li.dataview.task-list-item` / `li.dataview.task-list-basic-item`;
//   TABLE cells, LIST items, group headers, and dataviewjs output render
//   with the query note's path.
// - Neither query plugin gives section info; both rows may be detached
//   when post-processed, with the row `li` already an ancestor.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  helpers,
  FakeDocument,
  FakeNotice,
  installClipboardStub,
} = require("./copy-chips-test-helpers.cjs");

const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await tick();
};

// Manual animation frames: detached buttons retry on frames.
const frames = [];
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
function runFrames() {
  for (const callback of frames.splice(0)) callback();
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    timers: {
      set(fn, ms) {
        const id = nextId++;
        timers.set(id, { fn, at: now + Number(ms || 0) });
        return id;
      },
      clear(id) {
        timers.delete(id);
      },
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let dueId = null;
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (!due || timer.at < due.at)) {
            dueId = id;
            due = timer;
          }
        }
        if (!due) break;
        timers.delete(dueId);
        now = due.at;
        due.fn();
      }
      now = target;
    },
  };
}

function step(index, text, extra = {}) {
  return Object.freeze({
    index, text, argv: Object.freeze(text.split(/\s+/).slice(1)), entryId: "e" + index, title: text,
    effect: "writes", policy: "run", presentation: "action", hasPreview: false, confirm: null, ...extra,
  });
}

function ready(signature, steps) {
  return Object.freeze({ ok: true, state: "ready", signature, steps: Object.freeze(steps), reason: null, step: null });
}

function refused(state, reason, stepNo) {
  return Object.freeze({ ok: false, state, signature: null, steps: Object.freeze([]), reason, step: stepNo || null });
}

const VERDICTS = {
  "bob task reconcile": ready("reconcile", [step(1, "bob task reconcile")]),
  "bob plan": ready("plan", [step(1, "bob plan", { presentation: "report", effect: "reads" })]),
  "bob nope": refused("invalid", "bob has no command `nope`", 1),
};

function fakeEngine() {
  const engine = {
    version: 1,
    loading: false,
    token: "1:fp",
    resolveCalls: 0,
    runs: [],
    opens: [],
    outputs: [],
    resolve(text) {
      engine.resolveCalls += 1;
      if (engine.loading) return refused("loading", "Command Mode is still loading bob's catalog");
      return VERDICTS[text] || refused("invalid", "command chips run only bob", 1);
    },
    runText(text, opts) {
      const call = { text, opts, ...deferred() };
      engine.runs.push(call);
      return call.promise;
    },
    openText(text, opts) {
      const call = { text, opts, ...deferred() };
      engine.opens.push(call);
      return call.promise;
    },
    openOutput(runId) {
      engine.outputs.push(runId);
      return Promise.resolve({ ok: true });
    },
    catalogInfo() {
      return Object.freeze({ token: engine.token });
    },
  };
  return engine;
}

function makeWorkspace() {
  const handlers = new Map();
  return {
    leaves: [],
    on(name, callback) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(callback);
      return { name, callback };
    },
    offref() {},
    trigger(name, payload) {
      for (const callback of [...(handlers.get(name) || [])]) callback(payload);
    },
    getLeavesOfType() {
      return this.leaves;
    },
  };
}

// A vault whose files follow renames like TFile objects do.
function makeVault(seed) {
  const files = new Map();
  const vault = {
    reads: 0,
    add(path, text) {
      const file = { path, text, basename: path.replace(/^.*\//, "").replace(/\.md$/, "") };
      files.set(path, file);
      return file;
    },
    rename(from, to) {
      const file = files.get(from);
      files.delete(from);
      file.path = to;
      files.set(to, file);
    },
    remove(path) {
      files.delete(path);
    },
    write(path, text) {
      files.get(path).text = text;
    },
    getAbstractFileByPath(path) {
      return files.get(path) || null;
    },
    cachedRead(file) {
      vault.reads += 1;
      return Promise.resolve(file.text);
    },
  };
  for (const [path, text] of Object.entries(seed)) vault.add(path, text);
  return vault;
}

const DASH = "dash.md";
const WALK = "notes/walk.md";
const SEED = {
  [DASH]: "# Dash\n\nOwn `run: bob task reconcile`.\n",
  [WALK]: "# Walk\n\n- [ ] Reconcile `run: bob task reconcile` then `copy: ssh apollo`\n",
};
for (const root of ["mail", "ref", "ref_history", ".bob", "_conflicts", "REF"]) {
  SEED[root + "/n.md"] = "# N\n\n- [ ] Reconcile `run: bob task reconcile` then `copy: ssh apollo`\n";
}

function harness(options = {}) {
  FakeNotice.messages.length = 0;
  const clock = fakeClock();
  const engine = fakeEngine();
  const vault = makeVault(SEED);
  const app = {
    isMobile: Boolean(options.mobile),
    workspace: makeWorkspace(),
    vault,
    metadataCache: {
      getFirstLinkpathDest(linkpath) {
        const direct = vault.getAbstractFileByPath(linkpath) || vault.getAbstractFileByPath(linkpath + ".md");
        return direct || null;
      },
    },
    plugins: {
      plugins: options.noEngine ? {} : { "bob-command-mode": { api: { commandMode: engine } } },
      enabledPlugins: new Set(options.disabled ? ["bob-chips"] : ["bob-command-mode", "bob-chips"]),
    },
  };
  const registered = [];
  const plugin = { app, registerEvent() {}, register: (fn) => registered.push(fn) };
  helpers.commandChipRuntimeSetup(plugin, { store: { timers: clock.timers, now: clock.now } });
  return { plugin, app, engine, clock, vault, store: plugin.commandChipRuntime.store, registered };
}

// `chain` is outermost-first `[tag, className, attrs?]`; the last entry is
// the post-processor's `el`, which holds the code elements.
function buildChain(doc, chain) {
  let parent = null;
  let top = null;
  for (const [tag, className, attrs] of chain) {
    const el = doc.createElement(tag);
    if (className) el.setAttribute("class", className);
    for (const [name, value] of Object.entries(attrs || {})) el.setAttribute(name, value);
    if (parent) parent.appendChild(el);
    else top = el;
    parent = el;
  }
  return { top, el: parent };
}

function addCode(doc, parent, text) {
  const code = doc.createElement("code");
  code.textContent = text;
  parent.appendChild(code);
  return code;
}

function sectionOf(path, vault, lineStart, lineEnd) {
  return { text: vault.getAbstractFileByPath(path).text, lineStart, lineEnd };
}

function render(h, el, sourcePath, section) {
  const children = [];
  const ctx = {
    sourcePath,
    getSectionInfo: () => section || null,
    addChild: (child) => children.push(child),
  };
  helpers.copyChipReadingRender(h.plugin, el, ctx);
  return { ctx, children };
}

function runButtons(root) {
  return root.querySelectorAll(".bob-run-chip");
}

function stateLine(host) {
  const row = host.querySelector(".bob-run-chip-tip").children[0];
  return row && (row.getAttribute("class") || "").includes("is-state") ? row.textContent : null;
}

function face(host) {
  return (host.getAttribute("class") || "").split(/\s+/).find((name) => /^is-(ready|armed|loading|queued|running|completed|attention|failed|unavailable|copy)$/.test(name)) || null;
}

function pointer(type, extra = {}) {
  const event = { type, button: 0, clientX: 10, clientY: 10, detail: 1, prevented: false, ...extra };
  event.preventDefault = () => { event.prevented = true; };
  return event;
}

function click(host, extra = {}) {
  host.dispatch("mousedown", pointer("mousedown", extra));
  host.dispatch("mouseup", pointer("mouseup", extra));
  host.dispatch("click", pointer("click", extra));
}

function key(host, keyName, extra = {}) {
  const event = { key: keyName, prevented: false, ...extra };
  event.preventDefault = () => { event.prevented = true; };
  host.dispatch("keydown", event);
  return event;
}

// One surface per entry: the render chain for a chip whose note is `path`.
// Ordinary/embed/hover renders carry section info; query rows do not.
const SURFACES = {
  reading: (path) => ({
    chain: [["div", "markdown-reading-view"], ["div", "markdown-preview-view markdown-rendered"], ["div", "el-ul"]],
    sourcePath: path,
    line: 2,
  }),
  embed: (path) => ({
    chain: [
      ["div", "markdown-preview-view markdown-rendered"], ["div", "el-p"],
      ["span", "internal-embed markdown-embed inline-embed is-loaded", { src: path.replace(/\.md$/, "") }],
      ["div", "markdown-embed-content"], ["div", "markdown-preview-view markdown-rendered"], ["div", "el-ul"],
    ],
    sourcePath: path,
    line: 2,
  }),
  hover: (path) => ({
    chain: [
      ["div", "hover-popover popover"], ["div", "markdown-embed"], ["div", "markdown-embed-content"],
      ["div", "markdown-preview-view markdown-rendered"], ["div", "el-ul"],
    ],
    sourcePath: path,
    line: 2,
  }),
  tasks: (path) => ({
    chain: [
      ["div", "markdown-preview-view markdown-rendered"], ["div", "el-pre"], ["div", "block-language-tasks"], ["div", ""],
      ["ul", "contains-task-list plugin-tasks-query-result"], ["li", "task-list-item plugin-tasks-list-item", { "data-line": "0" }],
      ["span", "tasks-list-text"], ["span", "task-description"], ["span", ""], ["span", ""],
    ],
    sourcePath: path,
    line: null,
  }),
  dataview: (path) => ({
    chain: [
      ["div", "markdown-preview-view markdown-rendered"], ["div", "el-pre"], ["div", "block-language-dataview"],
      ["div", "dataview dataview-container"], ["ul", "contains-task-list"], ["li", "dataview task-list-item", { "data-task": " " }],
      ["span", ""],
    ],
    sourcePath: path,
    line: null,
  }),
};

// Render the walk line's chips on `surface` for the note at `path`.
function mountOn(h, surfaceName, path, options = {}) {
  const doc = options.document || new FakeDocument();
  const surface = SURFACES[surfaceName](path);
  const { top, el } = buildChain(doc, surface.chain);
  addCode(doc, el, "run: bob task reconcile");
  addCode(doc, el, "copy: ssh apollo");
  const section = surface.line === null || !h.vault.getAbstractFileByPath(path) ? null : sectionOf(path, h.vault, 2, 2);
  const rendered = render(h, el, surface.sourcePath, section);
  return { top, el, host: runButtons(top)[0], ...rendered };
}

test("run spans become real buttons beside copy chips; plain code stays inert", () => {
  const h = harness();
  const doc = new FakeDocument();
  const { el } = buildChain(doc, [["div", "markdown-preview-view"], ["div", "el-p"]]);
  addCode(doc, el, "run: bob task reconcile");
  addCode(doc, el, "bob plan");
  addCode(doc, el, "copy: ssh apollo");
  const stale = addCode(doc, el, "run[Plan]: bob plan");
  stale.setAttribute("data-bob-copy-processed", "1");
  render(h, el, DASH, sectionOf(DASH, h.vault, 2, 2));
  const kinds = el.children.map((child) => [child.tagName, (child.getAttribute("class") || "").split(" ")[0]]);
  assert.deepEqual(kinds, [["BUTTON", "bob-run-chip"], ["CODE", ""], ["BUTTON", "bob-copy-chip"], ["BUTTON", "bob-run-chip"]]);
  assert.equal(el.children[1].textContent, "bob plan");
  const [run, , , labeled] = el.children;
  assert.equal(run.getAttribute("type"), "button");
  assert.equal(face(run), "is-ready");
  assert.equal(helpers.commandChipPayloadOf(run), "bob task reconcile");
  assert.equal(labeled.querySelector(".bob-run-chip-face").textContent, "Plan", "the copy-only marker of older builds never consumes a run span");
  assert.equal(run.getAttribute("aria-labelledby").split(" ").length, 2);
  render(h, el, DASH, sectionOf(DASH, h.vault, 2, 2));
  assert.equal(runButtons(el).length, 2, "repeat processing is idempotent");
  assert.deepEqual([h.engine.runs.length, h.engine.opens.length], [0, 0]);
});

test("rendering, hovering, and focusing never run or copy on any surface", async (t) => {
  const clip = installClipboardStub();
  t.after(() => clip.restore());
  const h = harness();
  const hosts = [];
  for (const surface of Object.keys(SURFACES)) {
    for (const path of [WALK, "ref/n.md", DASH]) hosts.push(mountOn(h, surface, path).host);
  }
  for (const host of hosts) {
    host.dispatch("mouseenter", {});
    host.dispatch("focusin", {});
  }
  runFrames();
  h.app.workspace.trigger(helpers.COMMAND_CHIP_CATALOG_EVENT, { token: "2:fp" });
  await settle();
  assert.deepEqual([h.engine.runs.length, h.engine.opens.length, h.engine.outputs.length, clip.writes.length], [0, 0, 0, 0]);
  assert.equal(FakeNotice.messages.length, 0);
});

// The source matrix: every surface, an allowed note, every protected root.
for (const surface of Object.keys(SURFACES)) {
  test("source matrix on " + surface + ": allowed notes run, protected roots copy byte-exact", async (t) => {
    const clip = installClipboardStub();
    t.after(() => clip.restore());
    const h = harness();
    const allowed = mountOn(h, surface, WALK);
    assert.equal(face(allowed.host), "is-ready");
    click(allowed.host);
    await settle();
    assert.equal(h.engine.runs.length, 1);
    assert.deepEqual(h.engine.runs[0].opts.source, surface === "tasks" || surface === "dataview" ? { path: WALK } : { path: WALK, line: 2 });
    h.engine.runs[0].resolve({ ok: true, stage: "run", outcome: "completed" });
    await settle();
    h.clock.advance(2000);

    for (const root of ["mail", "ref", "ref_history", ".bob", "_conflicts", "REF"]) {
      const path = root + "/n.md";
      const { host } = mountOn(h, surface, path);
      assert.equal(face(host), "is-copy", path);
      assert.match(stateLine(host), /^Copy only: notes under (mail|ref|ref_history|\.bob|_conflicts)\/ never run commands$/);
      click(host);
      key(host, "Enter", { shiftKey: true });
      await settle();
    }
    assert.equal(h.engine.runs.length, 1, "protected roots never run");
    assert.equal(h.engine.opens.length, 0, "Shift never opens a protected chip");
    assert.equal(clip.writes.length, 12);
    assert.ok(clip.writes.every((text) => text === "bob task reconcile"), "copies are byte-exact");
    assert.equal(FakeNotice.messages.length, 0);
  });
}

test("query output rendered with the dashboard's path never runs", async (t) => {
  const clip = installClipboardStub();
  t.after(() => clip.restore());
  const h = harness();
  const doc = new FakeDocument();
  const unknown = [
    // Tasks 8.6 group headings render with the query note's path.
    [["div", "block-language-tasks"], ["div", ""], ["h4", "tasks-group-heading"], ["p", ""]],
    // A Tasks row outside its description component.
    [["div", "block-language-tasks"], ["ul", "plugin-tasks-query-result"], ["li", "task-list-item plugin-tasks-list-item"], ["span", "tasks-list-text"], ["span", ""]],
    // Dataview TABLE cells, LIST items, group headers, and dataviewjs output.
    [["div", "block-language-dataview"], ["table", "dataview table-view-table"], ["tbody", "table-view-tbody"], ["tr", ""], ["td", ""], ["span", ""]],
    [["div", "block-language-dataview"], ["ul", "dataview list-view-ul"], ["li", ""], ["span", ""]],
    [["div", "block-language-dataview"], ["div", "dataview dataview-container"], ["h4", ""], ["span", ""]],
    [["div", "block-language-dataviewjs"], ["p", ""], ["span", ""]],
    // Dataview inline fields and inline queries, and any other plugin block.
    [["div", "el-p"], ["span", "dataview inline-field"], ["span", "dataview inline-field-value"], ["span", ""]],
    [["div", "el-p"], ["span", "dataview dataview-inline-query"], ["span", ""]],
    [["div", "block-language-bob-stats"], ["div", ""], ["span", ""]],
  ];
  for (const chain of unknown) {
    const { top, el } = buildChain(doc, [["div", "markdown-preview-view"], ...chain]);
    addCode(doc, el, "run: bob task reconcile");
    render(h, el, DASH, null);
    const host = runButtons(top)[0];
    assert.equal(stateLine(host), "Copy only: source note unknown", JSON.stringify(chain));
    click(host);
    await settle();
  }
  assert.equal(h.engine.runs.length + h.engine.opens.length, 0);
  assert.equal(clip.writes.length, unknown.length);
});

test("an embed whose src names another note than its render never runs", async (t) => {
  const clip = installClipboardStub();
  t.after(() => clip.restore());
  const h = harness();
  const doc = new FakeDocument();
  const { top, el } = buildChain(doc, [
    ["div", "markdown-preview-view"], ["span", "internal-embed markdown-embed", { src: "ref/n" }], ["div", "markdown-embed-content"], ["div", "el-ul"],
  ]);
  addCode(doc, el, "run: bob task reconcile");
  render(h, el, WALK, sectionOf(WALK, h.vault, 2, 2));
  const host = runButtons(top)[0];
  assert.equal(stateLine(host), "Copy only: source note unknown");
  click(host);
  await settle();
  assert.deepEqual([h.engine.runs.length, clip.writes.length], [0, 1]);
});

test("a note renamed into a protected folder copies without a re-render", async (t) => {
  const clip = installClipboardStub();
  t.after(() => clip.restore());
  for (const surface of ["reading", "tasks", "dataview"]) {
    const h = harness();
    const { host } = mountOn(h, surface, WALK);
    assert.equal(face(host), "is-ready");
    h.vault.rename(WALK, "ref/walk.md");
    click(host);
    await settle();
    assert.equal(h.engine.runs.length, 0, surface);
    assert.equal(face(host), "is-copy", surface + " repaints after the gesture");
    assert.equal(stateLine(host), "Copy only: notes under ref/ never run commands");
  }
  assert.deepEqual(clip.writes, ["bob task reconcile", "bob task reconcile", "bob task reconcile"]);
});

test("stale and disappeared content refreshes and never runs", async (t) => {
  const clip = installClipboardStub();
  t.after(() => clip.restore());
  const h = harness();
  const rerenders = [];
  // Exact evidence: the line changed under a Reading button.
  const reading = mountOn(h, "reading", WALK);
  h.app.workspace.leaves = [{ view: {
    containerEl: reading.top,
    getMode: () => "preview",
    previewMode: { rerender: (full) => rerenders.push(full) },
  } }];
  h.vault.write(WALK, "# Walk\n\n- [ ] Reconcile `run: bob task reconcile --x` then `copy: ssh apollo`\n");
  click(reading.host);
  await settle();
  assert.equal(h.engine.runs.length, 0);
  assert.deepEqual(rerenders, [true], "the Reading view is asked to re-render");
  // A query row has no line: the chip must still be somewhere in its note.
  h.clock.advance(1000);
  const row = mountOn(h, "tasks", "notes/walk.md");
  h.vault.write(WALK, "# Walk\n\n- [x] Reconciled by hand\n");
  click(row.host);
  await settle();
  assert.equal(h.engine.runs.length, 0);
  // A deleted note is unknown, so it only copies.
  h.clock.advance(1000);
  h.vault.write(WALK, SEED[WALK]);
  const gone = mountOn(h, "dataview", WALK);
  h.vault.remove(WALK);
  click(gone.host);
  await settle();
  assert.deepEqual([h.engine.runs.length, h.engine.opens.length], [0, 0]);
  assert.deepEqual(clip.writes, ["bob task reconcile"]);
  assert.equal(FakeNotice.messages.length, 0);
});

test("equal spans map to their own source occurrence; ambiguity falls back to presence", async () => {
  const h = harness();
  h.vault.add("notes/two.md", "a\n`run: bob task reconcile` and `run: bob task reconcile`\nb");
  const doc = new FakeDocument();
  const { el } = buildChain(doc, [["div", "markdown-preview-view"], ["div", "el-p"]]);
  addCode(doc, el, "run: bob task reconcile");
  addCode(doc, el, "run: bob task reconcile");
  render(h, el, "notes/two.md", sectionOf("notes/two.md", h.vault, 1, 1));
  const [first, second] = runButtons(el);
  assert.deepEqual([helpers.commandChipMountOf(first).chip.from, helpers.commandChipMountOf(second).chip.from], [0, 30]);
  h.vault.write("notes/two.md", "a\n`run: bob task reconcile` and `run: bob task reconcile!`\nb");
  click(second);
  await settle();
  assert.equal(h.engine.runs.length, 0, "the edited occurrence is stale, though equal text remains on its line");
  h.clock.advance(1000);
  click(first);
  await settle();
  assert.equal(h.engine.runs.length, 1, "the untouched occurrence still runs");
  assert.deepEqual(h.engine.runs[0].opts.source, { path: "notes/two.md", line: 1 });

  // Three source spans but two rendered: no exact evidence, presence only.
  const render2 = helpers.commandChipReadingRenderState(h.plugin, el, {
    sourcePath: "notes/two.md",
    getSectionInfo: () => ({ text: "`run: bob plan` `run: bob plan` `run: bob plan`", lineStart: 0, lineEnd: 0 }),
  });
  const parsed = { kind: "run", label: null, text: "bob plan", table: false };
  render2.counts.set("\u0001\u0000bob plan", 2);
  assert.equal(helpers.commandChipReadingSnapshotFor(render2, parsed), null);
});

test("mobile, absent, disabled, and unavailable Command Mode copy or refuse once", async (t) => {
  const clip = installClipboardStub();
  t.after(() => clip.restore());
  const cases = [
    [{ mobile: true }, "Copy only: commands run only on desktop"],
    [{ noEngine: true }, "Copy only: Command Mode is not enabled"],
    [{ disabled: true }, "Copy only: Command Mode is not enabled"],
  ];
  for (const [options, line] of cases) {
    for (const surface of Object.keys(SURFACES)) {
      const h = harness(options);
      const { host } = mountOn(h, surface, WALK);
      assert.equal(stateLine(host), line, surface);
      click(host);
      await settle();
      assert.equal(h.engine.runs.length + h.engine.opens.length, 0);
    }
  }
  assert.equal(clip.writes.length, cases.length * Object.keys(SURFACES).length);

  const h = harness();
  const doc = new FakeDocument();
  const { el } = buildChain(doc, [["div", "markdown-preview-view"], ["div", "el-p"]]);
  addCode(doc, el, "run: bob nope");
  h.vault.add("notes/bad.md", "`run: bob nope`");
  render(h, el, "notes/bad.md", sectionOf("notes/bad.md", h.vault, 0, 0));
  const bad = runButtons(el)[0];
  assert.equal(face(bad), "is-unavailable");
  click(bad);
  await settle();
  assert.deepEqual(FakeNotice.messages, ["Can't run: bob has no command `nope`"]);
  assert.equal(h.engine.runs.length + h.engine.opens.length, 0);
  assert.equal(clip.writes.length, cases.length * Object.keys(SURFACES).length, "a refusal never copies");
});

test("a loading catalog paints Loading and hands the click to Command Mode's bounded wait", async () => {
  const h = harness();
  h.engine.loading = true;
  h.engine.token = "loading";
  const { host } = mountOn(h, "dataview", WALK);
  assert.equal(face(host), "is-loading");
  assert.equal(h.engine.runs.length, 0);
  click(host);
  await settle();
  assert.equal(h.engine.runs.length, 1, "the engine waits for its in-flight catalog, never the renderer");
  h.engine.loading = false;
  h.engine.token = "2:fp";
  h.app.workspace.trigger(helpers.COMMAND_CHIP_CATALOG_EVENT, { token: "2:fp" });
  assert.equal(face(host), "is-ready");
});

test("Reading buttons: Enter, Space, Shift+Enter, and Shift+Click each activate once", async () => {
  const h = harness();
  const { host } = mountOn(h, "reading", WALK);
  const done = async () => {
    await settle();
    for (const call of [...h.engine.runs, ...h.engine.opens]) call.resolve({ ok: true, stage: "run", outcome: "completed" });
    await settle();
    h.clock.advance(2000);
  };
  assert.equal(host.tagName, "BUTTON");
  key(host, "Enter");
  host.dispatch("click", pointer("click", { detail: 0 }));
  await done();
  assert.equal(h.engine.runs.length, 1, "the button's native click after Enter never runs twice");
  key(host, " ");
  await done();
  assert.equal(h.engine.runs.length, 2);
  key(host, "Enter", { shiftKey: true });
  await done();
  click(host, { shiftKey: true });
  await done();
  assert.deepEqual([h.engine.runs.length, h.engine.opens.length], [2, 2]);
  assert.deepEqual(Object.keys(h.engine.opens[0].opts).sort(), ["onState", "source"]);
});

test("a second mounted copy of one command opens live output instead of running twice", async () => {
  const h = harness();
  const first = mountOn(h, "reading", WALK).host;
  const second = mountOn(h, "embed", WALK).host;
  click(first);
  await settle();
  h.engine.runs[0].opts.onState({ state: "running", runId: "r1", kind: "run", step: 1, total: 1 });
  assert.equal(face(second), "is-running");
  h.clock.advance(1000);
  click(second);
  await settle();
  assert.equal(h.engine.runs.length, 1);
  assert.deepEqual(h.engine.outputs, ["r1"]);
});

test("a re-render mid-run shows live feedback; unloading a render child never stops the run", async () => {
  const h = harness();
  const first = mountOn(h, "tasks", WALK);
  click(first.host);
  await settle();
  const call = h.engine.runs[0];
  call.opts.onState({ state: "running", runId: "r1", kind: "run", step: 1, total: 1 });
  // The copy chip keeps its own child; command chips share one per pass.
  assert.equal(first.children.length, 2);
  first.children.at(-1).onunload();
  assert.equal(helpers.commandChipMountOf(first.host), null);
  assert.equal(h.store.listeners.size, 0);
  assert.equal(h.plugin.commandChipRuntime.catalogListeners.size, 0);
  assert.equal(h.store.snapshot("reconcile").state, "running");
  const again = mountOn(h, "tasks", WALK);
  assert.equal(face(again.host), "is-running", "a rebuilt query row shows the run immediately");
  call.opts.onState({ state: "finished", runId: "r1", kind: "run", outcome: "failed", reason: "error: boom" });
  call.resolve({ ok: false, stage: "run", outcome: "failed", runId: "r1" });
  await settle();
  assert.equal(face(again.host), "is-failed");
  assert.equal(stateLine(again.host), "Failed: error: boom");
  assert.equal(face(first.host), "is-running", "an unloaded button is left alone");
});

test("a detached query row paints copy-only until it is attached", async () => {
  const h = harness();
  class AttachDocument extends FakeDocument {
    createElement(tag) {
      const el = super.createElement(tag);
      el.isConnected = false;
      el.onNodeInserted = (listener) => {
        el.inserted = listener;
        return () => { el.inserted = null; };
      };
      return el;
    }
  }
  const doc = new AttachDocument();
  // Tasks renders the description into a span before the row exists in
  // the page; the post-processor sees only that span.
  const { el } = buildChain(doc, [["span", ""]]);
  addCode(doc, el, "run: bob task reconcile");
  const { children } = render(h, el, WALK, null);
  const host = runButtons(el)[0];
  assert.equal(stateLine(host), "Copy only: source note unknown");
  click(host);
  await settle();
  assert.equal(h.engine.runs.length, 0, "a detached unknown row never runs");
  // Tasks attaches the row; Obsidian's onNodeInserted repaints.
  const { el: description } = buildChain(doc, [
    ["div", "block-language-tasks"], ["ul", "plugin-tasks-query-result"], ["li", "task-list-item plugin-tasks-list-item"],
    ["span", "tasks-list-text"], ["span", "task-description"],
  ]);
  description.appendChild(el);
  host.isConnected = true;
  host.inserted();
  assert.equal(face(host), "is-ready");
  // A detached ordinary section with section info paints by its path.
  const section = buildChain(doc, [["div", "el-ul"]]).el;
  addCode(doc, section, "run: bob task reconcile");
  render(h, section, "ref/n.md", sectionOf("ref/n.md", h.vault, 2, 2));
  assert.equal(stateLine(runButtons(section)[0]), "Copy only: notes under ref/ never run commands");
  children[0].onunload();
  assert.equal(host.inserted, null, "unload drops the attach listener");
  runFrames();
});

test("an outer pass leaves run spans inside nested renders to their own pass", () => {
  const h = harness();
  const doc = new FakeDocument();
  const { top, el } = buildChain(doc, [["div", "el-p"], ["span", "internal-embed markdown-embed"], ["div", "markdown-embed-content"]]);
  const inner = addCode(doc, el, "run: bob task reconcile");
  const own = addCode(doc, top, "run: bob task reconcile");
  render(h, top, DASH, sectionOf(DASH, h.vault, 2, 2));
  assert.equal(inner.parentNode, el, "the embed's span is untouched");
  assert.equal(inner.getAttribute("data-bob-chip-processed"), null, "and unmarked, so its own pass still sees it");
  assert.equal(own.parentNode, null, "the outer note's own span becomes a button");
  assert.equal(helpers.commandChipReadingInNestedRender(inner, top), true);
});

test("origin reads the innermost boundary", () => {
  const doc = new FakeDocument();
  const origin = (chain) => {
    const { el } = buildChain(doc, chain);
    const host = doc.createElement("button");
    el.appendChild(host);
    const o = helpers.commandChipReadingOrigin(host);
    return [o.origin, o.adapter, o.verified];
  };
  assert.deepEqual(origin([["div", "markdown-preview-view"], ["p", ""]]), ["reading", null, false]);
  assert.deepEqual(origin(SURFACES.tasks(WALK).chain), ["query", "tasks", true]);
  assert.deepEqual(origin(SURFACES.dataview(WALK).chain), ["query", "dataview", true]);
  assert.deepEqual(origin([["div", "block-language-dataview"], ["ul", "contains-task-list"], ["li", "dataview task-list-basic-item"], ["span", ""]]), ["query", "dataview", true]);
  assert.deepEqual(origin(SURFACES.embed(WALK).chain), ["embed", null, false]);
  assert.deepEqual(origin(SURFACES.hover(WALK).chain), ["hover", null, false]);
  // An embed inside a Dataview table renders its own note.
  assert.deepEqual(origin([["div", "block-language-dataview"], ["table", "dataview"], ["td", ""], ["span", "internal-embed markdown-embed"], ["div", "el-p"]]), ["embed", null, false]);
  // Live Preview hosts query blocks and embeds in editor widgets.
  assert.deepEqual(origin([["div", "cm-content"], ["div", "cm-preview-code-block cm-embed-block markdown-rendered cm-lang-tasks"], ...SURFACES.tasks(WALK).chain.slice(2)]), ["query", "tasks", true]);
});
