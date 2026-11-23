// Property editor local kind conversion and explicit vault type changes.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin { constructor(app) { this.app = app; } }
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Notice: class {}, Platform: { isDesktopApp: true },
    Plugin: TestPlugin, normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return {
    EditorView: { updateListener: { of: (listener) => ({ listener }) } }, keymap: { of: (value) => value },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

function row(overrides = {}) {
  return {
    key: "status", line: 3, end_line: 3, value: "open", kind: "text", role: "loose",
    owner: "props", editor: null, reason: null, duplicate: false, opaque: false,
    ...overrides,
  };
}

function report(properties, fingerprint = "sha256:before") {
  return {
    schema_version: 1, ok: true, path: "notes/item.md", note_kind: "note",
    capabilities: ["props_v1"], fingerprint,
    frontmatter: { state: "ok", start_line: 1, end_line: 12 }, properties,
  };
}

function fakeSession(options = {}) {
  return {
    state: { status: "browsing", draftOps: [], canApply: false, expect: "sha256:before" },
    applied: [],
    setDraft(ops) {
      this.state = {
        ...this.state,
        status: ops.length ? "preview-ready" : "browsing",
        draftOps: ops.slice(),
        canApply: ops.length > 0,
        refusal: null,
      };
      return this.state;
    },
    getState() { return this.state; },
    async apply() {
      this.applied.push(this.state.draftOps.slice());
      this.state = { ...this.state, status: "browsing", draftOps: [], canApply: false };
      return {
        ok: true, changed: true,
        report: {
          ok: true, changed: true, fingerprint_after: "sha256:after",
          inverse_ops: [{ op: "prop.set", key: "status", value: "open", kind: "text" }],
          properties: options.propertiesAfter || [],
        },
      };
    },
    async undo() { return { ok: true, report: { ok: true, fingerprint_after: "sha256:before", properties: [] } }; },
    async redo() { return { ok: true, report: { ok: true, fingerprint_after: "sha256:after", properties: [] } }; },
    close() {},
  };
}

function modalFor(properties, extra = {}) {
  const app = extra.app || {};
  const modal = new H.PropertyEditorModal(app, {
    filePath: "notes/item.md",
    report: report(properties),
    plugin: extra.plugin || { app },
    ...extra,
  });
  modal.app = app;
  modal.session = extra.session || fakeSession();
  modal.editorEnsureSession = () => modal.session;
  modal.paintPropertyEditor = () => {};
  return modal;
}

class EditorElement {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.className = "";
    this.value = "";
    this.disabled = false;
  }
  get textContent() {
    if (!this.children.length && this._text != null) return this._text;
    return this.children.map((child) => child.textContent || child._text || "").join("");
  }
  set textContent(value) { this.children = []; this._text = String(value); }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches?.(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matches(selector) {
    const attr = /^\[([\w-]+)(?:=['"]([^'"]*)['"])?\]$/.exec(selector);
    if (attr) return this.attrs.has(attr[1]) && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]);
    const cls = /^\.([\w-]+)$/.exec(selector);
    if (cls) return this.className.split(/\s+/).includes(cls[1]);
    const tagged = /^([a-z][\w-]*)\[([\w-]+)(?:=['"]([^'"]*)['"])?\]$/i.exec(selector);
    if (tagged) {
      return this.tagName === tagged[1].toUpperCase()
        && this.attrs.has(tagged[2])
        && (tagged[3] === undefined || this.getAttribute(tagged[2]) === tagged[3]);
    }
    if (selector === "[role='menu']") return this.getAttribute("role") === "menu";
    return this.tagName === selector.toUpperCase();
  }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }
}

function editorDocument() {
  const doc = { activeElement: null };
  doc.createElement = (tag) => new EditorElement(tag, doc);
  doc.createTextNode = (text) => ({ textContent: String(text), ownerDocument: doc });
  return doc;
}

test("t maps to kind conversion while text inputs keep native typing", () => {
  assert.equal(H.propertyEditorKeyAction({ key: "t" }), "kind");
  assert.equal(H.propertyEditorKeyAction({ key: "T" }), "kind");
  assert.equal(H.propertyEditorKeyAction({ key: "t" }, { inInput: true }), null);
  const input = { closest: (selector) => selector === "input,select,textarea" ? {} : null };
  assert.equal(H.propertyEditorKeyAction({ key: "t", target: input }), null);
});

