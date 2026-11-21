// Property-card identity kit (bob-cli-o6 identity-kit): title source ranges,
// recognizers, reveal-on-touch, the Live Preview reducer, deferred editor
// ownership, Reading tags, and the host opt-in.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = {
  none: [],
  widget: (options) => ({ ...options }),
  replace: (spec) => ({ spec, range(from, to) { return { from, to, value: this }; } }),
  set: (ranges) => ranges,
};
const EditorView = {
  decorations: { from: (field, get) => ({ facet: "decorations", field, get }) },
  editorAttributes: { of: (value) => value, from: (field, get) => ({ facet: "editorAttributes", field, get }) },
};
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, EditorView, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

const TODAY = "2026-11-20";
const OWNS = "bob-property-card-owns-title";
const SOURCE = "bob-property-card-title-source";

// ---- Fake DOM ----
class FakeText {
  constructor(text, doc) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = doc; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
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
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.childNodes.push(node); return node; }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const cls = part.match(/\.[\w-]+/g) || [];
      if (!tag && !cls.length) return false;
      return cls.every((name) => this.classList.contains(name.slice(1)));
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
  const observers = [];
  const doc = {
    observers,
    createElement(tag) { return new FakeNode(tag, doc); },
    createTextNode(text) { return new FakeText(text, doc); },
    defaultView: {
      MutationObserver: class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target, options) { this.target = target; this.options = options; this.connected = true; }
        disconnect() { this.connected = false; }
        trigger() { if (this.connected) this.callback([]); }
      },
    },
  };
  return doc;
}

function el(doc, tag, cls, ...kids) {
  const node = doc.createElement(tag);
  if (cls) node.setAttribute("class", cls);
  for (const kid of kids) node.appendChild(typeof kid === "string" ? doc.createTextNode(kid) : kid);
  return node;
}

function link(doc, target, text) {
  const node = el(doc, "a", "internal-link", text);
  node.setAttribute("data-href", target);
  return node;
}

// ---- Fake CodeMirror ----
function fakeDoc(text) {
  const lines = [];
  const separator = /\r\n|\r|\n/g;
  let cursor = 0;
  let match;
  while ((match = separator.exec(text))) {
    lines.push({ text: text.slice(cursor, match.index), from: cursor, to: match.index });
    cursor = match.index + match[0].length;
  }
  lines.push({ text: text.slice(cursor), from: cursor, to: text.length });
  return { lines: lines.length, length: text.length, line: (n) => ({ number: n, ...lines[n - 1] }) };
}

function fakeState({ text, cursor = 0, ranges, path = "eat.md", live = true, fields = new Map() }) {
  return {
    doc: fakeDoc(text),
    selection: { ranges: ranges || [{ from: cursor, to: cursor }] },
    field(field) {
      if (field === editorLivePreviewField) return live;
      if (field === editorInfoField) return { file: path === null ? null : { path } };
      return fields.has(field) ? fields.get(field) : undefined;
    },
  };
}

function tr(state, effects = [], docChanged = false) {
  return { effects, docChanged, state, startState: state };
}

const ALBUM = "---\ntype: \"[[album]]\"\nparent: \"[[body]]\"\n---\n# Restaurants\nRestaurants Kelly and I have tried.\n";

function daySubject(path = "2026/20261120.md") {
  return H.intentionCardSubjectForPath(path, TODAY);
}

test("album ranges: H1 line only after frontmatter, and every non-match is null", () => {
  const recognizer = H.propertyCardAlbumTitleRecognizer("  Restaurants ");
  assert.equal(recognizer.key, "album:Restaurants");
  const range = H.propertyCardTitleSourceRange(ALBUM, recognizer);
  const from = ALBUM.indexOf("# Restaurants");
  assert.deepEqual(range, {
    from, to: from + "# Restaurants".length, fromLine: 4, toLine: 4, headingLine: 4, title: "Restaurants", nextLine: 5,
  });
  const fm = "---\ntype: \"[[album]]\"\n---\n";
  assert.ok(H.propertyCardTitleSourceRange(`${fm}\n\n#   Restaurants  ##\n`, recognizer), "blank lines and a closing # run are fine");
  const nulls = {
    mismatch: `${fm}# Restaurant List\n`,
    proseBefore: `${fm}Intro line.\n# Restaurants\n`,
    fenced: `${fm}\`\`\`md\n# Restaurants\n\`\`\`\n`,
    late: `${fm}Intro\n\n## Section\n\n# Restaurants\n`,
    h2: `${fm}## Restaurants\n`,
    tag: `${fm}#Restaurants\n`,
    unterminated: "---\ntype: album\n# Restaurants\n",
    emptyBody: `${fm}\n\n`,
    empty: "",
  };
  for (const [name, text] of Object.entries(nulls)) {
    assert.equal(H.propertyCardTitleSourceRange(text, recognizer), null, name);
  }
  assert.equal(H.propertyCardTitleSourceRange(ALBUM, H.propertyCardAlbumTitleRecognizer("")), null);
  assert.equal(H.propertyCardTitleSourceRange(ALBUM, null), null);
});

