// Report-backed live patch for Area/Project cards (bob-cli-pl.5 card-live):
// patch merging, absent-not-zero, the blocked-ancestor walk, contract
// setting filing, and the ^prj goal-line locators on both surfaces.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other.type === type }; } }; return type; } };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ ...options }), line: (options) => ({ ...options }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
    EditorView: { editorAttributes: { of: (attributes) => attributes } },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

class FakeText {
  constructor(text, doc) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = doc; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
  contains(node) { return node === this; }
}

class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this.attrs = new Map();
    this.listeners = new Map();
    const self = this;
    this.classList = {
      add(name) { const xs = new Set(self.className.split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { self.setAttribute("class", self.className.split(/\s+/).filter((x) => x && x !== name).join(" ")); },
      contains(name) { return self.className.split(/\s+/).includes(name); },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(value) { this.childNodes = []; this.appendChild(this.ownerDocument.createTextNode(value)); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.childNodes.push(node); return node; }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, extra = {}) {
    const event = { type, button: 0, defaultPrevented: false, ...extra };
    event.preventDefault = () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const cls of part.match(/\.[\w-]+/g) || []) if (!this.classList.contains(cls.slice(1))) return false;
      for (const [, name, value] of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(name)) return false;
        if (value !== undefined && this.getAttribute(name) !== value) return false;
      }
      return true;
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => { for (const child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeText(text, this); },
  };
}

function yaml(fields, body = "") {
  const lines = Object.entries(fields).flatMap(([key, value]) => {
    if (Array.isArray(value)) return [`${key}:`, ...value.map((item) => `  - ${item}`)];
    if (typeof value === "boolean" || typeof value === "number") return [`${key}: ${value}`];
    return [`${key}: ${value}`];
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

const CLOCK = new Date(2026, 10, 22, 12, 0, 0);

function projectModel(body, frontmatter = {}) {
  return H.homeCardModel({
    path: "sase_blog.md",
    frontmatter: { type: "[[project]]", parent: "[[dev]]", ...frontmatter },
    sourceText: yaml({ type: "\"[[project]]\"", parent: "\"[[dev]]\"", ...frontmatter }, body),
    ready: { count: 2, cap: 5, cap_source: "default", state: "room" },
    hue: "blue",
    ancestors: [{ path: "dev.md", title: "dev", kind: "area", hue: "blue" }],
    clock: CLOCK,
  });
}

function projectEntry(overrides = {}) {
  return {
    path: "sase_blog.md",
    stem: "sase_blog",
    status: "open",
    state: "blocked",
    criterion: "goal",
    parent: "dev.md",
    children: [],
    closed_on: null,
    prj: { line: 4, mark: "?", hidden: false, scheduled: null },
    blocked: { kind: "dependency", waits_on: ["sase_plan#^abc123"] },
    tasks: { open: 3, shown: 3, today: 1 },
    contract_issues: [],
    ...overrides,
  };
}

function projectStates(entry, { stale = false, unavailable = false, today = "2026-11-22" } = {}) {
  const report = {
    projectsByPath: new Map([[entry.path, entry]]),
    today,
  };
  return { projects: { report, stale, unavailable }, areas: { report: null, stale: false, unavailable: true } };
}

test("contract codes file under the stable settings-contract ids", () => {
  const cases = [
    ["area_summary_multiline", "summary"],
    ["area_summary_long", "summary"],
    ["area_parent_missing", "parent"],
    ["area_parent_unresolved", "parent"],
    ["area_cycle", "parent"],
    ["area_color_invalid", "color"],
    ["type_default_conflict", "task_type"],
    ["note_theme_unconfigured", "task_type"],
    ["note_offclock_shadowed", "clock"],
    ["note_offclock_invalid", "clock"],
    ["note_ready_cap_invalid", "ready_cap"],
    ["task_refresh_invalid", "task_refresh"],
    ["catalog_state_damaged", ""],
    ["", ""],
  ];
  for (const [code, setting] of cases) assert.equal(H.homeCardContractSetting(code), setting, code);
});

test("issue normalization keeps code and message rows and drops the rest", () => {
  const issues = H.homeCardLiveNormalizeIssues([
    { code: "note_offclock_shadowed", severity: "warning", message: "offclock: false is ignored" },
    { code: "mystery", message: "something odd" },
    { code: "", message: "no code" },
    { code: "x" },
    "nope",
    null,
  ]);
  assert.deepEqual(issues, [
    { code: "note_offclock_shadowed", severity: "warning", message: "offclock: false is ignored", setting: "clock" },
    { code: "mystery", severity: "warning", message: "something odd", setting: "" },
  ]);
});

test("a missing, stale, or entry-less snapshot patches nothing, never zero", () => {
  const model = projectModel("- [?] #task #prj Wait for the review ^prj\n");
  assert.equal(H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: {} }), null);
  const entry = projectEntry();
  assert.equal(H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry, { stale: true }) }), null);
  assert.equal(H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry, { unavailable: true }) }), null);
  assert.equal(H.homeCardLivePatch({ kind: "project", path: "other.md", model, states: projectStates(entry) }), null);
  assert.equal(H.homeCardApplyLivePatch(model, null), model, "a null patch keeps the model untouched");
});

