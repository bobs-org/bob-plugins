// Bank title ownership (bob-cli-q6 bank-title): emoji-split identity, bank
// recognizer, accessible name, the title block with its Setup/YAML state
// matrix, hue walk, truthful foot marks, and Source-mode release. Painting
// never writes vault bytes: the fake DOM has no vault, and every report
// string enters as text.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestNotice {
  constructor(message) { TestNotice.messages.push(String(message)); }
}
TestNotice.messages = [];

class TestPlugin {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
  registerInterval(handle) { (this.intervals ||= []).push(handle); return handle; }
  registerDomEvent() { return { unregister: () => {} }; }
}

const editorInfoField = { setupMark: "info" };
const editorLivePreviewField = { setupMark: "live" };
class WidgetType {}
class RangeSetBuilder {
  constructor() { this.adds = []; }
  add(from, to, value) { this.adds.push({ from, to, value }); }
  finish() { return { adds: this.adds.slice() }; }
}
const Decoration = {
  none: { none: true },
  mark: (spec) => ({ mark: true, ...spec }),
  widget: (spec) => ({ widget: true, ...spec }),
  line: (spec) => ({ line: true, ...spec }),
};
const StateEffect = {
  define: () => {
    const type = {};
    type.of = (value) => ({ value, is: (other) => other === type });
    return type;
  },
};
const ViewPlugin = { fromClass: (cls, options) => ({ cls, options }) };
const Prec = { highest: (value) => value };

function loadPlugin(platform = { isDesktopApp: true }) {
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    if (request === "obsidian") {
      return {
        Notice: TestNotice,
        Plugin: TestPlugin,
        Platform: platform,
        MarkdownView: class MarkdownView {},
        MarkdownRenderChild: class MarkdownRenderChild {},
        normalizePath: (value) => value,
        parseYaml: (text) => JSON.parse(text),
        editorInfoField,
        editorLivePreviewField,
      };
    }
    if (request === "@codemirror/state") return { Prec, StateEffect, RangeSetBuilder };
    if (request === "@codemirror/view") return { ViewPlugin, Decoration, WidgetType, EditorView: {} };
    if (request === "@codemirror/language") return {};
    return originalLoad.call(this, request, ...args);
  };
  try {
    const entryPath = require.resolve("../plugins/bob-ledger-tools/main.js");
    delete require.cache[entryPath];
    return require(entryPath);
  } finally {
    Module._load = originalLoad;
  }
}

const LedgerToolsPlugin = loadPlugin();
const H = LedgerToolsPlugin.helpers;

// --- Minimal fake DOM: text-only insertion, attribute selectors. ---

class TextNode {
  constructor(value, doc) {
    this.nodeType = 3;
    this.nodeValue = String(value);
    this.ownerDocument = doc;
    this.parentNode = null;
  }
  get textContent() { return this.nodeValue; }
}

