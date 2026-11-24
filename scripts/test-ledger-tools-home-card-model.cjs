// Pure local Area/Project card model (bob-cli-pl.4.1 presentation).
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
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ ...options }) };
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

const TODAY = new Date(2026, 10, 22, 12, 0, 0);

function yaml(fields, body = "") {
  const lines = Object.entries(fields).flatMap(([key, value]) => {
    if (Array.isArray(value)) {
      return [`${key}:`, ...value.map((item) => `  - ${item}`)];
    }
    if (typeof value === "boolean" || typeof value === "number") return [`${key}: ${value}`];
    if (value == null) return [`${key}:`];
    return [`${key}: ${value}`];
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function model(path, frontmatter, extra = {}) {
  return H.homeCardModel({
    path,
    frontmatter,
    clock: TODAY,
    ...extra,
  });
}

test("eligibility is typed homes only and excludes type notes, archives, and templates", () => {
  assert.equal(H.homeCardEligible("love.md", { type: "[[area]]" }).kind, "area");
  assert.equal(H.homeCardEligible("sase_blog.md", { type: "[[project]]" }).kind, "project");
  assert.equal(H.homeCardEligible("love.md", { type: "[[album]]" }), null);
  assert.equal(H.homeCardEligible("love.md", {}), null);
  for (const path of ["area.md", "project.md", "bank.md", "done/old.md", "_templates/area.md", "x/_conflicts/note.md"]) {
    assert.equal(H.homeCardEligible(path, { type: "[[area]]" }), null, path);
  }
  assert.ok(H.homeCardEligible("areas/love.md", { type: "[[area]]" }));
  assert.equal(H.homeCardModel({ path: "love.md", frontmatter: { type: "record" } }), null);
});

test("title prefers the first-body H1, then alias, then the stem verbatim", () => {
  const heading = model("sase_blog.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "# Local Area cards\n\n- [ ] #task #prj goal ^prj\n"),
  });
  assert.equal(heading.title.text, "Local Area cards");
  assert.equal(heading.title.source, "h1");
  assert.ok(heading.title.range);
  assert.ok(heading.title.range.to < heading.prj.from, "the title range never consumes ^prj");

  const afterPrj = model("sase_blog.md", { type: "[[project]]", aliases: ["Pretty"] }, {
    sourceText: yaml({ type: "\"[[project]]\"", aliases: "[Pretty]" }, "- [ ] #task #prj goal ^prj\n\n# Late title\n"),
  });
  assert.equal(afterPrj.title.source, "alias");
  assert.equal(afterPrj.title.text, "Pretty");
  assert.equal(afterPrj.title.range, null);

  const stem = model("sase_blog.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "- [ ] #task #prj goal ^prj\n"),
  });
  assert.equal(stem.title.source, "stem");
  assert.equal(stem.title.text, "sase_blog");

  const underscored = model("my_area.md", { type: "[[area]]" }, {
    sourceText: yaml({ type: "\"[[area]]\"" }, "plain body\n"),
  });
  assert.equal(underscored.title.text, "my_area");
});

test("home title recognizer stops before a following ^prj line", () => {
  const source = "---\ntype: \"[[project]]\"\n---\n# Goal\n\n- [ ] #task #prj keep me ^prj\n";
  const range = H.propertyCardTitleSourceRange(source, H.propertyCardHomeTitleRecognizer("Goal"));
  assert.ok(range);
  assert.equal(source.slice(range.from, range.to).includes("^prj"), false);
  assert.match(source.slice(range.to), /\^prj/);
});

test("ancestry omits the area sentinel and self, collapses the middle, and never invents links", () => {
  const notes = {
    "leaf.md": { path: "leaf.md", kind: "project", parent: "[[mid]]", title: "leaf", hue: "blue" },
    "mid.md": { path: "mid.md", kind: "project", parent: "[[deep]]", title: "mid" },
    "deep.md": { path: "deep.md", kind: "project", parent: "[[nested]]", title: "deep" },
    "nested.md": { path: "nested.md", kind: "project", parent: "[[inner]]", title: "nested" },
    "inner.md": { path: "inner.md", kind: "project", parent: "[[dev]]", title: "inner" },
    "dev.md": { path: "dev.md", kind: "area", parent: "[[area]]", title: "dev", hue: "green" },
    "area.md": { path: "area.md", kind: "area", title: "area" },
  };
  const resolve = (target) => notes[`${String(target).replace(/\.md$/i, "")}.md`] || null;
  const deep = model("leaf.md", { type: "[[project]]", parent: "[[mid]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"", parent: "\"[[mid]]\"" }, "- [ ] #task #prj x ^prj\n"),
    resolveParent: resolve,
    hue: "green",
  });
  assert.deepEqual(deep.crumbs.map((crumb) => crumb.text), ["dev", "…", "deep", "mid"]);
  assert.equal(deep.crumbs[0].pip, "green");
  assert.equal(deep.crumbs[1].ellipsis, true);
  assert.equal(deep.crumbs.some((crumb) => crumb.target === "area.md" || crumb.text === "area"), false);
  assert.equal(deep.where.parent, "kicker");

  const cyclic = model("a.md", { type: "[[project]]", parent: "[[b]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"", parent: "\"[[b]]\"" }, "- [ ] #task #prj x ^prj\n"),
    resolveParent: (target) => {
      if (target === "b") return { path: "b.md", kind: "project", parent: "[[a]]", title: "b" };
      if (target === "a") return { path: "a.md", kind: "project", parent: "[[b]]", title: "a" };
      return null;
    },
  });
  assert.equal(cyclic.ancestry.cyclic, true);
  assert.deepEqual(cyclic.crumbs.map((crumb) => crumb.target), ["b.md"]);

  const broken = model("a.md", { type: "[[project]]", parent: "[[gone]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"", parent: "\"[[gone]]\"" }, "- [ ] #task #prj x ^prj\n"),
    resolveParent: () => null,
  });
  assert.equal(broken.ancestry.broken, true);
  assert.deepEqual(broken.crumbs, []);

  const top = model("love.md", { type: "[[area]]" }, {
    sourceText: yaml({ type: "\"[[area]]\"" }, "# love\n"),
  });
  assert.deepEqual(top.crumbs, []);
  assert.equal(top.where.parent, undefined);
});