test("dependency-blocked projects gain at most two waits-on links", () => {
  const model = projectModel("- [?] #task #prj Wait for the review ^prj\n");
  const entry = projectEntry({
    blocked: { kind: "dependency", waits_on: ["alpha#^a1", "beta#^b2", "gamma#^c3"] },
    tasks: { open: 5, shown: 5, today: 0 },
  });
  const patch = H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry) });
  assert.ok(patch && patch.blocked, "blocked reason patches");
  assert.equal(patch.blocked.kind, "dependency");
  assert.deepEqual(patch.blocked.links.map((link) => link.text), ["alpha", "beta"]);
  assert.equal(patch.blocked.tail, "+1");
  assert.equal(patch.open, 5);
  assert.equal(patch.today, 0, "a present zero today paints as zero");
  const next = H.homeCardApplyLivePatch(model, patch);
  assert.equal(next.subtitle.word, "BLOCKED");
  assert.equal(next.subtitle.text, "BLOCKED · waits on alpha, beta +1");
  assert.equal(next.report.open, 5);
  assert.equal(next.report.today, 0);
});

test("same-note dependency targets stay text while other notes link", () => {
  const model = projectModel("- [?] #task #prj Wait for the review ^prj\n");
  const entry = projectEntry({ blocked: { kind: "dependency", waits_on: ["#^local1", "sase_plan#^x9"] } });
  const patch = H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry) });
  assert.ok(patch && patch.blocked);
  assert.deepEqual(patch.blocked.links, [
    { text: "#^local1", target: "" },
    { text: "sase_plan", target: "sase_plan" },
  ]);
});

test("inherited blocking names the nearest blocked ancestor", () => {
  const model = projectModel("- [?] #task #prj Wait on the parent ^prj\n");
  const child = projectEntry({ path: "leaf.md", stem: "leaf", parent: "mid_plan.md", blocked: { kind: "inherited" } });
  const parent = projectEntry({ path: "mid_plan.md", stem: "mid_plan", parent: "top_plan.md", blocked: { kind: "inherited" } });
  const top = projectEntry({ path: "top_plan.md", stem: "top_plan", parent: null, blocked: { kind: "dependency", waits_on: ["dep#^d"] } });
  const report = { projectsByPath: new Map([["leaf.md", child], ["mid_plan.md", parent], ["top_plan.md", top]]), today: "2026-11-22" };
  const ancestor = H.homeCardLiveBlockedAncestor(report, child);
  assert.deepEqual(ancestor, { text: "mid_plan", target: "mid_plan.md" });
  const patch = H.homeCardLivePatch({
    kind: "project", path: "leaf.md", model: { ...model, path: "leaf.md" },
    states: { projects: { report, stale: false, unavailable: false }, areas: { report: null, unavailable: true } },
  });
  assert.ok(patch && patch.blocked);
  assert.equal(patch.blocked.kind, "inherited");
  assert.equal(patch.blocked.text, "parent project mid_plan is blocked");
  const next = H.homeCardApplyLivePatch({ ...model, path: "leaf.md" }, patch);
  assert.equal(next.subtitle.text, "BLOCKED · parent project mid_plan is blocked");
  assert.deepEqual(next.subtitle.reason.links, [{ text: "mid_plan", target: "mid_plan.md" }]);
});