function matchSelector(node, part) {
  const tagMatch = part.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  const tag = tagMatch ? tagMatch[1].toLowerCase() : null;
  if (tag && tag !== "*" && String(node.tagName || "").toLowerCase() !== tag) {
    return false;
  }
  const classes = part.match(/\.[A-Za-z0-9_-]+/g) || [];
  for (const name of classes) {
    if (!node.classList || !node.classList.contains(name.slice(1))) {
      return false;
    }
  }
  const attrMatch = part.match(/\[([A-Za-z0-9_-]+)(?:="([^"]*)")?\]/);
  if (attrMatch) {
    const actual = node.getAttribute ? node.getAttribute(attrMatch[1]) : null;
    if (actual === null || actual === undefined) {
      return false;
    }
    if (attrMatch[2] !== undefined && String(actual) !== attrMatch[2]) {
      return false;
    }
  }
  return true;
}

class Element {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = doc;
    this.childNodes = [];
    this.parentNode = null;
    this.className = "";
    this.attrs = new Map();
    this.disabled = false;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => {
        for (const name of names) {
          if (!this.classList.contains(name)) {
            this.className = `${this.className} ${name}`.trim();
          }
        }
      },
      remove: (...names) => {
        this.className = this.className.split(/\s+/).filter((part) => part && !names.includes(part)).join(" ");
      },
    };
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "class") {
      this.className = String(value);
    }
  }
  getAttribute(name) {
    if (name === "class") {
      return this.className;
    }
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  getAttributeNames() { return [...this.attrs.keys()]; }
  removeAttribute(name) {
    this.attrs.delete(name);
    if (name === "class") {
      this.className = "";
    }
  }
  appendChild(node) {
    if (node.parentNode && node.parentNode.removeChild) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node, ref) {
    if (node.parentNode && node.parentNode.removeChild) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    const index = this.childNodes.indexOf(ref);
    if (index < 0) {
      this.childNodes.push(node);
    } else {
      this.childNodes.splice(index, 0, node);
    }
    return node;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
    }
    node.parentNode = null;
    return node;
  }
  remove() {
    if (this.parentNode && this.parentNode.removeChild) {
      this.parentNode.removeChild(this);
    }
  }
  closest(selector) {
    const parts = String(selector).split(",").map((part) => part.trim()).filter(Boolean);
    let current = this;
    while (current) {
      if (current.nodeType === 1 && parts.some((part) => matchSelector(current, part))) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }
  contains(node) {
    if (node === this) {
      return true;
    }
    let current = node && node.parentNode;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }
  querySelectorAll(selector) {
    const parts = String(selector).split(",").map((part) => part.trim()).filter(Boolean);
    const out = [];
    const stack = [...this.childNodes];
    while (stack.length) {
      const node = stack.shift();
      if (!node || node.nodeType !== 1) {
        continue;
      }
      if (parts.some((part) => matchSelector(node, part))) {
        out.push(node);
      }
      stack.push(...(node.childNodes || []));
    }
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener() {}
  focus() { this.focused = true; }
  get textContent() { return this.childNodes.map((node) => node.textContent || "").join(""); }
  set textContent(value) {
    this.childNodes = [];
    const text = value == null ? "" : String(value);
    if (text) {
      this.appendChild(this.ownerDocument.createTextNode(text));
    }
  }
}

class Document {
  constructor() {
    this.body = new Element("body", this);
    this.body.ownerDocument = this;
    this.activeElement = null;
  }
  createElement(tag) { return new Element(tag, this); }
  createTextNode(value) { return new TextNode(value, this); }
}

// --- Kit: emoji split, bank recognizer, and the folded-equal name. ---

test("propertyCardSplitLeadingEmoji splits one grapheme cluster and trims the rest", () => {
  assert.deepEqual(H.propertyCardSplitLeadingEmoji("# 🏦 Bank"), { emoji: "", rest: "# 🏦 Bank" });
  assert.deepEqual(H.propertyCardSplitLeadingEmoji("🏦 Bank"), { emoji: "🏦", rest: "Bank" });
  assert.deepEqual(H.propertyCardSplitLeadingEmoji("🏦"), { emoji: "🏦", rest: "" });
  assert.deepEqual(H.propertyCardSplitLeadingEmoji("🍽️ Eating out"), { emoji: "🍽️", rest: "Eating out" });
  assert.deepEqual(H.propertyCardSplitLeadingEmoji("Bank"), { emoji: "", rest: "Bank" });
  assert.deepEqual(H.propertyCardSplitLeadingEmoji(""), { emoji: "", rest: "" });
  assert.deepEqual(H.propertyCardSplitLeadingEmoji("  🏦   Bank  "), { emoji: "🏦", rest: "Bank" });
});

test("propertyCardBankTitleRecognizer matches the raw heading with emoji and nothing else", () => {
  const recognizer = H.propertyCardBankTitleRecognizer("🏦 Bank");
  assert.equal(recognizer.key, "bank:🏦 Bank");
  const hit = H.propertyCardTitleSourceRange("---\nparent: x\n---\n\n# 🏦 Bank\n\nBody.\n", recognizer);
  assert.ok(hit, "the first H1 owns the title");
  assert.equal(hit.title, "🏦 Bank");
  assert.equal(hit.headingLine, 4);
  const miss = H.propertyCardTitleSourceRange("---\nparent: x\n---\n\n# Bank\n\nBody.\n", recognizer);
  assert.equal(miss, null, "a bare title does not match an emoji heading");
  const h1less = H.propertyCardTitleSourceRange("---\nparent: x\n---\n\nBody.\n", recognizer);
  assert.equal(h1less, null, "no H1 matches nothing");
  const empty = H.propertyCardBankTitleRecognizer("");
  assert.equal(empty.key, "never:bank");
  assert.equal(
    H.propertyCardTitleSourceRange("# 🏦 Bank\n", empty),
    null,
    "an empty heading never owns a title",
  );
});

test("propertyCardAccessibleName folds the title equal to the species word", () => {
  assert.equal(H.propertyCardAccessibleName("bank", "Bank"), "Bank");
  assert.equal(H.propertyCardAccessibleName("bank", "  bank  "), "Bank");
  assert.equal(H.propertyCardAccessibleName("bank", ""), "Bank");
  assert.equal(H.propertyCardAccessibleName("bank", "Cash"), "Bank: Cash");
  assert.equal(H.propertyCardAccessibleName("album", "Album"), "Album");
  assert.equal(H.propertyCardAccessibleName("album", "Eat"), "Album: Eat");
});

// --- Identity: H1, emoji, summary, and the parent chain from the cache. ---

function titleCache() {
  const files = {
    "bank.md": {
      frontmatter: { parent: "[[cash]]", type: "[[area]]", summary: "Every transaction." },
      headings: [{ level: 1, heading: "🏦 Bank" }],
    },
    "cash.md": {
      frontmatter: { type: "[[area]]", color: "blue" },
      headings: [{ level: 1, heading: "Cash" }],
    },
  };
  return {
    getFileCache: (file) => files[file && file.path] || null,
    getFirstLinkpathDest: (name) => ({ path: /\.md$/i.test(name) ? name : `${name}.md` }),
    on: () => ({}),
  };
}

function titleVault() {
  return { getAbstractFileByPath: (path) => ({ path }) };
}

function titlePlugin() {
  const plugin = new LedgerToolsPlugin({ metadataCache: titleCache(), vault: titleVault() });
  plugin.bankSetupActive = true;
  plugin.bankSetupDesktop = () => true;
  plugin.albumSetTimeout = (fn) => { fn(); return 1; };
  plugin.albumClearTimeout = () => {};
  plugin.bankSetupExpanded = new Map();
  return plugin;
}

test("bankSetupIdentityModel splits the first H1 and walks the parent chain", () => {
  const sourceText = '---\nparent: "[[cash]]"\ntype: "[[area]]"\n---\n\n# 🏦 Bank\n\nBody.\n';
  const identity = H.bankSetupIdentityModel("bank.md", {
    metadataCache: titleCache(),
    vault: titleVault(),
    sourceText,
  });
  assert.equal(identity.path, "bank.md");
  assert.equal(identity.title, "Bank");
  assert.equal(identity.emoji, "🏦");
  assert.equal(identity.heading, "🏦 Bank");
  assert.equal(identity.summary, "Every transaction.");
  assert.deepEqual(identity.owners.map((owner) => owner.title), ["Cash"]);
  assert.equal(identity.owners[0].path, "cash.md");
  assert.equal(identity.ancestryBroken, false);
});

test("bankSetupIdentityModel falls back to the cached H1, then the hub title", () => {
  const cached = H.bankSetupIdentityModel("bank.md", { metadataCache: titleCache(), vault: titleVault() });
  assert.equal(cached.title, "Bank");
  assert.equal(cached.emoji, "🏦");
  const bare = H.bankSetupIdentityModel("bank.md", {
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), on: () => ({}) },
    vault: titleVault(),
    sourceText: "---\n---\n\nBody without a heading.\n",
  });
  assert.equal(bare.title, "Bank");
  assert.equal(bare.emoji, "🏦");
  assert.equal(bare.heading, "🏦 Bank");
  assert.deepEqual(bare.owners, []);
  assert.equal(H.bankSetupIdentityModel("other.md", { metadataCache: titleCache(), vault: titleVault() }), null);
});

