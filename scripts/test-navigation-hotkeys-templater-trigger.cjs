const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NavigationHotkeysPlugin,
  helpers,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

const ENABLE_NOTICE =
  'Templater: turned on "Trigger on file creation" for this device, so new notes use the vault\'s folder templates';
const WRITE_FAILURE_NOTICE =
  "Could not turn on Templater's new-note trigger for this device";

function folderSettings(overrides = {}) {
  return {
    trigger_on_file_creation_mode: "folder",
    folder_templates: [
      { folder: "/", template: "_templates/new_note.md" },
    ],
    ...overrides,
  };
}

function regexSettings(overrides = {}) {
  return {
    trigger_on_file_creation_mode: "regex",
    file_templates: [{ regex: ".*", template: "_templates/new_note.md" }],
    ...overrides,
  };
}

function resetNotices() {
  notices.length = 0;
}

function makePlugin(options = {}) {
  const loads = [];
  const saves = [];
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const storedLocal =
    Object.prototype.hasOwnProperty.call(options, "storedLocal")
      ? options.storedLocal
      : undefined;
  const loadLocalStorage =
    options.loadLocalStorage === undefined
      ? (key) => {
          loads.push(key);
          return storedLocal;
        }
      : options.loadLocalStorage;
  const saveLocalStorage =
    options.saveLocalStorage === undefined
      ? (key, value) => {
          saves.push({ key, value });
        }
      : options.saveLocalStorage;
  plugin.app = {
    plugins: Object.prototype.hasOwnProperty.call(options, "plugins")
      ? options.plugins
      : {
          plugins: {
            "templater-obsidian": Object.prototype.hasOwnProperty.call(
              options,
              "templaterPlugin",
            )
              ? options.templaterPlugin
              : { settings: options.settings || folderSettings() },
          },
        },
  };
  if (loadLocalStorage !== null) {
    plugin.app.loadLocalStorage = loadLocalStorage;
  }
  if (saveLocalStorage !== null) {
    plugin.app.saveLocalStorage = saveLocalStorage;
  }
  return { plugin, loads, saves };
}

test("absent local key with folder template writes the trigger and one notice", () => {
  resetNotices();
  const { plugin, saves } = makePlugin({ storedLocal: undefined });
  const plan = plugin.ensureTemplaterNewNoteTrigger();
  assert.equal(plan.action, "enable");
  assert.deepEqual(saves, [
    {
      key: "templater-local-settings",
      value: { trigger_on_file_creation: true },
    },
  ]);
  assert.deepEqual(notices, [ENABLE_NOTICE]);
});

test("existing local object keeps other keys and only adds the trigger", () => {
  resetNotices();
  const storedLocal = {
    enable_system_commands: false,
    enable_startup_templates: true,
  };
  const { plugin, saves } = makePlugin({ storedLocal });
  const plan = plugin.ensureTemplaterNewNoteTrigger();
  assert.equal(plan.action, "enable");
  assert.deepEqual(saves, [
    {
      key: "templater-local-settings",
      value: {
        enable_system_commands: false,
        enable_startup_templates: true,
        trigger_on_file_creation: true,
      },
    },
  ]);
  assert.equal(saves[0].value.enable_system_commands, false);
  assert.equal(saves[0].value.enable_startup_templates, true);
  assert.deepEqual(notices, [ENABLE_NOTICE]);
});

test("stored true is already-enabled with no write and no notice", () => {
  resetNotices();
  const { plugin, saves } = makePlugin({
    storedLocal: { trigger_on_file_creation: true },
  });
  const plan = plugin.ensureTemplaterNewNoteTrigger();
  assert.deepEqual(plan, { action: "skip", reason: "already-enabled" });
  assert.deepEqual(saves, []);
  assert.deepEqual(notices, []);
});

test("stored false is device-opt-out with no write and no notice", () => {
  resetNotices();
  const { plugin, saves } = makePlugin({
    storedLocal: { trigger_on_file_creation: false },
  });
  const plan = plugin.ensureTemplaterNewNoteTrigger();
  assert.deepEqual(plan, { action: "skip", reason: "device-opt-out" });
  assert.deepEqual(saves, []);
  assert.deepEqual(notices, []);
});

test("mode none and blank folder templates skip as no-creation-templates", () => {
  resetNotices();
  const none = makePlugin({
    settings: { trigger_on_file_creation_mode: "none" },
  });
  assert.deepEqual(none.plugin.ensureTemplaterNewNoteTrigger(), {
    action: "skip",
    reason: "no-creation-templates",
  });
  assert.deepEqual(none.saves, []);

  const emptyFolder = makePlugin({
    settings: folderSettings({ folder_templates: [] }),
  });
  assert.deepEqual(emptyFolder.plugin.ensureTemplaterNewNoteTrigger(), {
    action: "skip",
    reason: "no-creation-templates",
  });
  assert.deepEqual(emptyFolder.saves, []);

  const blankFolder = makePlugin({
    settings: folderSettings({
      folder_templates: [{ folder: "/", template: "   " }],
    }),
  });
  assert.deepEqual(blankFolder.plugin.ensureTemplaterNewNoteTrigger(), {
    action: "skip",
    reason: "no-creation-templates",
  });
  assert.deepEqual(blankFolder.saves, []);
  assert.deepEqual(notices, []);
});