test("safe scalar conversions and single text to one-item list emit prop.set", () => {
  const text = row({ value: "hello", kind: "text" });
  const toList = H.propertyEditorConvertPreview(text, "list");
  assert.equal(toList.ok, true);
  assert.equal(toList.mode, "safe");
  assert.deepEqual(toList.ops, [{ op: "prop.set", key: "status", value: ["hello"], kind: "list" }]);

  const numeric = row({ key: "count", value: "4", kind: "text" });
  const toNumber = H.propertyEditorConvertPreview(numeric, "number");
  assert.equal(toNumber.ok, true);
  assert.deepEqual(toNumber.ops, [{ op: "prop.set", key: "count", value: 4, kind: "number" }]);

  const flag = row({ key: "done", value: "true", kind: "text" });
  const toCheck = H.propertyEditorConvertPreview(flag, "checkbox");
  assert.equal(toCheck.ok, true);
  assert.deepEqual(toCheck.ops, [{ op: "prop.set", key: "done", value: true, kind: "checkbox" }]);

  const number = row({ key: "count", value: 0, kind: "number" });
  const toText = H.propertyEditorConvertPreview(number, "text");
  assert.equal(toText.ok, true);
  assert.deepEqual(toText.value, "0");
  assert.equal(toText.reportedKind, "text");
});

test("null, empty, false, and zero stay distinct", () => {
  const empty = H.propertyEditorConvertPreview(row({ value: null, kind: "null" }), "text");
  assert.equal(empty.ok, false);
  assert.equal(empty.mode, "input");
  const zero = H.propertyEditorConvertPreview(row({ key: "count", value: 0, kind: "number" }), "text");
  assert.equal(zero.value, "0");
  const falseRow = H.propertyEditorConvertPreview(row({ key: "done", value: false, kind: "checkbox" }), "text");
  assert.equal(falseRow.value, "false");
  const emptyList = H.propertyEditorConvertPreview(row({ value: null, kind: "null" }), "list");
  assert.deepEqual(emptyList.value, []);
  const emptyString = H.propertyEditorConvertPreview(row({ value: "", kind: "text" }), "list");
  assert.deepEqual(emptyString.value, [""]);
});

test("validated date tokens convert; datetime to date stays editable", () => {
  const dated = row({ key: "due", value: "today", kind: "text" });
  const toDate = H.propertyEditorConvertPreview(dated, "date", {}, {
    now: new Date("2026-11-23T12:00:00Z"), timeZone: "UTC",
  });
  assert.equal(toDate.ok, true);
  assert.deepEqual(toDate.ops, [{ op: "prop.set", key: "due", value: "2026-11-23", kind: "date" }]);

  const isoAlreadyDate = H.propertyEditorConvertPreview(row({ key: "due", value: "2026-11-23", kind: "text" }), "date");
  assert.equal(isoAlreadyDate.changed, false);
  assert.deepEqual(isoAlreadyDate.ops, []);

  const stamp = row({
    key: "due", value: "2026-11-23T09:41:00-05:00", kind: "datetime",
  });
  const toDateOnly = H.propertyEditorConvertPreview(stamp, "date");
  assert.equal(toDateOnly.mode, "input");
  assert.equal(toDateOnly.destructive, true);
  assert.match(toDateOnly.message, /drops the time/);
  assert.equal(toDateOnly.value, "2026-11-23");
});

test("multi-item lists and invalid numbers need explicit input", () => {
  const items = row({ key: "aliases", value: ["one", "two"], kind: "list" });
  const toText = H.propertyEditorConvertPreview(items, "text");
  assert.equal(toText.ok, false);
  assert.equal(toText.mode, "input");
  assert.match(toText.message, /multi-item list/);

  const typed = H.propertyEditorConvertPreview(items, "text", { value: "one, two", touched: true });
  assert.equal(typed.ok, true);
  assert.equal(typed.value, "one, two");

  const invalid = H.propertyEditorConvertPreview(row({ value: "nope" }), "number", { value: "nope", touched: true });
  assert.equal(invalid.ok, false);
  assert.match(invalid.message, /number/i);
});

test("date-looking text cannot force a different inferred kind", () => {
  const dated = row({ key: "due", value: "2026-11-23", kind: "date" });
  const asText = H.propertyEditorConvertPreview(dated, "text");
  assert.equal(asText.changed, false);
  assert.deepEqual(asText.ops, []);
  assert.match(asText.reportedKindNote, /still report this value as date/);
});