test("album ranges keep exact offsets across a BOM, CRLF, and no frontmatter", () => {
  const recognizer = H.propertyCardAlbumTitleRecognizer("Restaurants");
  const crlf = "﻿---\r\ntitle: x\r\n...\r\n\r\n# Restaurants\r\nIntro\r\n";
  const range = H.propertyCardTitleSourceRange(crlf, recognizer);
  const from = crlf.indexOf("# Restaurants");
  assert.equal(range.from, from);
  assert.equal(range.to, from + "# Restaurants".length);
  assert.equal(range.headingLine, 4);
  const bare = "﻿# Restaurants\nIntro\n";
  const bareRange = H.propertyCardTitleSourceRange(bare, recognizer);
  assert.equal(bareRange.from, 0, "offsets count the BOM");
  assert.equal(bareRange.to, bare.indexOf("\n"));
  const cr = "---\rtitle: x\r---\r# [[eat|Restaurants]]\rIntro";
  const crRange = H.propertyCardTitleSourceRange(cr, recognizer);
  assert.equal(crRange.from, cr.indexOf("# "));
  assert.equal(crRange.title, "Restaurants");
});

test("album title ranges consume trailing blanks with exact newline offsets", () => {
  const recognizer = H.propertyCardAlbumTitleRecognizer("Restaurants");
  const cases = [
    { text: "# Restaurants\n\n\nBody\n", blank: 15, body: 16 },
    { text: "# Restaurants\r\n\r\nBody\r\n", blank: 15, body: 17 },
    { text: "# Restaurants\r\rBody\r", blank: 14, body: 15 },
    { text: "\uFEFF# Restaurants\n\nBody", blank: 15, body: 16 },
  ];
  for (const { text, blank, body } of cases) {
    const range = H.propertyCardTitleSourceRange(text, recognizer);
    assert.equal(range.from, 0);
    assert.equal(range.to, blank, JSON.stringify(text));
    assert.equal(H.propertyCardSelectionTouches({ ranges: [{ from: blank, to: blank }] }, range), true, "a consumed blank reveals the source");
    assert.equal(H.propertyCardSelectionTouches({ ranges: [{ from: body, to: body }] }, range), false, "the next content line stays outside");
  }
  const eof = "# Restaurants\n\n\n";
  assert.equal(H.propertyCardTitleSourceRange(eof, recognizer).to, eof.length, "trailing blank lines at EOF are consumed");
  const noFinalNewline = "# Restaurants";
  assert.equal(H.propertyCardTitleSourceRange(noFinalNewline, recognizer).to, noFinalNewline.length);
});

test("heading cleanup strips markers, escapes, wikilinks, and whitespace", () => {
  assert.equal(H.propertyCardCleanHeadingText("#   Restaurants   ##  "), "Restaurants");
  assert.equal(H.propertyCardCleanHeadingText("# C\\# notes \\#"), "C# notes #");
  assert.equal(H.propertyCardCleanHeadingText("# [[eat|Restaurants]] and [[body]]"), "Restaurants and body");
  assert.equal(H.propertyCardCleanHeadingText("  # a\t\tb  "), "a b");
});

test("day ranges: every H1 shape and alias, both nav forms, and trailing blanks", () => {
  const subject = daySubject();
  const recognizer = H.propertyCardDayTitleRecognizer(subject, { alias: ["Friday Nov 20"], today: TODAY });
  assert.equal(recognizer.key, "day:2026-11-20");
  const fm = "---\nintentions: []\n---\n";
  const threeNav = "[[2026/20261119|‹ Thu]] · [[2026-W47|W47]] · [[2026/20261121|Sat ›]]";
  const twoNav = "[[2026/20261119|prev]] · [[2026/20261121|next]]";
  for (const heading of ["# 2026-11-20 Fri", "# Day: 2026-11-20 Fri", "# day = 2026-11-20.Fri", "# DAY: 2026-11-20 FRI", "# Friday Nov 20"]) {
    for (const nav of [threeNav, twoNav]) {
      const text = `${fm}${heading}\n\n${nav}\n\n\nBody prose\n`;
      const range = H.propertyCardTitleSourceRange(text, recognizer);
      assert.ok(range, `${heading} / ${nav}`);
      assert.equal(range.from, text.indexOf(heading));
      assert.equal(range.to, text.indexOf("Body prose") - 1, "the trailing blanks are included and the body line stays outside");
      assert.equal(range.headingLine, 3);
      assert.equal(range.toLine, 7);
      assert.equal(range.nextLine, 8);
      const blank = text.indexOf(nav) + nav.length + 1;
      assert.equal(H.propertyCardSelectionTouches({ ranges: [{ from: blank, to: blank }] }, range), true);
      const body = text.indexOf("Body prose");
      assert.equal(H.propertyCardSelectionTouches({ ranges: [{ from: body, to: body }] }, range), false);
    }
  }
  const headingOnly = `${fm}# 2026-11-20 Fri\n\nday::2025-01-01 Wed\n`;
  const range = H.propertyCardTitleSourceRange(headingOnly, recognizer);
  assert.equal(range.toLine, 4, "the blank before a legacy body line is consumed, but the line is never absorbed");
  assert.ok(!headingOnly.slice(range.from, range.to).includes("day::"));
  assert.equal(H.propertyCardTitleSourceRange(`${fm}# 2026-11-21 Sat\n`, recognizer), null, "another date's shape");
  assert.equal(H.propertyCardTitleSourceRange(`${fm}# 2026-11-20 Thu\n`, recognizer), null, "wrong weekday");
  assert.equal(H.propertyCardTitleSourceRange(`${fm}day::2025-01-01 Wed\n${twoNav}\n`, recognizer), null, "H1-less 2025 shape");
  assert.equal(H.propertyCardTitleSourceRange(`${fm}${twoNav}\n\n# 2026-11-20 Fri\n`, recognizer), null, "H1-less nav-first shape");
  const shifted = `${fm}# 2026-11-20 Fri\n[[2026/20261118|prev]] · [[2026/20261121|next]]\n`;
  assert.equal(H.propertyCardTitleSourceRange(shifted, recognizer).toLine, 3, "a nav line for other days is not absorbed");
  const legacy = H.propertyCardDayTitleRecognizer(daySubject("2023/20230719.md"), { today: TODAY });
  assert.ok(H.propertyCardTitleSourceRange("# Day: 2023-07-19 Wed\n", legacy));
  const leap = H.propertyCardDayTitleRecognizer(daySubject("2024/20240101.md"), { today: TODAY });
  assert.ok(H.propertyCardTitleSourceRange("# day = 2024-01-01.Mon\n", leap));
});

