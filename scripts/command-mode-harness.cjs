// Fake Obsidian runtime for bob-command-mode tests. Reuses modal-harness DOM
// stubs and adds the Plugin/app surface the run engine needs: loadData,
// saveData, addCommand, settings tabs, workspace leaves/events, and the vault.
const assert = require("node:assert/strict");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const { ModalStub } = require("./modal-harness.cjs");

const notices = [];
const toastNotices = [];

class TestMarkdownView {
  constructor(file) {
    this.file = file || null;
    this.editor = { getCursor: () => ({ line: 0, ch: 0 }) };
    this.saved = 0;
    this.failSave = null;
  }

  async save() {
    if (this.failSave) throw new Error(this.failSave);
    this.saved += 1;
  }
}

class TestPlugin {
  constructor(app) {
    this.app = app;
    this.commands = new Map();
    this.settingTabs = [];
    this.events = [];
    this.statusBarItems = [];
    this.stored = undefined;
  }

  async loadData() {
    return this.stored;
  }

  async saveData(data) {
    this.stored = data;
  }

  addCommand(spec) {
    assert.ok(spec && typeof spec.id === "string" && spec.id, "command needs an id");
    this.commands.set(spec.id, spec);
    return spec;
  }

  addSettingTab(tab) {
    this.settingTabs.push(tab);
  }

  addStatusBarItem() {
    const { ElementStub } = require("./modal-harness.cjs");
    const element = new ElementStub({ tag: "span" });
    this.statusBarItems.push(element);
    return element;
  }

  registerEvent(ref) {
    this.events.push(ref);
  }
}

class TestPluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = {
      children: [],
      empty() {
        this.children = [];
      },
    };
  }
}

class TestSetting {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.name = "";
    this.desc = "";
  }

  setName(name) {
    this.name = name;
    return this;
  }

  setDesc(desc) {
    this.desc = desc;
    return this;
  }

  addText(callback) {
    const control = {
      value: "",
      placeholder: "",
      setPlaceholder(text) {
        this.placeholder = text;
        return this;
      },
      setValue(value) {
        this.value = value;
        return this;
      },
      onChange(handler) {
        this.onChange = handler;
        return this;
      },
    };
    callback(control);
    return this;
  }

  addToggle(callback) {
    const control = {
      value: false,
      setValue(value) {
        this.value = value;
        return this;
      },
      onChange(handler) {
        this.onChange = handler;
        return this;
      },
    };
    callback(control);
    return this;
  }
}

function makeWorkspace() {
  const handlers = new Map();
  return {
    leaves: [],
    handlers,
    iterateAllLeaves(callback) {
      for (const leaf of this.leaves) callback(leaf);
    },
    trigger(name, payload) {
      const list = handlers.get(name) || [];
      for (const callback of [...list]) callback(payload);
    },
    on(name, callback) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(callback);
      return { name, callback };
    },
    offref(ref) {
      if (!ref) return;
      const list = handlers.get(ref.name) || [];
      handlers.set(ref.name, list.filter((callback) => callback !== ref.callback));
    },
  };
}

function makeApp(overrides = {}) {
  const workspace = makeWorkspace();
  return {
    workspace,
    vault: {
      adapter: {
        getBasePath: () => null,
      },
    },
    plugins: { plugins: {} },
    metadataCache: {},
    ...overrides,
  };
}

const originalLoad = Module._load;
Module._load = function loadWithCommandModeStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Modal: ModalStub,
      Notice: class TestNotice {
        constructor(message, duration) {
          this.message = message;
          this.duration = duration;
          this.hidden = false;
          if (typeof message === "string") notices.push(message);
          else toastNotices.push(this);
        }

        hide() {
          this.hidden = true;
        }
      },
      Plugin: TestPlugin,
      PluginSettingTab: TestPluginSettingTab,
      Setting: TestSetting,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const BobCommandModePlugin = require("../plugins/bob-command-mode/main.js");
