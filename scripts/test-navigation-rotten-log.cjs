// Rotten Log grammar tests: marker vectors copied verbatim from the
// Rotten cases in bob-cli `src/native/capture/tests/assembly.rs`,
// entry parsing, `readRottenLog` statuses, `planManagedTaskLogEntry`,
// and the Work Log regression.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const harness = require("./modal-harness.cjs");
const { ModalStub, defer } = harness;

global.window = { setTimeout: defer };

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: class extends ModalStub {},
      Notice: class {},
      Platform: { isDesktopApp: true },
      Plugin: class {},
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (v) => v } };
  if (request === "@codemirror/view") return { EditorView: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require("../plugins/bob-navigation-hotkeys/main.js");
const h = Plugin.helpers;
Module._load = originalLoad;

const ROTTEN = "rotten";

test("marker vectors match the Rust Rotten cases", () => {
  const accepted = [
    "\t- 🥀 **ROTTEN LOG**",
    "  * **ROTTEN LOG**",
    "\t+ **ROTTEN LOG:**",
    "  1. **Rotten log:**",
    "2) 🥀 **Rotten log**",
    "\t- 🥀️ **ROTTEN LOG**",
    "  * 🥀️ **Rotten log:**",
  ];
  for (const line of accepted) {
    const parsed = h.parseManagedTaskLogParentBullet(line);
    assert.ok(parsed, "expected a marker for: " + line);
    assert.equal(parsed.kind, ROTTEN, line);
  }
  const rejected = [
    "\t- **ROTTEN LOG** trailing",
    "\t- **rotten log**",
    "\t- **Rotten Log:**",
    "\t- 🗓️ **ROTTEN LOG**",
    "\t- 🛠️ **ROTTEN LOG**",
    "\t- 🥀 **SCHEDULE LOG**",
    "\t- 🥀 **WORK LOG**",
    "\t- 🥀**ROTTEN LOG**",
    "- [ ] #task 🥀 **ROTTEN LOG**",
  ];
  for (const line of rejected) {
    const parsed = h.parseManagedTaskLogParentBullet(line);
    assert.ok(
      !parsed || parsed.kind !== ROTTEN,
      "expected no Rotten marker for: " + line,
    );
  }
});

test("entry parsing accepts valid entries and rejects bad counts", () => {
  const good = h.parseRottenLogEntryBullet(
    "\t\t- *2026-10-16* — old reason · kept 2×",
  );
  assert.ok(good);
  assert.equal(good.date, "2026-10-16");
  assert.equal(good.keeps, 2);
  assert.equal(
    h.parseRottenLogEntryBullet("\t- *2026-10-16* — r · kept 0×"),
    null,
    "kept 0× is rejected",
  );
  assert.equal(
    h.parseRottenLogEntryBullet("\t- *2026-10-16* — r · kept 1000×"),
    null,
    "kept 1000× is rejected",
  );
  assert.equal(
    h.parseRottenLogEntryBullet("\t- *2026-10-16* — r"),
    null,
    "a missing tail is rejected",
  );
});

test("readRottenLog statuses cover missing, empty, ok, and unknown", () => {
  const missing = h.readRottenLog("- [ ] #task T\n\t- child\n", 0);
  assert.equal(missing.status, "missing");
  assert.equal(missing.entries.length, 0);

  const empty = h.readRottenLog(
    "- [ ] #task T\n\t- 🥀 **ROTTEN LOG**\n",
    0,
  );
  assert.equal(empty.status, "empty");

  const ok = h.readRottenLog(
    "- [ ] #task T\n\t- 🥀 **ROTTEN LOG**\n\t\t- *2026-10-16* — old · kept 2×\n",
    0,
  );
  assert.equal(ok.status, "ok");
  assert.equal(ok.entries.length, 1);

  const unknown = h.readRottenLog(
    "- [ ] #task T\n\t- 🥀 **ROTTEN LOG**\n\t\t- *2026-10-19* — first · kept 3×\n\t- 🥀 **ROTTEN LOG**\n\t\t- *2026-10-18* — second · kept 2×\n",
    0,
  );
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.entries.length, 0);

  const nested = h.readRottenLog(
    "- [ ] #task T\n\t- 🥀 **ROTTEN LOG**\n\t\t- parent\n\t\t\t- *2026-10-16* — nested · kept 2×\n",
    0,
  );
  assert.equal(nested.status, "empty", "nested bullets are not counted");

  const handNote = h.readRottenLog(
    "- [ ] #task T\n\t- hand note\n\t- 🥀 **ROTTEN LOG**\n\t\t- *2026-10-16* — old · kept 1×\n",
    0,
  );
  assert.equal(handNote.status, "ok");
  assert.equal(handNote.entries.length, 1);
});

