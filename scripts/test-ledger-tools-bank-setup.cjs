// Bank Setup header (bob-cli-lt setup-header): config decode, collapsed and
// expanded models, shared tile parity with the Category card, DOM states,
// mount idempotence, scoped hiding, jumps, Source-mode lint mapping, and the
// queue card pointer. Painting never writes vault bytes: the fake DOM has no
// vault, and every report string enters as text.
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
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

// --- Minimal fake DOM: text-only insertion, attribute selectors, surfaces. ---

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
    this.surface = false;
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
  prepend(...nodes) {
    for (const node of nodes.reverse()) {
      this.insertBefore(node, this.childNodes[0] || null);
    }
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
  matches(selector) {
    return String(selector).split(",").map((part) => part.trim()).filter(Boolean)
      .some((part) => matchSelector(this, part));
  }
  contains(node) {
    if (node === this) {
      return true;
    }
    return (node && typeof node.closest === "function" && node.closest("*") && walkUp(node, this)) || false;
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

function walkUp(node, root) {
  let current = node && node.parentNode;
  while (current) {
    if (current === root) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
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

// --- Config fixtures shaped like `bob bank config -f json`. ---

function configCategory(overrides = {}) {
  return {
    key: "coffee",
    emoji: "☕",
    label: "Coffee",
    builtin: false,
    declared: true,
    hotkey: "c",
    hotkey_source: "explicit",
    group: "Everyday",
    hidden: false,
    line: 13,
    source_line: 13,
    rows: 5,
    rule_refs: 0,
    ...overrides,
  };
}

function configAccount(overrides = {}) {
  return {
    alias: "checking",
    label: "WF Checking",
    kind: "checking",
    default: true,
    start: "2026-11-11",
    line: 8,
    source_line: 8,
    rows: 11,
    journal_events: 0,
    status: "balanced",
    hint: "Ledger balance matches.",
    last_import: "2026-11-15",
    balance_cents: 100,
    balance_asof: "2026-11-13",
    delta_cents: 0,
    ...overrides,
  };
}

function configReport(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    state: "valid",
    teaching_empty: false,
    partial: false,
    today: "2026-11-15",
    path: "bank.md",
    line: 6,
    fingerprint: "sha256:abc",
    accounts: [configAccount()],
    categories: [
      configCategory(),
      configCategory({ key: "groceries", emoji: "🛒", label: "Groceries", hotkey: "g", line: 14, source_line: 14, rows: 2 }),
      configCategory({ key: "income", emoji: "💵", label: "Income", builtin: true, declared: false, hotkey: "i", hotkey_source: "builtin_default", group: "Money moves", line: null, source_line: null, rows: 1 }),
      configCategory({ key: "kids", emoji: "🧸", label: "Kids", hotkey: null, hotkey_source: "none", hidden: true, line: 20, source_line: 20, rows: 3 }),
    ],
    free_hotkeys: ["b", "j"],
    rules: [{ index: 0, match: "VENMO", payee: "Venmo", cat: "groceries", link: null, line: 30, source_line: 30 }],
    stale_after: { days: 10, explicit: false, line: null },
    findings: [],
    issues: { errors: 0, warnings: 0 },
    starter: null,
    ...overrides,
  };
}

test("config decode keeps every report field and tolerates absent ones", () => {
  const decoded = H.bankDecodeConfig(JSON.stringify(configReport()), "");
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.state, "valid");
  assert.equal(decoded.report.categories.length, 4);
  assert.equal(decoded.report.accounts[0].status, "balanced");
  assert.equal(decoded.report.rules[0].line, 30);
  assert.deepEqual(decoded.report.free_hotkeys, ["b", "j"]);
  // Absent optional fields still decode.
  const sparse = {
    schema_version: 1,
    ok: true,
    state: "valid",
    categories: [{ key: "coffee", label: "Coffee" }],
    accounts: [{ alias: "checking", label: "WF Checking" }],
  };
  const sparseDecoded = H.bankDecodeConfig(JSON.stringify(sparse), "");
  assert.equal(sparseDecoded.ok, true);
  assert.equal(sparseDecoded.report.categories[0].hotkey, null);
  assert.equal(sparseDecoded.report.categories[0].declared, true);
  assert.equal(sparseDecoded.report.accounts[0].status, null);
  assert.deepEqual(sparseDecoded.report.rules, []);
  assert.deepEqual(sparseDecoded.report.findings, []);
  assert.equal(sparseDecoded.report.stale_after.days, 10);
});

test("config decode reads invalid, missing, and teaching-empty states with located findings", () => {
  const invalid = configReport({
    ok: false,
    state: "invalid",
    partial: true,
    findings: [
      { code: "dup", severity: "error", path: "bank.md", line: 14, key_path: "bank.categories.cafe.hotkey", message: "hotkey taken", hint: null },
      { code: "dead", severity: "warning", path: "bank.md", line: null, key_path: "bank.rules.0", message: "read-time dead", hint: "digits" },
    ],
    issues: { errors: 1, warnings: 1 },
  });
  const decoded = H.bankDecodeConfig(JSON.stringify(invalid), "");
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.state, "invalid");
  assert.equal(decoded.report.partial, true);
  assert.equal(decoded.report.findings.length, 2);
  assert.equal(decoded.report.findings[0].line, 14);
  assert.equal(decoded.report.findings[1].line, null);
  const missing = H.bankDecodeConfig(JSON.stringify({
    schema_version: 1,
    ok: false,
    state: "missing",
    starter: "bank:\n  accounts: {}",
  }), "");
  assert.equal(missing.ok, true);
  assert.equal(missing.report.state, "missing");
  assert.equal(missing.report.starter, "bank:\n  accounts: {}");
  const empty = H.bankDecodeConfig(JSON.stringify({ schema_version: 1, ok: false, state: "teaching_empty" }), "");
  assert.equal(empty.ok, true);
  assert.equal(empty.report.teaching_empty, true);
});

test("config decode maps an older bob to unsupported and rejects bad shapes", () => {
  const unsupported = H.bankDecodeConfig(
    "",
    "error: unrecognized subcommand 'config'\n\nUsage: bob bank [COMMAND]",
    2,
  );
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.code, "unsupported");
  assert.match(unsupported.message, /newer bob/);
  const badJson = H.bankDecodeConfig("nope", "", 0);
  assert.equal(badJson.ok, false);
  assert.equal(badJson.code, "bad-json");
  const badSchema = H.bankDecodeConfig(JSON.stringify({ schema_version: 2, ok: true, state: "valid" }), "", 0);
  assert.equal(badSchema.ok, false);
  assert.equal(badSchema.code, "schema-mismatch");
  const malformed = H.bankDecodeConfig(
    JSON.stringify({ schema_version: 1, ok: true, state: "valid", categories: [{ key: null }] }),
    "",
    0,
  );
  assert.equal(malformed.ok, false);
});

test("config fetch args use the bare config member", () => {
  assert.deepEqual(H.bankBuildArgs({ command: "config" }), ["bank", "config", "-f", "json"]);
  const plugin = makeSetupPlugin(null, {});
  assert.deepEqual(plugin.bankFetchesFor({ command: "config" }), [{ command: "config" }]);
  assert.deepEqual(plugin.bankFetchesFor({ config: true }), [{ command: "config" }]);
  assert.equal(H.bankCacheKey(H.bankBuildArgs({ command: "config" })), JSON.stringify(["bank", "config", "-f", "json"]));
});

// --- Model: collapsed grammar, states, tiles, and signatures. ---

function decodedReport(overrides = {}) {
  const decoded = H.bankDecodeConfig(JSON.stringify(configReport(overrides)), "");
  assert.equal(decoded.ok, true);
  return decoded.report;
}

test("collapsed grammar covers one vs several accounts, hidden counts, and rule plurals", () => {
  const one = H.bankSetupModel(decodedReport(), { desktop: true, expanded: false });
  assert.equal(one.collapsedLine, "WF Checking · 3 categories · 1 hidden · 1 rule");
  assert.equal(one.state, "valid");
  assert.equal(one.foldable, true);
  assert.equal(one.problems, "");
  assert.equal(one.attention, null);
  const none = H.bankSetupModel(decodedReport({ accounts: [], categories: [], rules: [], free_hotkeys: [] }), { desktop: true });
  assert.equal(none.collapsedLine, "no accounts · 0 categories · no rules");
  const two = H.bankSetupModel(decodedReport({
    accounts: [configAccount(), configAccount({ alias: "savings", label: "WF Savings", default: false })],
  }), { desktop: true });
  assert.equal(two.collapsedLine, "WF Checking + 1 more · 3 categories · 1 hidden · 1 rule");
});

test("invalid configs no longer force expansion but expose problems and attention", () => {
  const report = decodedReport({
    ok: false,
    state: "invalid",
    partial: true,
    findings: [
      { code: "dup", severity: "error", path: "bank.md", line: 14, key_path: "bank.categories.cafe.hotkey", message: "hotkey taken", hint: null },
    ],
  });
  const collapsed = H.bankSetupModel(report, { desktop: true, expanded: false });
  assert.equal(collapsed.state, "invalid");
  assert.equal(collapsed.expanded, false);
  assert.equal(collapsed.foldable, true);
  assert.equal(collapsed.problems, 'invalid:["hotkey taken"]');
  assert.equal(collapsed.errorCount, 1);
  assert.equal(collapsed.findings[0].label, "line 14 · bank.categories.cafe.hotkey · hotkey taken");
  assert.deepEqual(
    { icon: collapsed.attention.icon, word: collapsed.attention.word, tone: collapsed.attention.tone },
    { icon: "✗", word: "1 problem", tone: "error" },
  );
  const open = H.bankSetupModel(report, { desktop: true, expanded: true });
  assert.equal(open.expanded, true);
});