Module._load = originalLoad;

const { helpers } = BobCommandModePlugin;

function takeNotices() {
  return notices.splice(0);
}

function takeToastNotices() {
  return toastNotices.splice(0);
}

function installDocument(options = {}) {
  const { ElementStub } = require("./modal-harness.cjs");
  const previous = global.document;
  global.document = {
    createElement: (tag) => new ElementStub({ tag }),
    createDocumentFragment: () => new ElementStub({ tag: "#document-fragment" }),
    hasFocus: () => Boolean(options.focused),
  };
  return () => {
    if (previous === undefined) delete global.document;
    else global.document = previous;
  };
}

function fixtureCatalog(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    protocol: 1,
    bob_version: "0.3.1-test",
    features: ["clicolor-force", "progress-env", "run-receipt"],
    sections: [{ id: "daily", title: "Daily workflow" }],
    roots: ["plan", "ref", "capture"],
    aliases: [],
    entries: [
      {
        id: "plan", path: ["plan"], fixed: [], title: "Today's plan",
        about: "Show today's plan", section: "daily", keywords: ["plan"],
        effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "ready", path: ["ready"], fixed: [], title: "Ready lanes",
        about: "Show each area/project note's Ready lane", section: "daily", keywords: ["ready"],
        effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [{ name: "NOTE", slot: "area-note", required: false, repeat: false }],
        exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "ref-create", path: ["ref", "create"], fixed: [], title: "Create reference",
        about: "Create a reference", section: "vault", keywords: ["ref"],
        effect: "writes", network: true, presentation: "action",
        policy: "run", preview: ["--dry-run"], confirm: null, budget_secs: 60,
        args: [{ name: "TARGET", slot: "ref-target", required: true, repeat: true }],
        exit_codes: [], adapter: null, hosts: [], invalidates: ["references"],
      },
    ],
    excluded: [{ path: ["capture"], reason: "Use the named capture rows" }],
    ...overrides,
  };
}

// Build a runner wired to a temp state dir and canned app answers. Returns
// {runner, app, tmpState, settings}.
function makeRunner(overrides = {}) {
  const fs = require("node:fs");
  const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), "bob-cmd-test-"));
  const app = overrides.app || makeApp();
  const catalog = overrides.catalog === undefined ? fixtureCatalog() : overrides.catalog;
  const testDeps = { unrefHandles: false, ...(overrides.deps || {}) };
  const fired = [];
  const notified = [];
  const savedViews = overrides.savedViews;
  const runner = new helpers.CommandModeRunner({
    env: { XDG_STATE_HOME: tmpState, PATH: "/usr/bin:/bin" },
    home: os.homedir(),
    vaultBase: () => (overrides.vaultBase === undefined ? tmpState : overrides.vaultBase),
    catalog: () => catalog,
    resolveBob: () => overrides.resolution || { path: "bob", source: "path", tried: [] },
    saveAllMarkdown: overrides.saveAllMarkdown || (() => Promise.resolve({ ok: true })),
    notify: (run) => notified.push(run),
    fireEvent: (name, payload) => {
      fired.push({ name, payload });
      app.workspace.trigger(name, payload);
    },
    onWorkspaceEvent: (name, callback) => {
      const ref = app.workspace.on(name, callback);
      return () => app.workspace.offref(ref);
    },
    tailPollMs: 10,
    readKillGraceMs: 50,
    stopKillGraceMs: 50,
    adoptPollMs: 10,
    ...testDeps,
  });
  void savedViews;
  return { runner, app, tmpState, fired, notified, helpers };
}

module.exports = {
  BobCommandModePlugin,
  helpers,
  TestMarkdownView,
  TestPlugin,
  makeApp,
  makeWorkspace,
  takeNotices,
  takeToastNotices,
  installDocument,
  fixtureCatalog,
  makeRunner,
};
