// No-reply pill: NR vectors from bob-cli `docs/mail-link-marks.md`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _noReplyField: "info" };
const editorLivePreviewField = { _noReplyField: "live" };

class StubWidgetType {}
class StubRangeSetBuilder {
  constructor() { this.adds = []; }
  add(from, to, value) { this.adds.push({ from, to, value }); }
  finish() { return { adds: this.adds.slice() }; }
}
const StubDecoration = {
  none: { none: true },
  replace: (spec) => ({ ...spec, replaceDecoration: true }),
};
const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => ({ value, is: (other) => other === type });
    return type;
  },
};
const StubViewPlugin = { fromClass: (cls, options) => ({ cls, options }) };
class FakePlugin {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension(extension) { (this.editorExtensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, sortOrder) { (this.postProcessors ||= []).push({ handler, sortOrder }); }
  registerEvent(event) { (this.registeredEvents ||= []).push(event); }
  register(callback) { (this.cleanups ||= []).push(callback); }
}

const originalLoad = Module._load;
Module._load = function loadNoReplyStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: class {},
      Plugin: FakePlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
      editorInfoField,
      editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: StubStateEffect,
      RangeSetBuilder: StubRangeSetBuilder,
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
      ViewPlugin: StubViewPlugin,
      Decoration: StubDecoration,
      WidgetType: StubWidgetType,
    };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const h = LedgerToolsPlugin.helpers;

const TODAY = "2026-11-07";
const LINK = "[[mail/2026/261107_lease_renewal|✉️ Lease renewal · Ada]]";
const NR1_LINE = `- [ ] #task #awaiting_reply ${LINK} [scheduled:: 2026-11-07]`;

function fakeEl(tag, extras = {}) {
  const attrs = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    textContent: extras.textContent || "",
    className: extras.className || "",
    classList: {
      add(name) {
        const parts = el.className.split(/\s+/).filter(Boolean);
        if (!parts.includes(name)) parts.push(name);
        el.className = parts.join(" ");
      },
      remove(name) {
        el.className = el.className.split(/\s+/).filter((part) => part && part !== name).join(" ");
      },
      contains(name) {
        return el.className.split(/\s+/).includes(name);
      },
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    removeAttribute(name) { delete attrs[name]; },
    closest(sel) { return sel === "li" ? extras.li || el : null; },
  };
  return el;
}

function docFromText(text) {
  const lines = text.split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return {
    length: text.length,
    lineAt(pos) {
      let index = 0;
      while (index + 1 < starts.length && starts[index + 1] <= pos) index += 1;
      const from = starts[index];
      const lineText = lines[index];
      return { from, to: from + lineText.length, text: lineText };
    },
  };
}

function makeView(text) {
  const doc = docFromText(text);
  return {
    visibleRanges: [{ from: 0, to: text.length }],
    state: {
      doc,
      selection: { ranges: [] },
      field(field) {
        if (field === editorLivePreviewField) return true;
        if (field === editorInfoField) return { file: { path: "Projects/Example.md" } };
        return null;
      },
    },
  };
}

test("NR1–NR7: no-reply pill model vectors pass verbatim", () => {
  assert.equal(
    h.noReplyPillModel(NR1_LINE, { today: TODAY, turnSince: "2026-11-04T09:00" }).text,
    "✈ no reply since Wed, Nov 4",
    "NR1",
  );
  assert.equal(
    h.noReplyPillModel(NR1_LINE, { today: TODAY, turnSince: "" }).text,
    "✈ no reply yet",
    "NR2",
  );
  assert.equal(
    h.noReplyPillModel(
      `- [?] #task #awaiting_reply ${LINK} [scheduled:: 2026-11-10]`,
      { today: TODAY, turnSince: "2026-11-04T09:00" },
    ),
    null,
    "NR3",
  );
  assert.equal(
    h.noReplyPillModel(`- [ ] #task ${LINK} [scheduled:: 2026-11-05]`, { today: TODAY }),
    null,
    "NR4",
  );
  assert.equal(
    h.noReplyPillModel(
      `- [ ] #task #awaiting_reply ${LINK} [scheduled:: 2026-11-10]`,
      { today: TODAY, turnSince: "2026-11-04T09:00" },
    ),
    null,
    "NR5",
  );
  assert.equal(
    h.noReplyPillModel(
      `- [x] #task #awaiting_reply ${LINK} [scheduled:: 2026-11-05]`,
      { today: TODAY, turnSince: "2026-11-04T09:00" },
    ),
    null,
    "NR6",
  );
  assert.equal(
    h.noReplyPillModel(
      `- [ ] #task #awaiting_reply_old ${LINK} [scheduled:: 2026-11-05]`,
      { today: TODAY, turnSince: "2026-11-04T09:00" },
    ),
    null,
    "NR7",
  );
});

