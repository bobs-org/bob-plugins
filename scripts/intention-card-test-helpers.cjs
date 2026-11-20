// Shared fakes for the intention card landing tests: an Obsidian/CodeMirror
// module stub, a small DOM with the selectors the editor uses, a vault whose
// metadata can lag its disk bytes, and controllable promises.
const Module = require("node:module");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
  addCommand(command) { (this.commands ||= []).push(command); return command; }
}

const editorLivePreviewField = { live: true };

class StubWidgetType { eq() { return false; } }
class StubRangeSetBuilder {
  constructor() { this.ranges = []; }
  add(from, to, value) { this.ranges.push({ from, to, value }); }
  finish() { return { ranges: this.ranges }; }
}
const StubDecoration = { none: { ranges: [] }, widget: (spec) => ({ spec }) };

function loadLedgerTools() {
  const originalLoad = Module._load;
  Module._load = function loadWithStubs(request, parent, isMain) {
    if (request === "obsidian") {
      return {
        MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
        MarkdownView: class {}, Notice: class { constructor(text) { (loadLedgerTools.notices ||= []).push(String(text)); } },
        Plugin: TestPlugin, Platform: { isDesktopApp: true },
        normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
        editorLivePreviewField,
      };
    }
    if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, RangeSetBuilder: StubRangeSetBuilder };
    if (request === "@codemirror/view") {
      return {
        EditorView: { updateListener: { of: (listener) => ({ listener }) }, editorAttributes: { of: (value) => value } },
        keymap: { of: (value) => value }, Decoration: StubDecoration, WidgetType: StubWidgetType,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require("../plugins/bob-ledger-tools/main.js");
  } finally {
    Module._load = originalLoad;
  }
}

function deferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function flush(times = 4) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

function fakeTimers(plugin) {
  const timers = new Map();
  let next = 0;
  plugin.albumSetTimeout = (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; };
  plugin.albumClearTimeout = (id) => timers.delete(id);
  return timers;
}

// ---- DOM -----------------------------------------------------------------

function parseSelector(selector) {
  const text = String(selector).trim();
  const tag = /^([a-z][a-z0-9-]*)/i.exec(text)?.[1] || "";
  const classes = (text.replace(/\[[^\]]*\]/g, "").match(/\.[\w-]+/g) || []).map((name) => name.slice(1));
  const attrs = [];
  const attrPattern = /\[([\w-]+)(?:="([^"]*)")?\]/g;
  let match = null;
  while ((match = attrPattern.exec(text))) attrs.push({ name: match[1], value: match[2] });
  return { tag, classes, attrs };
}

class FakeNode {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.parentNode = null;
    this.value = "";
    this.text = "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.disabled = false;
  }
  get firstChild() { return this.children[0] || null; }
  set className(value) { this.setAttribute("class", value); }
  get className() { return this.getAttribute("class") || ""; }
  get classList() {
    const node = this;
    return {
      contains: (name) => node.className.split(/\s+/).includes(name),
      add: (...names) => node.setAttribute("class", [...new Set([...node.className.split(/\s+/).filter(Boolean), ...names])].join(" ")),
      remove: (...names) => node.setAttribute("class", node.className.split(/\s+/).filter((name) => name && !names.includes(name)).join(" ")),
    };
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  appendChild(child) {
    if (child.parentNode && typeof child.parentNode.removeChild === "function") child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  hasAttribute(name) { return this.attributes.has(String(name)); }
  removeAttribute(name) { this.attributes.delete(String(name)); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== callback)); }
  dispatch(type, event = {}) {
    const payload = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...event };
    let node = this;
    while (node) {
      for (const callback of node.listeners?.get?.(type) || []) callback(payload);
      node = node.parentNode;
    }
    return payload;
  }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const { tag, classes, attrs } = parseSelector(part);
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      if (!classes.every((name) => this.classList.contains(name))) return false;
      return attrs.every(({ name, value }) => (value === undefined ? this.hasAttribute(name) : this.getAttribute(name) === value));
    });
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (typeof node.matches === "function" && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child.matches?.(selector)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  // Layout stand-ins: rows stack 30px apart; text grows 20px per line.
  getBoundingClientRect() {
    const index = this.parentNode && Array.isArray(this.parentNode.children) ? this.parentNode.children.indexOf(this) : 0;
    return { left: 0, top: index * 30, width: 300, height: 28 };
  }
  get scrollHeight() { return Math.max(1, String(this.value || "").split("\n").length) * 20 + 8; }
  get offsetHeight() { return (parseInt(this.style.height, 10) || 40) + 2; }
  get clientHeight() { return parseInt(this.style.height, 10) || 40; }
}