test("regex mode with a non-empty file template enables", () => {
  resetNotices();
  const { plugin, saves } = makePlugin({
    settings: regexSettings(),
    storedLocal: undefined,
  });
  const plan = plugin.ensureTemplaterNewNoteTrigger();
  assert.equal(plan.action, "enable");
  assert.deepEqual(saves, [
    {
      key: "templater-local-settings",
      value: { trigger_on_file_creation: true },
    },
  ]);
  assert.deepEqual(notices, [ENABLE_NOTICE]);
});

test("legacy settings without a mode key skip as legacy-templater", () => {
  resetNotices();
  const { plugin, saves } = makePlugin({
    settings: { trigger_on_file_creation: true },
  });
  const plan = plugin.ensureTemplaterNewNoteTrigger();
  assert.deepEqual(plan, { action: "skip", reason: "legacy-templater" });
  assert.deepEqual(saves, []);
  assert.deepEqual(notices, []);
});

test("missing Templater plugin or settings skip as no-templater without throwing", () => {
  resetNotices();
  const missingPlugin = makePlugin({ plugins: { plugins: {} } });
  assert.deepEqual(missingPlugin.plugin.ensureTemplaterNewNoteTrigger(), {
    action: "skip",
    reason: "no-templater",
  });
  assert.deepEqual(missingPlugin.saves, []);

  const missingSettings = makePlugin({ templaterPlugin: {} });
  assert.deepEqual(missingSettings.plugin.ensureTemplaterNewNoteTrigger(), {
    action: "skip",
    reason: "no-templater",
  });
  assert.deepEqual(missingSettings.saves, []);
  assert.deepEqual(notices, []);
});

test("missing loadLocalStorage or saveLocalStorage returns without throwing", () => {
  resetNotices();
  const missingLoad = makePlugin({ loadLocalStorage: null });
  assert.equal(missingLoad.plugin.ensureTemplaterNewNoteTrigger(), undefined);
  assert.deepEqual(missingLoad.saves, []);

  const missingSave = makePlugin({ saveLocalStorage: null });
  assert.equal(missingSave.plugin.ensureTemplaterNewNoteTrigger(), undefined);
  assert.deepEqual(notices, []);
});

test("string or array stored local values skip as unknown-local-shape", () => {
  resetNotices();
  const asString = makePlugin({ storedLocal: "off" });
  assert.deepEqual(asString.plugin.ensureTemplaterNewNoteTrigger(), {
    action: "skip",
    reason: "unknown-local-shape",
  });
  assert.deepEqual(asString.saves, []);

  const asArray = makePlugin({ storedLocal: [{ trigger_on_file_creation: true }] });
  assert.deepEqual(asArray.plugin.ensureTemplaterNewNoteTrigger(), {
    action: "skip",
    reason: "unknown-local-shape",
  });
  assert.deepEqual(asArray.saves, []);
  assert.deepEqual(notices, []);
});

test("saveLocalStorage throw shows one failure notice and does not escape", () => {
  resetNotices();
  const { plugin, saves } = makePlugin({
    saveLocalStorage: () => {
      throw new Error("quota");
    },
  });
  const plan = plugin.ensureTemplaterNewNoteTrigger();
  assert.equal(plan.action, "enable");
  assert.deepEqual(saves, []);
  assert.deepEqual(notices, [WRITE_FAILURE_NOTICE]);
});

test("planTemplaterLocalTrigger covers helper cases and never adds extra keys", () => {
  const { planTemplaterLocalTrigger } = helpers;
  assert.deepEqual(planTemplaterLocalTrigger(null, undefined), {
    action: "skip",
    reason: "no-templater",
  });
  assert.deepEqual(planTemplaterLocalTrigger("settings", undefined), {
    action: "skip",
    reason: "no-templater",
  });
  assert.deepEqual(
    planTemplaterLocalTrigger({ trigger_on_file_creation: false }, undefined),
    { action: "skip", reason: "legacy-templater" },
  );
  assert.deepEqual(
    planTemplaterLocalTrigger(
      { trigger_on_file_creation_mode: "other" },
      undefined,
    ),
    { action: "skip", reason: "no-creation-templates" },
  );
  assert.deepEqual(
    planTemplaterLocalTrigger(folderSettings(), 12),
    { action: "skip", reason: "unknown-local-shape" },
  );

  const stored = {
    enable_system_commands: true,
    enable_startup_templates: false,
  };
  const enabled = planTemplaterLocalTrigger(folderSettings(), stored);
  assert.equal(enabled.action, "enable");
  assert.deepEqual(Object.keys(enabled.next).sort(), [
    "enable_startup_templates",
    "enable_system_commands",
    "trigger_on_file_creation",
  ]);
  assert.equal(enabled.next.enable_system_commands, true);
  assert.equal(enabled.next.enable_startup_templates, false);
  assert.equal(enabled.next.trigger_on_file_creation, true);

  const fromEmpty = planTemplaterLocalTrigger(folderSettings(), undefined);
  assert.deepEqual(Object.keys(fromEmpty.next), ["trigger_on_file_creation"]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      fromEmpty.next,
      "enable_system_commands",
    ),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      fromEmpty.next,
      "enable_startup_templates",
    ),
    false,
  );

  assert.equal(helpers.TEMPLATER_PLUGIN_ID, "templater-obsidian");
  assert.equal(helpers.TEMPLATER_LOCAL_SETTINGS_KEY, "templater-local-settings");
  assert.equal(helpers.TEMPLATER_LOCAL_TRIGGER_KEY, "trigger_on_file_creation");
});