test("fold health resolves through the kit: healthy collapsed, broken open, choice stamped", () => {
  assert.equal(H.bankSetupFoldProblems({ state: "valid", findings: [] }), "");
  assert.equal(
    H.bankSetupFoldProblems({ state: "invalid", findings: [{ severity: "error", message: "hotkey taken" }] }),
    'invalid:["hotkey taken"]',
  );
  assert.equal(H.bankSetupIsFoldable({ state: "valid" }), true);
  assert.equal(H.bankSetupIsFoldable({ state: "invalid" }), true);
  assert.equal(H.bankSetupIsFoldable({ state: "missing", starter: "bank:\n  accounts: {}" }), true);
  assert.equal(H.bankSetupIsFoldable({ state: "missing", starter: null }), false);
  assert.equal(H.bankSetupIsFoldable({ state: "loading" }), false);
  assert.equal(H.propertyCardFoldResolve({ choice: undefined, problems: "", foldDefault: false }), false);
  assert.equal(H.propertyCardFoldResolve({
    choice: { open: false, problems: 'invalid:["hotkey taken"]' },
    problems: 'invalid:["hotkey taken"]',
    foldDefault: false,
  }), false);
  assert.equal(H.propertyCardFoldResolve({
    choice: { open: false, problems: 'invalid:["a"]' },
    problems: 'invalid:["b"]',
    foldDefault: false,
  }), true);
});

test("gap status rides a warning tone and attention prefers errors, warnings, then accounts", () => {
  assert.deepEqual(H.bankSetupStatusTone("gap"), { icon: "⚠", word: "gap", tone: "warn" });
  const warnings = H.bankSetupModel(decodedReport({
    findings: [{ code: "dead", severity: "warning", path: "bank.md", line: null, key_path: "bank.rules.0", message: "read-time dead", hint: "digits" }],
  }), { desktop: true, expanded: false });
  assert.equal(warnings.attention.icon, "⚠");
  assert.match(warnings.attention.word, /warning/);
  const stale = H.bankSetupModel(decodedReport({
    accounts: [configAccount({ status: "stale", hint: "old" })],
  }), { desktop: true, expanded: false });
  assert.equal(stale.attention.word, "stale");
  assert.equal(stale.attention.tone, "warn");
  assert.match(stale.attention.title, /WF Checking/);
  const mixed = H.bankSetupModel(decodedReport({
    state: "invalid",
    ok: false,
    findings: [
      { code: "a", severity: "error", path: "bank.md", line: 1, key_path: "bank.a", message: "first", hint: null },
      { code: "b", severity: "error", path: "bank.md", line: 2, key_path: "bank.b", message: "second", hint: null },
      { code: "c", severity: "warning", path: "bank.md", line: null, key_path: "bank.c", message: "careful", hint: null },
    ],
    accounts: [configAccount({ status: "stale", hint: "old" })],
  }), { desktop: true, expanded: false });
  assert.equal(mixed.attention.word, "2 problems");
  assert.equal(mixed.attention.count, 2);
  assert.doesNotMatch(JSON.stringify(mixed.attention), /\$/);
  const signature = JSON.parse(H.bankSetupModelSignature(mixed));
  assert.deepEqual(signature.attention, mixed.attention);
});

test("state selection covers mobile, unsupported, loading, refresh failures, and missing", () => {
  const report = decodedReport();
  assert.equal(H.bankSetupModel(report, { desktop: false }).state, "mobile");
  assert.equal(H.bankSetupModel(report, { desktop: true, error: { code: "unsupported", message: "old" } }).state, "unsupported");
  assert.equal(H.bankSetupModel(report, { desktop: true, error: { code: "bob-not-found", message: "missing" } }).state, "unsupported");
  assert.equal(H.bankSetupModel(null, { desktop: true }).state, "loading");
  assert.equal(H.bankSetupModel(null, { desktop: true, error: { code: "unloaded" } }).state, "loading");
  assert.equal(H.bankSetupModel(null, { desktop: true, error: { code: "timeout", message: "slow" } }).state, "refresh-failed");
  assert.equal(H.bankSetupModel(null, { desktop: true, error: { code: "failed", message: "down" }, stale: true }).state, "refresh-failed");
  const missing = H.bankSetupModel(decodedReport({ ok: false, state: "missing", categories: [], accounts: [] }), { desktop: true });
  assert.equal(missing.state, "missing");
});

test("tiles enrich keycap style, tooltips, accessible names, and jump lines", () => {
  const model = H.bankSetupModel(decodedReport(), { desktop: true, expanded: true });
  const everyday = model.sections.find((section) => section.group === "Everyday");
  const coffee = everyday.tiles.find((tile) => tile.key === "coffee");
  assert.equal(coffee.keycapStyle, "solid");
  assert.equal(coffee.tooltip, "☕ Coffee · stored as coffee · key C pinned · 5 rows");
  assert.equal(coffee.ariaLabel, "Coffee, key C, 5 rows");
  assert.equal(coffee.line, 13);
  const hidden = model.hiddenTiles.find((tile) => tile.key === "kids");
  assert.equal(hidden.keycapStyle, "none");
  assert.equal(hidden.tooltip, "🧸 Kids · stored as kids · no key · 3 rows");
  const money = model.sections.find((section) => section.group === "Money moves");
  const income = money.tiles.find((tile) => tile.key === "income");
  assert.equal(income.keycapStyle, "solid");
  assert.match(income.tooltip, /built-in default/);
});

test("widget identity folds the signature with surface options", () => {
  const model = H.bankSetupModel(decodedReport(), { desktop: true, expanded: true });
  const same = H.bankSetupSignature(model, { expanded: true, desktop: true });
  assert.equal(same, H.bankSetupSignature(model, { expanded: true, desktop: true }));
  assert.notEqual(same, H.bankSetupSignature(model, { expanded: false, desktop: true }));
  assert.notEqual(same, H.bankSetupSignature(model, { expanded: true, desktop: false }));
});

test("tiles follow Category card order and the signature moves with row counts", () => {
  const model = H.bankSetupModel(decodedReport(), { desktop: true, expanded: true });
  const cardSections = H.bankCategorySections(
    decodedReport().categories.filter((entry) => entry.hidden !== true),
    {},
  );
  assert.deepEqual(
    model.sections.map((section) => section.tiles.map((tile) => tile.key)),
    cardSections.map((section) => section.tiles.map((tile) => tile.key)),
  );
  const changed = H.bankSetupModel(decodedReport({
    categories: [
      configCategory({ rows: 6 }),
      configCategory({ key: "groceries", emoji: "🛒", label: "Groceries", hotkey: "g", line: 14, source_line: 14, rows: 2 }),
      configCategory({ key: "income", emoji: "💵", label: "Income", builtin: true, declared: false, hotkey: "i", hotkey_source: "builtin_default", group: "Money moves", line: null, source_line: null, rows: 1 }),
      configCategory({ key: "kids", emoji: "🧸", label: "Kids", hotkey: null, hotkey_source: "none", hidden: true, line: 20, source_line: 20, rows: 3 }),
    ],
  }), { desktop: true, expanded: true });
  assert.notEqual(model.signature, changed.signature);
});

test("accounts carry status words and since labels; dead rules are flagged", () => {
  const model = H.bankSetupModel(decodedReport(), { desktop: true, expanded: true });
  assert.equal(model.accounts[0].status, "balanced");
  assert.equal(model.accounts[0].statusIcon, "✓");
  assert.equal(model.accounts[0].sinceLabel, "since Wed Nov 11");
  const dead = H.bankSetupModel(decodedReport({
    rules: [{ index: 0, match: "VENMO 1234", payee: "Venmo", cat: "groceries", link: null, line: 30, source_line: 30 }],
  }), { desktop: true, expanded: true });
  assert.equal(dead.rules[0].readTimeDead, true);
  assert.equal(model.rules[0].readTimeDead, false);
});

// --- Shared tiles: card output unchanged, header keyed apart. ---