test("period ranges: week, quarter, and year with alias, nav, and child links", () => {
  const week = H.intentionCardSubjectForPath("2026/2026-W47.md", TODAY);
  const weekRecognizer = H.propertyCardPeriodTitleRecognizer(week, { alias: "2026-W47 · Nov 16 – 22", today: TODAY });
  assert.equal(weekRecognizer.key, "week:2026-W47");
  assert.equal(H.propertyCardPeriodScaffoldTitle(week), "2026-W47 · Nov 16 – 22");
  const days = Array.from({ length: 7 }, (_, index) => `[[2026/202611${16 + index}]]`).join(" · ");
  const weekText = [
    "---", "aliases: [\"2026-W47 · Nov 16 – 22\"]", "---", "# 2026-W47 · Nov 16 – 22", "",
    "[[2026-W46|‹ W46]] · [[2026-Q4|↑ 2026-Q4]] · [[2026-W48|W48 ›]]", "", days, "", "## Days", "",
  ].join("\n");
  const weekRange = H.propertyCardTitleSourceRange(weekText, weekRecognizer);
  assert.equal(weekRange.headingLine, 3);
  assert.equal(weekRange.toLine, 8);
  const weekBody = weekText.indexOf("## Days");
  assert.equal(weekRange.to, weekBody - 1);
  assert.equal(H.propertyCardSelectionTouches({ ranges: [{ from: weekBody - 1, to: weekBody - 1 }] }, weekRange), true);
  assert.equal(H.propertyCardSelectionTouches({ ranges: [{ from: weekBody, to: weekBody }] }, weekRange), false);
  const scaffoldOnly = H.propertyCardPeriodTitleRecognizer(week, { today: TODAY });
  assert.ok(H.propertyCardTitleSourceRange(weekText, scaffoldOnly), "the scaffold title matches without an alias");

  const quarter = H.intentionCardSubjectForPath("2026/2026-Q4.md", TODAY);
  const quarterTitle = H.propertyCardPeriodScaffoldTitle(quarter);
  assert.equal(quarterTitle, "2026-Q4 · W40–W53 · Sep 28, 2026 – Jan 3, 2027");
  const weeks = Array.from({ length: 14 }, (_, index) => `[[2026-W${40 + index}]]`).join(" · ");
  const quarterText = `# ${quarterTitle}\n[[2026-Q3|‹ Q3]] · [[2026|↑ 2026]] · [[2027-Q1|Q1 ›]]\n${weeks}\nNotes\n`;
  const quarterRange = H.propertyCardTitleSourceRange(quarterText, H.propertyCardPeriodTitleRecognizer(quarter, { alias: quarterTitle, today: TODAY }));
  assert.equal(quarterRange.toLine, 2);

  const year = H.intentionCardSubjectForPath("2026.md", TODAY);
  const yearTitle = H.propertyCardPeriodScaffoldTitle(year);
  assert.equal(yearTitle, "2026 · Dec 29, 2025 – Jan 3, 2027 · 53 weeks");
  const quarters = ["Q1", "Q2", "Q3", "Q4"].map((q) => `[[2026-${q}]]`).join(" · ");
  const yearText = `---\nx: 1\n---\n# ${yearTitle}\n\n[[2025|‹ 2025]] · [[all_time|↑ All time]] · [[2027|2027 ›]]\n\n${quarters}\n`;
  const yearRecognizer = H.propertyCardPeriodTitleRecognizer(year, { alias: [yearTitle], today: TODAY });
  assert.equal(yearRecognizer.key, "year:2026");
  assert.equal(H.propertyCardTitleSourceRange(yearText, yearRecognizer).toLine, 8);
  const legacyYear = H.intentionCardSubjectForPath("2025.md", TODAY);
  const legacyText = "---\nx: 1\n---\n[[2024|‹ 2024]] · [[all_time|↑ All time]] · [[2026|2026 ›]]\n\nNotes\n";
  assert.equal(H.propertyCardTitleSourceRange(legacyText, H.propertyCardPeriodTitleRecognizer(legacyYear, { today: TODAY })), null);

  for (const missing of [null, daySubject(), { kind: "week" }]) {
    const never = H.propertyCardPeriodTitleRecognizer(missing, {});
    assert.ok(never.key.startsWith("never:"));
    assert.equal(H.propertyCardTitleSourceRange(weekText, never), null);
  }
  assert.ok(H.propertyCardDayTitleRecognizer(week, {}).key.startsWith("never:"));
});