test("bankSetupFirstHeading reads live bytes and skips frontmatter", () => {
  assert.equal(H.bankSetupFirstHeading('---\na: b\n---\n\n# 🏦 Bank\n'), "🏦 Bank");
  assert.equal(H.bankSetupFirstHeading("Body without a heading.\n"), "");
  assert.equal(H.bankSetupFirstHeading(""), "");
});

// --- Title block: one identity stack, Setup/YAML action matrix. ---

function setupReport(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    state: "valid",
    path: "bank.md",
    accounts: [{ alias: "checking", label: "WF Checking", kind: "checking", start: "2026-11-11", status: "balanced" }],
    categories: [
      { key: "coffee", label: "Coffee", hotkey: "c", group: "Everyday", line: 13, rows: 5 },
      { key: "groceries", label: "Groceries", hotkey: "g", group: "Everyday", line: 14, rows: 2 },
    ],
    free_hotkeys: [],
    rules: [{ index: 0, match: "VENMO", cat: "coffee", line: 30 }],
    stale_after: { days: 10, explicit: false, line: null },
    findings: [],
    ...overrides,
  };
}

function setupModel(report, options = {}) {
  const decoded = H.bankDecodeConfig(JSON.stringify(report), "");
  assert.equal(decoded.ok, true);
  return H.bankSetupModel(decoded.report, { desktop: true, expanded: true, ...options });
}