test("shared tile keeps the card look and keys the header apart", () => {
  const doc = new Document();
  const tile = { key: "coffee", hotkey: "c", keycap: "C", emoji: "☕", label: "Coffee", dimmed: false };
  const card = H.bankSharedCategoryTile(doc, tile, { card: true, selected: true, disabled: false });
  assert.equal(card.getAttribute("data-category-key"), "coffee");
  assert.equal(card.getAttribute("data-bank-setup-category"), null);
  assert.equal(card.getAttribute("aria-keyshortcuts"), "c");
  assert.equal(card.getAttribute("aria-pressed"), "true");
  assert.equal(card.querySelector(".bob-bank-category-keycap").textContent, "C");
  assert.match(card.textContent, /Coffee/);
  assert.match(card.textContent, /↵/);
  const header = H.bankSharedCategoryTile(doc, {
    ...tile,
    ariaLabel: "Coffee, key C, 5 rows",
    tooltip: "☕ Coffee · stored as coffee · key C pinned · 5 rows",
    rows: 5,
    line: 13,
    keycapStyle: "solid",
  }, {});
  assert.equal(header.getAttribute("data-bank-setup-category"), "coffee");
  assert.equal(header.getAttribute("data-category-key"), null);
  assert.equal(header.getAttribute("aria-label"), "Coffee, key C, 5 rows");
  assert.equal(header.getAttribute("title"), "☕ Coffee · stored as coffee · key C pinned · 5 rows");
  assert.equal(header.getAttribute("data-bank-setup-line"), "13");
  assert.equal(header.querySelector(".bob-bank-setup-tile-count").textContent, "5");
  assert.equal(header.querySelector(".bob-bank-category-enter"), null);
  const keyless = H.bankSharedCategoryTile(doc, { key: "kids", hotkey: null, keycap: null, emoji: "🧸", label: "Kids" }, {});
  assert.equal(keyless.querySelector(".bob-bank-category-keycap"), null);
  assert.ok(keyless.querySelector(".bob-bank-category-keydot"));
  const derived = H.bankSharedCategoryTile(doc, { ...tile, keycapStyle: "dashed" }, {});
  assert.ok(derived.querySelector(".bob-bank-category-keycap.is-derived"));
});

// --- DOM: every state paints with text, jumps, and accessible names. ---

function paintHandlers() {
  const calls = { toggle: 0, yaml: 0, jumps: [], starter: 0, retry: 0 };
  return {
    calls,
    handlers: {
      onToggle: () => { calls.toggle += 1; },
      onYaml: () => { calls.yaml += 1; },
      onJump: (line) => { calls.jumps.push(line); },
      onCopyStarter: () => { calls.starter += 1; },
      onRetry: () => { calls.retry += 1; },
    },
  };
}

function paintModel(report, options = {}) {
  const doc = new Document();
  const { calls, handlers } = paintHandlers();
  const model = H.bankSetupModel(report, { desktop: true, expanded: true, ...options });
  const el = H.bankSetupBuildEl(model, handlers, doc);
  assert.ok(el);
  assert.equal(el.classList.contains("bob-property-card"), true);
  doc.body.appendChild(el);
  return { doc, el, model, calls };
}

test("valid header paints collapsed and expanded states with jumps and accessible names", () => {
  const collapsed = paintModel(decodedReport(), { expanded: false });
  assert.match(collapsed.el.textContent, /WF Checking/);
  assert.doesNotMatch(collapsed.el.textContent, /🏦 WF Checking/);
  const collapsedBody = collapsed.el.querySelector(".bob-bank-setup-body");
  assert.ok(collapsedBody);
  assert.equal(collapsedBody.getAttribute("hidden"), "");
  assert.equal(collapsedBody.childNodes.length, 0);
  const collapsedToggle = collapsed.el.querySelector(".bob-bank-setup-toggle");
  assert.equal(collapsedToggle.getAttribute("aria-expanded"), "false");
  assert.equal(collapsedToggle.getAttribute("data-card-fold"), "bank");
  assert.equal(collapsedToggle.getAttribute("aria-keyshortcuts"), "_");
  assert.equal(collapsedToggle.getAttribute("title"), "Toggle bank setup (_)");
  assert.equal(collapsedToggle.getAttribute("data-bank-setup-focus"), "toggle");
  const bodyId = collapsedToggle.getAttribute("aria-controls");
  assert.ok(bodyId);
  assert.equal(collapsed.el.querySelector(`[id="${bodyId}"]`), collapsedBody);
  assert.equal(collapsed.calls.toggle, 0);
  assert.equal(collapsed.calls.yaml, 0);
  const expanded = paintModel(decodedReport(), { expanded: true });
  assert.equal(expanded.el.querySelector(".bob-bank-setup-toggle").getAttribute("aria-expanded"), "true");
  assert.match(expanded.el.querySelector(".bob-bank-setup-toggle").textContent, /▾ Setup · WF Checking/);
  assert.ok(expanded.el.querySelector(".bob-bank-category-tile"));
  assert.ok(expanded.el.querySelector(".bob-bank-setup-tiles"));
  // Header tiles never match the card's click selector.
  assert.equal(expanded.el.querySelectorAll("button[data-category-key]").length, 0);
  assert.ok(expanded.el.querySelectorAll("button[data-bank-setup-category]").length > 0);
  // Single rule numbering: one list with a muted tabular gutter, no double markers.
  assert.equal(expanded.el.querySelectorAll(".bob-bank-setup-rules").length, 1);
  assert.ok(expanded.el.querySelector(".bob-bank-setup-rule-index"));
  // No vault bytes move during paint: handlers stay silent.
  assert.deepEqual(expanded.calls, { toggle: 0, yaml: 0, jumps: [], starter: 0, retry: 0 });
  const tile = expanded.el.querySelector('button[data-bank-setup-category="coffee"]');
  assert.equal(tile.getAttribute("data-bank-setup-line"), "13");
  const account = expanded.el.querySelector(".bob-bank-setup-account-name");
  assert.equal(account.getAttribute("data-bank-setup-line"), "8");
  const rule = expanded.el.querySelector(".bob-bank-setup-rule-text");
  assert.equal(rule.getAttribute("data-bank-setup-line"), "30");
});

test("fold rows carry unique live ids, stale rides outside, and bodyless carries no fold", () => {
  const first = paintModel(decodedReport(), { expanded: false });
  const second = paintModel(decodedReport(), { expanded: false });
  const firstId = first.el.querySelector(".bob-bank-setup-toggle").getAttribute("aria-controls");
  const secondId = second.el.querySelector(".bob-bank-setup-toggle").getAttribute("aria-controls");
  assert.ok(firstId && secondId && firstId !== secondId);
  const staleReport = decodedReport();
  const staleCollapsed = paintModel(staleReport, { expanded: false, stale: true, lastGoodLabel: "3:41 PM" });
  const staleLine = staleCollapsed.el.querySelector(".bob-bank-setup-status[role=\"status\"]");
  assert.ok(staleLine);
  assert.match(staleLine.textContent, /Updating · last good values from 3:41 PM/);
  assert.equal(staleCollapsed.el.querySelector(".bob-bank-setup-body").getAttribute("hidden"), "");
  const staleExpanded = paintModel(staleReport, { expanded: true, stale: true, lastGoodLabel: "3:41 PM" });
  assert.ok(staleExpanded.el.querySelector(".bob-bank-setup-body"));
  assert.ok(staleExpanded.el.querySelector(".bob-bank-setup-body").querySelector(".bob-bank-setup-tiles"));
  const bodyless = paintModel(null, {});
  assert.equal(bodyless.el.querySelector("[data-card-fold]"), null);
  assert.equal(bodyless.el.querySelector(".bob-bank-setup-toggle"), null);
  assert.match(bodyless.el.textContent, /loading/);
});

// The bank card wears its species: data-card-kind="bank" and a badge (the
// bank mark in a plain tile, then the word Bank) leading the head row. The
// aria-label stays exactly "Bank setup", which already leads with the word.
// Foldable states render the shared fold row below the head; bodyless states
// render a static row without fold attributes.
function assertBankIdentity(el, label) {
  assert.equal(el.getAttribute("data-card-kind"), "bank", `${label}: data-card-kind`);
  assert.equal(el.getAttribute("aria-label"), "Bank setup", `${label}: aria-label`);
  assert.equal(el.getAttribute("role"), null, `${label}: no role is added`);
  assert.equal(el.querySelectorAll("[aria-level]").length, 0, `${label}: never a heading`);
  const head = el.querySelector(".bob-bank-setup-head");
  const badge = head.childNodes.filter((node) => node.nodeType === 1)[0];
  assert.equal(badge.getAttribute("class"), "bob-property-card-identity", `${label}: badge leads the head row`);
  assert.equal(badge.getAttribute("data-card-kind"), "bank");
  const [tile, word] = badge.childNodes.filter((node) => node.nodeType === 1);
  assert.equal(tile.getAttribute("data-tile-form"), "plain");
  assert.equal(tile.getAttribute("aria-hidden"), "true");
  assert.equal(tile.textContent, "🏦");
  assert.equal(word.getAttribute("class"), "bob-property-card-identity-word");
  assert.equal(word.textContent, "Bank");
  const fold = el.querySelector(".bob-bank-setup-toggle");
  if (fold) {
    assert.equal(fold.getAttribute("data-card-fold"), "bank", `${label}: fold kind`);
    assert.equal(fold.getAttribute("aria-keyshortcuts"), "_", `${label}: key hint`);
    assert.equal(fold.getAttribute("title"), "Toggle bank setup (_)", `${label}: tooltip`);
    assert.equal(fold.getAttribute("data-bank-setup-focus"), "toggle", `${label}: focus key`);
    assert.match(fold.textContent, /^[▾▸] Setup · /, `${label}: fold grammar`);
    const bodyId = fold.getAttribute("aria-controls");
    assert.ok(bodyId, `${label}: live body id`);
    assert.ok(el.querySelector(`[id="${bodyId}"]`), `${label}: controls resolves`);
  } else {
    assert.equal(el.querySelector("[data-card-fold]"), null, `${label}: bodyless carries no fold`);
  }
}