test("planManagedTaskLogEntry creates the log last and prepends entries", () => {
  const withKids = "- [ ] #task T\n\t- child\n\t\t- grandchild\n";
  const created = h.planManagedTaskLogEntry(withKids, 0, {
    kind: h.MANAGED_TASK_LOG_KIND_ROTTEN,
    entryText: "*2026-10-23* — reason · kept 1×",
  });
  assert.equal(created.valid, true);
  assert.equal(created.createdParent, true);
  assert.ok(created.insertLine >= 3, "new log is the last direct child");

  const existing =
    "- [ ] #task T\n\t- 🥀 **ROTTEN LOG**\n\t\t- *2026-10-16* — old · kept 1×\n";
  const prepended = h.planManagedTaskLogEntry(existing, 0, {
    kind: h.MANAGED_TASK_LOG_KIND_ROTTEN,
    entryText: "*2026-10-23* — new · kept 2×",
  });
  assert.equal(prepended.valid, true);
  assert.equal(prepended.createdParent, false);
  assert.equal(prepended.insertLine, 2);
  assert.match(prepended.lineTexts[0], /^\t\t- \*2026-10-23\*/);

  const spaced = "- [ ] #task T\n  * 🥀 **ROTTEN LOG**\n    * *2026-10-16* — old · kept 1×\n";
  const spacedPlan = h.planManagedTaskLogEntry(spaced, 0, {
    kind: h.MANAGED_TASK_LOG_KIND_ROTTEN,
    entryText: "*2026-10-23* — new · kept 2×",
  });
  assert.equal(spacedPlan.valid, true);
  assert.match(spacedPlan.lineTexts[0], /^    \* /);

  const crlf = "- [ ] #task T\r\n\t- child\r\n";
  const crlfPlan = h.planManagedTaskLogEntry(crlf, 0, {
    kind: h.MANAGED_TASK_LOG_KIND_ROTTEN,
    entryText: "*2026-10-23* — reason · kept 1×",
  });
  assert.equal(crlfPlan.valid, true);

  const noNewline = "- [ ] #task T";
  const noNewlinePlan = h.planManagedTaskLogEntry(noNewline, 0, {
    kind: h.MANAGED_TASK_LOG_KIND_ROTTEN,
    entryText: "*2026-10-23* — reason · kept 1×",
  });
  assert.equal(noNewlinePlan.valid, true);

  const cancelFirst =
    "- [ ] #task T\n\t- ❌ **CANCEL LOG**\n\t\t- *2026-10-20* — verdict\n\t- child\n";
  const cancelPlan = h.planManagedTaskLogEntry(cancelFirst, 0, {
    kind: h.MANAGED_TASK_LOG_KIND_ROTTEN,
    entryText: "*2026-10-23* — reason · kept 1×",
  });
  assert.equal(cancelPlan.valid, true);
  assert.ok(
    cancelPlan.insertLine > 2,
    "a first-child Cancel Log stays first",
  );

  const dependsFirst =
    "- [ ] #task T\n\t- ⛓️ **DEPENDS ON:** [[#^a]]\n\t- child\n";
  const dependsPlan = h.planManagedTaskLogEntry(dependsFirst, 0, {
    kind: h.MANAGED_TASK_LOG_KIND_ROTTEN,
    entryText: "*2026-10-23* — reason · kept 1×",
  });
  assert.equal(dependsPlan.valid, true);
  assert.ok(
    dependsPlan.insertLine > 1,
    "a first-child Depends-On line stays first",
  );

  const ambiguous =
    "- [ ] #task T\n\t- 🥀 **ROTTEN LOG**\n\t- 🥀 **ROTTEN LOG**\n";
  const ambiguousPlan = h.planManagedTaskLogEntry(ambiguous, 0, {
    kind: h.MANAGED_TASK_LOG_KIND_ROTTEN,
    entryText: "*2026-10-23* — reason · kept 1×",
  });
  assert.equal(ambiguousPlan.valid, false);
  assert.equal(ambiguousPlan.reason, "ambiguous-markers");
});

test("Work Log writes never file under the Rotten marker", () => {
  const withRotten = [
    "- [ ] #task T",
    "\t- 🥀 **ROTTEN LOG**",
    "\t\t- *2026-10-16* — old · kept 1×",
  ];
  const lines = withRotten.slice();
  const ok = h.insertLaneWorkLogEntry(lines, 0, "did work", "2026-10-23");
  assert.equal(ok, true);
  const joined = lines.join("\n");
  assert.match(joined, /🛠️ \*\*WORK LOG\*\*/);
  const workIndex = lines.findIndex((line) => line.includes("WORK LOG"));
  const rottenIndex = lines.findIndex((line) => line.includes("ROTTEN LOG"));
  assert.ok(workIndex > rottenIndex, "Work Log lands after the Rotten Log");
  const workBlockStart = workIndex + 1;
  const workEntry = lines[workBlockStart] || "";
  assert.match(workEntry, /Did work|did work/);
  assert.doesNotMatch(
    lines.slice(rottenIndex + 1, workIndex).join("\n"),
    /did work/i,
    "no Work entry sits under the Rotten marker",
  );
});