test("tags and aliases stay key-specific", () => {
  const tags = row({ key: "tags", value: ["one"], kind: "tags" });
  const asList = H.propertyEditorConvertPreview(tags, "list");
  assert.equal(asList.changed, false);
  assert.match(asList.reportedKindNote, /still report this value as tags/);

  const status = row({ value: "hello", kind: "text" });
  const asTags = H.propertyEditorConvertPreview(status, "tags");
  assert.deepEqual(asTags.ops, [{ op: "prop.set", key: "status", value: ["hello"], kind: "list" }]);
  assert.match(asTags.reportedKindNote, /tags key/);
});

test("maps use the YAML stage; opaque and protected rows are refused", () => {
  const mapped = H.propertyEditorConvertPreview(row({ key: "meta", value: { a: 1 }, kind: "map" }), "text");
  assert.equal(mapped.mode, "yaml");
  assert.equal(mapped.changed, false);

  const opaque = H.propertyEditorConvertPreview(row({ opaque: true, kind: "opaque", value: "*alias" }), "text");
  assert.equal(opaque.ok, false);
  assert.equal(opaque.code, "opaque");

  const locked = H.propertyEditorConvertPreview(row({ role: "card", owner: "record", editor: "==" }), "list");
  assert.equal(locked.ok, false);
  assert.equal(locked.code, "locked");
});

test("converting created to datetime adds the offset-stripping warning", () => {
  const created = row({ key: "created", value: "2026-11-23", kind: "date" });
  const preview = H.propertyEditorConvertPreview(created, "datetime", {}, {
    now: new Date("2026-11-23T12:00:00Z"), timeZone: "UTC",
  });
  assert.equal(preview.warning, H.PROPERTY_EDITOR_CONVERT_CREATED_WARNING);
  assert.equal(preview.ok, true);
});

test("type manager adapter handles missing, throwing, and asynchronous setters", async () => {
  assert.equal(H.propertyEditorDetectTypeManager(null).code, "missing");
  assert.equal(H.propertyEditorDetectTypeManager({}).code, "unsupported");
  const throws = H.propertyEditorDetectTypeManager({
    setType() { throw new Error("nope"); },
  });
  const failed = await H.propertyEditorApplyVaultType(throws, "status", "text");
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "failed");
  assert.match(failed.message, /nope/);

  const calls = [];
  const asyncManager = {
    async setType(key, type) { calls.push([key, type]); },
  };
  const adapter = H.propertyEditorDetectTypeManager(asyncManager);
  const ok = await H.propertyEditorApplyVaultType(adapter, "status", "multitext");
  assert.equal(ok.ok, true);
  assert.deepEqual(calls, [["status", "multitext"]]);
});

test("note counts prefer the property-info API and fall back to cache iteration", () => {
  const apiApp = {
    metadataCache: {
      getAllPropertyInfos() {
        return { status: { name: "status", type: "text", count: 12 } };
      },
    },
  };
  assert.deepEqual(H.propertyEditorConvertCountKeyUses(apiApp, "status"), {
    ok: true, count: 12, source: "api",
  });

  const cacheApp = {
    vault: {
      getMarkdownFiles() {
        return [{ path: "a.md" }, { path: "b.md" }, { path: "c.md" }];
      },
    },
    metadataCache: {
      getFileCache(file) {
        if (file.path === "c.md") return { frontmatter: { other: 1 } };
        return { frontmatter: { status: "x" } };
      },
    },
  };
  assert.deepEqual(H.propertyEditorConvertCountKeyUses(cacheApp, "status"), {
    ok: true, count: 2, source: "cache",
  });

  assert.equal(H.propertyEditorConvertCountKeyUses({}, "status").code, "count-unavailable");
});