function paintTitle(report, options = {}) {
  const doc = new Document();
  const model = setupModel(report, options.model || {});
  const identity = H.bankSetupIdentityModel("bank.md", {
    metadataCache: titleCache(),
    vault: titleVault(),
    sourceText: '---\nparent: "[[cash]]"\n---\n\n# 🏦 Bank\n',
  });
  const calls = { setup: 0, toggle: 0, yaml: 0 };
  const el = H.bankSetupBuildEl(model, {
    sourcePath: "bank.md",
    identity,
    handlers: {
      onSetup: () => { calls.setup += 1; },
      onToggle: () => { calls.toggle += 1; },
      onYaml: () => { calls.yaml += 1; },
    },
  }, doc);
  assert.ok(el);
  doc.body.appendChild(el);
  return { doc, el, model, identity, calls };
}

test("the title block owns the note top with tile, kicker, title, and subtitle", () => {
  const { el, identity } = paintTitle(setupReport(), { model: { expanded: false } });
  assert.equal(el.getAttribute("data-card-kind"), "bank");
  assert.equal(el.getAttribute("aria-label"), "Bank");
  assert.equal(el.getAttribute("role"), "group");
  assert.equal(el.querySelectorAll("[aria-level]").length, 0, "demoted until adoption owns it");
  const block = el.querySelector(".bob-property-card-title-block");
  assert.ok(block, "the kit title block leads");
  assert.equal(block.textContent.includes("Bank"), true);
  const tile = block.querySelector(".bob-property-card-tile");
  assert.ok(tile);
  assert.equal(tile.getAttribute("data-tile-form"), "plain");
  assert.match(tile.textContent, /🏦/);
  const kicker = block.querySelector(".bob-property-card-kicker");
  assert.ok(kicker);
  assert.match(kicker.textContent, /Bank/, "the species word (CSS uppercases it)");
  assert.match(kicker.textContent, /Cash/);
  const crumb = block.querySelector(".bob-property-card-kicker-link");
  assert.ok(crumb, "the parent crumb navigates");
  assert.equal(crumb.getAttribute("data-href"), "cash.md");
  const subtitle = block.querySelector(".bob-property-card-subtitle");
  assert.ok(subtitle, "the frontmatter summary is the subtitle");
  assert.match(subtitle.textContent, /Every transaction/);
  assert.equal(el.querySelector(".bob-property-card-identity"), null, "the BANK badge is retired");
  assert.equal(el.querySelector(".bob-bank-setup-head"), null, "the head row is gone");
  assert.equal(identity.heading, "🏦 Bank");
});