class FakeDocument {
  constructor() { this.activeElement = null; }
  createElement(tag) { return new FakeNode(this, tag); }
  createTextNode(text) { return { nodeType: 3, textContent: String(text), parentNode: null }; }
}

// ---- vault with lagging metadata ------------------------------------------

function wrappedFrontmatter(fields, body) {
  return `---\n${JSON.stringify(fields)}\n---\n\n${body}`;
}

function fakeVault(options = {}) {
  const files = new Map();
  const caches = new Map();
  const disk = new Map();
  const changed = [];
  const reads = [];
  let readGate = null;
  const app = {
    document: new FakeDocument(),
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      async read(file) {
        reads.push(file.path);
        const text = disk.get(file.path);
        if (readGate) {
          const gate = readGate;
          readGate = null;
          await gate;
        }
        return text;
      },
    },
    metadataCache: {
      getFileCache: (file) => caches.get(file.path) || null,
      getFirstLinkpathDest: (target) => files.get(String(target).replace(/\.md$/i, "") + ".md") || null,
      on(name, callback) { if (name === "changed") changed.push(callback); return { name }; },
    },
    workspace: {
      leaves: [],
      getLeavesOfType() { return this.leaves; },
      on: () => ({}),
      getActiveViewOfType: () => null,
    },
    spawn() { throw new Error("intention cards must not spawn bob while painting"); },
  };
  const vault = {
    app, files, caches, disk, reads,
    // Bob writes disk bytes; metadataCache lags until index() runs.
    write(path, fields, body = options.body || "# Thu Nov 19, 2026\n\nBody stays.\n") {
      if (!files.has(path)) files.set(path, { path });
      disk.set(path, wrappedFrontmatter(fields, body));
      vault.fields.set(path, fields);
    },
    fields: new Map(),
    index(path, fields = vault.fields.get(path)) {
      caches.set(path, { frontmatter: JSON.parse(JSON.stringify(fields)) });
      for (const callback of changed) callback(files.get(path));
    },
    seed(path, fields, body) {
      vault.write(path, fields, body);
      caches.set(path, { frontmatter: JSON.parse(JSON.stringify(fields)) });
    },
    holdNextRead() { const gate = deferred(); readGate = gate.promise; return gate; },
  };
  return vault;
}


// ---- bob periods update simulator ------------------------------------------
// Applies the documented ops to a note's frontmatter, refuses a stale expect,
// and reports before/after public fields, summary_state, and inverse ops.
const crypto = require("node:crypto");

function simulatorDigest(text) {
  const normalized = String(text).replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, "")).join("\n").trim();
  return `sha256:${crypto.createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16)}`;
}

function simulatorPublic(fm) {
  const summary = typeof fm.summary === "string" && fm.summary.trim() ? fm.summary : null;
  return {
    intentions: Array.isArray(fm.intentions) ? fm.intentions.slice() : [],
    summary,
    summary_state: !summary ? "empty" : fm.summary_digest === simulatorDigest(summary) ? "drafted" : "edited",
    reflection: typeof fm.reflection === "string" && fm.reflection.trim() ? fm.reflection : null,
  };
}