test("heading-less recognizers start at an accepted follower line", () => {
  const recognizer = {
    key: "walk:x", requireHeading: false, heading: () => false,
    follower: (line) => /^\[\[.*\]\] · \[\[.*\]\]$/.test(line),
  };
  const text = "---\ntitle: Cranford\n---\n\n[[eat/a|‹ A]] · [[eat/b|B ›]]\n\nBody\n";
  const range = H.propertyCardTitleSourceRange(text, recognizer);
  assert.equal(range.headingLine, -1);
  assert.equal(range.title, "");
  assert.equal(range.fromLine, 4);
  assert.equal(range.toLine, 5);
  const blank = text.indexOf("\n\nBody") + 1;
  const body = text.indexOf("Body");
  assert.equal(H.propertyCardSelectionTouches({ ranges: [{ from: blank, to: blank }] }, range), true);
  assert.equal(H.propertyCardSelectionTouches({ ranges: [{ from: body, to: body }] }, range), false);
  assert.equal(H.propertyCardTitleSourceRange("Body\n[[a]] · [[b]]\n", recognizer), null);
  assert.equal(H.propertyCardTitleSourceRange(text, { ...recognizer, requireHeading: true }), null);
});

test("reveal boundaries follow the inclusive touch rule", () => {
  const range = H.propertyCardTitleSourceRange(ALBUM, H.propertyCardAlbumTitleRecognizer("Restaurants"));
  const at = (...positions) => ({ ranges: positions.map((pos) => (Array.isArray(pos) ? { from: pos[0], to: pos[1] } : { from: pos, to: pos })) });
  assert.equal(H.propertyCardSelectionTouches(at(range.from), range), true, "cursor at from");
  assert.equal(H.propertyCardSelectionTouches(at(range.to), range), true, "cursor at the end of the last line");
  assert.equal(H.propertyCardSelectionTouches(at(range.to + 1), range), false, "the line after");
  assert.equal(H.propertyCardSelectionTouches(at(range.from - 1), range), false, "end of frontmatter");
  assert.equal(H.propertyCardSelectionTouches(at(0), range), false, "cursor in frontmatter");
  assert.equal(H.propertyCardSelectionTouches(at(0, range.to + 5), range), false, "several selections, none touching");
  assert.equal(H.propertyCardSelectionTouches(at(0, range.from + 3, range.to + 5), range), true, "one of several selections touches");
  assert.equal(H.propertyCardSelectionTouches(at([0, ALBUM.length]), range), true, "a spanning selection");
  assert.equal(H.propertyCardSelectionTouches({ ranges: [{ anchor: range.to + 3, head: range.from + 1 }] }, range), true, "anchor/head");
  assert.equal(H.propertyCardSelectionTouches({ selection: at(range.from) }, range), true, "an EditorState");
  assert.equal(H.propertyCardSelectionTouches(at(range.from), null), false);
  assert.equal(H.propertyCardSelectionTouches(null, range), false);
});

