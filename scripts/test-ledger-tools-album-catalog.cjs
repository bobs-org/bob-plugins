// Album owner cards: the notebook DOM/editor harness shape with focused
// path identity, status, focus, lifecycle and group-navigation regressions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const util = require("node:util");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
  addCommand() {}
  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }
  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }
  registerMarkdownCodeBlockProcessor() {}
  registerMarkdownPostProcessor(handler) {
    this.postProcessors = this.postProcessors || [];
    this.postProcessors.push(handler);
  }
  registerInterval(handle) {
    return handle;
  }
  registerDomEvent() {}
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

const editorInfoField = { _notebook: "info" };
const editorLivePreviewField = { _notebook: "live" };

class StubWidgetType {
  eq(other) {
    return this === other;
  }
}

const widgetCalls = [];
const lineCalls = [];
const StubDecoration = {
  none: { none: true },
  widget: (args) => {
    widgetCalls.push(args);
    return { widget: args.widget, side: args.side, _widget: true };
  },
  line: (args) => {
    lineCalls.push(args);
    return { line: true, attributes: args && args.attributes, _line: true };
  },
};

const StubStateEffect = {
  define: () => {
    const effect = {
      of: (value) => ({ effect, value }),
      is: (other) => other === effect,
    };
    return effect;
  },
};