test("every Setup state wears the bank species badge without changing the toggle or label", () => {
  const states = {
    collapsed: paintModel(decodedReport(), { expanded: false }),
    expanded: paintModel(decodedReport(), { expanded: true }),
    loading: paintModel(null, {}),
    failed: paintModel(null, { error: { code: "timeout", message: "slow" } }),
    unsupported: paintModel(decodedReport(), { error: { code: "unsupported", message: "old bob" } }),
    mobile: paintModel(decodedReport(), { desktop: false }),
    missing: paintModel(decodedReport({ ok: false, state: "missing", categories: [], accounts: [], rules: [], starter: "bank:\n  accounts: {}" }), {}),
  };
  for (const [label, painted] of Object.entries(states)) assertBankIdentity(painted.el, label);
  // The badge carries the bank mark; the collapsed clause drops its emoji.
  assert.match(states.collapsed.el.querySelector(".bob-bank-setup-toggle").textContent, /▸ Setup · WF Checking/);
  assert.doesNotMatch(states.collapsed.el.querySelector(".bob-bank-setup-toggle").textContent, /🏦 WF Checking/);
  assert.equal(states.expanded.el.querySelector(".bob-bank-setup-body").querySelectorAll(".bob-property-card-identity").length, 0);
  assert.equal(states.expanded.el.querySelectorAll(".bob-property-card-identity").length, 1);
});