test("reducer: own, stale release, Source mode, file change, doc change, and reveal", () => {
  const effect = H.propertyCardTitleEnsureEffect();
  assert.ok(effect);
  const recognizer = H.propertyCardAlbumTitleRecognizer("Restaurants");
  const own = (generation, path = "eat.md") => effect.of({ own: { path, generation, recognizer } });
  let value = H.propertyCardTitleFieldCreate();
  assert.deepEqual(value, { owner: null, range: null, revealed: false });
  assert.equal(H.propertyCardTitleFieldDecorations(value), Decoration.none);
  assert.equal(H.propertyCardTitleFieldAttributes(value), null);

  value = H.propertyCardTitleFieldReduce(value, tr(fakeState({ text: ALBUM }), [own(7)]));
  assert.equal(value.owner.generation, 7);
  assert.equal(value.range.from, ALBUM.indexOf("# Restaurants"));
  assert.equal(value.revealed, false, "a cursor in the frontmatter never reveals");
  const decorations = H.propertyCardTitleFieldDecorations(value);
  assert.equal(decorations.length, 1);
  assert.deepEqual([decorations[0].from, decorations[0].to], [value.range.from, value.range.to]);
  assert.deepEqual(decorations[0].value.spec, { block: true });
  assert.deepEqual(H.propertyCardTitleFieldAttributes(value), { class: OWNS });

  const same = H.propertyCardTitleFieldReduce(value, tr(fakeState({ text: ALBUM })));
  assert.equal(same, value, "an unrelated transaction keeps the value identity");
  const stale = H.propertyCardTitleFieldReduce(value, tr(fakeState({ text: ALBUM }), [effect.of({ release: 6 })]));
  assert.equal(stale.owner.generation, 7, "a stale generation's release is ignored");

  const revealed = H.propertyCardTitleFieldReduce(value, tr(fakeState({ text: ALBUM, cursor: value.range.from + 2 })));
  assert.equal(revealed.range, value.range, "selection-only changes keep the range");
  assert.equal(revealed.revealed, true);
  assert.equal(H.propertyCardTitleFieldDecorations(revealed), Decoration.none);
  assert.deepEqual(H.propertyCardTitleFieldAttributes(revealed), { class: OWNS }, "the card still owns the inline title");
  const hidden = H.propertyCardTitleFieldReduce(revealed, tr(fakeState({ text: ALBUM, cursor: value.range.to + 1 })));
  assert.equal(hidden.revealed, false);

  const edited = `---\ntype: x\n---\n\n\n# Restaurants\n`;
  const changed = H.propertyCardTitleFieldReduce(value, tr(fakeState({ text: edited }), [], true));
  assert.equal(changed.range.from, edited.indexOf("# Restaurants"), "a doc change recomputes the range");
  const broken = H.propertyCardTitleFieldReduce(value, tr(fakeState({ text: "Prose\n# Restaurants\n" }), [], true));
  assert.ok(broken.owner, "an unrecognized body keeps the owner");
  assert.equal(broken.range, null);
  assert.equal(H.propertyCardTitleFieldDecorations(broken), Decoration.none);
  assert.deepEqual(H.propertyCardTitleFieldAttributes(broken), { class: OWNS });

  const source = H.propertyCardTitleFieldReduce(value, tr(fakeState({ text: ALBUM, live: false })));
  assert.equal(source.owner, null, "Source mode drops the owner");
  assert.equal(H.propertyCardTitleFieldAttributes(source), null);
  const moved = H.propertyCardTitleFieldReduce(value, tr(fakeState({ text: ALBUM, path: "other.md" })));
  assert.equal(moved.owner, null, "a file change drops the owner");
  const released = H.propertyCardTitleFieldReduce(value, tr(fakeState({ text: ALBUM }), [effect.of({ release: 7 })]));
  assert.deepEqual(released, { owner: null, range: null, revealed: false });
  const otherFile = H.propertyCardTitleFieldReduce(H.propertyCardTitleFieldCreate(), tr(fakeState({ text: ALBUM, path: "b.md" }), [own(9, "a.md")]));
  assert.equal(otherFile.owner, null, "an own effect for another file never sticks");
});

test("the extension is one lazily defined StateField with decorations and attributes", () => {
  const field = H.propertyCardTitleOwnershipExtension();
  assert.equal(field.stateField, true);
  assert.equal(H.propertyCardTitleOwnershipExtension(), field, "defined once");
  const provided = field.spec.provide(field);
  assert.deepEqual(provided.map((item) => item.facet), ["decorations", "editorAttributes"]);
  assert.deepEqual(provided[1].get(H.propertyCardTitleFieldCreate()), {});
  assert.deepEqual(field.spec.create(), { owner: null, range: null, revealed: false });
});

function fakeView({ text = ALBUM, path = "eat.md", live = true, embed = false } = {}) {
  const doc = makeDoc();
  const dom = el(doc, "div", "cm-editor");
  if (embed) el(doc, "div", "markdown-embed").appendChild(dom);
  const field = H.propertyCardTitleOwnershipExtension();
  const fields = new Map([[field, H.propertyCardTitleFieldCreate()]]);
  const view = { dom, dispatched: [], live, path };
  const stateFor = () => fakeState({ text, path: view.path, live: view.live, fields });
  view.state = stateFor();
  view.dispatch = (spec) => {
    view.dispatched.push(spec);
    const next = stateFor();
    fields.set(field, H.propertyCardTitleFieldReduce(fields.get(field), tr(next, [].concat(spec.effects || []))));
    view.state = next;
  };
  view.reconfigure = () => { fields.set(field, H.propertyCardTitleFieldReduce(fields.get(field), tr(stateFor()))); view.state = stateFor(); };
  view.owner = () => fields.get(field).owner;
  return view;
}

function queue() {
  const jobs = [];
  const defer = (fn) => jobs.push(fn);
  defer.flush = () => { while (jobs.length) jobs.shift()(); };
  defer.size = () => jobs.length;
  return defer;
}

test("deferred editor ownership: async dispatch, idempotent keys, generations, releaseAll", () => {
  const defer = queue();
  const view = fakeView();
  const recognizer = H.propertyCardAlbumTitleRecognizer("Restaurants");
  const handle = H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer, defer });
  assert.equal(typeof handle, "function");
  assert.equal(view.dispatched.length, 0, "nothing dispatches synchronously");
  assert.equal(H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer, defer }), handle, "pending same key");
  defer.flush();
  assert.equal(view.dispatched.length, 1);
  assert.equal(view.owner().generation, handle.generation);
  assert.equal(H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants"), defer }), handle);
  defer.flush();
  assert.equal(view.dispatched.length, 1, "the same key dispatches once");

  const renamed = H.propertyCardAlbumTitleRecognizer("Eateries");
  const next = H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer: renamed, defer });
  assert.notEqual(next, handle);
  assert.ok(next.generation > handle.generation, "a new key gets a new generation");
  defer.flush();
  assert.equal(view.owner().generation, next.generation);
  assert.equal(view.owner().recognizer, renamed);
  const count = view.dispatched.length;
  handle();
  defer.flush();
  assert.equal(view.dispatched.length, count, "an old handle cannot release a newer owner");
  assert.equal(view.owner().generation, next.generation);

  view.live = false;
  view.reconfigure();
  assert.equal(view.owner(), null, "Source mode drops the field owner");
  assert.equal(H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer: renamed, defer }), null, "Source mode is denied");
  view.live = true;
  view.reconfigure();
  assert.equal(H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer: renamed, defer }), next, "the same handle returns");
  defer.flush();
  assert.equal(view.owner().generation, next.generation, "a dropped owner is re-dispatched");

  next();
  next();
  assert.equal(defer.size(), 1, "release is deferred and idempotent");
  defer.flush();
  assert.equal(view.owner(), null);

  const a = fakeView();
  const b = fakeView({ path: "b.md" });
  H.propertyCardOwnTitleInEditor(a, { path: "eat.md", recognizer, defer });
  H.propertyCardOwnTitleInEditor(b, { path: "b.md", recognizer, defer });
  defer.flush();
  assert.ok(a.owner() && b.owner());
  H.propertyCardTitleReleaseAll();
  defer.flush();
  assert.equal(a.owner(), null);
  assert.equal(b.owner(), null);
});

