const path = require("node:path");
const Module = require("node:module");

const editorLivePreviewField = { _copyChipsField: "live" };
const editorInfoField = { _copyChipsField: "info" };

class FakePluginBase {
  constructor(app) {
    this.app = app;
    this.commands = [];
    this.extensions = [];
    this.postProcessors = [];
    this.registers = [];
  }

  addCommand(command) {
    this.commands.push(command);
  }

  registerEditorExtension(extension) {
    this.extensions.push(extension);
  }

  registerMarkdownPostProcessor(handler, sortOrder) {
    this.postProcessors.push({ handler, sortOrder });
  }

  register(fn) {
    this.registers.push(fn);
  }

  registerEvent() {}
}

class FakeNotice {
  constructor(message) {
    FakeNotice.messages.push(String(message));
  }
}
FakeNotice.messages = [];

class FakeModal {
  constructor(app) {
    this.app = app;
    this.opened = false;
    this.closed = false;
    this.scopeRefs = [];
    const doc = new FakeDocument();
    this._doc = doc;
    this.containerEl = doc.createElement("div");
    this.modalEl = doc.createElement("div");
    this.contentEl = doc.createElement("div");
    this.modalEl.appendChild(this.contentEl);
    this.containerEl.appendChild(this.modalEl);
    this.scope = {
      register: (_modifiers, _key, fn) => {
        const ref = { fn };
        this.scopeRefs.push(ref);
        return ref;
      },
      unregister: (ref) => {
        const index = this.scopeRefs.indexOf(ref);
        if (index >= 0) this.scopeRefs.splice(index, 1);
      },
    };
  }

  open() {
    this.opened = true;
    this.closed = false;
    if (typeof this.onOpen === "function") this.onOpen();
  }

  close() {
    this.closed = true;
    if (typeof this.onClose === "function") this.onClose();
  }
}

class FakeMarkdownRenderChild {
  constructor(containerEl) {
    this.containerEl = containerEl;
  }
}

function fakeSetIcon(el, name) {
  try {
    if (el && typeof el.setAttribute === "function") {
      el.setAttribute("data-copy-chip-icon", String(name || ""));
    }
  } catch (error) {
    // Icon stub never throws.
  }
}

class StubWidgetType {}

class StubRangeSetBuilder {
  constructor() {
    this.adds = [];
  }

  add(from, to, value) {
    this.adds.push({ from, to, value });
  }

  finish() {
    return { _decorations: true, adds: this.adds.slice() };
  }
}

const StubDecoration = {
  none: { _decorationNone: true },
  replace: (spec) => ({ _decorationReplace: true, ...spec }),
  mark: (spec) => ({ _decorationMark: true, ...spec }),
  widget: (spec) => ({ _decorationWidget: true, ...spec }),
};

const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => {
      const effect = { value, _effectType: type };
      effect.is = (other) => other === type;
      return effect;
    };
    return type;
  },
};

const StubStateField = {
  define(spec) {
    return { _stateField: true, spec };
  },
};

const StubViewPlugin = {
  fromClass(cls, options) {
    return { _viewPlugin: true, cls, options };
  },
};