test("invalid header stays toggleable with a live-region banner and a last-good note", () => {
  const report = decodedReport({
    ok: false,
    state: "invalid",
    partial: true,
    findings: [
      { code: "dup", severity: "error", path: "bank.md", line: 14, key_path: "bank.categories.cafe.hotkey", message: "hotkey taken", hint: null },
    ],
  });
  const { el } = paintModel(report, { lastGoodLabel: "2:14 PM" });
  const toggle = el.querySelector(".bob-bank-setup-toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.match(toggle.textContent, /✗ 1 problem/);
  const banner = el.querySelector(".bob-bank-setup-banner");
  assert.equal(banner.getAttribute("role"), "alert");
  assert.match(banner.textContent, /1 problem in bank:/);
  const finding = el.querySelector(".bob-bank-setup-finding-text");
  assert.equal(finding.getAttribute("data-bank-setup-line"), "14");
  assert.match(el.textContent, /last good · 2:14 PM/);
  const collapsed = paintModel(report, { expanded: false, lastGoodLabel: "2:14 PM" });
  assert.equal(collapsed.el.querySelector(".bob-bank-setup-toggle").getAttribute("aria-expanded"), "false");
  assert.ok(collapsed.el.querySelector(".bob-bank-setup-banner") === null);
  assert.ok(collapsed.el.querySelector(".bob-bank-setup-toggle").textContent.includes("1 problem"));
});

test("missing, unsupported, mobile, and failed states paint their lines", () => {
  const missingReport = decodedReport({ ok: false, state: "missing", categories: [], accounts: [], rules: [], starter: "bank:\n  accounts: {}" });
  const missing = paintModel(missingReport, {});
  assert.match(missing.el.textContent, /no bank: mapping yet/);
  assert.ok(missing.el.querySelector(".bob-bank-setup-copy"));
  const stale = paintModel(null, {});
  assert.match(stale.el.textContent, /loading/);
  const failed = paintModel(null, { error: { code: "timeout", message: "slow" } });
  assert.equal(failed.model.state, "refresh-failed");
  assert.ok(failed.el.querySelector(".bob-bank-retry"));
  const old = paintModel(decodedReport(), { error: { code: "unsupported", message: "old bob" } });
  assert.match(old.el.textContent, /needs a newer bob/);
  const mobile = paintModel(decodedReport(), { desktop: false });
  assert.match(mobile.el.textContent, /drawn by bob on desktop/);
  // The mobile line carries no subprocess-backed data or write affordances.
  assert.equal(mobile.el.querySelectorAll("button[data-bank-setup-category]").length, 0);
});

// --- Lint mark mapping across edits. ---

test("lint marks map through edits and drop from edited lines", () => {
  const findings = [
    { message: "hotkey taken", line: 14, key_path: "bank.categories.cafe.hotkey", severity: "error" },
    { message: "unknown category", line: 30, key_path: "bank.rules.0.cat", severity: "error" },
    { message: "unlocated", line: null, key_path: "bank", severity: "warning" },
  ];
  const marks = H.bankSetupLintMarks(findings);
  assert.equal(marks.length, 2);
  assert.equal(marks[0].tooltip, "bank.categories.cafe.hotkey — hotkey taken");
  // Same-line edit drops only that line.
  assert.deepEqual(
    H.bankSetupMapFindingLines(marks, [{ fromLine: 14, delta: 0 }]).map((mark) => mark.line),
    [30],
  );
  // Insert above shifts both.
  assert.deepEqual(
    H.bankSetupMapFindingLines(marks, [{ fromLine: 10, delta: 2 }]).map((mark) => mark.line),
    [16, 32],
  );
  // Deletion above shifts down; an edit on the line drops it.
  assert.deepEqual(
    H.bankSetupMapFindingLines(marks, [{ fromLine: 5, delta: -1 }]).map((mark) => mark.line),
    [13, 29],
  );
  assert.deepEqual(
    H.bankSetupLintDeltas("a\nb\nc", "a\nB\nc"),
    [{ fromLine: 2, delta: 0 }],
  );
  assert.deepEqual(
    H.bankSetupLintDeltas("a\nc", "a\nb\nc"),
    [{ fromLine: 2, delta: 1 }],
  );
  assert.deepEqual(H.bankSetupLintDeltas("same", "same"), []);
});

// --- Hosts: mount, scoped hide, jumps, lifecycle. ---

function setupApp(overrides = {}) {
  return {
    vault: {
      getAbstractFileByPath: (p) => ({ path: p }),
      cachedRead: async () => "",
      read: async () => "",
    },
    metadataCache: {
      getFileCache: () => ({ frontmatter: {} }),
      on: () => ({}),
    },
    workspace: {
      on: () => ({}),
      getLeavesOfType: () => overrides.leaves || [],
      getMostRecentLeaf: () => null,
      activeLeaf: null,
      openLinkText: async () => {},
    },
  };
}

function makeSetupPlugin(platform, app, subscribe) {
  const Bundle = platform ? loadPlugin(platform) : LedgerToolsPlugin;
  const plugin = new Bundle(setupApp(app), {});
  plugin.applyMarkGateClass = () => {};
  plugin.registerMarkGatePopoutSync = () => {};
  plugin.markGateDocuments = () => [new Document()];
  plugin.apiBankSubscribe = subscribe || ((spec, subscriber) => {
    plugin.subscribedSpec = spec;
    return () => { plugin.unsubscribed = true; };
  });
  return plugin;
}

function hubSurface() {
  const doc = new Document();
  const preview = doc.createElement("div");
  preview.classList.add("markdown-preview-view");
  const h1 = doc.createElement("h1");
  h1.appendChild(doc.createTextNode("🏦 Bank"));
  preview.appendChild(h1);
  const el = doc.createElement("div");
  preview.appendChild(el);
  doc.body.appendChild(preview);
  return { doc, preview, h1, el };
}

function seedReport(plugin, report) {
  const key = plugin.bankSetupConfigKey();
  plugin.bankSetupLastState = {
    results: { [key]: { report, stale: false, error: null, refreshing: false } },
  };
}

test("setup registers surfaces on desktop and skips the fetch on mobile", () => {
  const plugin = makeSetupPlugin(null, {});
  plugin.setupBankSetup();
  assert.equal(plugin.postProcessors.length, 1);
  assert.equal(plugin.extensions.length, 1);
  assert.deepEqual(plugin.subscribedSpec, { command: "config" });
  plugin.teardownBankSetup();
  assert.equal(plugin.unsubscribed, true);
  const mobileBundle = loadPlugin({ isDesktopApp: false, isMobile: true });
  const mobile = new mobileBundle(setupApp({}), {});
  mobile.applyMarkGateClass = () => {};
  mobile.registerMarkGatePopoutSync = () => {};
  mobile.markGateDocuments = () => [new Document()];
  let subscribed = false;
  mobile.apiBankSubscribe = () => { subscribed = true; return () => {}; };
  mobile.setupBankSetup();
  assert.equal(subscribed, false);
  assert.equal(mobile.bankSetupUnsubscribe, null);
  mobile.teardownBankSetup();
});

test("hub mounts once per surface, survives repaint, and leaves other notes alone", () => {
  const plugin = makeSetupPlugin(null, {});
  plugin.setupBankSetup();
  seedReport(plugin, decodedReport());
  const { preview, el } = hubSurface();
  const first = plugin.paintBankSetupReading(el, "bank.md");
  assert.ok(first);
  assert.ok(preview.querySelector(".bob-bank-setup"));
  assert.ok(preview.classList.contains("bob-bank-setup-surface"));
  const second = plugin.paintBankSetupReading(el, "bank.md");
  assert.equal(second, first);
  assert.equal(preview.querySelectorAll(".bob-bank-setup").length, 1);
  const other = hubSurface();
  const miss = plugin.paintBankSetupReading(other.el, "bank/2026-11.md");
  assert.equal(miss, null);
  assert.equal(other.preview.querySelector(".bob-bank-setup"), null);
  assert.ok(!other.preview.classList.contains("bob-bank-setup-surface"));
  plugin.bankSetupReading.add({ el, surface: preview, scope: preview, path: "bank.md" });
  plugin.teardownBankSetup();
  assert.equal(preview.querySelector(".bob-bank-setup"), null);
  assert.ok(!preview.classList.contains("bob-bank-setup-surface"));
});

test("setup header rests collapsed when healthy and toggles per hub in view state", () => {
  const plugin = makeSetupPlugin(null, {});
  plugin.setupBankSetup();
  seedReport(plugin, decodedReport());
  const { el, preview } = hubSurface();
  plugin.paintBankSetupReading(el, "bank.md");
  const toggle = preview.querySelector(".bob-bank-setup-toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.match(toggle.textContent, /▸ Setup · WF Checking/);
  assert.equal(toggle.getAttribute("data-card-fold"), "bank");
  const body = preview.querySelector(".bob-bank-setup-body");
  assert.ok(body);
  assert.equal(body.getAttribute("hidden"), "");
  assert.equal(body.querySelector(".bob-bank-category-tile"), null);
  const bodyId = toggle.getAttribute("aria-controls");
  assert.equal(preview.querySelector(`[id="${bodyId}"]`), body);
  plugin.bankSetupToggleExpanded("bank.md");
  plugin.paintBankSetupReading(el, "bank.md");
  const expanded = preview.querySelector(".bob-bank-setup-toggle");
  assert.equal(expanded.getAttribute("aria-expanded"), "true");
  assert.ok(preview.querySelector(".bob-bank-setup-body"));
  assert.ok(preview.querySelector(".bob-bank-setup-body").querySelector(".bob-bank-category-tile"));
  plugin.bankSetupToggleExpanded("bank.md");
  plugin.paintBankSetupReading(el, "bank.md");
  const collapsed = preview.querySelector(".bob-bank-setup-toggle");
  assert.equal(collapsed.getAttribute("aria-expanded"), "false");
  assert.equal(preview.querySelector(".bob-bank-setup-body").getAttribute("hidden"), "");
  plugin.teardownBankSetup();
});

test("invalid setup opens by default, holds an explicit collapse, and resurfaces on new findings", () => {
  const plugin = makeSetupPlugin(null, {});
  plugin.setupBankSetup();
  const invalid = decodedReport({
    ok: false,
    state: "invalid",
    findings: [{ code: "dup", severity: "error", path: "bank.md", line: 14, key_path: "bank.a", message: "first", hint: null }],
  });
  seedReport(plugin, invalid);
  const { el, preview } = hubSurface();
  plugin.paintBankSetupReading(el, "bank.md");
  assert.equal(preview.querySelector(".bob-bank-setup-toggle").getAttribute("aria-expanded"), "true");
  plugin.bankSetupToggleExpanded("bank.md");
  plugin.paintBankSetupReading(el, "bank.md");
  assert.equal(preview.querySelector(".bob-bank-setup-toggle").getAttribute("aria-expanded"), "false");
  const changed = decodedReport({
    ok: false,
    state: "invalid",
    findings: [{ code: "dup", severity: "error", path: "bank.md", line: 14, key_path: "bank.a", message: "second", hint: null }],
  });
  seedReport(plugin, changed);
  plugin.paintBankSetupReading(el, "bank.md");
  assert.equal(preview.querySelector(".bob-bank-setup-toggle").getAttribute("aria-expanded"), "true");
  plugin.teardownBankSetup();
});

test("hiding never touches document.body and is owned only by bob-bank-setup-surface", () => {
  const plugin = makeSetupPlugin(null, {});
  plugin.setupBankSetup();
  seedReport(plugin, decodedReport());
  const { doc, preview, el } = hubSurface();
  doc.body.classList.add("bogus-body-gate");
  plugin.paintBankSetupReading(el, "bank.md");
  assert.ok(preview.classList.contains("bob-bank-setup-surface"));
  assert.ok(!preview.classList.contains("bob-bank-hub-note"));
  assert.ok(!doc.body.classList.contains("bob-bank-hub-note"));
  assert.equal(typeof plugin.bankMarkSyncHubProperty, "undefined");
  const other = hubSurface();
  plugin.paintBankSetupReading(other.el, "bank/2026-11.md");
  assert.ok(!other.preview.classList.contains("bob-bank-setup-surface"));
  assert.ok(!other.preview.classList.contains("bob-bank-hub-note"));
  plugin.teardownBankSetup();
  assert.ok(!preview.classList.contains("bob-bank-setup-surface"));
  assert.ok(!doc.body.classList.contains("bob-bank-hub-note"));
});

test("tile, account, and finding jumps open Source mode on the exact line", async () => {
  const plugin = makeSetupPlugin(null, {});
  const opened = {};
  const cursor = {};
  const scrolled = {};
  const leaf = {
    view: {
      file: { path: "bank.md" },
      editor: {
        setCursor: (pos) => Object.assign(cursor, pos),
        scrollIntoView: (range) => Object.assign(scrolled, range),
      },
    },
    openFile: async (file, opts) => Object.assign(opened, { file, opts }),
  };
  plugin.app.workspace.getLeavesOfType = () => [leaf];
  const result = await plugin.bankSetupJumpYaml("bank.md", 14);
  assert.equal(result.ok, true);
  assert.equal(result.line, 14);
  assert.equal(opened.file.path, "bank.md");
  assert.equal(opened.opts.state.mode, "source");
  assert.equal(opened.opts.state.source, true);
  assert.deepEqual(cursor, { line: 13, ch: 0 });
  assert.ok(scrolled.from);
});

// --- Queue card pointer. ---

test("queue card points at Setup instead of the raw first message", () => {
  const plugin = makeSetupPlugin(null, {});
  const failure = { code: "bob-error", message: "bank.accounts: must be a mapping", configProblems: 2 };
  assert.equal(plugin.bankCardConfigProblems({ error: failure }), 2);
  assert.equal(plugin.bankCardConfigProblems({ error: { code: "failed", message: "down" } }), 0);
  assert.equal(plugin.bankCardConfigProblems({ report: null, error: null }), 0);
  const partial = {
    report: { findings: [{ severity: "error" }, { severity: "warning" }] },
    error: null,
  };
  assert.equal(plugin.bankCardConfigProblems(partial), 1);
  const doc = new Document();
  const root = doc.createElement("div");
  const calls = [];
  plugin.apiBankRefresh = async () => { calls.push("refresh"); return {}; };
  plugin.bankCardPaintRefreshState(root, { stale: false, error: failure }, {}, { command: "list" });
  assert.match(root.textContent, /bank: has 2 problems — see Setup above/);
  assert.doesNotMatch(root.textContent, /must be a mapping/);
  assert.ok(root.querySelector(".bob-bank-card-error"));
});

// --- Bank Setup card (setup-card). ---

test("Setup card model preserves Category-card order and maps category gestures to guarded ops", () => {
  const report = configReport({
    categories: [
      configCategory(),
      configCategory({ key: "groceries", emoji: "🛒", label: "Groceries", hotkey: "g", line: 14, source_line: 14, rows: 2 }),
      configCategory({ key: "income", emoji: "💵", label: "Income", builtin: true, declared: false, hotkey: "i", hotkey_source: "builtin_default", group: "Money moves", line: null, source_line: null, rows: 1 }),
      configCategory({ key: "kids", emoji: "🧸", label: "Kids", hotkey: null, hotkey_source: "none", hidden: true, line: 20, source_line: 20, rows: 3 }),
    ],
  });
  const model = H.bankSetupCardModel(report);
  assert.equal(model.state, "valid");
  assert.deepEqual(model.sections.map((section) => section.group), ["Everyday", "Money moves"]);
  assert.deepEqual(model.sections[0].tiles.map((tile) => tile.key), ["coffee", "groceries"]);
  assert.equal(model.hiddenTiles[0].key, "kids");
  assert.equal(H.bankSetupCardSelectionByHotkey(report.categories, "g").key, "groceries");
  assert.equal(H.bankSetupCardSelectionByHotkey(report.categories, "q"), null);

  assert.deepEqual(H.bankSetupCardSetCategoryOp(report.categories[0], {
    label: "Cafe", group: "Everyday", hotkey: "c", hotkeyTouched: false,
  }), { op: "category.set", key: "coffee", set: { label: "☕ Cafe" } });
  assert.deepEqual(H.bankSetupCardSetCategoryOp(report.categories[0], {
    label: "Coffee", group: "", hotkey: "", hotkeyTouched: false,
  }), { op: "category.set", key: "coffee", unset: ["group"] });
  const derived = configCategory({ key: "market", emoji: "", label: "Market", hotkey: "m", hotkey_source: "derived" });
  assert.deepEqual(H.bankSetupCardSetCategoryOp(derived, {
    label: "Market", group: "Everyday", hotkey: "m", hotkeyTouched: true,
  }), { op: "category.set", key: "market", set: { hotkey: "m" } });
  assert.deepEqual(H.bankSetupCardCategoryMoveOp(report.categories, "coffee", "forward"), {
    op: "category.move", key: "coffee", after: "groceries",
  });
  const grouped = report.categories.concat(configCategory({ key: "family", label: "Family", group: "Family", hotkey: "f" }));
  assert.deepEqual(H.bankSetupCardGroupMoveOp(grouped, "Everyday", "forward"), {
    op: "group.move", group: "Everyday", after: "Family",
  });
  assert.deepEqual(H.bankSetupCardHiddenOp(report.categories[0]), {
    op: "category.set", key: "coffee", set: { hidden: true },
  });
  assert.deepEqual(H.bankSetupCardRemoveOp(report.categories[0]), { op: "category.remove", key: "coffee" });
  assert.equal(H.bankSetupCardRemoveOp(report.categories[2]), null);
  assert.deepEqual(H.bankSetupCardRestoreOp(configCategory({ key: "income", builtin: true, declared: true })), {
    op: "category.reset", key: "income",
  });
  assert.deepEqual(H.bankSetupCardGroupRenameOp("Everyday", "Daily"), {
    op: "group.rename", group: "Everyday", to: "Daily",
  });
});

function setupCardPlugin(report = configReport()) {
  const plugin = makeSetupPlugin(null, { document: new Document() });
  plugin.bankSetupCardActive = true;
  plugin.bankVaultGeneration = 1;
  plugin.apiBankRefresh = async () => ({ report, stale: false, error: null, generation: 1 });
  plugin.applyOps = [];
  plugin.previewAttempts = 0;
  plugin.apiBankConfigUpdatePreview = async (envelopeText) => {
    plugin.previewAttempts += 1;
    const op = JSON.parse(envelopeText).ops[0];
    if (plugin.previewAttempts === 1 && plugin.staleFirstPreview) {
      return { ok: true, report: { ok: false, failure: { code: "stale_config", message: "bank config changed" } } };
    }
    return { ok: true, report: { ok: true, dry_run: true, changed: true, consequence: `Preview ${op.op}`, after_fingerprint: "sha256:abc", per_op: [], inverse_ops: [] } };
  };
  plugin.apiBankConfigUpdateApply = async (envelopeText) => {
    const op = JSON.parse(envelopeText).ops[0];
    plugin.applyOps.push(op);
    return {
      ok: true,
      report: {
        ok: true, dry_run: false, changed: true,
        after_fingerprint: "sha256:next", inverse_ops: [{ op: "category.set", key: "coffee", set: { label: "Coffee" } }],
        categories: report.categories, per_op: [{ op: op.op, key: op.key || "coffee" }], warnings: [], sync: null,
      },
    };
  };
  plugin.apiBankConfigVaultSyncRetry = async () => ({ ok: true });
  plugin.app.workspace.getLeavesOfType = () => [];
  return plugin;
}

test("Setup card selects by key, protects focused typing, and stages shared New category input", async () => {
  const plugin = setupCardPlugin();
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: configReport() });
  modal.open();
  const before = modal.selection?.id;
  const typed = { key: "g", target: { closest: () => ({}) }, preventDefault() { this.prevented = true; }, stopPropagation() {} };
  modal.onKeyDown(typed);
  assert.equal(modal.selection?.id, before, "letters in an input do not select a category");
  assert.equal(typed.prevented, undefined);
  const key = { key: "g", preventDefault() {}, stopPropagation() {} };
  modal.onKeyDown(key);
  assert.equal(modal.selection.key, "groceries");
  const categoryButton = { getAttribute: (name) => name === "data-setup-card-category" ? "coffee" : null };
  const enter = {
    key: "Enter",
    target: { closest: (selector) => selector === "[data-setup-card-category]" ? categoryButton : null },
    preventDefault() {}, stopPropagation() {},
  };
  modal.onKeyDown(enter);
  assert.equal(modal.selection.key, "coffee", "first Enter selects the focused category");
  assert.equal(modal.stage, null);
  modal.onKeyDown(enter);
  assert.equal(modal.stage.kind, "edit", "second Enter edits the selected category");
  modal.cancelStage();
  modal.openNewCategoryStage();
  assert.equal(modal.stage.kind, "new");
  assert.equal(modal.stage.group, "Everyday");
  modal.onFieldInput("label", "🍔 Fast food");
  assert.deepEqual(modal.session.getState().draftOps, [{ op: "category.add", label: "🍔 Fast food", group: "Everyday", hotkey: "a" }]);
  const cancel = { key: "q", target: { closest: () => ({}) }, preventDefault() { this.prevented = true; }, stopPropagation() {} };
  await modal.onKeyDown(cancel);
  assert.equal(cancel.prevented, undefined, "q in an input types instead of cancelling the stage");
  assert.equal(modal.stage.kind, "new");
  modal.close();
});