test("pending source defers lifecycle and chips so WIP never flickers", () => {
  const pending = model("sase_blog.md", { type: "[[project]]", task_type: "BUILD" });
  assert.equal(pending.sourcePending, true);
  assert.equal(pending.lifecycle.pending, true);
  assert.equal(pending.subtitle.pending, true);
  assert.equal(pending.subtitle.text, "");
  assert.deepEqual(pending.chips, []);
  assert.equal(pending.ready, null);
});

test("project lifecycle covers WIP, schedule boundaries, blocked, done, canceled, and missing", () => {
  const wipSource = (mark) => yaml({ type: "\"[[project]]\"" }, `- [${mark}] #task #prj goal ^prj\n`);
  for (const mark of [" ", "*", "/"]) {
    const row = model("p.md", { type: "[[project]]" }, { sourceText: wipSource(mark) });
    assert.equal(row.lifecycle.kind, "wip", mark);
    assert.equal(row.subtitle.word, "WIP");
    assert.equal(row.terminal, false);
  }

  const scheduled = model("p.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "- [?] #task #prj wait [scheduled:: 2026-12-02] ^prj\n"),
  });
  assert.equal(scheduled.lifecycle.kind, "scheduled");
  assert.equal(scheduled.subtitle.word, "SCHEDULED");
  assert.equal(scheduled.subtitle.detail, "starts Dec 2 · in 10 days");

  const today = model("p.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "- [?] #task #prj wait [scheduled:: 2026-11-22] ^prj\n"),
  });
  assert.equal(today.lifecycle.kind, "blocked");

  const past = model("p.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "- [?] #task #prj wait [scheduled:: 2026-11-01] ^prj\n"),
  });
  assert.equal(past.lifecycle.kind, "blocked");

  const blocked = model("p.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "- [?] #task #prj wait ^prj\n"),
  });
  assert.equal(blocked.lifecycle.kind, "blocked");
  assert.equal(blocked.subtitle.word, "BLOCKED");

  const done = model("p.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "- [x] #task #prj wait [completion:: 2026-11-20] ^prj\n"),
  });
  assert.equal(done.lifecycle.kind, "done");
  assert.equal(done.terminal, true);
  assert.equal(done.subtitle.detail, "Nov 20");
  assert.deepEqual(done.chips, []);
  assert.equal(done.ready, null);
  assert.equal(done.material.wash, 2);

  const canceled = model("p.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "- [-] #task #prj wait [cancelled:: 2026-10-02] ^prj\n"),
  });
  assert.equal(canceled.lifecycle.kind, "canceled");
  assert.equal(canceled.subtitle.detail, "Oct 2");

  const fromStatus = model("p.md", { type: "[[project]]", status: "done" }, {
    sourceText: yaml({ type: "\"[[project]]\"", status: "done" }, "# no task here\n"),
  });
  assert.equal(fromStatus.lifecycle.kind, "done");
  assert.equal(fromStatus.lifecycle.fromStatus, true);
  assert.equal(fromStatus.where.status, "state");

  const missing = model("p.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "# Heading\n"),
  });
  assert.equal(missing.lifecycle.kind, "missing");
  assert.equal(missing.subtitle.word, "NO ^prj TASK");
  assert.match(missing.subtitle.detail, /add "- \[ \] #task #prj/);
  assert.equal(missing.where.status, undefined);

  const duplicate = model("p.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "- [ ] #task #prj a ^prj\n- [ ] #task #prj b ^prj\n"),
  });
  assert.equal(duplicate.lifecycle.kind, "missing");
  assert.equal(duplicate.prj.kind, "duplicate");

  const fenced = model("p.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "```\n- [ ] #task #prj example ^prj\n```\n"),
  });
  assert.equal(fenced.lifecycle.kind, "missing");

  const crlf = model("p.md", { type: "[[project]]" }, {
    sourceText: "---\r\ntype: \"[[project]]\"\r\n---\r\n- [ ] #task #prj goal ^prj\r\n",
  });
  assert.equal(crlf.lifecycle.kind, "wip");
  assert.equal(typeof crlf.prj.from, "number");
});

