// obsidian_destination: block-id-prompt api.pomodoroLinkPicker v1 — the
// versioned Pomodoro link picker nav's successor picker chains
// Ctrl+Shift+Enter through for per-row destination overrides.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  helpers,
} = require("./block-id-prompt-harness.cjs");

test("pomodoro link picker choices normalize to existing/new or null", () => {
  const { normalizePomodoroLinkPickerChoice } = helpers;
  assert.deepEqual(
    normalizePomodoroLinkPickerChoice({ kind: "existing", entryLine: 4, entryText: "- [ ] () — DEEP", title: "DEEP" }),
    { kind: "existing", entryLine: 4, entryText: "- [ ] () — DEEP", title: "DEEP" },
  );
  assert.deepEqual(normalizePomodoroLinkPickerChoice({ kind: "new", name: "  WRITE " }), { kind: "new", name: "WRITE" });
  assert.equal(normalizePomodoroLinkPickerChoice({ kind: "existing", entryLine: -1, entryText: "x" }), null);
  assert.equal(normalizePomodoroLinkPickerChoice({ kind: "existing", entryLine: 4, entryText: "" }), null);
  assert.equal(normalizePomodoroLinkPickerChoice({ kind: "new", name: "a\nb" }), null);
  assert.equal(normalizePomodoroLinkPickerChoice({ kind: "new", name: "  " }), null);
  assert.equal(normalizePomodoroLinkPickerChoice({ kind: "other" }), null);
  assert.equal(normalizePomodoroLinkPickerChoice(null), null);
});

test("pomodoroLinkPicker api never rejects and validates choices", async () => {
  const { createPomodoroLinkPickerApi } = helpers;
  assert.equal(await createPomodoroLinkPickerApi(null).pick(), null);
  assert.equal(await createPomodoroLinkPickerApi({}).pick(), null);
  const api = createPomodoroLinkPickerApi({
    pickPomodoroLinkDestination: async () => ({ kind: "new", name: "WRITE" }),
  });
  assert.equal(api.version, 1);
  assert.deepEqual(await api.pick(), { kind: "new", name: "WRITE" });
  const malformed = createPomodoroLinkPickerApi({
    pickPomodoroLinkDestination: async () => ({ kind: "new", name: "" }),
  });
  assert.equal(await malformed.pick(), null);
  const throwing = createPomodoroLinkPickerApi({
    pickPomodoroLinkDestination: async () => { throw new Error("boom"); },
  });
  assert.equal(await throwing.pick(), null);
});

test("destination pick refuses without a prompt when busy, noteless, unreadable, or sectionless", async () => {
  const pick = Plugin.prototype.pickPomodoroLinkDestination;
  assert.equal(typeof pick, "function");
  const busy = { promptOpen: true, activePomodoroLinkPicker: null };
  assert.equal(await pick.call(busy, {}), null);
  const active = { promptOpen: false, activePomodoroLinkPicker: {} };
  assert.equal(await pick.call(active, {}), null);
  const noteless = {
    promptOpen: false,
    activePomodoroLinkPicker: null,
    resolveTodayDailyFile: () => null,
  };
  assert.equal(await pick.call(noteless, {}), null);
  const unreadable = {
    promptOpen: false,
    activePomodoroLinkPicker: null,
    resolveTodayDailyFile: () => ({ path: "Daily.md" }),
    app: { workspace: {}, vault: { read: async () => null } },
    now: () => new Date(2026, 8, 15),
  };
  assert.equal(await pick.call(unreadable, {}), null);
  const sectionless = {
    promptOpen: false,
    activePomodoroLinkPicker: null,
    resolveTodayDailyFile: () => ({ path: "Daily.md" }),
    app: { workspace: {}, vault: { read: async () => "# no pomodoros here" } },
    now: () => new Date(2026, 8, 15),
  };
  assert.equal(await pick.call(sectionless, {}), null);
});

test("destination pick with a section releases its guards when the modal cannot open", async () => {
  const pick = Plugin.prototype.pickPomodoroLinkDestination;
  const fake = {
    promptOpen: false,
    activePomodoroLinkPicker: null,
    resolveTodayDailyFile: () => ({ path: "Daily.md" }),
    app: { workspace: {}, vault: { read: async () => "## Pomodoros\n- [ ] Current (10:00-10:25)" } },
    now: () => new Date(2026, 8, 15),
  };
  // The harness stubs Obsidian Modal as an empty class, so opening throws;
  // the refusal still resolves null and releases both guards.
  assert.equal(await pick.call(fake, {}), null);
  assert.equal(fake.promptOpen, false);
  assert.equal(fake.activePomodoroLinkPicker, null);
});

test("plugin lifecycle installs the api and drops it on unload", async () => {
  const plugin = new Plugin();
  plugin.addCommand = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.register = () => {};
  plugin.onload();
  assert.equal(plugin.api.pomodoroLinkPicker.version, 1);
  plugin.onunload();
  assert.equal(await plugin.api.pomodoroLinkPicker.pick(), null);
});