test("Setup checks YAML action preserves its located line through one delegated click", () => {
  const plugin = setupCardPlugin();
  const calls = [];
  plugin.bankSetupStartYamlExcursion = async (options) => { calls.push(options); return { ok: true }; };
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: configReport() });
  modal.open();
  const action = { getAttribute: (name) => name === "data-setup-action" ? "yaml" : name === "data-setup-line" ? "42" : null };
  const event = {
    target: { closest: (selector) => selector === "[data-setup-action]" ? action : null },
    preventDefault() {}, stopPropagation() {},
  };
  modal.onClick(event);
  assert.equal(modal.closed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].line, 42);
});

test("Setup card requires a current preview before Apply and exposes the shared Undo stage", async () => {
  const plugin = setupCardPlugin();
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: configReport() });
  modal.open();
  modal.beginGesture({ op: "category.set", key: "coffee", set: { hidden: true } }, "Hide Coffee");
  assert.equal(await modal.applyStage(), false, "Enter is inert while the preview is pending");
  assert.equal(plugin.applyOps.length, 0);
  await modal.session.previewNow();
  assert.equal(modal.session.getState().canApply, true);
  assert.equal(await modal.applyStage(), true);
  assert.deepEqual(plugin.applyOps[0], { op: "category.set", key: "coffee", set: { hidden: true } });
  assert.equal(modal.savedMessage, "Saved · Ctrl+Z undo");
  assert.equal(modal.stageUndo(), true);
  assert.equal(modal.stage.kind, "undo");
  assert.deepEqual(modal.session.getState().draftOps, [{ op: "category.set", key: "coffee", set: { label: "Coffee" } }]);
  modal.close();
});

test("stale Setup preview refreshes data, keeps the draft, and waits for explicit re-preview", async () => {
  const plugin = setupCardPlugin();
  plugin.staleFirstPreview = true;
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: configReport() });
  modal.open();
  modal.beginGesture({ op: "category.set", key: "coffee", set: { hidden: true } }, "Hide Coffee");
  const first = await modal.session.previewNow();
  assert.equal(first.ok, false);
  await modal.staleRefreshFlight;
  assert.equal(modal.staleMessage.includes("draft is kept"), true);
  assert.deepEqual(modal.session.getState().draftOps, [{ op: "category.set", key: "coffee", set: { hidden: true } }]);
  assert.equal(modal.session.getState().canApply, false);
  assert.equal(await modal.repreview(), true);
  assert.equal(modal.session.getState().canApply, true);
  modal.close();
});

test("invalid config opens Checks read-only and the palette command is registered", async () => {
  const invalid = configReport({
    ok: false,
    state: "invalid",
    findings: [{ severity: "error", line: 14, message: "duplicate hotkey", key_path: "bank.categories.coffee.hotkey" }],
  });
  const plugin = setupCardPlugin(invalid);
  plugin.setupBankSetupCard();
  assert.ok(plugin.commands.some((command) => command.id === "edit-bank-setup" && command.name === "Edit bank setup"));
  const opened = await plugin.openBankSetupCard();
  assert.equal(opened.modal.section, "checks");
  assert.equal(opened.modal.readOnly, true);
  opened.modal.close();
  plugin.teardownBankSetupCard();
});

test("Setup card paints its loading shell before the first report arrives", () => {
  const modal = new H.BankSetupCardModal({ document: new Document() }, { report: null });
  modal.errorMessage = "Loading the current bank config…";
  modal.open();
  assert.equal(modal.model.state, "loading");
  assert.match(modal.errorMessage, /Loading the current bank config/);
  modal.close();
});

test("bank YAML Done stays on an invalid line and returns only after a valid fresh report", async () => {
  const invalid = configReport({ ok: false, state: "invalid", findings: [{ severity: "error", line: 14, message: "duplicate hotkey" }] });
  const plugin = setupCardPlugin(invalid);
  plugin.albumYamlExcursionDisposed = false;
  plugin.albumYamlExcursions = new Map();
  plugin.albumYamlSaveExcursionEditors = async () => ({ ok: true });
  const cursor = {};
  const leaf = { view: { file: { path: "bank.md" }, editor: { setCursor: (value) => Object.assign(cursor, value) } } };
  const record = { albumPath: "bank.md", kind: "bank", viewState: {}, selectedSection: "categories", reopenCard: false };
  plugin.albumYamlExcursions.set(leaf, record);
  const refused = await plugin.bankSetupYamlDoneAttempt(leaf, record);
  assert.equal(refused.reason, "invalid-config");
  assert.deepEqual(cursor, { line: 13, ch: 0 });
  assert.equal(plugin.albumYamlExcursions.has(leaf), true);
  plugin.apiBankRefresh = async () => ({ report: configReport(), stale: false, error: null, generation: 2 });
  const accepted = await plugin.bankSetupYamlDoneAttempt(leaf, record);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.reopened, false);
  assert.equal(plugin.albumYamlExcursions.has(leaf), false);
});