test("the ancestor walk stops at cycles and unblocked chains", () => {
  const a = projectEntry({ path: "a.md", stem: "a", parent: "b.md", blocked: { kind: "inherited" } });
  const b = projectEntry({ path: "b.md", stem: "b", parent: "a.md", blocked: null });
  const report = { projectsByPath: new Map([["a.md", a], ["b.md", b]]), today: "2026-11-22" };
  assert.equal(H.homeCardLiveBlockedAncestor(report, a), null, "a parent cycle terminates with no ancestor");
  const self = projectEntry({ path: "s.md", stem: "s", parent: "s.md", blocked: { kind: "inherited" } });
  const selfReport = { projectsByPath: new Map([["s.md", self]]), today: "2026-11-22" };
  assert.equal(H.homeCardLiveBlockedAncestor(selfReport, self), null, "a self parent terminates with no ancestor");
  const lone = projectEntry({ path: "lone.md", stem: "lone", parent: "plain.md", blocked: { kind: "inherited" } });
  const plain = projectEntry({ path: "plain.md", stem: "plain", parent: null, blocked: null });
  const report2 = { projectsByPath: new Map([["lone.md", lone], ["plain.md", plain]]), today: "2026-11-22" };
  assert.equal(H.homeCardLiveBlockedAncestor(report2, lone), null, "an unblocked chain resolves to no ancestor");
  assert.equal(H.homeCardLiveBlockedAncestor(null, lone), null);
  const model = projectModel("- [?] #task #prj Wait on the parent ^prj\n");
  const patch = H.homeCardLivePatch({
    kind: "project", path: "lone.md", model: { ...model, path: "lone.md" },
    states: { projects: { report: report2, stale: false, unavailable: false }, areas: { report: null, unavailable: true } },
  });
  assert.ok(!patch || !patch.blocked, "no ancestor keeps the local BLOCKED line");
});

test("done projects without a line date gain the report close date", () => {
  const model = projectModel("- [x] #task #prj Finish the old rollout ^prj\n");
  assert.equal(model.lifecycle.kind, "done");
  assert.equal(model.lifecycle.detail, "", "the line carries no date");
  const entry = projectEntry({ state: "done", blocked: null, closed_on: "2026-11-20" });
  const patch = H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry) });
  assert.ok(patch && patch.closedOn, "the report close date patches");
  assert.equal(patch.closedOn, "Nov 20");
  const next = H.homeCardApplyLivePatch(model, patch);
  assert.equal(next.lifecycle.detail, "Nov 20");
  assert.equal(next.subtitle.text, "DONE · Nov 20");
});

test("a line date always beats the report close date", () => {
  const model = projectModel("- [x] #task #prj Finish the old rollout [completion:: 2026-11-18] ^prj\n");
  assert.equal(model.lifecycle.detail, "Nov 18");
  const entry = projectEntry({ state: "done", blocked: null, closed_on: "2026-11-20" });
  const patch = H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry) });
  assert.ok(!patch || !patch.closedOn, "no close-date patch when the line has one");
});

test("reason links render as anchors and navigate like crumbs", () => {
  const doc = makeDoc();
  const model = projectModel("- [?] #task #prj Wait for the review ^prj\n");
  const entry = projectEntry({ blocked: { kind: "dependency", waits_on: ["alpha#^a1", "beta#^b2"] } });
  const patch = H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry) });
  const opened = [];
  const card = H.homeCardBuildEl(doc, H.homeCardApplyLivePatch(model, patch), { onLink: (target, event) => opened.push(target) });
  const links = card.querySelectorAll(".bob-home-card-reason-link");
  assert.equal(links.length, 2);
  assert.equal(links[0].tagName, "A");
  assert.equal(links[0].textContent, "alpha");
  links[0].fire("click");
  assert.deepEqual(opened, ["alpha"]);
  assert.match(card.querySelector(".bob-home-card-lifecycle-detail").textContent, /waits on alpha, beta/);
});

test("reason links stay text when no opener is present", () => {
  const doc = makeDoc();
  const model = projectModel("- [?] #task #prj Wait for the review ^prj\n");
  const entry = projectEntry({ blocked: { kind: "dependency", waits_on: ["alpha#^a1"] } });
  const patch = H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry) });
  const card = H.homeCardBuildEl(doc, H.homeCardApplyLivePatch(model, patch), {});
  const link = card.querySelector(".bob-home-card-reason-link");
  assert.ok(link);
  assert.equal(link.tagName, "SPAN");
});