test("authored chips keep order, false clock, type off, and legacy theme, and ignore unauthored keys", () => {
  const source = yaml({
    type: "\"[[project]]\"",
    task_type: "BUILD",
    theme: "CODE",
    offclock: false,
    offclock_types: ["MEET", "CALL"],
    task_refresh: 3,
    project_name_aliases: ["tailnet", "mesh"],
  }, "- [ ] #task #prj x ^prj\n");
  const card = model("p.md", {
    type: "[[project]]",
    task_type: "BUILD",
    theme: "CODE",
    offclock: false,
    offclock_types: ["MEET", "CALL"],
    task_refresh: 3,
    project_name_aliases: ["tailnet", "mesh"],
  }, {
    sourceText: source,
    themeHue: () => "orange",
  });
  assert.deepEqual(card.chips.map((chip) => chip.text), [
    "#BUILD", "off-clock · MEET, CALL", "review 3d", "aka tailnet +1",
  ]);
  assert.equal(card.chips[0].hue, "orange");
  assert.equal(card.chips[1].warning, true);
  assert.match(card.chips[1].tooltip, /offclock: false is ignored/);
  assert.equal(card.chips[1].settingKey, "offclock_types");
  assert.equal(card.where.task_type, "chip");
  assert.equal(card.where.offclock_types, "chip");

  const off = model("p.md", { type: "[[project]]", task_type: "off" }, {
    sourceText: yaml({ type: "\"[[project]]\"", task_type: "off" }, "- [ ] #task #prj x ^prj\n"),
  });
  assert.equal(off.chips[0].text, "type off");

  const legacy = model("p.md", { type: "[[project]]", theme: "code" }, {
    sourceText: yaml({ type: "\"[[project]]\"", theme: "code" }, "- [ ] #task #prj x ^prj\n"),
  });
  assert.equal(legacy.chips[0].text, "#CODE");
  assert.equal(legacy.chips[0].tooltip, "Legacy theme key");

  const onClock = model("p.md", { type: "[[project]]", offclock: false }, {
    sourceText: yaml({ type: "\"[[project]]\"", offclock: false }, "- [ ] #task #prj x ^prj\n"),
  });
  assert.equal(onClock.chips[0].text, "on-clock");

  const cacheOnly = model("p.md", { type: "[[project]]", task_type: "BUILD" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "- [ ] #task #prj x ^prj\n"),
  });
  assert.deepEqual(cacheOnly.chips, []);
});