test("valid bank YAML Done restores the prior view and reopens the card selection", async () => {
  const plugin = setupCardPlugin();
  plugin.albumYamlExcursionDisposed = false;
  plugin.albumYamlExcursions = new Map();
  plugin.albumYamlSaveExcursionEditors = async () => ({ ok: true });
  const leaf = {
    view: { file: { path: "bank.md" }, editor: {} },
    setViewState: async (state) => {
      leaf.view.file.path = state.state.file;
      plugin.albumYamlExcursionHandleFileOpen({ path: state.state.file });
    },
  };
  const selection = { type: "category", key: "groceries", group: "Everyday", id: "category:groceries" };
  const record = {
    albumPath: "bank.md", kind: "bank", viewState: { state: { file: "daily.md" } },
    selectedSection: "rules", selection, reopenCard: true,
  };
  plugin.albumYamlExcursions.set(leaf, record);
  let reopenedOptions = null;
  plugin.openBankSetupCard = async (options) => { reopenedOptions = options; return { modal: {} }; };
  const result = await plugin.bankSetupYamlDoneAttempt(leaf, record);
  assert.deepEqual(result, { ok: true, reopened: true });
  assert.deepEqual(reopenedOptions, { report: configReport(), section: "rules", selection });
  assert.equal(plugin.albumYamlExcursions.has(leaf), false);
  assert.equal(leaf.view.file.path, "daily.md");
});

test("Setup header shows Edit on desktop valid/invalid states and degrades without it on mobile", () => {
  const doc = new Document();
  const valid = H.bankSetupModel(configReport(), { desktop: true });
  assert.ok(H.bankSetupBuildEl(valid, {}, doc).querySelector(".bob-bank-setup-edit"));
  const invalid = H.bankSetupModel(configReport({ ok: false, state: "invalid" }), { desktop: true });
  assert.ok(H.bankSetupBuildEl(invalid, {}, doc).querySelector(".bob-bank-setup-edit"));
  const mobile = H.bankSetupModel(configReport(), { desktop: false });
  assert.equal(H.bankSetupBuildEl(mobile, {}, doc).querySelector(".bob-bank-setup-edit"), null);
});

// --- Bank Setup card (setup-card-more): Accounts, Rules, Checks. ---

test("Setup card models accounts, rules, and findings alongside categories", () => {
  const report = configReport({
    accounts: [
      configAccount(),
      configAccount({ alias: "savings", label: "WF Savings", kind: "savings", default: false, start: "2026-12-01", rows: 0 }),
    ],
    rules: [
      { index: 0, match: "VENMO", payee: "Venmo", cat: "groceries", link: null, line: 30, source_line: 30 },
      { index: 1, match: "ACME1234", payee: null, cat: "coffee", link: null, line: 31, source_line: 31 },
    ],
    findings: [{ severity: "error", line: 14, message: "duplicate hotkey", key_path: "bank.categories.coffee.hotkey" }],
  });
  const model = H.bankSetupCardModel(report);
  assert.equal(model.accountItems.length, 2);
  assert.equal(model.ruleItems.length, 2);
  assert.equal(model.findingItems.length, 1);
  // Existing category items are unchanged.
  assert.ok(model.items.some((item) => item.id === "category:coffee"));
  assert.deepEqual(H.bankSetupCardSelection(model, "account:savings"), {
    type: "account", key: null, group: null, alias: "savings", index: null, id: "account:savings",
  });
  assert.deepEqual(H.bankSetupCardSelection(model, "rule:1"), {
    type: "rule", key: null, group: null, alias: null, index: 1, id: "rule:1",
  });
  assert.deepEqual(H.bankSetupCardSelection(model, "finding:0"), {
    type: "finding", key: null, group: null, alias: null, index: 0, id: "finding:0",
  });
  const moved = H.bankSetupCardMoveRuleSelection(model, { id: "rule:0" }, "forward");
  assert.equal(moved.id, "rule:1");
  const movedAccount = H.bankSetupCardMoveAccountSelection(model, { id: "account:checking" }, "forward");
  assert.equal(movedAccount.id, "account:savings");
  const stale = H.bankSetupCardMoveFindingSelection(model, { id: "finding:0" }, "forward");
  assert.equal(stale.id, "finding:0", "a single finding stays put");
});

test("Setup card maps account, rule, and stale-after gestures to guarded ops", () => {
  const accounts = [configAccount(), configAccount({ alias: "savings", label: "WF Savings", kind: "savings", rows: 0 })];
  assert.deepEqual(H.bankSetupCardAccountAddOp({ label: "WF Savings", kind: "savings", start: "2026-12-01" }), {
    op: "account.add", label: "WF Savings", kind: "savings", start: "2026-12-01",
  });
  assert.equal(H.bankSetupCardAccountAddOp({ label: "Nope", kind: "checking" }), null, "start is required except for cash");
  assert.deepEqual(H.bankSetupCardAccountAddOp({ label: "Cash", kind: "cash" }), {
    op: "account.add", label: "Cash", kind: "cash",
  });
  assert.equal(H.bankSetupCardAccountAddStatus(accounts, { label: "Savings", kind: "savings", start: "2026-12-01" }).kind, "taken");
  assert.equal(H.bankSetupCardDeriveAccountAlias("WF Savings"), "wf_savings");
  assert.deepEqual(H.bankSetupCardAccountSetOp(configAccount(), { label: "WF Checking!" }), {
    op: "account.set", alias: "checking", set: { label: "WF Checking!" },
  });
  assert.equal(H.bankSetupCardAccountSetOp(configAccount(), { label: "WF Checking" }), null);
  assert.deepEqual(H.bankSetupCardAccountRemoveOp(configAccount()), { op: "account.remove", alias: "checking" });

  const categories = configReport().categories;
  assert.deepEqual(H.bankSetupCardRuleAddOp({ match: "VENMO", cat: "coffee" }, categories), {
    op: "rule.add", match: "VENMO", cat: "coffee",
  });
  assert.equal(H.bankSetupCardRuleAddOp({ match: "", cat: "coffee" }, categories), null);
  assert.equal(H.bankSetupCardRuleAddOp({ match: "X", cat: "nope" }, categories), null, "unknown categories stay inert");
  const rules = [
    { index: 0, match: "VENMO", payee: "Venmo", cat: "groceries", link: null, line: 30 },
    { index: 1, match: "ACME", payee: null, cat: "coffee", link: null, line: 31 },
  ];
  assert.deepEqual(H.bankSetupCardRuleMoveOp(rules, 0, "forward"), { op: "rule.move", index: 0, match_was: "VENMO", position: 1 });
  assert.equal(H.bankSetupCardRuleMoveOp(rules, 1, "forward"), null, "the last rule cannot move forward");
  assert.deepEqual(H.bankSetupCardRuleRemoveOp(rules[0]), { op: "rule.remove", index: 0, match_was: "VENMO" });
  assert.deepEqual(H.bankSetupCardRuleSetOp(rules[0], { match: "VENMO", payee: "", cat: "groceries", link: null }, categories), {
    op: "rule.set", index: 0, match_was: "VENMO", unset: ["payee"],
  });
  assert.equal(H.bankSetupCardRuleSetOp(rules[0], { match: "VENMO", payee: "Venmo", cat: "groceries", link: null }, categories), null);
  assert.deepEqual(H.bankSetupCardStaleAfterOp("10"), { op: "bank.set", set: { stale_after: 10 } });
  assert.deepEqual(H.bankSetupCardStaleAfterUnsetOp(), { op: "bank.set", unset: ["stale_after"] });
});

test("Setup card paints interactive account, rule, and finding rows", () => {
  const doc = new Document();
  const report = configReport();
  const model = H.bankSetupCardModel(report);
  const fakeModal = (section) => ({
    section,
    selection: null,
    report,
    readOnly: false,
    busy: false,
    selectItem() { return false; },
    openYaml() { return false; },
  });
  const accountsPanel = doc.createElement("div");
  H.bankSetupCardPaintAccounts(accountsPanel, fakeModal("accounts"), model);
  assert.ok(accountsPanel.querySelector("[data-setup-card-account]"), "accounts paint as selectable rows");
  assert.ok(accountsPanel.querySelector("[data-setup-new-account]"), "accounts offer + Add account");
  assert.match(accountsPanel.textContent, /\[acct:: checking\]/);
  assert.match(accountsPanel.textContent, /Balances go stale after/);
  const rulesPanel = doc.createElement("div");
  H.bankSetupCardPaintRules(rulesPanel, fakeModal("rules"), model);
  assert.ok(rulesPanel.querySelector("[data-setup-card-rule]"), "rules paint as numbered rows");
  assert.ok(rulesPanel.querySelector("[data-setup-new-rule]"), "rules offer + New rule");
  assert.match(rulesPanel.textContent, /VENMO/);
  const checksPanel = doc.createElement("div");
  H.bankSetupCardPaintChecks(checksPanel, fakeModal("checks"), model);
  assert.match(checksPanel.textContent, /valid — bob uses it as shown/);
  const invalid = configReport({
    ok: false,
    state: "invalid",
    findings: [{ severity: "error", line: 14, message: "duplicate hotkey", key_path: "bank.categories.coffee.hotkey" }],
  });
  const invalidModel = H.bankSetupCardModel(invalid);
  const invalidPanel = doc.createElement("div");
  H.bankSetupCardPaintChecks(invalidPanel, { ...fakeModal("checks"), report: invalid }, invalidModel);
  assert.ok(invalidPanel.querySelector("[data-setup-card-finding]"), "findings are selectable");
  const plugin = setupCardPlugin();
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report });
  modal.open();
  modal.setSection("accounts");
  assert.match(modal.footerText(), /relabel/);
  modal.setSection("rules");
  assert.match(modal.footerText(), /Alt\+J\/K move/);
  modal.setSection("checks");
  assert.match(modal.footerText(), /open line/);
  modal.close();
});