test("open and today readouts paint from a present snapshot only", () => {
  const doc = makeDoc();
  const model = projectModel("- [ ] #task #prj Ship the rollout ^prj\n");
  const entry = projectEntry({ state: "open", blocked: null, tasks: { open: 3, shown: 3, today: 1 } });
  const patch = H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry) });
  const card = H.homeCardBuildEl(doc, H.homeCardApplyLivePatch(model, patch), {});
  const reports = card.querySelectorAll(".bob-home-card-report");
  assert.equal(reports.length, 2);
  assert.equal(reports[0].textContent, "3 open");
  assert.equal(reports[0].getAttribute("title"), "Open tasks in this project: 3");
  assert.equal(reports[1].textContent, "1 today");
  const bare = H.homeCardBuildEl(doc, model, {});
  assert.equal(bare.querySelectorAll(".bob-home-card-report").length, 0, "no snapshot means no readout, never zero");
});

test("areas show direct today only and never count subtrees", () => {
  const doc = makeDoc();
  const model = H.homeCardModel({
    path: "dev.md",
    frontmatter: { type: "[[area]]", parent: "[[area]]", summary: "Work." },
    sourceText: yaml({ type: "\"[[area]]\"", parent: "\"[[area]]\"", summary: "Work." }, "# Dev\n"),
    ready: { count: 1, cap: 5, cap_source: "default", state: "room" },
    hue: "blue",
    clock: CLOCK,
  });
  const entry = {
    path: "dev.md", stem: "dev", link: "[[dev]]", title: "Dev", titled: true,
    summary: "Work.", parent: "area.md", depth: 0, top: "dev",
    children: ["ops.md"], projects: { direct: 2, subtree: 9 }, today: { direct: 4, subtree: 11 },
    issues: [], contract_issues: [],
  };
  const states = {
    projects: { report: null, stale: false, unavailable: true },
    areas: { report: { areasByPath: new Map([["dev.md", entry]]), today: "2026-11-22" }, stale: false, unavailable: false },
  };
  const patch = H.homeCardLivePatch({ kind: "area", path: "dev.md", model, states });
  assert.ok(patch);
  assert.equal(patch.open, null, "areas never show an open readout");
  assert.equal(patch.today, 4, "areas show direct today, never the subtree");
  const card = H.homeCardBuildEl(doc, H.homeCardApplyLivePatch(model, patch), {});
  const reports = card.querySelectorAll(".bob-home-card-report");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].textContent, "4 today");
  assert.equal(reports[0].getAttribute("title"), "Today tasks directly in this area: 4");
});

test("terminal projects keep no report readout but gain an undated close date", () => {
  const doc = makeDoc();
  const model = projectModel("- [x] #task #prj Finish the old rollout ^prj\n");
  assert.equal(model.terminal, true);
  const entry = projectEntry({ state: "done", blocked: null, tasks: { open: 0, shown: 0, today: 0 }, closed_on: "2026-11-20" });
  const patch = H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry) });
  assert.ok(patch && patch.closedOn === "Nov 20", "the undated terminal detail still fills");
  assert.equal(patch.open, null);
  assert.equal(patch.today, null);
  const card = H.homeCardBuildEl(doc, H.homeCardApplyLivePatch(model, patch), {});
  assert.equal(card.querySelectorAll(".bob-home-card-report").length, 0, "terminal cards keep no readout row");
  assert.equal(card.querySelector(".bob-home-card-lifecycle-detail").textContent, "Nov 20");
  const dated = projectModel("- [x] #task #prj Finish the old rollout [completion:: 2026-11-18] ^prj\n");
  const datedEntry = projectEntry({ state: "done", blocked: null, closed_on: "2026-11-20" });
  assert.equal(
    H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model: dated, states: projectStates(datedEntry) }),
    null,
    "a dated terminal card takes no patch at all",
  );
});

test("contract issues ride the patch with the first affected setting", () => {
  const model = projectModel("- [ ] #task #prj Ship the rollout ^prj\n");
  const entry = projectEntry({
    state: "open", blocked: null, tasks: { open: 1, shown: 1, today: 0 },
    contract_issues: [
      { code: "task_refresh_invalid", severity: "error", message: "task_refresh is not 1–365 days" },
      { code: "mystery_code", severity: "warning", message: "something odd" },
    ],
  });
  const patch = H.homeCardLivePatch({ kind: "project", path: "sase_blog.md", model, states: projectStates(entry) });
  assert.ok(patch && patch.contractIssues.length === 2);
  assert.equal(patch.firstSetting, "task_refresh");
  const next = H.homeCardApplyLivePatch(model, patch);
  assert.equal(next.contract.firstSetting, "task_refresh");
});

