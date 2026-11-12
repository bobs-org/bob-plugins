// Gmail open hint: GO vectors from bob-cli `docs/mail-link-marks.md`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _hintField: "info" };
const editorLivePreviewField = { _hintField: "live" };

class StubWidgetType {}
class StubRangeSetBuilder {
  constructor() { this.adds = []; }
  add(from, to, value) { this.adds.push({ from, to, value }); }
  finish() { return { adds: this.adds.slice() }; }
}
const StubDecoration = {
  none: { none: true },
  widget: (spec) => ({ ...spec, widgetDecoration: true }),
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
  applyMarkGateClass() {}
  registerMarkGatePopoutSync() {}
}
class TestNotice {
  constructor(message) { TestNotice.messages.push(String(message)); }
}
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadHintStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: TestNotice,
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
const LINK = "[[mail/2026/261107_lease_renewal|✉️ Lease renewal · Ada]]";
const GMAIL_URL = "https://mail.google.com/mail/u/0/#all/abcdef";
const MAIL_FACTS = Object.freeze({ type: "[[mail]]", gmail_url: GMAIL_URL });

function fakeEl(tag) {
  const attrs = {};
  return {
    tagName: String(tag).toUpperCase(),
    textContent: "",
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
}
function fakeDoc() {
  return { createElement: (tag) => fakeEl(tag) };
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
    toString() { return text; },
    lineAt(pos) {
      let index = 0;
      while (index + 1 < starts.length && starts[index + 1] <= pos) index += 1;
      const from = starts[index];
      const lineText = lines[index];
      return { from, to: from + lineText.length, text: lineText, number: index + 1 };
    },
  };
}
function makeView(text, cursorLine, live = true) {
  const doc = docFromText(text);
  const lines = text.split("\n");
  let head = 0;
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (index === cursorLine) { head = offset; break; }
    offset += lines[index].length + 1;
  }
  return {
    visibleRanges: [{ from: 0, to: text.length }],
    state: {
      doc,
      selection: { main: { head } },
      field(field) {
        if (field === editorLivePreviewField) return live;
        if (field === editorInfoField) return { file: { path: "Projects/Example.md" } };
        return null;
      },
    },
  };
}
function resolversFor(frontmatter) {
  return {
    getDest: (target) => (String(target).replace(/\.md$/i, "") === "mail/2026/261107_lease_renewal"
      ? { path: "mail/2026/261107_lease_renewal.md" }
      : null),
    getFrontmatter: () => frontmatter,
  };
}
function addsLength(decorations) {
  return decorations && Array.isArray(decorations.adds) ? decorations.adds.length : 0;
}
function pluginWithHint() {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.mailLinkMarksEnabled = true;
  plugin.app = {
    metadataCache: {
      getFirstLinkpathDest: (target, source) => (String(target).replace(/\.md$/i, "") === "mail/2026/261107_lease_renewal"
        ? { path: "mail/2026/261107_lease_renewal.md" }
        : null),
      getFileCache: () => ({ frontmatter: MAIL_FACTS }),
    },
    plugins: { plugins: { "bob-mail": { mailGmailOpenKeymap: 1 } } },
  };
  return plugin;
}

test("GO1 line-borne task row shows the chip on the cursor line", () => {
  assert.equal(h.gmailOpenHintCanOpen(`- [ ] #task ${LINK}`, [`- [ ] #task ${LINK}`], 0, "Projects/Example.md", resolversFor(MAIL_FACTS)), true);
  const plugin = pluginWithHint();
  const decorations = plugin.buildGmailOpenHintDecorations(makeView(`- [ ] #task ${LINK}`, 0));
  assert.equal(addsLength(decorations), 1);
  const line = `- [ ] #task ${LINK}`;
  assert.equal(decorations.adds[0].from, line.length);
  assert.equal(decorations.adds[0].to, line.length);
  assert.equal(decorations.adds[0].value.side, 1);
});

test("GO2 cursor on another line shows nothing", () => {
  const text = `- [ ] #task ${LINK}\nplain line`;
  const plugin = pluginWithHint();
  const decorations = plugin.buildGmailOpenHintDecorations(makeView(text, 1));
  assert.equal(addsLength(decorations), 0);
});

test("GO3 child hop works from the task row and the child row", () => {
  const parent = "- [ ] #task Follow up";
  const child = `  - ${LINK}`;
  const lines = [parent, child];
  assert.equal(h.gmailOpenHintCanOpen(parent, lines, 0, "Projects/Example.md", resolversFor(MAIL_FACTS)), true);
  assert.equal(h.gmailOpenHintCanOpen(child, lines, 1, "Projects/Example.md", resolversFor(MAIL_FACTS)), true);
  const plugin = pluginWithHint();
  assert.equal(addsLength(plugin.buildGmailOpenHintDecorations(makeView(lines.join("\n"), 0))), 1);
  assert.equal(addsLength(plugin.buildGmailOpenHintDecorations(makeView(lines.join("\n"), 1))), 1);
});