test("Setup card stages account and rule gestures through bob previews", async () => {
  const plugin = setupCardPlugin();
  const twoRules = configReport({
    rules: [
      { index: 0, match: "VENMO", payee: "Venmo", cat: "coffee", link: null, line: 30, source_line: 30 },
      { index: 1, match: "ACME", payee: null, cat: "groceries", link: null, line: 31, source_line: 31 },
    ],
  });
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: twoRules });
  modal.open();
  modal.setSection("accounts");
  modal.openNewAccountStage();
  assert.equal(modal.stage.kind, "new-account");
  modal.onFieldInput("label", "WF Savings");
  modal.onFieldInput("kind", "savings");
  modal.onFieldInput("start", "2026-12-01");
  assert.deepEqual(modal.stageDraftOp(), {
    op: "account.add", label: "WF Savings", kind: "savings", start: "2026-12-01",
  });
  modal.cancelStage();
  modal.selection = { type: "account", key: null, group: null, alias: "checking", index: null, id: "account:checking" };
  modal.paint();
  assert.equal(modal.beginSelectedGesture("edit")?.kind || modal.stage?.kind, "edit-account");
  modal.cancelStage();

  modal.setSection("rules");
  modal.openNewRuleStage();
  assert.equal(modal.stage.kind, "new-rule");
  modal.onFieldInput("match", "VENMO");
  modal.onFieldInput("cat", "coffee");
  assert.deepEqual(modal.stageDraftOp(), { op: "rule.add", match: "VENMO", cat: "coffee" });
  modal.cancelStage();
  const plus = { key: "+", target: { closest: () => null }, preventDefault() {}, stopPropagation() {} };
  modal.onKeyDown(plus);
  assert.equal(modal.stage.kind, "new-rule", "+ in the Rules section opens a rule stage");
  modal.cancelStage();
  const firstRule = modal.model.ruleItems[0];
  modal.selection = { type: "rule", key: null, group: null, alias: null, index: firstRule.entry.index, id: firstRule.id };
  modal.paint();
  assert.equal(modal.beginSelectedGesture("move", "forward"), true);
  assert.equal(modal.stage, null, "rule moves no longer open a confirm stage");
  assert.equal(modal.bankArrangeDirty(), true, "a rule move is a local arrangement");
  modal.bankArrangeRevert();
  assert.equal(modal.bankArrangeDirty(), false);
  modal.openStaleAfterStage();
  assert.equal(modal.stage.kind, "stale-after");
  modal.onFieldInput("stale-after", "14");
  assert.deepEqual(modal.stageDraftOp(), { op: "bank.set", set: { stale_after: 14 } });
  modal.cancelStage();
  modal.close();
});

test("Setup card checks Enter jumps to the finding line", async () => {
  const plugin = setupCardPlugin();
  const calls = [];
  plugin.bankSetupStartYamlExcursion = async (options) => { calls.push(options); return { ok: true }; };
  const invalid = configReport({
    ok: false,
    state: "invalid",
    findings: [{ severity: "error", line: 14, message: "duplicate hotkey", key_path: "bank.categories.coffee.hotkey" }],
  });
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: invalid });
  modal.open();
  assert.equal(modal.section, "checks");
  const finding = { getAttribute: (name) => name === "data-setup-card-finding" ? "0" : null };
  modal.onKeyDown({
    key: "Enter",
    target: { closest: (selector) => selector === "[data-setup-card-finding]" ? finding : null },
    preventDefault() {}, stopPropagation() {},
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].line, 14);
  modal.close();
});

test("Setup card paints lock wait as pending and Esc stops without closing", async () => {
  const plugin = setupCardPlugin();
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: configReport() });
  modal.open();
  let stopped = 0;
  modal.session = {
    getState: () => modal.sessionState,
    stopWaiting() {
      stopped += 1;
      modal.sessionState = {
        status: "preview-ready",
        canApply: true,
        lockWait: null,
        lockNotice: { message: "Stopped waiting for another Bob vault maintenance run.", hint: "Nothing was written. Press Enter to try again." },
      };
      return modal.sessionState;
    },
  };
  modal.sessionState = {
    status: "applying",
    busy: true,
    canApply: false,
    lockWait: { since: 0, elapsedMs: 42000, attempts: 2, stopping: false },
  };
  assert.match(H.bankSetupCardStatusText(modal), /Waiting for another Bob vault maintenance run… 42s/);
  assert.equal(H.bankSetupCardStatusTone(modal), "is-previewing");
  assert.deepEqual(H.bankSetupCardHintItems(modal).map((item) => item.label), ["stop waiting"]);
  await modal.onKeyDown({
    key: "Escape",
    target: { closest: () => null },
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(stopped, 1);
  assert.equal(modal.closed, false);
  assert.match(H.bankSetupCardStatusText(modal), /Stopped waiting/);
  assert.match(H.bankSetupCardStatusText(modal), /Nothing was written/);
  assert.equal(H.bankSetupCardStatusTone(modal), "is-previewing");
  modal.close();
});

test("q, Ctrl+[, and onEscapeKey stop a lock wait without closing", async () => {
  for (const makeEvent of [
    () => ({ key: "q", target: { closest: () => null }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }),
    () => ({ key: "[", ctrlKey: true, code: "BracketLeft", target: { closest: () => null }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }),
  ]) {
    const plugin = setupCardPlugin();
    const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: configReport() });
    modal.open();
    let stopped = 0;
    modal.session = {
      getState: () => modal.sessionState,
      stopWaiting() {
        stopped += 1;
        modal.sessionState = { status: "preview-ready", canApply: true, lockWait: null };
        return modal.sessionState;
      },
    };
    modal.sessionState = { status: "applying", busy: false, canApply: false, lockWait: { since: 0, attempts: 1 } };
    await modal.onKeyDown(makeEvent());
    assert.equal(stopped, 1);
    assert.equal(modal.closed, false, "stopping the wait keeps the card open");
    modal.close();
  }
  const plugin = setupCardPlugin();
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: configReport() });
  modal.open();
  let stopped = 0;
  modal.session = {
    getState: () => modal.sessionState,
    stopWaiting() {
      stopped += 1;
      modal.sessionState = { status: "preview-ready", canApply: true, lockWait: null };
      return modal.sessionState;
    },
  };
  modal.sessionState = { status: "applying", busy: false, canApply: false, lockWait: { since: 0, attempts: 1 } };
  modal.onEscapeKey({ preventDefault() {}, stopPropagation() {} });
  assert.equal(stopped, 1);
  assert.equal(modal.closed, false, "onEscapeKey stops waiting instead of closing");
  modal.close();
});

test("onEscapeKey cancels a stage without closing, then closes from browsing", async () => {
  const plugin = setupCardPlugin();
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: configReport() });
  modal.open();
  modal.beginGesture({ op: "category.set", key: "coffee", set: { hidden: true } }, "Hide Coffee");
  assert.ok(modal.stage, "a stage opens");
  modal.onEscapeKey({ preventDefault() {}, stopPropagation() {} });
  assert.equal(modal.stage, null, "onEscapeKey cancels the stage");
  assert.equal(modal.closed, false, "the card stays open");
  let closed = false;
  const origClose = modal.close.bind(modal);
  modal.close = () => { closed = true; return origClose(); };
  const outside = { closest: () => null };
  for (const key of ["q", "Escape"]) {
    closed = false;
    const event = key === "q"
      ? { key: "q", target: outside, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }
      : { key: "Escape", target: outside, preventDefault() {}, stopPropagation() {} };
    await modal.onKeyDown(event);
    if (key === "q") assert.equal(event.defaultPrevented, true, "q from the editor is consumed");
    assert.equal(closed, true, `${key} closes from browsing`);
    modal.closed = false;
  }
  modal.close = origClose;
  modal.close();
});

test("bank scope handler routes q/Ctrl+[ through backOut and leaves other keys alone", async () => {
  const plugin = setupCardPlugin();
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: configReport() });
  modal.scope = {
    register: (m, k, fn) => { modal.__captured = fn; return 11; },
    unregister: (ref) => { modal.__unregistered = ref; },
  };
  modal.open();
  assert.equal(typeof modal.__captured, "function", "the scope handler is registered on open");
  for (const key of ["j", "a", "Enter"]) {
    const event = { key, target: { closest: () => null }, preventDefault() { this.touched = true; }, stopPropagation() {} };
    assert.equal(modal.__captured(event), true, `${key} passes through untouched`);
    assert.equal(event.touched, undefined);
  }
  const outside = { closest: () => null };
  let closed = false;
  const origClose = modal.close.bind(modal);
  modal.close = () => { closed = true; return origClose(); };
  const qEvent = { key: "q", target: outside, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  assert.equal(modal.__captured(qEvent), false, "q from the editor is handled");
  assert.equal(qEvent.defaultPrevented, true, "q is consumed so Vim never sees it");
  assert.equal(closed, true, "q closes through the scope path");
  modal.close = origClose;
  modal.close();
  assert.equal(modal.__unregistered, 11, "onClose unregisters the handler");
});

test("bank plain-browsing close hint reads esc/q", () => {
  const plugin = setupCardPlugin();
  const modal = new H.BankSetupCardModal(plugin.app, { plugin, report: configReport() });
  modal.open();
  const items = H.bankSetupCardHintItems(modal);
  const close = items.find((item) => item.label === "close");
  assert.ok(close, "a close chip exists");
  assert.equal(close.keys, "esc/q");
  modal.close();
});