test("a field that drops the owner every transaction re-arms once", () => {
  const defer = queue();
  const view = fakeView();
  const recognizer = H.propertyCardAlbumTitleRecognizer("Restaurants");
  const orig = view.dispatch;
  view.dispatch = (spec) => {
    orig(spec);
    const saved = view.path;
    view.path = "other.md";
    view.reconfigure();
    view.path = saved;
  };
  const handle = H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer, defer });
  defer.flush();
  assert.equal(view.owner(), null, "the follow-up transaction drops the owner");
  assert.equal(view.dispatched.length, 1);
  assert.equal(H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer, defer }), handle);
  defer.flush();
  assert.equal(view.dispatched.length, 2, "a dropped owner re-arms once");
  assert.equal(H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer, defer }), handle);
  defer.flush();
  assert.equal(view.dispatched.length, 2, "a reducer that keeps dropping cannot microtask-loop");
});

test("a replaced owner released before its effect lands never strands the old range", () => {
  const defer = queue();
  const view = fakeView();
  const first = H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants"), defer });
  defer.flush();
  assert.equal(view.owner().generation, first.generation);
  const second = H.propertyCardOwnTitleInEditor(view, { path: "eat.md", recognizer: H.propertyCardAlbumTitleRecognizer("Eateries"), defer });
  second();
  defer.flush();
  assert.equal(view.owner(), null);
});

test("editor denial: embeds, missing views, missing recognizers, and missing fields", () => {
  const defer = queue();
  const recognizer = H.propertyCardAlbumTitleRecognizer("Restaurants");
  assert.equal(H.propertyCardOwnTitleInEditor(fakeView({ embed: true }), { path: "eat.md", recognizer, defer }), null);
  assert.equal(H.propertyCardOwnTitleInEditor(null, { path: "eat.md", recognizer, defer }), null);
  assert.equal(H.propertyCardOwnTitleInEditor(fakeView(), { path: "", recognizer, defer }), null);
  assert.equal(H.propertyCardOwnTitleInEditor(fakeView(), { path: "eat.md", defer }), null);
  const bare = fakeView();
  bare.state = { ...bare.state, field: (field) => (field === editorLivePreviewField ? true : undefined) };
  assert.equal(H.propertyCardOwnTitleInEditor(bare, { path: "eat.md", recognizer, defer }), null, "no kit field installed");
  assert.equal(defer.size(), 0);
  const doc = makeDoc();
  const canvas = el(doc, "div", "canvas-node");
  const scope = el(doc, "div", "cm-editor");
  canvas.appendChild(scope);
  assert.equal(H.propertyCardTitleScopeDenied(scope), true);
  const print = el(doc, "div", "print", el(doc, "div", "markdown-preview-view"));
  assert.equal(H.propertyCardTitleScopeDenied(print.children[0]), true);
  assert.equal(H.propertyCardTitleScopeDenied(el(doc, "div", "cm-editor")), false);
});

function readingFixture({ heading = "2026-11-20 Fri", nav = true, card = true, embed = false, extra = null } = {}) {
  const doc = makeDoc();
  const scope = el(doc, "div", "markdown-preview-view");
  const sizer = el(doc, "div", "markdown-preview-sizer");
  scope.appendChild(sizer);
  sizer.appendChild(el(doc, "div", "markdown-preview-pusher"));
  const header = el(doc, "div", "mod-header", el(doc, "div", "inline-title", "20261120"));
  sizer.appendChild(header);
  sizer.appendChild(el(doc, "div", "mod-frontmatter", el(doc, "pre", null, "intentions: []")));
  sizer.appendChild(el(doc, "div", "el-p"));
  const h1 = el(doc, "h1", null, heading);
  const h1Section = el(doc, "div", "el-h1", h1);
  let cardEl = null;
  if (card) {
    cardEl = el(doc, "div", "bob-property-card bob-intention-card", el(doc, "p", null, "card body"));
    h1Section.appendChild(cardEl);
  }
  sizer.appendChild(h1Section);
  let navP = null;
  if (nav) {
    navP = el(doc, "p", null,
      link(doc, "2026/20261119", "‹ Thu"), " · ", link(doc, "2026-W47", "W47"), " · ", link(doc, "2026/20261121", "Sat ›"));
    sizer.appendChild(el(doc, "div", "el-p", navP));
  }
  if (extra) sizer.appendChild(extra(doc));
  let embedP = null;
  if (embed) {
    embedP = el(doc, "p", null, link(doc, "2026/20261119", "prev"), " · ", link(doc, "2026/20261121", "next"));
    sizer.appendChild(el(doc, "div", "el-embed", el(doc, "div", "internal-embed markdown-embed", embedP)));
  }
  const prose = el(doc, "p", null, "Body prose");
  sizer.appendChild(el(doc, "div", "el-p", prose));
  return { doc, scope, sizer, header, h1, h1Section, card: cardEl, navP, embedP, prose };
}