test("Ready omits unknown data, keeps cap provenance, and uses room/full/crowded/exempt ink", () => {
  const base = {
    path: "love.md",
    frontmatter: { type: "[[area]]" },
    sourceText: yaml({ type: "\"[[area]]\"" }, "# love\n"),
  };
  assert.equal(H.homeCardModel(base).ready, null);
  assert.equal(H.homeCardModel({ ...base, ready: { count: "2", cap: 5 } }).ready, null);

  const capped = H.homeCardModel({ ...base, ready: { count: 2, cap: 5, cap_source: "default", state: "room" } });
  assert.equal(capped.ready.text, "2/5 ready");
  assert.equal(capped.ready.state, "room");
  assert.match(capped.ready.tooltip, /cap from plan.max_ready_per_note/);
  assert.equal(capped.where.ready_cap, "readout");

  const noteCap = H.homeCardModel({ ...base, ready: { count: 5, cap: 5, cap_source: "note", state: "full" } });
  assert.equal(noteCap.ready.text, "5/5 ready");
  assert.match(noteCap.ready.tooltip, /cap from ready_cap/);
  assert.equal(noteCap.ready.state, "full");

  const crowded = H.homeCardModel({ ...base, ready: { count: 6, cap: 5, cap_source: "config", state: "crowded" } });
  assert.equal(crowded.ready.state, "crowded");

  const exempt = H.homeCardModel({ ...base, ready: { count: 14, cap: null, state: "exempt" } });
  assert.equal(exempt.ready.text, "14 ready · no cap");
  assert.equal(exempt.ready.state, "exempt");
});

test("material, inbox, root, summary, created, and managed grouping stay local", () => {
  const area = model("love.md", { type: "[[area]]", summary: "A long area blurb.", color: "green", created: "2026-01-01" }, {
    sourceText: yaml({ type: "\"[[area]]\"", summary: "A long area blurb.", color: "green", created: "2026-01-01" }, "# love\n"),
    hue: "green",
    inbox: true,
  });
  assert.equal(area.kind, "area");
  assert.equal(area.material.wash, 8);
  assert.equal(area.material.paper, "hue");
  assert.equal(area.subtitle.kind, "summary");
  assert.equal(area.pills[0].text, "INBOX");
  assert.equal(area.where.summary, "subtitle");
  assert.equal(area.where.color, "tint");
  assert.equal(area.where.type, "tile");
  assert.equal(area.created.silentMissing, true);
  assert.deepEqual(Object.keys(area.managed), ["done_tasks", "template", "scheduled", "task_count", "open_task_count"]);

  const grey = model("love.md", { type: "[[area]]" }, {
    sourceText: yaml({ type: "\"[[area]]\"" }, "# love\n"),
    hue: "unresolved",
  });
  assert.equal(grey.material.paper, "neutral");
  assert.equal(grey.material.wash, 8);

  const project = model("p.md", { type: "[[project]]", root: true, summary: "ignored" }, {
    sourceText: yaml({ type: "\"[[project]]\"", root: true, summary: "ignored" }, "- [ ] #task #prj x ^prj\n"),
    hue: "blue",
  });
  assert.equal(project.material.wash, 5);
  assert.equal(project.subtitle.kind, "lifecycle");
  assert.equal(project.pills[0].text, "ROOT");
  assert.equal(project.pills[0].tooltip, "Pomodoro time here reports under this project");
  assert.equal(project.where.root, "kicker");
  assert.equal(project.where.summary, undefined);
  assert.equal(project.created.silentMissing, false);
  assert.equal(project.where.created, "foot");
});

test("nested ^prj tasks never become the project lifecycle", () => {
  const nested = H.homeCardPrjTask("- note\n  - [x] #task #prj example ^prj\n");
  assert.equal(nested.kind, "missing");
  assert.equal(nested.count, 0);

  const nestedUnderHeading = model("p.md", { type: "[[project]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"" }, "- parent\n  - [x] #task #prj example ^prj\n"),
  });
  assert.equal(nestedUnderHeading.lifecycle.kind, "missing");
  assert.equal(nestedUnderHeading.prj.kind, "missing");

  const topIndented = H.homeCardPrjTask("---\ntype: \"[[project]]\"\n---\n  - [ ] #task #prj x ^prj\n");
  assert.equal(topIndented.kind, "one");
  assert.equal(topIndented.mark, " ");
  assert.equal(typeof topIndented.from, "number");
  assert.match("---\ntype: \"[[project]]\"\n---\n  - [ ] #task #prj x ^prj\n".slice(topIndented.from, topIndented.to), /\^prj/);

  const fenced = H.homeCardPrjTask("---\ntype: \"[[project]]\"\n---\n```\n- [ ] #task #prj example ^prj\n```\n");
  assert.equal(fenced.kind, "missing");

  const duplicate = H.homeCardPrjTask("---\ntype: \"[[project]]\"\n---\n- [ ] #task #prj a ^prj\n- [ ] #task #prj b ^prj\n");
  assert.equal(duplicate.kind, "duplicate");
  assert.equal(duplicate.count, 2);
});