class StubRangeSetBuilder {
  constructor() {
    this.ranges = [];
  }
  add(from, to, decoration) {
    this.ranges.push({ from, to, decoration });
  }
  finish() {
    return this.ranges;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      MarkdownRenderChild: class {
        constructor(el) {
          this.containerEl = el;
        }
      },
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
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
      ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
      Decoration: StubDecoration,
      WidgetType: StubWidgetType,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

function hide(node, fields) {
  for (const field of fields) {
    Object.defineProperty(node, field, { enumerable: false, configurable: true, writable: true });
  }
}

class FakeNode {
  constructor(tag, doc, nodeType) {
    this.tag = tag;
    this.tagName = tag ? String(tag).toUpperCase() : "";
    this.nodeName = this.tagName || "#text";
    this.nodeType = nodeType || 1;
    this.doc = doc;
    this.ownerDocument = doc;
    this.parentNode = null;
    this._childNodes = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this._text = "";
    this.disabled = false;
    this.innerHTMLWrites = [];
    this.isConnected = true;
    hide(this, ["doc", "ownerDocument", "parentNode"]);
  }

  [util.inspect.custom]() {
    const cls = this.getAttribute("class");
    const kids = this._childNodes.length;
    const text = String(this.textContent || "").replace(/\s+/g, " ").slice(0, 40);
    const dot = cls ? "." + String(cls).split(/\s+/).filter(Boolean).join(".") : "";
    return `FakeNode(${this.nodeName}${dot} children=${kids} text=${JSON.stringify(text)})`;
  }

  get children() {
    return this._childNodes.filter((node) => node.nodeType === 1);
  }

  get childNodes() {
    return this._childNodes;
  }

  get className() {
    return this.getAttribute("class") || "";
  }

  set className(value) {
    this.setAttribute("class", value);
  }

  get classList() {
    const node = this;
    return {
      add(name) {
        const set = new Set(String(node.className || "").split(/\s+/).filter(Boolean));
        set.add(name);
        node.className = Array.from(set).join(" ");
      },
      contains(name) {
        return String(node.className || "").split(/\s+/).includes(name);
      },
    };
  }

  get textContent() {
    if (this.nodeType === 3) {
      return this._text;
    }
    return this._childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._text = String(value);
    if (this.nodeType === 1) {
      this._childNodes = [];
      if (this._text) {
        const text = new FakeNode("", this.doc, 3);
        text._text = this._text;
        text.parentNode = this;
        this._childNodes.push(text);
      }
    }
  }

  get nodeValue() {
    return this.nodeType === 3 ? this._text : null;
  }

  set nodeValue(value) {
    this._text = String(value);
  }

  get firstChild() {
    return this._childNodes[0] || null;
  }

  get nextSibling() {
    const parent = this.parentNode;
    if (!parent) {
      return null;
    }
    const at = parent._childNodes.indexOf(this);
    return at >= 0 ? parent._childNodes[at + 1] || null : null;
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  removeAttribute(name) {
    this.attrs.delete(name);
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }

  appendChild(child) {
    if (child.parentNode && child.parentNode !== this) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this._childNodes.push(child);
    return child;
  }

  insertBefore(child, before) {
    if (child.parentNode && child.parentNode !== this) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    const at = this._childNodes.indexOf(before);
    if (at === -1) {
      this._childNodes.push(child);
    } else {
      this._childNodes.splice(at, 0, child);
    }
    return child;
  }

  removeChild(child) {
    const at = this._childNodes.indexOf(child);
    if (at !== -1) {
      this._childNodes.splice(at, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(handler);
  }

  fire(type, extra = {}) {
    const event = {
      type,
      key: extra.key,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {},
      ...extra,
    };
    for (const handler of this.listeners.get(type) || []) {
      handler(event);
    }
    return event;
  }

  contains(node) {
    return node === this || this._childNodes.some((child) => child.contains(node));
  }

  focus() { this.ownerDocument.activeElement = this; }

  matches(selector) {
    return selectorParts(selector).some((part) => matchPart(this, part));
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.nodeType === 1 && node.matches(selector)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const parts = selectorParts(selector);
    const found = [];
    const walk = (node) => {
      if (node.nodeType === 1 && parts.some((part) => matchPart(node, part))) {
        found.push(node);
      }
      for (const child of node._childNodes || []) {
        walk(child);
      }
    };
    for (const child of this._childNodes) {
      walk(child);
    }
    return found;
  }

  set innerHTML(value) {
    this.innerHTMLWrites.push(String(value));
    this.textContent = String(value);
  }

  get innerHTML() {
    return this.textContent;
  }
}

function selectorParts(selector) {
  return String(selector).split(",").map((part) => part.trim()).filter(Boolean);
}

function matchPart(node, selector) {
  let rest = selector;
  let tag = "*";
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  if (tagMatch) {
    tag = tagMatch[0].toUpperCase();
    rest = rest.slice(tagMatch[0].length);
  }
  const classes = [];
  const attrs = [];
  const classRe = /^\.([\w-]+)/;
  const attrRe = /^\[([^\]]+)\]/;
  while (rest) {
    const cls = classRe.exec(rest);
    if (cls) {
      classes.push(cls[1]);
      rest = rest.slice(cls[0].length);
      continue;
    }
    const attr = attrRe.exec(rest);
    if (attr) {
      const body = attr[1];
      const eq = body.indexOf("=");
      if (eq === -1) {
        attrs.push({ name: body, value: null });
      } else {
        attrs.push({
          name: body.slice(0, eq),
          value: body.slice(eq + 1).replace(/^["']|["']$/g, ""),
        });
      }
      rest = rest.slice(attr[0].length);
      continue;
    }
    return false;
  }
  if (tag !== "*" && node.tagName !== tag) {
    return false;
  }
  const className = String(node.getAttribute("class") || "");
  for (const name of classes) {
    if (!className.split(/\s+/).includes(name)) {
      return false;
    }
  }
  for (const attr of attrs) {
    const actual = node.getAttribute(attr.name);
    if (attr.value === null) {
      if (actual === null) {
        return false;
      }
    } else if (actual !== attr.value) {
      return false;
    }
  }
  return true;
}

function makeDoc() {
  const doc = {
    nodes: [],
    createElement(tag) {
      const node = new FakeNode(tag, doc, 1);
      doc.nodes.push(node);
      return node;
    },
    createTextNode(text) {
      const node = new FakeNode("", doc, 3);
      node._text = String(text);
      doc.nodes.push(node);
      return node;
    },
  };
  return doc;
}

function el(doc, tag, attrs = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === "className" || name === "class") {
      node.className = value;
    } else if (name === "text") {
      node.appendChild(doc.createTextNode(value));
    } else {
      node.setAttribute(name, value);
    }
  }
  for (const child of children) {
    if (typeof child === "string") {
      node.appendChild(doc.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

function makeEditorView({ text, live = true, path = "dev.md", dom = null }) {
  const lines = String(text).split("\n");
  let offset = 0;
  const lineObjs = lines.map((line, index) => {
    const from = offset;
    const to = from + line.length;
    offset = to + 1;
    return { from, to, text: line, number: index + 1 };
  });
  return {
    state: {
      field(field) {
        if (field === editorLivePreviewField) {
          return live;
        }
        if (field === editorInfoField) {
          return { file: { path } };
        }
        return null;
      },
      doc: {
        lines: lineObjs.length,
        toString: () => String(text),
        line(number) {
          return lineObjs[number - 1];
        },
      },
    },
    dom,
  };
}


function album(overrides = {}) {
  return { path: 'eat.md', stem: 'eat', title: 'Restaurants', plural: 'restaurants', owner: 'body', root: 'body',
    records: 4, groups: [{ value: 'empty', label: 'Empty', count: 0, peek: [] },
      { value: 'to_try', label: '🔖 To try', count: 3, peek: ['Ani', '<img onerror=bad()>', 'Third', 'Fourth'] },
      { value: 'liked', label: '💚 Liked', count: 1, peek: ['Liked'] }],
    last_record: '2026-11-10', index: { state: 'current' }, issues: [], ...overrides };
}
function report(rows = [album()], catalog = {}) {
  return helpers.albumIndexReport({ albums: rows, catalogs: [
    { path: 'body.md', host: 'body', state: 'current', issues: [], ...catalog }], counts: {}, ok: true, schema_version: 1 });
}
function fixture(options = {}) {
  const doc = makeDoc();
  const row = (target, title = 'Same title') => el(doc, 'li', {}, [
    el(doc, 'strong', {}, [el(doc, 'a', { class: 'internal-link', 'data-href': target }, [title])]), ' — Summary']);
  const first = row('Alias');
  const nested = row('second');
  const group = el(doc, 'li', {}, ['🧩 ', el(doc, 'a', { class: 'internal-link', 'data-href': 'project' }, ['Project']), el(doc, 'ul', {}, [nested])]);
  const ordinary = row('other/eat');
  const callout = el(doc, 'div', { class: 'callout', 'data-callout': 'albums' }, [
    el(doc, 'div', { class: 'callout-title' }, ['Albums']),
    el(doc, 'div', { class: 'callout-content' }, [el(doc, 'ul', {}, [first, group, ordinary])])]);
  const root = el(doc, 'div', {}, [callout]);
  const files = new Map(['body.md', 'eat.md', 'second.md', 'project.md', 'other/eat.md'].map((path) => [path, { path }]));
  let state = { report: report([album(), album({ path: 'second.md', stem: 'second', records: 2 })]),
    today: '2026-11-12', stale: false, syncBusy: false, ...options.state };
  const writes = [];
  const opened = [];
  const app = {
    vault: { getAbstractFileByPath: (path) => files.get(path), cachedRead: async () => source,
      modify: (...args) => writes.push(args), process: (...args) => writes.push(args) },
    metadataCache: { getFirstLinkpathDest: (target, from) => {
      assert.equal(from, 'body.md');
      return files.get(target === 'Alias' ? 'eat.md' : `${target}.md`);
    } },
    workspace: { openLinkText: async (...args) => { opened.push(args); app.workspace.activeLeaf = { view: { file: files.get(args[0]), setEphemeralState(value) { this.ephemeral = value; } } }; } },
  };
  const plugin = new LedgerToolsPlugin(app);
  plugin.albumCatalogActive = true;
  plugin.albumCatalogReading = new Set();
  plugin.albumCatalogEditors = new Set();
  plugin.albumReportState = () => state;
  plugin.apiAlbumReport = () => { plugin.retries = (plugin.retries || 0) + 1; return Promise.resolve(state); };
  plugin.apiAlbumSync = () => { plugin.syncs = (plugin.syncs || 0) + 1; return Promise.resolve({ ok: true }); };
  return { doc, root, callout, first, group, nested, ordinary, plugin, app, writes, opened,
    state: () => state, setState: (next) => { state = { ...state, ...next }; } };
}
const source = ['---', 'type: "[[album]]"', '---', '# Restaurants', '', '## Records', '',
  '> [!records] 4 restaurants', '>', '> - **🔖 To try** · 3', '>   - [[eat/ani|Ani]]',
  '> - **💚 Liked** · 1', '>   - [[eat/liked|Liked]]'].join('\n');
const chips = (node) => node.querySelectorAll('.bob-album-chips');

test('lead tally respects declared order, grammar, peeks and last-added meaning', () => {
  const row = helpers.albumRowModel(album(), '2026-11-12');
  assert.equal(row.count, '4 restaurants');
  assert.equal(row.lead.tally, '🔖 3 to try');
  assert.equal(row.lead.value, 'to_try');
  assert.equal(row.lead.peek.length, 3);
  assert.equal(row.age, '2d');
  assert.equal(helpers.albumRowModel(null), null);
  assert.equal(helpers.albumRowModel(album({ records: 0, groups: [], last_record: null }), '2026-11-12').count, '0 restaurants');
  assert.equal(helpers.albumGroupTally({ label: 'TV shows', count: 2 }), '2 TV shows');
  assert.equal(helpers.albumGroupTally({ label: '🔖To try', count: 3 }), '🔖 3 to try');
});

test('Reading cards match aliases and paths, skip nested project headings and ordinary same-stem notes', () => {
  const f = fixture();
  f.plugin.paintAlbumCatalogReading(f.root, 'body.md');
  assert.equal(chips(f.first).length, 1);
  assert.equal(chips(f.nested).length, 1);
  assert.equal(f.group.children.filter((n) => n.className === 'bob-album-chips').length, 0);
  assert.equal(chips(f.ordinary).length, 0);
  assert.match(f.first.textContent, /4 restaurants/);
  assert.match(f.nested.textContent, /2 restaurants/);
  assert.equal(f.first.querySelector('.bob-album-age').getAttribute('title'), 'Last added: 2026-11-10');
  assert.equal(f.first.querySelector('a').getAttribute('data-href'), 'Alias');
  assert.equal(f.writes.length, 0);
});

test('peeks are inert text and repeated paints preserve keyboard focus and listeners', () => {
  const f = fixture();
  f.plugin.paintAlbumCatalogReading(f.root, 'body.md');
  const lead = f.first.querySelector('.bob-album-lead');
  lead.focus();
  f.plugin.paintAlbumCatalogReading(f.root, 'body.md');
  assert.equal(f.first.querySelector('.bob-album-lead'), lead);
  assert.equal(f.doc.activeElement, lead);
  assert.equal(lead.listeners.get('click').length, 1);
  assert.match(lead.getAttribute('aria-label'), /<img onerror=bad\(\)>/);
  assert.doesNotMatch(lead.getAttribute('aria-label'), /Fourth/);
  assert.equal(f.root.querySelectorAll('img').length, 0);
  assert.ok(f.doc.nodes.every((node) => node.innerHTMLWrites.length === 0));
  f.setState({ today: '2026-11-13' });
  f.plugin.paintAlbumCatalogReading(f.root, 'body.md');
  assert.equal(f.doc.activeElement, f.first.querySelector('.bob-album-lead'));
  assert.match(f.first.querySelector('.bob-album-age').textContent, /3d/);
});

test('unavailable, stale, invalid and damaged reports keep distinct feedback and shared repair actions', () => {
  const f = fixture({ state: { report: null, errorModel: { hint: 'bob missing' }, unavailable: true } });
  f.plugin.paintAlbumCatalogReading(f.root, 'body.md');
  assert.equal(chips(f.root).length, 0);
  assert.match(f.root.textContent, /bob missing/);
  f.root.querySelector('.bob-album-action').fire('click');
  assert.equal(f.plugin.retries, 1);
  f.setState({ report: report(), stale: true });
  f.plugin.paintAlbumCatalogReading(f.root, 'body.md');
  assert.equal(chips(f.first).length, 1);
  assert.equal(f.callout.getAttribute('data-stale'), 'true');
  const invalid = album({ index: { state: 'damaged' }, issues: [{ code: 'schema', severity: 'error', path: 'eat.md', line: 8, key_path: 'record.noun', message: 'Invalid noun', suggestions: ['Use restaurant'] }] });
  f.setState({ report: report([invalid]), stale: false, errorModel: null });
  f.plugin.paintAlbumCatalogReading(f.root, 'body.md');
  assert.equal(f.first.querySelector('.bob-album-health').textContent, 'invalid');
  assert.match(f.first.querySelector('.bob-album-health').getAttribute('title'), /record.noun.*Invalid noun.*Use restaurant/);
  assert.equal(f.root.querySelector('.bob-album-action'), null);
  f.setState({ report: report([album({ index: { state: 'stale' } })]) });
  f.plugin.paintAlbumCatalogReading(f.root, 'body.md');
  assert.equal(f.root.querySelectorAll('.bob-album-action').length, 1);
  f.root.querySelector('.bob-album-action').fire('keydown', { key: 'Enter' });
  assert.equal(f.plugin.syncs, 1);
  f.setState({ syncBusy: true });
  f.plugin.paintAlbumCatalogReading(f.root, 'body.md');
  const button = f.root.querySelector('.bob-album-action');
  assert.equal(button.disabled, true);
  button.fire('click'); button.fire('keydown', { key: ' ' });
  assert.equal(f.plugin.syncs, 1);
  assert.equal(helpers.albumHealthModel(album({ index: { state: 'damaged' }, issues: [{ severity: 'error', code: 'album_index_damaged', message: 'Duplicate records regions' }] })).label, 'damaged index');
});

test('missing or damaged catalog with no albums has an actionable host anchor and diagnostics', () => {
  const f = fixture({ state: { report: report([], { state: 'missing' }) } });
  const body = el(f.doc, 'div', {}, [el(f.doc, 'p', {}, ['Owner without H1'])]);
  f.plugin.paintAlbumCatalogReading(body, 'body.md');
  assert.equal(body.querySelectorAll('.bob-album-anchor').length, 1);
  body.querySelector('.bob-album-action').fire('click');
  assert.equal(f.plugin.syncs, 1);
  f.plugin.paintAlbumCatalogReading(body, 'body.md');
  assert.equal(body.querySelectorAll('.bob-album-action').length, 1);
  f.setState({ report: report([], { state: 'damaged', issues: [{ message: 'Duplicate Albums headings', suggestions: ['Keep one heading'] }] }) });
  f.plugin.paintAlbumCatalogReading(body, 'body.md');
  assert.match(body.textContent, /Duplicate Albums headings.*Keep one heading/);
  assert.equal(body.querySelector('.bob-album-action'), null);
  f.setState({ report: report() });
  f.plugin.paintAlbumCatalogReading(body, 'body.md');
  assert.equal(body.querySelector('.bob-album-anchor'), null);
});

test('source scanner and group jump ignore YAML/fenced/nested examples and handle escaped labels', () => {
  const examples = ['---', 'example: |', '  > [!records]', '  > - **🔖 To try** · 3', '---',
    '````md', '> [!records]', '> - **🔖 To try** · 3', '```', '> [!records]', '````',
    '> > [!records]', '> > - **🔖 To try** · 3'].join('\n');
  assert.equal(helpers.albumSourceRegions(examples, 'records').length, 0);
  const combined = examples + '\n' + source;
  const target = helpers.albumGroupJumpTarget(combined, album(), 'to_try');
  assert.equal(combined.split('\n')[target.line], '> - **🔖 To try** · 3');
  assert.equal(target.found, true);
  const escaped = '> [!records]\n> - **\\<odd\\> \\*label\\*** · 1';
  assert.equal(helpers.albumGroupJumpTarget(escaped, album({ groups: [{ value: 'odd', label: '<odd> *label*' }] }), 'odd').found, true);
  const missing = helpers.albumGroupJumpTarget(source, album(), 'gone');
  assert.equal(missing.found, false);
  assert.equal(missing.line, 7);
});

test('lead activation keeps modifier navigation, records jump history, and calls the pane fold hook before scrolling', async () => {
  const f = fixture();
  const order = [];
  f.app.plugins = { plugins: { 'bob-navigation-hotkeys': {
    captureGoToTaskJumpContext: () => ({ origin: 'body.md' }),
    enqueueVimJumpContextTransition: async (jump, target) => { order.push(['jump', jump, target]); },
  } } };
  f.plugin.albumRevealRecordGroup = async (view, target) => { order.push(['reveal', target]); assert.equal(view.ephemeral, undefined); };
  const result = await f.plugin.apiAlbumOpenGroup('eat.md', 'to_try', 'body.md', { metaKey: true });
  assert.equal(result.found, true);
  assert.deepEqual(f.opened[0], ['eat.md', 'body.md', 'tab', { eState: { line: 9 } }]);
  assert.equal(f.app.workspace.activeLeaf.view.ephemeral.line, 9);
  assert.equal(order[0][0], 'reveal'); assert.equal(order[1][0], 'jump');
  await f.plugin.apiAlbumOpenGroup('eat.md', 'gone', 'body.md');
  assert.match(TestNotice.messages.at(-1), /Opened Records/);
  assert.equal(f.writes.length, 0);
});

test('Reading children clean on unload, panes stay independent, file switches remove old facts', () => {
  const f = fixture();
  const second = fixture();
  const children = [];
  f.plugin.renderAlbumCatalogInReading(f.root, { sourcePath: 'body.md', addChild: (child) => children.push(child) });
  f.plugin.renderAlbumCatalogInReading(second.root, { sourcePath: 'body.md', addChild: (child) => children.push(child) });
  assert.equal(f.plugin.albumCatalogReading.size, 2);
  children[0].onunload();
  assert.equal(chips(f.root).length, 0);
  assert.equal(chips(second.root).length, 2);
  assert.equal(f.callout.getAttribute('data-bob-album-card'), null);
  f.plugin.teardownAlbumCatalog();
  assert.equal(chips(second.root).length, 0);
  assert.equal(f.plugin.albumCatalogReading.size, 0);
});

test('Live Preview paints native callouts, leaves source text/caret intact, and removes paint in Source mode', () => {
  const f = fixture();
  const text = '# Body\n\n> [!albums]\n> - **[[eat|Restaurants]]** — Summary';
  const view = makeEditorView({ text, path: 'body.md', dom: f.root });
  f.plugin.paintAlbumCatalogEditor(view);
  assert.equal(chips(f.root).length, 2);
  assert.equal(view.state.doc.toString(), text);
  assert.equal(f.plugin.buildAlbumCatalogDecorations(view), StubDecoration.none);
  const sourceView = makeEditorView({ text, live: false, path: 'body.md', dom: f.root });
  f.plugin.paintAlbumCatalogEditor(sourceView);
  assert.equal(chips(f.root).length, 0);
  assert.equal(f.plugin.buildAlbumCatalogDecorations(sourceView), StubDecoration.none);
  assert.equal(f.writes.length, 0);
});

test('Live Preview missing-catalog action is a widget outside frontmatter, with source mode gated', () => {
  const f = fixture({ state: { report: report([], { state: 'missing' }) } });
  const text = '---\ntype: "[[area]]"\n---\n# Body\n';
  const view = makeEditorView({ text, path: 'body.md', dom: f.root });
  const ranges = f.plugin.buildAlbumCatalogDecorations(view);
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].from > text.indexOf('# Body'));
  assert.equal(f.plugin.buildAlbumCatalogDecorations(makeEditorView({ text, live: false, path: 'body.md' })), StubDecoration.none);
});

test('CSS uses pane container wrapping, scoped album hue, safe peeks and keyboard outlines', () => {
  const css = fs.readFileSync(path.join(__dirname, '../plugins/bob-ledger-tools/styles.css'), 'utf8');
  assert.match(css, /@container bob-albums \(max-width: 440px\)/);
  assert.match(css, /data-callout="albums".*data-root-hue="aqua"/);
  assert.match(css, /\.bob-album-lead:focus-visible/);
  assert.match(css, /\.bob-album-action:focus-visible/);
});

test('missing-catalog controls occur only in the selected source section', () => {
  const f = fixture({ state: { report: report([], { state: 'missing' }) } });
  const text = '# Body\n\nIntro.\n\n## Albums\n\nOther paragraph.';
  const title = el(f.doc, 'div', {}, [el(f.doc, 'h1', {}, ['Body'])]);
  const heading = el(f.doc, 'div', {}, [el(f.doc, 'h2', {}, ['Albums'])]);
  const paragraph = el(f.doc, 'div', {}, [el(f.doc, 'p', {}, ['Other paragraph.'])]);
  for (const [root, line] of [[title, 0], [heading, 4], [paragraph, 6]]) {
    f.plugin.renderAlbumCatalogInReading(root, { sourcePath: 'body.md',
      getSectionInfo: () => ({ text, lineStart: line, lineEnd: line }), addChild() {} });
  }
  assert.equal(title.querySelector('.bob-album-action'), null);
  assert.equal(paragraph.querySelector('.bob-album-action'), null);
  assert.equal(heading.querySelectorAll('.bob-album-action').length, 1);
});

test('keyboard and middle-click group controls activate once without changing the editor caret', async () => {
  const f = fixture();
  f.plugin.paintAlbumCatalogReading(f.root, 'body.md');
  const lead = f.first.querySelector('.bob-album-lead');
  assert.equal(lead.fire('mousedown').prevented, true);
  lead.fire('keydown', { key: 'Enter' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.opened.length, 1);
  lead.fire('auxclick', { button: 1, shiftKey: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.opened.length, 2);
  assert.equal(f.opened[1][2], 'split');
  assert.equal(f.writes.length, 0);
});

test('Live Preview extension paints after updates and cleans file switches, destroy and pending timers', () => {
  const f = fixture();
  const timers = new Map(); let next = 0;
  f.plugin.albumSetTimeout = (callback) => { timers.set(++next, callback); return next; };
  f.plugin.albumClearTimeout = (id) => timers.delete(id);
  const flush = () => { const work = Array.from(timers.values()); timers.clear(); for (const callback of work) callback(); };
  const text = '> [!albums]\n> - **[[eat|Restaurants]]**';
  const view = makeEditorView({ text, path: 'body.md', dom: f.root });
  const extension = f.plugin.createAlbumCatalogExtension();
  const instance = new extension.cls(view);
  assert.equal(chips(f.root).length, 0);
  flush();
  assert.equal(chips(f.root).length, 2);
  const lead = f.first.querySelector('.bob-album-lead'); lead.focus();
  instance.update({ view, transactions: [] }); flush();
  assert.equal(f.doc.activeElement, lead);
  const sourceView = makeEditorView({ text, path: 'body.md', live: false, dom: f.root });
  // Real CM keeps the same EditorView when its state fields change.
  view.state = sourceView.state;
  instance.update({ view, transactions: [] }); flush();
  assert.equal(chips(f.root).length, 0);
  instance.destroy();
  assert.equal(f.plugin.albumCatalogEditors.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(view.state.doc.toString(), text);
});