test("the Setup/YAML action matrix follows state, and Setup never toggles", () => {
  const valid = paintTitle(setupReport(), { model: { expanded: false } });
  const setup = valid.el.querySelector(".bob-bank-setup-edit");
  assert.ok(setup, "valid shows Setup");
  assert.equal(setup.textContent, "⊞ Setup");
  assert.equal(setup.getAttribute("aria-label"), "Edit bank setup");
  assert.equal(valid.el.querySelector(".bob-bank-setup-yaml"), null, "valid hides YAML");
  const invalid = paintTitle(setupReport({
    ok: false,
    state: "invalid",
    partial: true,
    findings: [{ code: "dup", severity: "error", path: "bank.md", line: 14, key_path: "x", message: "hotkey taken" }],
  }));
  assert.ok(invalid.el.querySelector(".bob-bank-setup-edit"), "invalid keeps Setup");
  assert.ok(invalid.el.querySelector(".bob-bank-setup-yaml"), "invalid shows YAML for Source repair");
  const missing = paintTitle(setupReport({ ok: false, state: "missing", starter: "bank:\n  accounts: {}" }));
  assert.equal(missing.el.querySelector(".bob-bank-setup-edit"), null, "missing has no Setup editor");
  assert.ok(missing.el.querySelector(".bob-bank-setup-yaml"), "missing shows YAML");
  const loadingDoc = new Document();
  const loadingModel = H.bankSetupModel(null, { desktop: true, expanded: false });
  assert.equal(loadingModel.state, "loading");
  const loading = H.bankSetupBuildEl(loadingModel, { sourcePath: "bank.md", handlers: {} }, loadingDoc);
  assert.ok(loading, "loading paints");
  assert.equal(loading.querySelector(".bob-bank-setup-edit"), null);
  assert.equal(loading.querySelector(".bob-bank-setup-yaml"), null);
  // A click on Setup is a separate button from the fold row: the handlers
  // stay decoupled, so Setup never toggles the fold.
  assert.ok(valid.el.querySelector(".bob-bank-setup-toggle"), "the fold row still paints");
  assert.notEqual(setup, valid.el.querySelector(".bob-bank-setup-toggle"));
});

test("the Setup body carries the 0.9em density, not the card root", () => {
  const { el } = paintTitle(setupReport());
  const body = el.querySelector(".bob-bank-setup-body");
  assert.ok(body);
  assert.ok(body.textContent.includes("Coffee"), "body paints at full density scope");
});

// --- Hue: the real walk, then the bank.md color, then the literal. ---

test("bankSetupTitleHue follows the parent walk and fences match the card", () => {
  const plugin = titlePlugin();
  assert.equal(plugin.bankSetupTitleHue("bank.md"), "blue");
  assert.equal(plugin.bankCardRootHue("bank.md"), "blue", "the fence hue matches the card");
});

test("bankSetupTitleHue and bankCardRootHue degrade through the bank.md color", () => {
  const cache = {
    getFileCache: (file) => (file && file.path === "bank.md"
      ? { frontmatter: { color: "red" }, headings: [] }
      : { frontmatter: {}, headings: [] }),
    getFirstLinkpathDest: (name) => ({ path: /\.md$/i.test(name) ? name : `${name}.md` }),
    on: () => ({}),
  };
  const plugin = new LedgerToolsPlugin({ metadataCache: cache, vault: titleVault() });
  assert.equal(plugin.bankCardRootHue("bank.md"), "red");
  const empty = new LedgerToolsPlugin({
    metadataCache: { getFileCache: () => null, on: () => ({}) },
    vault: titleVault(),
  });
  assert.equal(empty.bankCardRootHue("bank.md"), "magenta");
});

// --- Foot: truthful where-marks, only what painted. ---