test("invalid authored policy shapes stay out of chips and do not claim where-marks", () => {
  const emptyTypes = model("p.md", {
    type: "[[project]]",
    offclock: true,
    offclock_types: [],
  }, {
    sourceText: yaml({ type: "\"[[project]]\"", offclock: true, offclock_types: [] }, "- [ ] #task #prj x ^prj\n"),
  });
  assert.deepEqual(emptyTypes.chips, []);
  assert.equal(emptyTypes.where.offclock, undefined);
  assert.equal(emptyTypes.where.offclock_types, undefined);

  const mixed = model("p.md", {
    type: "[[project]]",
    offclock_types: ["MEET", 7],
  }, {
    sourceText: "---\ntype: \"[[project]]\"\noffclock_types: [MEET, 7]\n---\n- [ ] #task #prj x ^prj\n",
  });
  assert.deepEqual(mixed.chips, []);
  assert.equal(mixed.where.offclock_types, undefined);

  const numericType = model("p.md", { type: "[[project]]", task_type: 42 }, {
    sourceText: yaml({ type: "\"[[project]]\"", task_type: 42 }, "- [ ] #task #prj x ^prj\n"),
  });
  assert.deepEqual(numericType.chips, []);
  assert.equal(numericType.where.task_type, undefined);

  const objectRefresh = model("p.md", { type: "[[project]]", task_refresh: { bad: true } }, {
    sourceText: "---\ntype: \"[[project]]\"\ntask_refresh:\n  bad: true\n---\n- [ ] #task #prj x ^prj\n",
  });
  assert.deepEqual(objectRefresh.chips, []);
  assert.equal(objectRefresh.where.task_refresh, undefined);

  const shadowed = model("p.md", {
    type: "[[project]]",
    offclock: false,
    offclock_types: ["MEET", "CALL"],
  }, {
    sourceText: yaml({
      type: "\"[[project]]\"",
      offclock: false,
      offclock_types: ["MEET", "CALL"],
    }, "- [ ] #task #prj x ^prj\n"),
  });
  assert.equal(shadowed.chips.length, 1);
  assert.equal(shadowed.chips[0].settingKey, "offclock_types");
  assert.equal(shadowed.chips[0].warning, true);
  assert.match(shadowed.chips[0].tooltip, /offclock: false is ignored/);
  assert.equal(shadowed.where.offclock_types, "chip");
  assert.equal(shadowed.where.offclock, undefined);
});

test("live source policy beats stale cached frontmatter and never paints cache-only chips", () => {
  const source = yaml({ type: "\"[[project]]\"", task_type: "CODE" }, "- [ ] #task #prj x ^prj\n");
  const card = model("p.md", { type: "[[project]]", task_type: "BUILD" }, {
    sourceText: source,
    themeHue: () => "orange",
  });
  assert.equal(card.chips.length, 1);
  assert.equal(card.chips[0].text, "#CODE");
  assert.equal(card.chips.some((chip) => chip.text === "#BUILD"), false);

  const unclosed = model("p.md", { type: "[[project]]", task_type: "BUILD" }, {
    sourceText: "---\ntype: \"[[project]]\"\ntask_type: BUILD\n- [ ] #task #prj x ^prj\n",
  });
  assert.deepEqual(unclosed.chips, []);
  assert.equal(unclosed.where.task_type, undefined);
});

test("the top ancestor crumb pip uses the ancestor hue, not the leaf override", () => {
  const notes = {
    "leaf.md": { path: "leaf.md", kind: "project", parent: "[[dev]]", title: "leaf", hue: "blue" },
    "dev.md": { path: "dev.md", kind: "area", parent: "[[area]]", title: "dev", hue: "green" },
    "area.md": { path: "area.md", kind: "area", title: "area" },
  };
  const card = model("leaf.md", { type: "[[project]]", parent: "[[dev]]" }, {
    sourceText: yaml({ type: "\"[[project]]\"", parent: "\"[[dev]]\"" }, "- [ ] #task #prj x ^prj\n"),
    resolveParent: (target) => notes[`${String(target).replace(/\.md$/i, "")}.md`] || null,
    hue: "blue",
  });
  assert.deepEqual(card.crumbs.map((crumb) => crumb.text), ["dev"]);
  assert.equal(card.crumbs[0].pip, "green");
  assert.equal(card.hue, "blue");
});