function installCopyChipsStubs() {
  const originalLoad = Module._load;
  Module._load = function loadCopyChipsStubs(request, parent, isMain) {
    if (request === "obsidian") {
      return {
        Plugin: FakePluginBase,
        Notice: FakeNotice,
        MarkdownRenderChild: FakeMarkdownRenderChild,
        Modal: FakeModal,
        setIcon: fakeSetIcon,
        editorLivePreviewField,
        editorInfoField,
      };
    }
    if (request === "@codemirror/view") {
      return {
        ViewPlugin: StubViewPlugin,
        Decoration: StubDecoration,
        WidgetType: StubWidgetType,
        EditorView: { decorations: { from: (field) => ({ _editorDecorations: true, field }) } },
      };
    }
    if (request === "@codemirror/state") {
      return {
        Prec: { highest: (value) => value },
        StateEffect: StubStateEffect,
        StateField: StubStateField,
        RangeSetBuilder: StubRangeSetBuilder,
        Transaction: {
          userEvent: {
            of(value) {
              return { _userEvent: true, value };
            },
          },
        },
      };
    }
    if (request === "@codemirror/commands") {
      return {
        isolateHistory: {
          of(value) {
            return { _isolateHistory: true, value };
          },
        },
      };
    }
    if (request === "@codemirror/language") {
      return { syntaxTree: () => null };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return originalLoad;
}

const pluginPath = path.join(__dirname, "..", "plugins", "bob-copy-chips", "main.js");

function loadCopyChips() {
  const originalLoad = installCopyChipsStubs();
  try {
    delete require.cache[pluginPath];
    const BobCopyChipsPlugin = require(pluginPath);
    return { BobCopyChipsPlugin, helpers: BobCopyChipsPlugin.helpers };
  } finally {
    Module._load = originalLoad;
  }
}

const { BobCopyChipsPlugin, helpers } = loadCopyChips();

// --- Fake DOM for chip tests -------------------------------------------

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.ownerDocument = ownerDocument || null;
    this.parentNode = null;
    this.parentElement = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this._text = "";
    this._value = "";
    this._classSet = new Set();
    this.isConnected = true;
    this.style = {};
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.focused = false;
    const self = this;
    this.classList = {
      add(name) {
        self._classSet.add(name);
        self._syncClass();
      },
      remove(name) {
        self._classSet.delete(name);
        self._syncClass();
      },
      contains(name) {
        return self._classSet.has(name);
      },
    };
  }

  addClass(name) {
    this.classList.add(name);
  }

  removeClass(name) {
    this.classList.remove(name);
  }

  _syncClass() {
    if (this._classSet.size) this.attrs.set("class", Array.from(this._classSet).join(" "));
    else this.attrs.delete("class");
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._text = String(value === undefined || value === null ? "" : value);
    this.children = [];
  }

  get value() {
    return this._value;
  }

  set value(next) {
    this._value = String(next === undefined || next === null ? "" : next);
  }

  get scrollHeight() {
    return String(this._value || "").split("\n").length * 16;
  }

  get innerHTML() {
    return "";
  }

  set innerHTML(_value) {
    // Tests never use innerHTML; refuse silently to catch regressions.
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "class") {
      this._classSet = new Set(String(value).split(/\s+/).filter(Boolean));
    }
  }

  getAttribute(name) {
    if (name === "class" && this._classSet.size && !this.attrs.has("class")) {
      return Array.from(this._classSet).join(" ");
    }
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    child.parentElement = this;
    if (!child.ownerDocument && this.ownerDocument) child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  replaceChild(next, prev) {
    const index = this.children.indexOf(prev);
    if (index < 0) throw new Error("replaceChild: child not found");
    next.parentNode = this;
    next.parentElement = this;
    this.children[index] = next;
    prev.parentNode = null;
    prev.parentElement = null;
    return prev;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }

  dispatch(type, event) {
    for (const handler of this.listeners.get(type) || []) {
      handler(event || {});
    }
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length ? all[0] : null;
  }

  querySelectorAll(selector) {
    const out = [];
    const wantClass = selector && selector.startsWith(".") ? selector.slice(1) : null;
    const wantTag = selector && !selector.startsWith(".") ? selector.toUpperCase() : null;
    const visit = (node) => {
      for (const child of node.children) {
        let match = false;
        if (wantClass) {
          const cls = child.getAttribute("class") || "";
          if ((" " + cls + " ").indexOf(" " + wantClass + " ") !== -1) match = true;
        } else if (wantTag && child.tagName === wantTag) {
          match = true;
        }
        if (match) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  remove() {
    this.isConnected = false;
    if (this.parentNode && this.parentNode.children) {
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
    }
    this.parentNode = null;
    this.parentElement = null;
  }

  focus() {
    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  select() {
    this.selectionStart = 0;
    this.selectionEnd = String(this._value || "").length;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  contains(node) {
    let cursor = node;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parentElement;
    }
    return false;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (fakeMatchesSelector(node, selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  empty() {
    this.children = [];
    this._text = "";
  }
}

function fakeMatchesSelector(node, selector) {
  const parts = String(selector || "").split(",").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith(".")) {
      const cls = node.getAttribute && node.getAttribute("class") || "";
      if ((" " + cls + " ").indexOf(" " + part.slice(1) + " ") !== -1) return true;
    } else if (part.startsWith("[")) {
      const name = part.slice(1, part.endsWith("]") ? -1 : part.length).split("=")[0];
      if (node.getAttribute && node.getAttribute(name) != null) return true;
    } else if (String(node.tagName || "").toUpperCase() === part.toUpperCase()) {
      return true;
    }
  }
  return false;
}

class FakeDocument {
  constructor() {
    this.timers = [];
    this.nextTimerId = 1;
    const doc = this;
    this.body = new FakeElement("div", this);
    this.activeElement = this.body;
    this.defaultView = {
      setTimeout(fn, ms) {
        const id = doc.nextTimerId++;
        doc.timers.push({ id, fn, ms });
        return id;
      },
      clearTimeout(id) {
        doc.timers = doc.timers.filter((entry) => entry.id !== id);
      },
    };
    this._liveRegion = null;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  runTimers() {
    const pending = this.timers.slice();
    this.timers = [];
    for (const entry of pending) {
      entry.fn();
    }
  }

  pendingTimerCount() {
    return this.timers.length;
  }
}

function installClipboardStub(textOrError) {
  const original = globalThis.navigator;
  const writes = [];
  const reads = [];
  const readValue = textOrError && typeof textOrError === "object" && !Array.isArray(textOrError) &&
    !(textOrError instanceof Error) && textOrError.readText !== undefined
    ? textOrError.readText
    : "";
  const rejectRead = textOrError && typeof textOrError === "object" && textOrError.readReject;
  const stub =
    textOrError instanceof Error || (typeof textOrError === "object" && textOrError && textOrError.reject)
      ? {
          writeText: async (text) => {
            writes.push(String(text));
            throw textOrError.reject || textOrError;
          },
          readText: async () => {
            reads.push(true);
            if (rejectRead) throw rejectRead;
            return readValue;
          },
        }
      : {
          writeText: async (text) => {
            writes.push(String(text));
            return undefined;
          },
          readText: async () => {
            reads.push(true);
            if (rejectRead) throw rejectRead;
            return typeof textOrError === "string" ? textOrError : readValue;
          },
        };
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: stub },
      configurable: true,
      writable: true,
    });
  } catch (error) {
    globalThis.navigator = { clipboard: stub };
  }
  return {
    writes,
    reads,
    restore() {
      try {
        if (original === undefined) {
          delete globalThis.navigator;
        } else {
          Object.defineProperty(globalThis, "navigator", {
            value: original,
            configurable: true,
            writable: true,
          });
        }
      } catch (error) {
        globalThis.navigator = original;
      }
    },
  };
}

module.exports = {
  BobCopyChipsPlugin,
  helpers,
  FakeElement,
  FakeDocument,
  FakeNotice,
  FakeModal,
  FakePluginBase,
  editorLivePreviewField,
  editorInfoField,
  installCopyChipsStubs,
  loadCopyChips,
  installClipboardStub,
};