test("GO4 plain log bullet with a mail link shows the chip", () => {
  const line = `Noted ${LINK} in passing`;
  assert.equal(h.gmailOpenHintCanOpen(line, [line], 0, "Projects/Example.md", resolversFor(MAIL_FACTS)), true);
  const plugin = pluginWithHint();
  assert.equal(addsLength(plugin.buildGmailOpenHintDecorations(makeView(line, 0))), 1);
});

test("GO5 inline and fenced code never show the chip", () => {
  const inline = `- [ ] #task \`[[mail/2026/261107_lease_renewal]]\``;
  assert.equal(h.gmailOpenHintCanOpen(inline, [inline], 0, "Projects/Example.md", resolversFor(MAIL_FACTS)), false);
  const plugin = pluginWithHint();
  assert.equal(addsLength(plugin.buildGmailOpenHintDecorations(makeView(inline, 0))), 0);
});

test("GO6 missing gmail_url shows nothing", () => {
  const line = `- [ ] #task ${LINK}`;
  assert.equal(h.gmailOpenHintCanOpen(line, [line], 0, "Projects/Example.md", resolversFor({ type: "[[mail]]" })), false);
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.mailLinkMarksEnabled = true;
  plugin.app = {
    metadataCache: {
      getFirstLinkpathDest: () => ({ path: "mail/2026/261107_lease_renewal.md" }),
      getFileCache: () => ({ frontmatter: { type: "[[mail]]" } }),
    },
    plugins: { plugins: { "bob-mail": { mailGmailOpenKeymap: 1 } } },
  };
  assert.equal(addsLength(plugin.buildGmailOpenHintDecorations(makeView(line, 0))), 0);
});

test("GO7 disabled bob-mail or missing capability shows nothing", () => {
  const line = `- [ ] #task ${LINK}`;
  const noFlag = pluginWithHint();
  noFlag.app.plugins.plugins["bob-mail"] = {};
  assert.equal(noFlag.buildGmailOpenHintDecorations(makeView(line, 0)), StubDecoration.none);

  const noPlugin = pluginWithHint();
  noPlugin.app.plugins.plugins = {};
  assert.equal(noPlugin.buildGmailOpenHintDecorations(makeView(line, 0)), StubDecoration.none);
});

test("GO8 gate off shows nothing", () => {
  const plugin = pluginWithHint();
  plugin.mailLinkMarksEnabled = false;
  assert.equal(plugin.buildGmailOpenHintDecorations(makeView(`- [ ] #task ${LINK}`, 0)), StubDecoration.none);
});

test("GO9 closed rows still show the chip", () => {
  const line = `- [x] #task ${LINK}`;
  assert.equal(h.gmailOpenHintCanOpen(line, [line], 0, "Projects/Example.md", resolversFor(MAIL_FACTS)), true);
  const plugin = pluginWithHint();
  assert.equal(addsLength(plugin.buildGmailOpenHintDecorations(makeView(line, 0))), 1);
});

test("GO10 plain lines without a mail link show nothing", () => {
  assert.equal(h.gmailOpenHintCanOpen("body text", ["body text"], 0, "mail/2026/261107_lease_renewal.md", resolversFor(MAIL_FACTS)), false);
  const plugin = pluginWithHint();
  assert.equal(addsLength(plugin.buildGmailOpenHintDecorations(makeView("body text", 0))), 0);
});

test("GO11 reading view shows nothing", () => {
  const plugin = pluginWithHint();
  assert.equal(plugin.buildGmailOpenHintDecorations(makeView(`- [ ] #task ${LINK}`, 0, false)), StubDecoration.none);
});

test("hint host is listener-free with the Gmail aria label", () => {
  const host = h.buildGmailOpenHintElement(fakeDoc(), "⌘↵ Gmail");
  assert.equal(host.getAttribute("class"), "bob-gmail-open-hint");
  assert.equal(host.getAttribute("role"), "img");
  assert.equal(host.getAttribute("aria-label"), "Cmd+Enter opens this email in Gmail");
  assert.equal(host.getAttribute("data-tooltip-position"), "top");
  assert.equal(host.getAttribute("title"), null);
  assert.equal(host.textContent, "⌘↵ Gmail");
  assert.equal(h.GMAIL_OPEN_HINT_SIDE, 1);
  assert.equal(h.gmailOpenHintLabel(true), "⌘↵ Gmail");
  assert.equal(h.gmailOpenHintLabel(false), "M-↵ Gmail");
});

test("styles.css contract: muted capsule, quiet ink, toggle hide", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  assert.ok(css.indexOf("body.bob-mail-link-marks .bob-gmail-open-hint") !== -1);
  assert.ok(css.indexOf("body:not(.bob-mail-link-marks) .bob-gmail-open-hint") !== -1);
  const block = css.slice(css.indexOf("body.bob-mail-link-marks .bob-gmail-open-hint"));
  const rules = block.slice(0, block.indexOf("}") + 1);
  assert.ok(rules.indexOf("font-size: 0.8em") !== -1);
  assert.ok(rules.indexOf("margin-inline-start: 0.35em") !== -1);
  assert.ok(rules.indexOf("user-select: none") !== -1);
  assert.ok(rules.indexOf("border-radius: 999px") !== -1);
  assert.ok(rules.indexOf("color-mix(in srgb, var(--text-muted) 12%, transparent)") !== -1);
});