test("foot lint counts contract issues and names the first setting", () => {
  const lint = H.propertyCardFootLint({
    inventory: { state: "closed", issues: [] },
    stamp: null,
    contractIssues: [
      { code: "note_offclock_shadowed", message: "offclock: false is ignored because offclock_types decides" },
      { code: "task_refresh_invalid", message: "task_refresh is not 1–365 days" },
    ],
    firstSetting: "clock",
  });
  assert.equal(lint.count, 2);
  assert.equal(lint.firstSetting, "clock");
  assert.match(lint.tooltip, /offclock: false is ignored/);
  assert.match(lint.tooltip, /task_refresh is not/);
  const clean = H.propertyCardFootLint({ inventory: { state: "closed", issues: [] }, stamp: null });
  assert.equal(clean.count, 0);
  assert.equal(clean.firstSetting, "");
});

test("the goal line locator follows the recognized ^prj task only", () => {
  const wip = projectModel("- [ ] #task #prj Ship the rollout ^prj\n");
  assert.equal(H.homeCardGoalLineFor(wip), 5, "frontmatter occupies lines 1-4");
  const missing = projectModel("# Notes without a goal task\n");
  assert.equal(missing.lifecycle.kind, "missing");
  assert.equal(H.homeCardGoalLineFor(missing), null);
  const area = H.homeCardModel({
    path: "dev.md",
    frontmatter: { type: "[[area]]", parent: "[[area]]" },
    sourceText: yaml({ type: "\"[[area]]\"", parent: "\"[[area]]\"" }, "# Dev\n"),
    clock: CLOCK,
  });
  assert.equal(H.homeCardGoalLineFor(area), null, "areas never decorate a goal line");
  assert.equal(H.homeCardGoalLineFor(null), null);
});

test("the Reading lookup finds the goal row before any H2 and skips the rest", () => {
  const doc = makeDoc();
  const model = projectModel("- [ ] #task #prj Ship the rollout ^prj\n");
  const expected = H.homeCardGoalLineExpectedText(model);
  assert.equal(expected, "#task #prj Ship the rollout");
  const root = new FakeNode("div", doc);
  const plain = new FakeNode("li", doc);
  plain.setAttribute("class", "task-list-item");
  plain.setAttribute("data-task", " ");
  plain.appendChild(doc.createTextNode("Water the plants"));
  const goal = new FakeNode("li", doc);
  goal.setAttribute("class", "task-list-item");
  goal.setAttribute("data-task", " ");
  goal.appendChild(doc.createTextNode("#task #prj Ship the rollout"));
  const heading = new FakeNode("h2", doc);
  const late = new FakeNode("li", doc);
  late.setAttribute("class", "task-list-item");
  late.setAttribute("data-task", " ");
  late.appendChild(doc.createTextNode("#task #prj Ship the rollout"));
  for (const node of [plain, goal, heading, late]) root.appendChild(node);
  assert.equal(H.homeCardGoalLineNode(root, model), goal);
  goal.removeChild(goal.childNodes[0]);
  goal.appendChild(doc.createTextNode("Something else entirely"));
  assert.equal(H.homeCardGoalLineNode(root, model), null, "a mismatched row never decorates");
});

test("the Reading lookup skips nested tasks", () => {
  const doc = makeDoc();
  const model = projectModel("- [ ] #task #prj Ship the rollout ^prj\n");
  const root = new FakeNode("div", doc);
  // A plain bullet parent (no task class) holding the goal text nested: the
  // source rule never recognizes a nested ^prj line, so nothing decorates.
  const outer = new FakeNode("li", doc);
  outer.appendChild(doc.createTextNode("Parent note"));
  const nested = new FakeNode("li", doc);
  nested.setAttribute("class", "task-list-item");
  nested.setAttribute("data-task", "x");
  nested.appendChild(doc.createTextNode("#task #prj Ship the rollout"));
  outer.appendChild(nested);
  root.appendChild(outer);
  assert.equal(H.homeCardGoalLineNode(root, model), null, "nested goal text never decorates");
});