const tagged = (node) => node.classList.contains(SOURCE);

test("Reading tags the h1 and nav p, never the section wrapper, a card, or embeds", () => {
  const recognizer = H.propertyCardDayTitleRecognizer(daySubject(), { today: TODAY });
  const fx = readingFixture({ embed: true });
  const handle = H.propertyCardOwnTitleInReading(fx.scope, { path: "2026/20261120.md", recognizer });
  assert.equal(typeof handle, "function");
  assert.ok(fx.scope.classList.contains(OWNS));
  assert.ok(tagged(fx.h1));
  assert.equal(fx.h1.getAttribute("data-bob-title-source"), "2026/20261120.md");
  assert.ok(tagged(fx.navP));
  assert.ok(!tagged(fx.h1Section), "the section hosting the card stays visible");
  assert.ok(!tagged(fx.card));
  assert.ok(!fx.card.querySelector(`.${SOURCE}`));
  assert.ok(!tagged(fx.embedP), "embed content is never tagged");
  assert.ok(!tagged(fx.prose));
  assert.equal(H.propertyCardReadingLineText(fx.navP), "[[2026/20261119|‹ Thu]] · [[2026-W47|W47]] · [[2026/20261121|Sat ›]]");

  handle();
  assert.ok(!fx.scope.classList.contains(OWNS));
  assert.ok(!tagged(fx.h1));
  assert.equal(fx.h1.getAttribute("data-bob-title-source"), null);
  assert.ok(!tagged(fx.navP));
  assert.equal(fx.doc.observers[0].connected, false, "release disconnects the observer");
});

test("Reading absorbs <br>-joined nav and child lines and stops at prose", () => {
  const week = H.intentionCardSubjectForPath("2026/2026-W47.md", TODAY);
  const title = H.propertyCardPeriodScaffoldTitle(week);
  const recognizer = H.propertyCardPeriodTitleRecognizer(week, { alias: title, today: TODAY });
  const joined = (doc) => {
    const p = el(doc, "p", null, link(doc, "2026-W46", "‹ W46"), " · ", link(doc, "2026-Q4", "↑ 2026-Q4"), " · ", link(doc, "2026-W48", "W48 ›"));
    p.appendChild(el(doc, "br"));
    p.appendChild(doc.createTextNode("\n"));
    for (let day = 16; day <= 22; day += 1) {
      if (day > 16) p.appendChild(doc.createTextNode(" · "));
      p.appendChild(link(doc, `2026/202611${day}`, `2026/202611${day}`));
    }
    return el(doc, "div", "el-p", p);
  };
  const fx = readingFixture({ heading: title, nav: false, card: false, extra: joined });
  H.propertyCardOwnTitleInReading(fx.scope, { path: "2026/2026-W47.md", recognizer });
  const joinedP = fx.sizer.children[5].children[0];
  assert.ok(tagged(fx.h1));
  assert.ok(tagged(joinedP));
  assert.ok(!tagged(fx.prose));

  const mixed = (doc) => el(doc, "div", "el-p", el(doc, "p", null, link(doc, "2026-W46", "‹ W46"), el(doc, "br"), "Read this first"));
  const fx2 = readingFixture({ heading: title, nav: false, card: false, extra: mixed });
  H.propertyCardOwnTitleInReading(fx2.scope, { path: "2026/2026-W47.md", recognizer });
  assert.ok(tagged(fx2.h1));
  assert.ok(!tagged(fx2.sizer.children[5].children[0]), "a paragraph with any unaccepted line stays visible");
});

test("Reading ignores unrecognized or late headings and denied scopes", () => {
  const recognizer = H.propertyCardDayTitleRecognizer(daySubject(), { today: TODAY });
  const other = readingFixture({ heading: "Something else" });
  assert.equal(typeof H.propertyCardOwnTitleInReading(other.scope, { path: "2026/20261120.md", recognizer }), "function");
  assert.ok(!tagged(other.h1));
  assert.ok(!tagged(other.navP), "followers need a recognized start");
  assert.ok(other.scope.classList.contains(OWNS), "the card still owns the inline title");

  const late = readingFixture({ extra: null });
  late.sizer.childNodes.splice(late.sizer.childNodes.indexOf(late.h1Section), 0, el(late.doc, "div", "el-p", el(late.doc, "p", null, "Intro")));
  H.propertyCardOwnTitleInReading(late.scope, { path: "2026/20261120.md", recognizer });
  assert.ok(!tagged(late.h1), "an H1 after prose stays visible");

  const doc = makeDoc();
  const embed = el(doc, "div", "markdown-embed", el(doc, "div", "markdown-preview-view"));
  assert.equal(H.propertyCardOwnTitleInReading(embed.children[0], { path: "x.md", recognizer }), null);
  assert.equal(H.propertyCardOwnTitleInReading(el(doc, "div", "cm-editor"), { path: "x.md", recognizer }), null);
  assert.equal(H.propertyCardOwnTitleInReading(late.scope, { path: "", recognizer }), null);
});