test("vault confirmation names the key, type, and note count", () => {
  const text = H.propertyEditorConvertVaultConfirmText("status", "multitext", 12);
  assert.match(text, /“status”/);
  assert.match(text, /List/);
  assert.match(text, /12 notes/);
  assert.match(text, /does not rewrite other notes/);
  assert.match(text, /u undoes this note's value, not the vault type/);
  assert.match(H.propertyEditorConvertVaultConfirmText("due", "date", 1), /1 note/);
});

test("protected rows cannot open the conversion stage", () => {
  const modal = modalFor([row({ role: "identity", reason: "Identity keys cannot be changed here." })]);
  assert.equal(modal.propertyEditorStartConvert(), false);
  assert.equal(modal.refusal.code, "locked");
  assert.equal(modal.stage, null);
});

test("local conversion drafts prop.set and does not touch the type manager", async () => {
  const calls = [];
  const app = { metadataTypeManager: { setType(key, type) { calls.push([key, type]); } } };
  const properties = [row({ value: "hello" })];
  const modal = modalFor(properties, { app });
  assert.equal(modal.propertyEditorStartConvert(), true);
  assert.equal(modal.stage.convert, true);
  modal.propertyEditorConvertSetDestination("list");
  const built = modal.propertyEditorBuildCurrentStage();
  assert.deepEqual(built.ops, [{ op: "prop.set", key: "status", value: ["hello"], kind: "list" }]);
  assert.deepEqual(modal.session.state.draftOps, built.ops);
  assert.deepEqual(calls, []);
});

test("vault confirmation can be cancelled without applying", async () => {
  const calls = [];
  const app = {
    metadataTypeManager: { setType(key, type) { calls.push([key, type]); } },
    metadataCache: { getAllPropertyInfos() { return { status: { name: "status", widget: "text", count: 3 } }; } },
  };
  const modal = modalFor([row()], { app });
  modal.propertyEditorStartConvert();
  modal.propertyEditorConvertSetDestination("list");
  assert.equal(await modal.propertyEditorConvertStartVaultType(), true);
  assert.equal(modal.stage.vaultPhase, "confirm");
  assert.match(modal.stage.vaultMessage, /3 notes/);
  assert.equal(modal.propertyEditorConvertCancelVaultType(), true);
  assert.equal(modal.stage.vaultPhase, "idle");
  assert.deepEqual(calls, []);
});

test("successful vault type changes stay on the injected manager", async () => {
  const calls = [];
  const app = {
    metadataTypeManager: { setType(key, type) { calls.push([key, type]); } },
    metadataCache: { getAllPropertyInfos() { return { status: { name: "status", type: "text", count: 2 } }; } },
  };
  const modal = modalFor([row()], { app });
  modal.propertyEditorStartConvert();
  modal.propertyEditorConvertSetDestination("list");
  await modal.propertyEditorConvertStartVaultType();
  assert.equal(await modal.propertyEditorConvertConfirmVaultType(), true);
  assert.deepEqual(calls, [["status", "multitext"]]);
  assert.equal(modal.stage.vaultPhase, "done");
  assert.match(modal.stage.vaultMessage, /not the vault type/);
  assert.deepEqual(modal.session.applied, []);
});

test("unsupported managers teach All Properties and make no global change", async () => {
  const modal = modalFor([row()], { app: {} });
  modal.propertyEditorStartConvert();
  assert.equal(await modal.propertyEditorConvertStartVaultType(), false);
  assert.equal(modal.stage.vaultPhase, "unsupported");
  assert.match(modal.stage.vaultMessage, /All Properties/);
});

test("failed setters report the error and skip property undo", async () => {
  const app = {
    metadataTypeManager: {
      setType() { throw new Error("type catalog locked"); },
    },
    metadataCache: { getAllPropertyInfos() { return { status: { name: "status", type: "text", count: 1 } }; } },
  };
  const modal = modalFor([row()], { app });
  modal.propertyEditorStartConvert();
  await modal.propertyEditorConvertStartVaultType();
  assert.equal(await modal.propertyEditorConvertConfirmVaultType(), false);
  assert.equal(modal.stage.vaultPhase, "failed");
  assert.match(modal.stage.vaultMessage, /type catalog locked/);
  assert.deepEqual(modal.session.applied, []);
});

test("conversion stage paint shows current value, warning, and vault confirmation", () => {
  const doc = editorDocument();
  const host = doc.createElement("div");
  const painted = H.propertyEditorPaintConvertStage(doc, host, {
    stageId: 1, key: "created", currentKind: "date", currentPreview: "\"2026-11-23\"",
    destination: "datetime", value: "2026-11-23", needsInput: true, disabled: false,
    previewText: "Preview", warning: H.PROPERTY_EDITOR_CONVERT_CREATED_WARNING,
    vaultPhase: "confirm", vaultConfirm: true,
    vaultMessage: H.propertyEditorConvertVaultConfirmText("created", "datetime", 4),
  }, { propertyEditorConvertSetDestination() {}, propertyEditorConvertConfirmVaultType() {} });
  assert.ok(painted.panel);
  assert.match(host.textContent, /Current: Date/);
  assert.equal(host.querySelector("[data-property-kind-warning]")?.textContent, H.PROPERTY_EDITOR_CONVERT_CREATED_WARNING);
  assert.ok(host.querySelector("[data-property-kind-vault-confirm]"));
  assert.match(host.textContent, /4 notes/);
});

test("close ladder still treats conversion as a stage", () => {
  assert.equal(H.propertyEditorCloseLadder({ stage: { convert: true } }), "stage");
});