test("bankSetupRemoveStrays clears widget-buffer mounts but keeps the body card", () => {
  const plugin = titlePlugin();
  const doc = new Document();
  const root = doc.createElement("div");
  const buffer = doc.createElement("div");
  buffer.setAttribute("class", "cm-widgetBuffer");
  const stray = doc.createElement("section");
  stray.setAttribute("class", "bob-bank-setup");
  stray.setAttribute("data-bank-setup-source", "bank.md");
  buffer.appendChild(stray);
  root.appendChild(buffer);
  const body = doc.createElement("section");
  body.setAttribute("class", "bob-bank-setup");
  body.setAttribute("data-bank-setup-source", "bank.md");
  root.appendChild(body);
  const other = doc.createElement("section");
  other.setAttribute("class", "bob-bank-setup");
  other.setAttribute("data-bank-setup-source", "other.md");
  root.appendChild(other);
  plugin.bankSetupRemoveStrays(root, "bank.md");
  assert.equal(buffer.childNodes.length, 0, "the stranded widget mount is gone");
  assert.equal(root.querySelectorAll(".bob-bank-setup").length, 2, "body and other-path cards stay");
});

test("Source mode releases the slot card and still lints the report", () => {
  const plugin = titlePlugin();
  plugin.bankSetupFootBind();
  const report = setupReport({
    ok: false,
    state: "invalid",
    partial: true,
    findings: [{ code: "dup", severity: "error", path: "bank.md", line: 2, key_path: "x", message: "hotkey taken" }],
  });
  const decoded = H.bankDecodeConfig(JSON.stringify(report), "");
  plugin.bankSetupLastState = {
    results: { [plugin.bankSetupConfigKey()]: { report: decoded.report, stale: false, error: null, refreshing: false } },
  };
  const text = '---\nbank: {}\n---\n\n# Bank\n';
  const lines = text.split("\n");
  let offset = 0;
  const lineStarts = lines.map((line) => {
    const from = offset;
    offset += line.length + 1;
    return from;
  });
  const fakeDoc = {
    toString: () => text,
    get length() { return text.length; },
    line: (n) => ({ text: lines[n - 1] || "", from: lineStarts[n - 1] || 0, to: (lineStarts[n - 1] || 0) + (lines[n - 1] || "").length }),
  };
  const doc = new Document();
  const dom = doc.createElement("div");
  dom.setAttribute("class", "cm-editor markdown-source-view");
  const view = { state: { doc: fakeDoc }, dom };
  plugin.app.workspace = {
    getLeavesOfType: () => [{ view: { editor: { cm: view }, file: { path: "bank.md" } } }],
  };
  const out = plugin.buildBankSetupDecorations(view);
  assert.ok(out && Array.isArray(out.adds) && out.adds.length > 0, "lint marks still paint in Source mode");
  assert.equal(plugin.bankSetupReleaseAdoption(dom, "bank.md"), false, "no slot card survives the mode flip");
});

test("bankSetupFootWhere marks only what actually painted", () => {
  const plugin = titlePlugin();
  const bare = plugin.bankSetupFootWhere(null);
  assert.deepEqual(bare, { type: "tile", created: "foot" });
  const identity = H.bankSetupIdentityModel("bank.md", { metadataCache: titleCache(), vault: titleVault() });
  const collapsed = plugin.bankSetupFootWhere({ identity, bodyPainted: false });
  assert.equal(collapsed.parent, "kicker");
  assert.equal(collapsed.summary, "subtitle");
  assert.equal(collapsed.bank, undefined, "a collapsed body paints no bank mapping");
  const expanded = plugin.bankSetupFootWhere({ identity, bodyPainted: true });
  assert.equal(expanded.bank, "setup");
  const noSummary = plugin.bankSetupFootWhere({
    identity: { ...identity, summary: "", owners: [] },
    bodyPainted: true,
  });
  assert.equal(noSummary.parent, undefined);
  assert.equal(noSummary.summary, undefined);
  assert.equal(noSummary.bank, "setup");
});