test("Reading re-tags late sections and keeps generations safe", () => {
  const recognizer = H.propertyCardDayTitleRecognizer(daySubject(), { today: TODAY });
  const fx = readingFixture({ nav: false });
  const first = H.propertyCardOwnTitleInReading(fx.scope, { path: "2026/20261120.md", recognizer });
  assert.ok(tagged(fx.h1));
  const navP = el(fx.doc, "p", null, link(fx.doc, "2026/20261119", "prev"), " · ", link(fx.doc, "2026/20261121", "next"));
  fx.sizer.childNodes.splice(fx.sizer.childNodes.indexOf(fx.h1Section) + 1, 0, el(fx.doc, "div", "el-p", navP));
  navP.parentNode.parentNode = fx.sizer;
  assert.ok(!tagged(navP));
  const observer = fx.doc.observers[0];
  assert.equal(observer.target, fx.scope);
  assert.deepEqual(observer.options, { childList: true, subtree: true });
  observer.trigger();
  assert.ok(tagged(navP), "a lazily rendered section is re-tagged");

  const second = H.propertyCardOwnTitleInReading(fx.scope, { path: "2026/20261120.md", recognizer });
  assert.ok(second.generation > first.generation);
  assert.equal(observer.connected, false, "a newer owner replaces the old observer");
  first();
  assert.ok(fx.scope.classList.contains(OWNS), "an old handle never clears a newer owner");
  assert.ok(tagged(fx.h1));
  observer.trigger();
  assert.ok(tagged(navP));

  H.propertyCardTitleReleaseAll();
  assert.ok(!fx.scope.classList.contains(OWNS));
  assert.ok(!tagged(fx.h1));
  assert.ok(!tagged(navP));
  second();
  assert.ok(!fx.scope.classList.contains(OWNS));
});

test("propertyCardOwnTitle dispatches by scope", () => {
  const defer = queue();
  const recognizer = H.propertyCardAlbumTitleRecognizer("Restaurants");
  const view = fakeView();
  const handle = H.propertyCardOwnTitle(view.dom, { path: "eat.md", recognizer, view, defer });
  assert.equal(typeof handle, "function");
  defer.flush();
  assert.equal(view.owner().generation, handle.generation);
  assert.equal(H.propertyCardOwnTitle(view.dom, { path: "eat.md", recognizer }), null, "an editor scope needs its view");
  const other = fakeView();
  assert.equal(H.propertyCardOwnTitle(other.dom, { path: "eat.md", recognizer, view, defer }), null, "the view must own the scope");
  const fx = readingFixture({ heading: "Restaurants", nav: false, card: false });
  assert.equal(typeof H.propertyCardOwnTitle(fx.scope, { path: "eat.md", recognizer }), "function");
  assert.ok(tagged(fx.h1));
  assert.equal(H.propertyCardOwnTitle(makeDoc().createElement("div"), { path: "eat.md", recognizer }), null);
  H.propertyCardTitleReleaseAll();
  defer.flush();
});

function hostFor(plugin, kind, extra = {}) {
  return H.createPropertyCardHost({
    plugin, kind,
    fields: {
      active: `${kind}Active`, reading: `${kind}Reading`, readingPending: `${kind}Pending`,
      readingTimers: `${kind}Timers`, editors: `${kind}Editors`, editorScopes: `${kind}Scopes`,
      refreshTimer: `${kind}Refresh`,
    },
    setTimeout: () => 0, clearTimeout: () => {},
    buildDecorations: () => [],
    ...extra,
  });
}

test("host opt-in registers the title field once per plugin; others register nothing new", () => {
  const plugin = new TestPlugin({ workspace: { getLeavesOfType: () => [], on: () => ({}) } });
  const field = H.propertyCardTitleOwnershipExtension();
  const album = hostFor(plugin, "albumProbe", { titleOwnership: true });
  const day = hostFor(plugin, "dayProbe", { titleOwnership: true });
  album.setup();
  day.setup();
  album.setup();
  assert.equal(album.titleOwnership, true);
  assert.equal(plugin.extensions.filter((item) => item === field).length, 1);

  const plain = new TestPlugin({ workspace: { getLeavesOfType: () => [], on: () => ({}) } });
  const bank = hostFor(plain, "bankProbe");
  bank.setup();
  assert.equal(bank.titleOwnership, false);
  assert.equal((plain.extensions || []).filter((item) => item === field).length, 0);
  assert.equal(plain._propertyCardTitleOwnershipRegistered, undefined);

  const fx = readingFixture({ heading: "Restaurants", nav: false, card: false });
  H.propertyCardOwnTitleInReading(fx.scope, { path: "eat.md", recognizer: H.propertyCardAlbumTitleRecognizer("Restaurants") });
  bank.dispose();
  assert.ok(fx.scope.classList.contains(OWNS), "a host without the option leaves title ownership alone");
  album.dispose();
  assert.ok(!fx.scope.classList.contains(OWNS), "an opted-in host's dispose releases every title");
});