function simulatorFingerprint(fm) {
  const owned = {};
  for (const key of ["intentions", "summary", "summary_digest", "summary_drafted", "reflection"]) owned[key] = fm[key] === undefined ? null : fm[key];
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(owned)).digest("hex")}`;
}

function simulatorApply(fm, ops) {
  const next = JSON.parse(JSON.stringify(fm));
  const touched = { intentions: false, summary: false, reflection: false };
  const list = () => (Array.isArray(next.intentions) ? next.intentions : (next.intentions = []));
  for (const [index, op] of ops.entries()) {
    const fail = (code, message) => { const error = new Error(message); error.code = code; error.opIndex = index; throw error; };
    if (op.op.startsWith("intentions.")) touched.intentions = true;
    if (op.op === "intentions.set") next.intentions = op.values.slice();
    else if (op.op === "intentions.insert") {
      if (!String(op.value || "").trim()) fail("empty_value", "intention values must not be empty");
      if (op.index > list().length) fail("index_out_of_range", "insert index out of range");
      list().splice(op.index, 0, String(op.value).trim());
    } else if (op.op === "intentions.replace") {
      if (op.index >= list().length) fail("index_out_of_range", "replace index out of range");
      if (!String(op.value || "").trim()) fail("empty_value", "intention values must not be empty");
      list()[op.index] = String(op.value).trim();
    } else if (op.op === "intentions.remove") {
      if (op.index >= list().length) fail("index_out_of_range", "remove index out of range");
      list().splice(op.index, 1);
    } else if (op.op === "intentions.move") {
      if (op.from >= list().length || op.to >= list().length) fail("index_out_of_range", "move index out of range");
      const [moved] = list().splice(op.from, 1);
      list().splice(op.to, 0, moved);
    } else if (op.op === "reflection.set") {
      if (!String(op.value || "").trim()) fail("empty_value", "reflection value must not be empty; use reflection.unset");
      touched.reflection = true; next.reflection = String(op.value).trim();
    } else if (op.op === "reflection.unset") { touched.reflection = true; delete next.reflection; }
    else if (op.op === "summary.set") {
      if (!String(op.value || "").trim()) fail("empty_value", "summary value must not be empty; use summary.unset");
      touched.summary = true; next.summary = String(op.value).trim(); delete next.summary_digest; delete next.summary_drafted;
    } else if (op.op === "summary.unset") { touched.summary = true; delete next.summary; delete next.summary_digest; delete next.summary_drafted; }
    else if (op.op === "summary.restore") {
      touched.summary = true;
      if (op.present && op.value) next.summary = op.value; else delete next.summary;
      if (op.digest) next.summary_digest = op.digest; else delete next.summary_digest;
      if (op.drafted) next.summary_drafted = op.drafted; else delete next.summary_drafted;
    } else fail("unknown_op", `unknown op ${op.op}`);
  }
  if (Array.isArray(next.intentions) && !next.intentions.length) delete next.intentions;
  const inverse = [];
  if (touched.intentions) inverse.push({ op: "intentions.set", values: Array.isArray(fm.intentions) ? fm.intentions.slice() : [] });
  if (touched.summary) {
    inverse.push({
      op: "summary.restore", present: typeof fm.summary === "string", source: typeof fm.summary === "string" ? "frontmatter" : "absent",
      value: fm.summary ?? null, digest: fm.summary_digest ?? null, drafted: fm.summary_drafted ?? null,
    });
  }
  if (touched.reflection) inverse.push(typeof fm.reflection === "string" ? { op: "reflection.set", value: fm.reflection } : { op: "reflection.unset" });
  return { next, inverse };
}

// Installs fake apiIntentionUpdatePreview/Apply on a plugin. Applies write the
// vault's disk bytes only; metadataCache lags until the test indexes it.
function installBobSimulator(plugin, vault, subjects, options = {}) {
  const calls = [];
  const run = (subject, envelopeText, dryRun) => {
    const envelope = JSON.parse(envelopeText);
    const path = subjects[subject];
    const fm = vault.fields.get(path) || {};
    calls.push({ subject, dryRun, envelope });
    const fingerprint = simulatorFingerprint(fm);
    const fail = (code, message, opIndex = null) => ({ ok: true, report: { ok: false, schema_version: 1, error: { code, message, hint: "Refresh and retry.", op_index: opIndex } } });
    if (envelope.expect && envelope.expect !== fingerprint) return fail("stale_note", "the note changed since the preview");
    let result;
    try { result = simulatorApply(fm, envelope.ops); } catch (error) { return fail(error.code, error.message, error.opIndex); }
    const changed = JSON.stringify(result.next) !== JSON.stringify(fm);
    if (!dryRun && changed) vault.write(path, result.next);
    return {
      ok: true,
      report: {
        ok: true, schema_version: 1,
        subject: { id: subject, kind: "day", label: subject, path },
        dry_run: dryRun, fingerprint_before: fingerprint, fingerprint_after: simulatorFingerprint(result.next),
        before: simulatorPublic(fm), after: simulatorPublic(result.next), changed,
        inverse_ops: changed ? result.inverse : [], warnings: [],
      },
    };
  };
  plugin.apiIntentionUpdatePreview = async (subject, envelopeText) => {
    if (options.beforePreview) await options.beforePreview(subject, envelopeText, calls);
    return run(subject, envelopeText, true);
  };
  plugin.apiIntentionUpdateApply = async (subject, envelopeText) => {
    if (options.beforeApply) {
      const override = await options.beforeApply(subject, envelopeText, calls);
      if (override) { calls.push({ subject, dryRun: false, envelope: JSON.parse(envelopeText), override: true }); return override; }
    }
    return run(subject, envelopeText, false);
  };
  return calls;
}

module.exports = {
  simulatorDigest, simulatorFingerprint, simulatorPublic, installBobSimulator,
  TestPlugin, editorLivePreviewField, loadLedgerTools, deferred, flush, fakeTimers,
  FakeNode, FakeDocument, fakeVault, wrappedFrontmatter,
};