test("no-reply pill replaces the exact #awaiting_reply span", () => {
  const model = h.noReplyPillModel(NR1_LINE, { today: TODAY, turnSince: "2026-11-04T09:00" });
  assert.equal(NR1_LINE.slice(model.from, model.to), "#awaiting_reply");
  const host = h.buildNoReplyPillElement(
    { createElement: (tag) => fakeEl(tag) },
    model,
  );
  assert.equal(host.getAttribute("class"), "bob-no-reply-pill");
  assert.equal(host.getAttribute("role"), "img");
  assert.equal(host.textContent, model.text);
  assert.equal(host.getAttribute("title"), null);
  const anchor = fakeEl("a", { textContent: "#awaiting_reply" });
  assert.equal(h.isNoReplyTagAnchor(anchor), true);
  assert.equal(h.annotateNoReplyPill(anchor, model), true);
  assert.ok(anchor.classList.contains("bob-no-reply-pill"));
  assert.equal(anchor.getAttribute("data-bob-no-reply"), model.text);
  assert.equal(h.stripNoReplyPill(anchor), true);
  assert.equal(anchor.classList.contains("bob-no-reply-pill"), false);
});

test("NR1 Live Preview replace widget covers the tag; NR8 toggle off is empty", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.taskTagMarksEnabled = true;
  plugin.dateMarksToday = () => TODAY;
  plugin.mailNoteFacts = () => ({ turnSince: "2026-11-04T09:00" });
  const decorations = plugin.buildNoReplyPillDecorations(makeView(NR1_LINE));
  assert.equal(decorations.adds.length, 1);
  assert.equal(decorations.adds[0].from, NR1_LINE.indexOf("#awaiting_reply"));
  assert.equal(decorations.adds[0].to, NR1_LINE.indexOf("#awaiting_reply") + "#awaiting_reply".length);
  assert.equal(decorations.adds[0].value.replaceDecoration, true);
  plugin.taskTagMarksEnabled = false;
  assert.equal(plugin.buildNoReplyPillDecorations(makeView(NR1_LINE)), StubDecoration.none);
});

test("Tasks query rows keep the native #awaiting_reply pill", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.taskTagMarksEnabled = true;
  plugin.dateMarksToday = () => TODAY;
  plugin.mailNoteFacts = () => ({ turnSince: "2026-11-04T09:00" });
  const li = { className: "plugin-tasks-list-item" };
  const desc = { className: "task-description", parentNode: li };
  const anchor = fakeEl("a", { textContent: "#awaiting_reply" });
  anchor.parentNode = desc;
  desc.parentNode = li;
  li.parentNode = null;
  plugin.renderNoReplyPillsIn(
    {
      querySelectorAll: () => [anchor],
    },
    { sourcePath: "Projects/Example.md", getSectionInfo: () => ({ text: NR1_LINE }) },
  );
  assert.equal(anchor.getAttribute("data-bob-no-reply"), null);
});

test("styles.css contract: muted capsule under task-tag-marks", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  assert.ok(css.indexOf("body.bob-task-tag-marks .bob-no-reply-pill") !== -1);
  assert.ok(css.indexOf("body.bob-task-tag-marks a.tag.bob-no-reply-pill") !== -1);
  assert.ok(css.indexOf("content: attr(data-bob-no-reply)") !== -1);
  const start = css.indexOf("body.bob-task-tag-marks .bob-no-reply-pill {");
  const block = css.slice(start, css.indexOf("}", start) + 1);
  assert.ok(block.indexOf("font-size: 0.8em") !== -1);
  assert.ok(block.indexOf("border-radius: 999px") !== -1);
  assert.ok(block.indexOf("padding: 0.05em 0.45em") !== -1);
  assert.ok(block.indexOf("color-mix(in srgb, var(--text-muted) 12%, transparent)") !== -1);
});
