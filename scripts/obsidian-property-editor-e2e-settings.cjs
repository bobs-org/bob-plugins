#!/usr/bin/env node
// Real-Obsidian acceptance for the contract-driven area/project settings rows.
// The main Property Editor run owns the scratch vault and application; this
// module keeps the settings scenario out of that already large runner.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("./obsidian-property-editor-e2e-lib.cjs");
const { clipboardRead, clipboardWrite } = require("./obsidian-property-editor-e2e-parity.cjs");

const AREA = "settings-acceptance-area.md";
const PROJECT = "settings-acceptance-project.md";
const LOVE = "love.md";
const BODY = "body.md";
const TOP_PROJECT = "projects/top-level-settings.md";
const STAGE_SHOTS = [[1400, "light"], [1400, "dark"], [390, "light"], [390, "dark"]];

function verifyFixtures(ctx, report, runBob) {
  const contracts = {};
  for (const file of [AREA, PROJECT, LOVE, BODY, TOP_PROJECT]) {
    const result = runBob(ctx, ["props", "show", file, "-f", "json"]);
    report.bobRuns.push(result);
    assert.equal(result.exitCode, 0, `${file} must be readable by the supplied bob`);
    assert.ok(result.report?.capabilities?.includes("props_contract_v1"), `${file} needs the settings contract`);
    contracts[file] = result.report.contract;
  }
  assert.equal(contracts[PROJECT].prj.line, "- [ ] #task #prj Prepare the settings rollout ^prj");
  assert.equal(contracts[PROJECT].settings.find((row) => row.id === "root").disabled, false,
    "the editable Stats root fixture must be a subproject");
  assert.equal(contracts[TOP_PROJECT].settings.find((row) => row.id === "root").disabled, true);
  assert.equal(contracts[AREA].settings.find((row) => row.id === "ready_cap").declared, false);
  assert.equal(contracts[LOVE].settings.find((row) => row.id === "color").value, "blue");
  assert.equal(contracts[BODY].settings.find((row) => row.id === "color").effective.value, "blue",
    "the body fixture inherits love's hue before its local override");

  // Capture names collide only between routable capture targets. Prove with
  // the same bob that the fixtures produce the cross-note warning (and that
  // a dry run never writes) before Obsidian is asked to show it inline.
  const projectPath = path.join(ctx.vaultDir, PROJECT);
  const projectBefore = fs.readFileSync(projectPath, "utf8");
  const shown = runBob(ctx, ["props", "show", PROJECT, "-f", "json"]);
  const envelope = {
    schema_version: 1,
    expect: shown.report?.fingerprint,
    ops: [{ op: "setting.set", setting: "project_name_aliases", value: ["Garden"] }],
  };
  const preview = runBob(ctx, ["props", "update", PROJECT, "-f", "json", "-i", "-", "-d"], JSON.stringify(envelope));
  report.bobRuns.push(preview);
  const warnings = Array.isArray(preview.report?.warnings) ? preview.report.warnings : [];
  assert.equal(preview.exitCode, 0, `Capture names preflight must preview: ${preview.stderr}`);
  assert.equal(preview.report?.ok, true, "Capture names collision is a warning, not a refusal");
  assert.ok(warnings.some((warning) => warning?.code === "project_name_aliases_conflict"),
    `Garden must collide with the area fixture: ${JSON.stringify(warnings)}`);
  assert.equal(fs.readFileSync(projectPath, "utf8"), projectBefore, "Capture names preflight is a dry run");
}

// The ^prj handoff opens navigation's Task Card, which reads a bullet-property
// config from the XDG config home. Give Obsidian a hermetic one so the card
// can open in the scratch profile; bob keeps its own BOB_CONFIG_FILE.
function seedTaskCardConfig(profileDir) {
  const configHome = path.join(profileDir, "nav-config");
  fs.mkdirSync(path.join(configHome, "bob"), { recursive: true });
  fs.writeFileSync(path.join(configHome, "bob", "config.yml"), [
    "timezone: America/New_York",
    "",
    "properties:",
    "  - name: scheduled",
    "    values: date",
    "  - name: dependsOn",
    "    values: local_task_id",
    "",
  ].join("\n"));
  return configHome;
}

function rowById(probe, id) {
  return (Array.isArray(probe?.rows) ? probe.rows : []).find((row) => row.id === id) || null;
}

function clickRowSource(client, id) {
  return client.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll(".bob-property-editor [data-property-row]"))
      .find((node) => node.getAttribute("data-property-row") === ${JSON.stringify(id)});
    if (!row) return false;
    const host = row.closest(".bob-property-editor");
    row.focus();
    row.click();
    const selected = host?.querySelector('[data-property-row][aria-selected="true"]');
    if (selected?.getAttribute("data-property-row") !== ${JSON.stringify(id)}) return false;
    selected.focus();
    return true;
  })()`);
}

async function selectSetting(ctx, id) {
  if (!await clickRowSource(ctx.client, `setting::${id}`)) throw new Error(`Missing setting row ${id}`);
  return ctx.waitForEditor(ctx.client,
    (probe) => rowById(probe, `setting::${id}`)?.selected === true,
    `selected ${id} settings row`);
}

async function openHomeSetting(ctx, filePath, selector, expectedId, label) {
  await ctx.closePropertyEditor(ctx.client);
  await ctx.shared.openNote(ctx.client, filePath, "live");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`, Boolean, `${label} visible`, 15_000);
  if (!await ctx.selectorClick(ctx.client, selector)) throw new Error(`Could not click ${label}`);
  const probe = await ctx.waitForEditor(ctx.client,
    (value) => rowById(value, `setting::${expectedId}`)?.selected === true,
    `${label} focus ${expectedId}`);
  ctx.addCheck(ctx.report, `settings entrypoint focus ${label}`,
    rowById(probe, `setting::${expectedId}`)?.selected === true,
    { filePath, expectedId, selected: probe.rows.find((row) => row.selected)?.id, heading: probe.heading });
  await ctx.closePropertyEditor(ctx.client);
}

async function openByKeys(ctx, filePath, keys, expectedId, label) {
  await ctx.closePropertyEditor(ctx.client);
  await ctx.shared.openNote(ctx.client, filePath, "live");
  for (const key of keys) await ctx.sendKey(ctx.client, key);
  const probe = await ctx.waitForEditor(ctx.client,
    (value) => value.open && value.readSettled && (!expectedId || rowById(value, `setting::${expectedId}`)?.selected === true),
    `${label} property editor`);
  return probe;
}

function updateInputsSince(ctx, firstRow) {
  if (!fs.existsSync(ctx.bobLog)) return [];
  return fs.readFileSync(ctx.bobLog, "utf8").trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line))
    .slice(firstRow)
    .filter((row) => row.event === "start" && row.args?.[0] === "props" && row.args?.[1] === "update")
    .map((row) => {
      try { return { args: row.args, envelope: JSON.parse(row.input || "{}") }; }
      catch (_) { return { args: row.args, envelope: null }; }
    });
}

function bobLogRowCount(ctx) {
  return fs.existsSync(ctx.bobLog)
    ? fs.readFileSync(ctx.bobLog, "utf8").split("\n").filter(Boolean).length
    : 0;
}

async function entrypointAcceptance(ctx) {
  let probe = await openByKeys(ctx, AREA, ["+"], null, "bare plus");
  ctx.addCheck(ctx.report, "settings entrypoint focus bare plus opens the general editor",
    probe.open && probe.rows.some((row) => row.id === "setting::summary"),
    { heading: probe.heading, selected: probe.rows.find((row) => row.selected)?.id });
  await ctx.closePropertyEditor(ctx.client);

  probe = await openByKeys(ctx, AREA, ["=", "="], "summary", "double equals");
  ctx.addCheck(ctx.report, "settings entrypoint focus double equals selects first setting",
    rowById(probe, "setting::summary")?.selected === true,
    { heading: probe.heading, selected: probe.rows.find((row) => row.selected)?.id });
  await ctx.closePropertyEditor(ctx.client);

  await openHomeSetting(ctx, AREA, ".bob-home-card-settings", "summary", "Settings button");
  await openHomeSetting(ctx, AREA, '.bob-home-card-chip[data-home-chip="theme"]', "task_type", "type chip");
  await openHomeSetting(ctx, PROJECT, ".bob-home-card-settings", "parent", "project Settings button");
  await openHomeSetting(ctx, PROJECT, '.bob-home-card-chip[data-home-chip="theme"]', "task_type", "project type chip");

  // Exercise every policy chip the fixtures render, including the shadowed
  // clock keys and Capture names, rather than treating type as a proxy for all.
  for (const filePath of [AREA, PROJECT]) {
    await ctx.shared.openNote(ctx.client, filePath, "live");
    const keys = await ctx.client.evaluate(`Array.from(document.querySelectorAll(".bob-home-card-chip[data-home-chip]"), (node) => node.getAttribute("data-home-chip"))`);
    for (const key of keys) {
      const setting = ({ theme: "task_type", offclock: "clock", offclock_types: "clock" })[key] || key;
      await openHomeSetting(ctx, filePath, `.bob-home-card-chip[data-home-chip="${key}"]`, setting, `${filePath} ${key} chip`);
    }
  }

}

async function settingHistoryAcceptance(ctx) {
  const notePath = path.join(ctx.vaultDir, AREA);
  const original = fs.readFileSync(notePath, "utf8");
  const initial = await ctx.openPropertyEditor(ctx.client, AREA, { focusSettings: true });
  const initialGhost = rowById(initial, "setting::ready_cap");
  const initialUndo = Number(initial.history?.undo || 0);
  ctx.addCheck(ctx.report, "settings ready-cap bytes start as a config ghost",
    Boolean(initialGhost && initialGhost.classes.includes("is-ghost") && /Bob setting/.test(initialGhost.text)),
    { row: initialGhost, history: initial.history });

  const inputLog = bobLogRowCount(ctx);
  await selectSetting(ctx, "ready_cap");
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector('.bob-property-editor [data-property-stage][data-setting-id="ready_cap"]'))`,
    Boolean, "Ready cap stage", 10_000);
  await ctx.setInput(ctx.client, "[data-property-stage-input]", "8");
  await ctx.shared.waitFor(ctx.client,
    `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
    (text) => /Preview ·/.test(text), "Ready cap preview", 10_000);
  await ctx.sendKey(ctx.client, "Enter");
  let probe = await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && /Saved/.test(value.status) && rowById(value, "setting::ready_cap")?.selected === true,
    "Ready cap override applied");
  const override = fs.readFileSync(notePath, "utf8");
  const overrideUndo = Number(probe.history?.undo || 0);
  ctx.addCheck(ctx.report, "settings ready-cap bytes override is a single saved operation",
    override !== original && lib.yamlHasScalar(override, "ready_cap", "8")
      && override.includes("Body bytes stay outside settings edits.")
      && overrideUndo === initialUndo + 1,
    { beforeBytes: Buffer.byteLength(original), afterBytes: Buffer.byteLength(override), beforeUndo: initialUndo, afterUndo: overrideUndo, selected: probe.focusedRow });

  await selectSetting(ctx, "ready_cap");
  await ctx.sendKey(ctx.client, "d", { ctrl: true });
  probe = await ctx.waitForEditor(ctx.client,
    (value) => rowById(value, "setting::ready_cap")?.classes.includes("is-ghost") === true
      && /Bob setting/.test(rowById(value, "setting::ready_cap")?.text || ""),
    "Ready cap clear reconciled to config ghost");
  const cleared = fs.readFileSync(notePath, "utf8");
  const clearUndo = Number(probe.history?.undo || 0);
  ctx.addCheck(ctx.report, "settings ready-cap bytes clear is one operation and returns to config",
    !lib.yamlHasScalar(cleared, "ready_cap", "8") && !/^ready_cap:/m.test(cleared)
      && clearUndo === overrideUndo + 1 && probe.focusedRow === "setting::ready_cap",
    { afterClearBytes: Buffer.byteLength(cleared), overrideUndo, clearUndo, selected: probe.focusedRow });

  await ctx.sendKey(ctx.client, "u");
  probe = await ctx.waitForEditor(ctx.client,
    (value) => lib.yamlHasScalar(fs.readFileSync(notePath, "utf8"), "ready_cap", "8")
      && rowById(value, "setting::ready_cap")?.selected === true,
    "Undo clear restores ready cap override");
  ctx.assertDiskBytes(ctx.report, "settings ready-cap bytes undo clear restores override exactly", notePath, override);

  await ctx.sendKey(ctx.client, "u");
  probe = await ctx.waitForEditor(ctx.client,
    (value) => rowById(value, "setting::ready_cap")?.classes.includes("is-ghost") === true
      && fs.readFileSync(notePath, "utf8") === original,
    "Undo override restores original ready cap ghost");
  ctx.assertDiskBytes(ctx.report, "settings ready-cap bytes undo override restores original bytes", notePath, original);

  await ctx.sendKey(ctx.client, "r", { ctrl: true });
  probe = await ctx.waitForEditor(ctx.client,
    (value) => lib.yamlHasScalar(fs.readFileSync(notePath, "utf8"), "ready_cap", "8")
      && rowById(value, "setting::ready_cap")?.selected === true,
    "Redo ready cap override");
  ctx.assertDiskBytes(ctx.report, "settings ready-cap bytes redo override exact bytes", notePath, override);

  await ctx.sendKey(ctx.client, "r", { ctrl: true });
  probe = await ctx.waitForEditor(ctx.client,
    (value) => fs.readFileSync(notePath, "utf8") === cleared
      && rowById(value, "setting::ready_cap")?.classes.includes("is-ghost") === true,
    "Redo ready cap clear");
  ctx.assertDiskBytes(ctx.report, "settings ready-cap bytes redo clear exact bytes", notePath, cleared);

  const updates = updateInputsSince(ctx, inputLog);
  const shapes = updates.map((row) => ({
    op: row.envelope?.ops?.[0]?.op,
    setting: row.envelope?.ops?.[0]?.setting,
    count: row.envelope?.ops?.length,
    dryRun: row.args.includes("-d"),
  }));
  ctx.addCheck(ctx.report, "settings ready-cap bytes typed history stays one operation per request",
    shapes.length >= 8 && shapes.every((shape) => shape.count === 1)
      && shapes.some((shape) => shape.op === "setting.set" && shape.setting === "ready_cap")
      && shapes.some((shape) => shape.op === "setting.clear" && shape.setting === "ready_cap"),
    { requests: shapes });
  await ctx.closePropertyEditor(ctx.client);
}

async function simpleSettingsAcceptance(ctx) {
  const areaPath = path.join(ctx.vaultDir, AREA);
  const areaBefore = fs.readFileSync(areaPath, "utf8");
  let probe = await ctx.openPropertyEditor(ctx.client, AREA, { setting: "summary" });
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector('.bob-property-editor [data-property-stage][data-setting-id="summary"]'))`,
    Boolean, "Summary simple stage", 10_000);
  await ctx.setInput(ctx.client, "[data-property-stage-input]", "x".repeat(141));
  const longSummary = await ctx.client.evaluate(`(() => ({
    counter: document.querySelector(".bob-property-editor-stage-counter")?.textContent || "",
    warning: Boolean(document.querySelector(".bob-property-editor-stage-counter.is-long")),
    input: document.querySelector("[data-property-stage-input]")?.value || "",
  }))()`);
  ctx.addCheck(ctx.report, "settings invalid and warning values long summary warns without blocking",
    longSummary.input.length === 141 && longSummary.warning && /141/.test(longSummary.counter), longSummary);
  await ctx.shared.waitFor(ctx.client,
    `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
    (text) => /Preview ·/.test(text), "long Summary accepted preview", 10_000);
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && /Saved/.test(value.status), "long Summary saved despite warning");
  ctx.addCheck(ctx.report, "settings invalid and warning values long Summary actually saves",
    lib.yamlHasScalar(fs.readFileSync(areaPath, "utf8"), "summary", "x".repeat(141)),
    { bytes: fs.readFileSync(areaPath, "utf8") });
  await ctx.sendKey(ctx.client, "u");
  await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && fs.readFileSync(areaPath, "utf8") === areaBefore,
    "long Summary undo restores exact bytes");
  ctx.assertDiskBytes(ctx.report, "settings long Summary undo restores original bytes", areaPath, areaBefore);
  await selectSetting(ctx, "summary");
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector('[data-setting-id="summary"] [data-property-stage-input]'))`,
    Boolean, "Summary cancel stage", 10_000);
  await ctx.setInput(ctx.client, "[data-property-stage-input]", "Canceled summary draft");
  await ctx.client.call("Input.imeSetComposition", { text: "仮", selectionStart: 1, selectionEnd: 1 });
  await ctx.shared.waitFor(ctx.client,
    `app.plugins.plugins["bob-ledger-tools"]?.propertyEditorModal?.stageComposing === true`,
    Boolean, "Summary observes IME composition", 10_000);
  await ctx.sendKey(ctx.client, "Enter");
  const composing = await ctx.waitForEditor(ctx.client,
    (value) => Boolean(value.stage), "IME Enter leaves the Summary draft open");
  const noPendingEnter = await ctx.client.evaluate(`app.plugins.plugins["bob-ledger-tools"]?.propertyEditorModal?.pendingStageEnter == null`);
  ctx.addCheck(ctx.report, "settings IME Enter never applies the composing Summary draft",
    Boolean(composing.stage) && noPendingEnter && fs.readFileSync(areaPath, "utf8") === areaBefore,
    { stage: composing.stage, input: composing.stageInput, noPendingEnter });
  await ctx.client.call("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
  await ctx.sendKey(ctx.client, "Escape");
  probe = await ctx.waitForEditor(ctx.client, (value) => value.open && !value.stage, "cancel long Summary draft");
  ctx.assertDiskBytes(ctx.report, "settings summary cancel leaves bytes unchanged", areaPath, areaBefore);

  await selectSetting(ctx, "ready_cap");
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector('.bob-property-editor [data-property-stage][data-setting-id="ready_cap"]'))`,
    Boolean, "invalid Ready cap stage", 10_000);
  await ctx.setInput(ctx.client, "[data-property-stage-input]", "0");
  await ctx.sendKey(ctx.client, "Enter");
  probe = await ctx.waitForEditor(ctx.client,
    (value) => value.stage && /1.*999|between 1 and 999|ready cap/i.test(value.status + " " + value.stagePreview),
    "invalid Ready cap stays refused");
  ctx.addCheck(ctx.report, "settings invalid and warning values invalid Ready cap stays refused",
    Boolean(probe.stage) && /1.*999|between 1 and 999|ready cap/i.test(probe.status + " " + probe.stagePreview),
    { status: probe.status, stagePreview: probe.stagePreview, input: probe.stageInput });
  ctx.assertDiskBytes(ctx.report, "settings invalid Ready cap leaves bytes unchanged", areaPath, areaBefore);
  await ctx.sendKey(ctx.client, "Escape");
  await ctx.closePropertyEditor(ctx.client);

  // Review's stage guidance is the contract boundary: it applies to tasks
  // residing in this note and never writes dates onto the task or project.
  probe = await ctx.openPropertyEditor(ctx.client, AREA, { setting: "task_refresh" });
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector('.bob-property-editor [data-property-stage][data-setting-id="task_refresh"]'))`,
    Boolean, "Review stage", 10_000);
  const reviewText = await ctx.client.evaluate(`document.querySelector(".bob-property-editor-stage")?.textContent || ""`);
  ctx.addCheck(ctx.report, "settings invalid and warning values Review explains residence scope",
    /Applies to tasks living in this note only/i.test(reviewText), { reviewText });
  await ctx.sendKey(ctx.client, "Escape");
  await ctx.closePropertyEditor(ctx.client);

  const projectPath = path.join(ctx.vaultDir, PROJECT);
  const projectBefore = fs.readFileSync(projectPath, "utf8");
  probe = await ctx.openPropertyEditor(ctx.client, PROJECT, { focusSettings: true });
  await selectSetting(ctx, "root");
  await ctx.sendKey(ctx.client, "Enter");
  probe = await ctx.waitForEditor(ctx.client,
    (value) => !value.pendingApply && /Saved/.test(value.status)
      && lib.yamlHasScalar(fs.readFileSync(projectPath, "utf8"), "root", "true")
      && rowById(value, "setting::root")?.selected === true
      && /root · true/.test(rowById(value, "setting::root")?.valueText || ""),
    "Stats root enabled on nested project");
  const rootSet = fs.readFileSync(projectPath, "utf8");
  ctx.addCheck(ctx.report, "settings invalid and warning values Stats root writes true",
    /^root:\s*true\s*$/m.test(rootSet) && !/^root:\s*false\s*$/m.test(rootSet), { rootSet });
  // Disk replacement precedes the response and final repaint. Wait above for
  // the confirmed contract/save guard before issuing a separate second toggle.
  await ctx.sendKey(ctx.client, "Enter");
  probe = await ctx.waitForEditor(ctx.client,
    (value) => !value.pendingApply && /Saved/.test(value.status)
      && fs.readFileSync(projectPath, "utf8") === projectBefore
      && rowById(value, "setting::root")?.classes.includes("is-ghost") === true
      && rowById(value, "setting::root")?.selected === true,
    "Stats root clear to absence");
  ctx.assertDiskBytes(ctx.report, "settings Stats root toggle back clears key", projectPath, projectBefore);
  await ctx.closePropertyEditor(ctx.client);

  const topPath = path.join(ctx.vaultDir, TOP_PROJECT);
  const topBefore = fs.readFileSync(topPath, "utf8");
  probe = await ctx.openPropertyEditor(ctx.client, TOP_PROJECT, { setting: "root" });
  const root = rowById(probe, "setting::root");
  await ctx.sendKey(ctx.client, "Enter");
  probe = await ctx.waitForEditor(ctx.client, (value) => value.open && !value.stage, "top-level Stats root disabled");
  ctx.addCheck(ctx.report, "settings invalid and warning values top-level Stats root is disabled",
    root?.disabled === true && /Disabled on a top-level project|disabled/i.test(probe.status + " " + root.text)
      && fs.readFileSync(topPath, "utf8") === topBefore,
    { root, status: probe.status });
  await ctx.closePropertyEditor(ctx.client);
}

async function projectTaskAcceptance(ctx) {
  const projectPath = path.join(ctx.vaultDir, PROJECT);
  const before = fs.readFileSync(projectPath, "utf8");
  const taskLine = "- [ ] #task #prj Prepare the settings rollout ^prj";
  const expectedLine = before.split("\n").indexOf(taskLine);
  const fields = ["goal", "starts", "depends_on", "status"];
  const outcomes = [];
  for (const field of fields) {
    const probe = await ctx.openPropertyEditor(ctx.client, PROJECT, { focusSettings: true });
    const row = field === "status"
      ? probe.rows.find((candidate) => candidate.key === "status") || null
      : rowById(probe, `project-task::${field}`);
    const id = row?.id || `project-task::${field}`;
    const clicked = await clickRowSource(ctx.client, id);
    if (!clicked) throw new Error(`Missing project task navigation row ${id}`);
    await ctx.waitForEditor(ctx.client, (value) => rowById(value, id)?.selected === true, `selected project task ${field}`);
    await ctx.sendKey(ctx.client, "Enter");
    await ctx.shared.waitFor(ctx.client, `!document.querySelector(".bob-property-editor")`, Boolean, `${field} leaves property editor`, 12_000);
    const state = await ctx.shared.waitFor(ctx.client, `(() => {
      const leaf = app.workspace.activeLeaf;
      const editor = leaf?.view?.editor;
      const cursor = editor?.getCursor?.("from") || null;
      return {
        path: leaf?.view?.file?.path || null,
        cursor,
        line: cursor ? editor.getLine(cursor.line) : null,
        taskCard: Boolean(document.querySelector(".bob-task-card-root")),
        pickerAvailable: typeof app.plugins.plugins["bob-navigation-hotkeys"]?.openBulletPropertyPicker === "function",
        propertyEditor: Boolean(document.querySelector(".bob-property-editor")),
      };
    })()`, (value) => value.path === PROJECT && value.line === taskLine && !value.propertyEditor
      && (!value.pickerAvailable || value.taskCard), `${field} finishes the project task handoff`, 12_000);
    outcomes.push({ field, row: row?.id, state });
    ctx.addCheck(ctx.report, `settings project task handoffs ${field} reaches current prj task`,
      state.path === PROJECT && state.line === taskLine && state.propertyEditor === false
        && (!state.pickerAvailable || state.taskCard),
      { field, expectedLine, row, state });
    ctx.assertDiskBytes(ctx.report, `settings project task handoffs ${field} does not write task fields or dates`, projectPath, before);
    if (state.taskCard) {
      await ctx.sendKey(ctx.client, "Escape");
      await ctx.shared.waitFor(ctx.client, `!document.querySelector(".bob-task-card-root")`, Boolean,
        `${field} task card closed`, 10_000);
    }
  }
  const scheduledKeys = ["scheduled", "due", "start", "deadline"];
  ctx.addCheck(ctx.report, "settings project task handoffs create no scheduling frontmatter",
    scheduledKeys.every((key) => !new RegExp(`^${key}:`, "m").test(fs.readFileSync(projectPath, "utf8"))),
    { scheduledKeys, outcomes });

  // The project card's policy chip and Settings entrypoints were exercised
  // independently above; make sure the row selection can also be refreshed.
  const noWrite = fs.readFileSync(projectPath, "utf8") === before;
  ctx.addCheck(ctx.report, "settings project task handoffs status is navigation only", noWrite, { outcomes, noWrite });
}

async function genericParityAcceptance(ctx) {
  const notePath = path.join(ctx.vaultDir, AREA);
  const before = fs.readFileSync(notePath, "utf8");
  let probe = await ctx.openPropertyEditor(ctx.client, AREA, { focusSettings: true });
  const sourceKeys = probe.properties.map((item) => item.key);
  const loose = ["created", "aliases", "tags", "cssclasses", "priority", "template"];
  const rowsBeforeFold = probe.rows.map((row) => row.key);
  const managedGroup = await ctx.client.evaluate(`(() => {
    const section = document.querySelector('[data-property-group="managed"]');
    return {
      exists: Boolean(section),
      title: section?.querySelector(".bob-property-editor-group-title")?.textContent || "",
      expanded: section?.querySelector(".bob-property-editor-group-title")?.getAttribute("aria-expanded") || null,
    };
  })()`);
  if (!managedGroup.exists) throw new Error("Bob-managed group missing from area settings editor");
  if (managedGroup.expanded !== "true") {
    await ctx.selectorClick(ctx.client, '[data-property-group="managed"] .bob-property-editor-group-title');
    probe = await ctx.waitForEditor(ctx.client,
      (value) => value.rows.some((row) => row.key === "task_count"), "expanded managed legacy-count row");
  }
  const managedRows = probe.rows.map((row) => row.key);
  const legacy = probe.rows.find((row) => row.key === "task_count");
  const exactSourceCount = Array.isArray(probe.properties) && probe.properties.length === sourceKeys.length;
  const genericRowsPresent = loose.every((key) => sourceKeys.includes(key));
  ctx.addCheck(ctx.report, "settings managed and generic property parity keeps real source rows",
    genericRowsPresent && exactSourceCount && Boolean(legacy) && /retired|nothing maintains/i.test(`${legacy.text} ${legacy.diagnostic}`),
    { loose, sourceKeys, rowsBeforeFold, managedGroup, managedRows, legacy, exactSourceCount });

  if (!await ctx.propertyRowClick(ctx.client, "task_count")) throw new Error("Could not select retired task_count");
  await ctx.sendKey(ctx.client, "d", { ctrl: true });
  await ctx.waitForEditor(ctx.client,
    (value) => !value.rows.some((row) => row.key === "task_count")
      && !/^task_count:/m.test(fs.readFileSync(notePath, "utf8")),
    "retired task_count deleted");
  ctx.assertDiskBytes(ctx.report, "settings managed and generic property parity deletes only retired count",
    notePath, before.replace("task_count: 8\n", ""));
  await ctx.sendKey(ctx.client, "u");
  await ctx.waitForEditor(ctx.client,
    (value) => value.rows.some((row) => row.key === "task_count") && fs.readFileSync(notePath, "utf8") === before,
    "retired count undo restores bytes");
  ctx.assertDiskBytes(ctx.report, "settings managed and generic property parity count undo is exact", notePath, before);

  const clipboard = await clipboardRead(ctx.client);
  if (!clipboard.ok) throw new Error("Settings copy acceptance requires the scratch clipboard");
  try {
    for (const [id, expected, count] of [["task_type", 'theme: "Writing"', 1], ["clock", "offclock: false\noffclock_types: [writing]", 2]]) {
      await selectSetting(ctx, id);
      await ctx.sendKey(ctx.client, "c", { ctrl: true });
      await ctx.waitForEditor(ctx.client,
        (value) => value.status.includes(`Copied ${count} propert`), `declared ${id} copied`);
      const copied = await clipboardRead(ctx.client);
      ctx.addCheck(ctx.report, `settings managed and generic property parity ${id} copy preserves source bytes`,
        copied.ok && copied.text === expected, { expected, actual: copied.text });
    }
    const sentinel = "ghost copy must leave this clipboard unchanged";
    if (!(await clipboardWrite(ctx.client, sentinel)).ok) throw new Error("Could not seed scratch clipboard");
    await selectSetting(ctx, "ready_cap");
    await ctx.sendKey(ctx.client, "c", { ctrl: true });
    const ghost = await ctx.waitForEditor(ctx.client,
      (value) => /no declared bytes to copy/i.test(value.status + " " + value.announce), "ghost copy explanation");
    const copied = await clipboardRead(ctx.client);
    ctx.addCheck(ctx.report, "settings managed and generic property parity ghost copy never serializes effective value",
      copied.ok && copied.text === sentinel, { actual: copied.text, status: ghost.status, announce: ghost.announce });
  } finally {
    await clipboardWrite(ctx.client, clipboard.text);
  }

  await ctx.closePropertyEditor(ctx.client);
  await ctx.shared.openNote(ctx.client, AREA, "live");
  await ctx.openPropertyEditor(ctx.client, AREA, { focusSettings: true });
  const groupState = await ctx.client.evaluate(`document.querySelector('[data-property-group="managed"] .bob-property-editor-group-title')?.getAttribute("aria-expanded") || null`);
  ctx.addCheck(ctx.report, "settings managed and generic property parity fold state survives reopen",
    groupState === "true" || groupState === "false", { groupState });
  ctx.assertDiskBytes(ctx.report, "settings managed and generic property parity paints without writes", notePath, before);
  await ctx.closePropertyEditor(ctx.client);
}

async function aliasWarningAcceptance(ctx) {
  const projectPath = path.join(ctx.vaultDir, PROJECT);
  const before = fs.readFileSync(projectPath, "utf8");
  await ctx.openPropertyEditor(ctx.client, PROJECT, { setting: "project_name_aliases" });
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector("[data-property-stage-input]"))`, Boolean, "Capture names stage", 10_000);
  // Garden is already declared on the area's fixture, so Bob must report
  // its cross-note collision while still allowing this explicit override.
  await ctx.setInput(ctx.client, "[data-property-stage-input]", "Garden");
  await ctx.sendKey(ctx.client, "Enter");
  // The local "Preview ·" copy paints before Bob answers; read the warning
  // only after Bob's dry-run is ready for exactly this [Garden] draft.
  const settled = await ctx.waitForEditor(ctx.client,
    (value) => lib.stagePreviewSettled(value)
      && JSON.parse(value.stageSession.currentOps)[0]?.value?.join?.("|") === "Garden",
    "Capture names collision preview settled by Bob", 20_000);
  let warning = "";
  try {
    warning = await ctx.shared.waitFor(ctx.client,
      `document.querySelector(".bob-property-editor-stage")?.textContent || ""`,
      (text) => /ambiguous|claimed by more than one/i.test(text), "Capture names collision painted", 5_000);
  } catch (_) {
    warning = await ctx.client.evaluate(`document.querySelector(".bob-property-editor-stage")?.textContent || ""`);
  }
  ctx.addCheck(ctx.report, "settings invalid and warning values alias collision is shown inline",
    settled.stageSession.warnings.includes("project_name_aliases_conflict")
      && /garden/i.test(warning) && /ambiguous|claimed by more than one/i.test(warning),
    { warning, session: settled.stageSession, status: settled.status });
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && /Saved/.test(value.status), "Capture names warning does not block save");
  const after = fs.readFileSync(projectPath, "utf8");
  ctx.addCheck(ctx.report, "settings invalid and warning values alias collision permits save",
    /^project_name_aliases:/m.test(after) && /Garden/.test(after), { after });
  await ctx.sendKey(ctx.client, "u");
  await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && fs.readFileSync(projectPath, "utf8") === before,
    "Capture names undo restores exact project bytes");
  ctx.assertDiskBytes(ctx.report, "settings Capture names undo restores exact bytes", projectPath, before);
  await ctx.closePropertyEditor(ctx.client);
}

async function policyStagesAcceptance(ctx) {
  const bodyPath = path.join(ctx.vaultDir, BODY);
  const bodyBefore = fs.readFileSync(bodyPath, "utf8");
  let probe = await ctx.openPropertyEditor(ctx.client, BODY, { setting: "color" });
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector('.bob-property-editor [data-property-stage][data-setting-id="color"]'))`,
    Boolean, "Hue swatch stage", 10_000);
  const swatches = await ctx.client.evaluate(`(() => ({
    hue: document.querySelector(".bob-property-editor-header")?.getAttribute("data-policy-preview-hue") || "",
    blue: Boolean(document.querySelector('[data-property-policy-choice="blue"]')),
    loveLabel: document.querySelector('[data-property-policy-choice="blue"]')?.getAttribute("title") || "",
    inherit: Boolean(document.querySelector('[data-property-policy-choice="__bob_policy_inherit__"]')),
    inheritSelected: document.querySelector('[data-property-policy-choice="__bob_policy_inherit__"]')?.getAttribute("aria-pressed") || "",
  }))()`);
  ctx.addCheck(ctx.report, "settings invalid and warning values hue stage starts at inherited tint and shows used-by labels",
    swatches.hue === "blue" && swatches.blue && /love/i.test(swatches.loveLabel)
      && swatches.inherit && swatches.inheritSelected === "true",
    swatches);
  if (!await ctx.selectorClick(ctx.client, '[data-property-policy-choice="aqua"]')) throw new Error("Missing aqua hue swatch");
  probe = await ctx.waitForEditor(ctx.client,
    (value) => lib.stagePreviewSettled(value) && value.stageSession.currentOps.includes('"setting":"color"')
      && value.stageSession.currentOps.includes('"value":"aqua"'),
    "Hue change previewed by Bob");
  const tint = await ctx.client.evaluate(`document.querySelector(".bob-property-editor-header")?.getAttribute("data-policy-preview-hue") || ""`);
  ctx.addCheck(ctx.report, "settings invalid and warning values hue swatch previews the header tint",
    tint === "aqua", { tint, session: probe.stageSession });
  await ctx.sendKey(ctx.client, "Escape");
  await ctx.waitForEditor(ctx.client, (value) => !value.stage, "cancel Hue preview");
  ctx.assertDiskBytes(ctx.report, "settings invalid and warning values Hue Esc writes nothing", bodyPath, bodyBefore);

  await ctx.openPropertyEditor(ctx.client, BODY, { setting: "color" });
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector('.bob-property-editor [data-property-stage][data-setting-id="color"]'))`,
    Boolean, "Hue apply stage", 10_000);
  if (!await ctx.selectorClick(ctx.client, '[data-property-policy-choice="aqua"]')) throw new Error("Missing aqua hue swatch for apply");
  await ctx.waitForEditor(ctx.client,
    (value) => lib.stagePreviewSettled(value) && value.stageSession.currentOps.includes('"value":"aqua"'),
    "Hue apply preview settled");
  await ctx.sendKey(ctx.client, "Enter");
  probe = await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && /Saved/.test(value.status)
      && /^color:\s*aqua\s*$/m.test(fs.readFileSync(bodyPath, "utf8")),
    "sub-area hue override applied");
  const afterHue = fs.readFileSync(bodyPath, "utf8");
  ctx.addCheck(ctx.report, "settings invalid and warning values sub-area hue override writes through setting.set",
    afterHue !== bodyBefore && /^color:\s*aqua\s*$/m.test(afterHue), { beforeBytes: bodyBefore.length, afterBytes: afterHue.length });
  await ctx.sendKey(ctx.client, "u");
  await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && fs.readFileSync(bodyPath, "utf8") === bodyBefore,
    "undo sub-area hue override");
  ctx.assertDiskBytes(ctx.report, "settings invalid and warning values sub-area hue undo restores exact bytes", bodyPath, bodyBefore);
  await ctx.closePropertyEditor(ctx.client);

  const projectPath = path.join(ctx.vaultDir, PROJECT);
  const projectBefore = fs.readFileSync(projectPath, "utf8");
  probe = await ctx.openPropertyEditor(ctx.client, PROJECT, { setting: "task_type" });
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector('.bob-property-editor [data-property-stage][data-setting-id="task_type"]'))`,
    Boolean, "Default type picker stage", 10_000);
  const migrationCopy = await ctx.client.evaluate(`document.querySelector(".bob-property-editor-stage")?.textContent || ""`);
  ctx.addCheck(ctx.report, "settings invalid and warning values Default type stage names legacy theme migration",
    /migrates legacy theme to task_type/i.test(migrationCopy), { migrationCopy });
  await ctx.setInput(ctx.client, "[data-property-policy-filter]", "Writing");
  if (!await ctx.selectorClick(ctx.client, '[data-property-policy-choice="Writing"]')) {
    const choice = await ctx.client.evaluate(`Array.from(document.querySelectorAll("[data-property-policy-choice]"))
      .find((node) => /writing/i.test(node.textContent || ""))?.getAttribute("data-property-policy-choice") || ""`);
    if (!choice || !await ctx.selectorClick(ctx.client, `[data-property-policy-choice="${choice}"]`)) {
      throw new Error("Default type picker did not expose the existing legacy theme value");
    }
  }
  probe = await ctx.waitForEditor(ctx.client,
    (value) => lib.stagePreviewSettled(value) && value.stageSession.currentOps.includes('"setting":"task_type"'),
    "legacy type migration preview settled");
  ctx.addCheck(ctx.report, "settings invalid and warning values unconfigured default type keeps Bob warning",
    probe.stageSession.warnings.length > 0 || /unconfigured/i.test(probe.stagePreview + " " + migrationCopy),
    { warnings: probe.stageSession.warnings, preview: probe.stagePreview, migrationCopy });
  await ctx.sendKey(ctx.client, "Enter");
  probe = await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && /Saved/.test(value.status)
      && /^task_type:/m.test(fs.readFileSync(projectPath, "utf8"))
      && !/^theme:/m.test(fs.readFileSync(projectPath, "utf8")),
    "legacy theme migrated to task_type");
  ctx.addCheck(ctx.report, "settings invalid and warning values legacy theme migration writes canonical key",
    /^task_type:/m.test(fs.readFileSync(projectPath, "utf8")) && !/^theme:/m.test(fs.readFileSync(projectPath, "utf8")),
    { bytes: fs.readFileSync(projectPath, "utf8") });
  await ctx.sendKey(ctx.client, "u");
  await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && fs.readFileSync(projectPath, "utf8") === projectBefore,
    "undo legacy theme migration");
  ctx.assertDiskBytes(ctx.report, "settings invalid and warning values legacy theme undo restores exact bytes", projectPath, projectBefore);
  await ctx.closePropertyEditor(ctx.client);

  const clockBefore = fs.readFileSync(bodyPath, "utf8");
  probe = await ctx.openPropertyEditor(ctx.client, BODY, { setting: "clock" });
  await ctx.sendKey(ctx.client, "Enter");
  await ctx.shared.waitFor(ctx.client,
    `Boolean(document.querySelector('.bob-property-editor [data-property-stage][data-setting-id="clock"]'))`,
    Boolean, "Clock policy stage", 10_000);
  const clockCopy = await ctx.client.evaluate(`document.querySelector(".bob-property-editor-stage")?.textContent || ""`);
  ctx.addCheck(ctx.report, "settings invalid and warning values shadowed Clock stage warns and previews cleanup",
    /shadowed|ignored/i.test(clockCopy), { clockCopy });
  probe = await ctx.waitForEditor(ctx.client,
    (value) => lib.stagePreviewSettled(value) && value.stageSession.currentOps.includes('"setting":"clock"')
      && value.stageSession.currentOps.includes('"mode":"types"'),
    "shadowed clock cleanup preview settled");
  await ctx.sendKey(ctx.client, "Enter");
  probe = await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && /Saved/.test(value.status)
      && !/^offclock:/m.test(fs.readFileSync(bodyPath, "utf8"))
      && /^offclock_types:/m.test(fs.readFileSync(bodyPath, "utf8")),
    "shadowed clock key removed");
  const clockAfter = fs.readFileSync(bodyPath, "utf8");
  ctx.addCheck(ctx.report, "settings invalid and warning values clock cleanup is one setting operation",
    clockAfter !== clockBefore && !/^offclock:/m.test(clockAfter) && /^offclock_types:/m.test(clockAfter),
    { before: clockBefore, after: clockAfter });
  await ctx.sendKey(ctx.client, "u");
  await ctx.waitForEditor(ctx.client,
    (value) => !value.stage && fs.readFileSync(bodyPath, "utf8") === clockBefore,
    "undo shadowed clock cleanup");
  ctx.assertDiskBytes(ctx.report, "settings invalid and warning values shadowed clock undo restores exact bytes", bodyPath, clockBefore);
  await ctx.closePropertyEditor(ctx.client);
}

async function policyStageScreenshots(ctx) {
  const cases = [
    { file: BODY, setting: "color", choice: '[data-property-policy-choice="aqua"]', name: "hue" },
    { file: PROJECT, setting: "task_type", choice: '[data-property-policy-choice="Writing"]', name: "type" },
    { file: BODY, setting: "clock", choice: '[data-property-policy-clock-mode="off"]', name: "clock" },
  ];
  for (const item of cases) {
    const notePath = path.join(ctx.vaultDir, item.file);
    const before = fs.readFileSync(notePath, "utf8");
    await ctx.openPropertyEditor(ctx.client, item.file, { setting: item.setting });
    await ctx.sendKey(ctx.client, "Enter");
    await ctx.shared.waitFor(ctx.client,
      `Boolean(document.querySelector('.bob-property-editor [data-property-stage][data-setting-id="${item.setting}"]'))`,
      Boolean, `${item.name} policy screenshot stage`, 10_000);
    if (item.setting !== "clock") {
      let selected = await ctx.selectorClick(ctx.client, item.choice);
      if (!selected && item.setting === "task_type") {
        const choice = await ctx.client.evaluate(`Array.from(document.querySelectorAll("[data-property-policy-choice]"))
          .find((node) => /writing/i.test(node.textContent || ""))?.getAttribute("data-property-policy-choice") || ""`);
        if (choice) selected = await ctx.selectorClick(ctx.client,
          `[data-property-policy-choice=${JSON.stringify(choice)}]`);
      }
      if (!selected) throw new Error(`Could not select a ${item.name} policy screenshot candidate`);
    }
    const settled = await ctx.waitForEditor(ctx.client,
      (value) => lib.stagePreviewSettled(value)
        && (item.setting !== "clock" || value.stageSession.currentOps.includes('"mode":"types"')),
      `${item.name} policy screenshot preview settled`, 20_000);
    for (const [width, theme] of STAGE_SHOTS) {
      await ctx.shared.setTheme(ctx.client, theme);
      await ctx.shared.setViewport(ctx.client, width, 900);
      const shot = await ctx.shared.capture(ctx.client, ctx.outDir,
        `settings-policy-${item.name}-${width}-${theme}`, width, theme, `Live Preview · ${item.name} policy stage`);
      shot.session = settled.stageSession;
      ctx.report.screenshots.push(shot);
      ctx.addCheck(ctx.report, "settings screenshots light dark narrow wide policy stages",
        fs.existsSync(shot.path) && shot.bytes > 0,
        { setting: item.setting, width, theme, name: shot.name, sha256: shot.sha256 });
    }
    await ctx.sendKey(ctx.client, "Escape");
    await ctx.waitForEditor(ctx.client, (value) => !value.stage, `${item.name} policy screenshot stage canceled`);
    ctx.assertDiskBytes(ctx.report, `settings ${item.name} policy screenshot cancel leaves exact bytes`, notePath, before);
    await ctx.shared.setViewport(ctx.client, 1400, 900);
    await ctx.closePropertyEditor(ctx.client);
  }
  await ctx.shared.setTheme(ctx.client, "light");
}

async function capabilityAcceptance(ctx) {
  const noContract = ctx.noContractFlag;
  fs.writeFileSync(noContract, "simulate props_v1 without props_contract_v1\n");
  let probe = await ctx.openPropertyEditor(ctx.client, AREA, { resetCapability: true });
  const settingRows = probe.rows.filter((row) => row.id?.startsWith("setting::"));
  ctx.addCheck(ctx.report, "settings capability fallbacks props_v1 without contract keeps generic rows",
    settingRows.length === 0 && /Update bob for typed settings/i.test(probe.banner)
      && probe.rows.some((row) => row.key === "theme"),
    { banner: probe.banner, settingRows, rows: probe.rows.map((row) => row.key) });
  await ctx.closePropertyEditor(ctx.client);
  fs.rmSync(noContract, { force: true });

  fs.writeFileSync(ctx.oldFlag, "simulate no props_v1\n");
  probe = await ctx.openPropertyEditor(ctx.client, "old-bob.md", { resetCapability: true });
  const oldSettings = probe.rows.filter((row) => row.id?.startsWith("setting::"));
  ctx.addCheck(ctx.report, "settings capability fallbacks no props_v1 stays read only",
    oldSettings.length === 0 && /Update bob to edit properties here/i.test(probe.banner) && !probe.stage,
    { banner: probe.banner, settingRows: oldSettings, rows: probe.rows });
  await ctx.closePropertyEditor(ctx.client);
  fs.rmSync(ctx.oldFlag, { force: true });
  await ctx.client.evaluate(`(() => {
    const plugin = app.plugins.plugins["bob-ledger-tools"];
    if (plugin) plugin.propertyCapability = null;
  })()`);
}

async function screenshotAcceptance(ctx) {
  const notePath = path.join(ctx.vaultDir, AREA);
  const before = fs.readFileSync(notePath, "utf8");
  const projectBefore = fs.readFileSync(path.join(ctx.vaultDir, PROJECT), "utf8");
  const specifications = [[1400, "light"], [1400, "dark"], [390, "light"], [390, "dark"]];
  for (const [file, species] of [[AREA, "area"], [PROJECT, "project"]]) {
    await ctx.openPropertyEditor(ctx.client, file, { focusSettings: true, resetCapability: true });
    for (const [width, theme] of specifications) {
      await ctx.shared.setTheme(ctx.client, theme);
      await ctx.shared.setViewport(ctx.client, width, 900);
      const layout = await ctx.client.evaluate(lib.visualLayoutSource());
      const shot = await ctx.shared.capture(ctx.client, ctx.outDir,
        `settings-${species}-populated-${width}-${theme}`, width, theme, `Live Preview · ${species} settings`);
      shot.layout = layout;
      ctx.report.screenshots.push(shot);
      ctx.addCheck(ctx.report, "settings screenshots light dark narrow wide populated settings layout",
        layout.open === true && !layout.clipped && !layout.keyValueOverlap && !layout.rowOverlap
          && !layout.valueOverflow && lib.headerLayoutLegible(layout)
          && fs.existsSync(shot.path) && shot.bytes > 0,
        { name: shot.name, width, theme, layout, sha256: shot.sha256 });
    }
    await ctx.shared.setViewport(ctx.client, 1400, 900);
    await ctx.closePropertyEditor(ctx.client);
  }

  // Each simple stage is captured with a valid changed draft whose Bob
  // preview has settled, so candidate effects are on screen; Esc then
  // cancels it and the note bytes must be unchanged.
  const drafts = {
    summary: "Settings acceptance area, reviewed in the stage screenshot",
    ready_cap: "8",
    task_refresh: "14",
    project_name_aliases: "Orchard",
  };
  await ctx.openPropertyEditor(ctx.client, AREA, { focusSettings: true });
  for (const [setting, draft] of Object.entries(drafts)) {
    await selectSetting(ctx, setting);
    await ctx.sendKey(ctx.client, "Enter");
    await ctx.shared.waitFor(ctx.client,
      `Boolean(document.querySelector('.bob-property-editor [data-property-stage][data-setting-id="${setting}"]'))`,
      Boolean, `${setting} screenshot stage`, 10_000);
    await ctx.setInput(ctx.client, "[data-property-stage-input]", draft);
    const settled = await ctx.waitForEditor(ctx.client,
      (value) => lib.stagePreviewSettled(value), `${setting} screenshot draft previewed by Bob`, 20_000);
    for (const [width, theme] of specifications) {
      await ctx.shared.setTheme(ctx.client, theme);
      await ctx.shared.setViewport(ctx.client, width, 900);
      await ctx.client.evaluate(`(() => {
        const stage = document.querySelector(".bob-property-editor-stage");
        stage?.scrollIntoView({ block: "center", behavior: "instant" });
        stage?.querySelector("[data-property-stage-input]")?.focus({ preventScroll: true });
      })()`);
      const layout = await ctx.client.evaluate(lib.visualLayoutSource());
      const stage = await ctx.client.evaluate(`(() => ({
        setting: document.querySelector(".bob-property-editor-stage")?.getAttribute("data-setting-id") || "",
        clipped: Array.from(document.querySelectorAll(".bob-property-editor-stage *")).some((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && (rect.left < 0 || rect.right > innerWidth + 1);
        }),
        focus: Boolean(document.querySelector(".bob-property-editor-stage :focus")),
        input: document.querySelector(".bob-property-editor-stage [data-property-stage-input]")?.value || "",
        preview: (() => {
          const stage = document.querySelector(".bob-property-editor-stage")?.getBoundingClientRect();
          const node = document.querySelector(".bob-property-editor-stage .bob-property-editor-stage-preview");
          const rect = node?.getBoundingClientRect();
          return {
            text: node?.textContent || "",
            inside: Boolean(stage && rect && rect.height > 0 && rect.top >= stage.top - 1 && rect.bottom <= stage.bottom + 1),
          };
        })(),
        visible: (() => {
          const stage = document.querySelector(".bob-property-editor-stage");
          const rect = stage?.getBoundingClientRect();
          return Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight
            && stage.scrollHeight <= stage.clientHeight + 2);
        })(),
      }))()`);
      const shot = await ctx.shared.capture(ctx.client, ctx.outDir,
        `settings-${setting}-stage-${width}-${theme}`, width, theme, `Live Preview · ${setting} stage`);
      shot.layout = layout;
      shot.stage = stage;
      shot.session = settled.stageSession;
      ctx.report.screenshots.push(shot);
      ctx.addCheck(ctx.report, "settings screenshots light dark narrow wide simple stage layout",
        stage.setting === setting && !stage.clipped && stage.visible && stage.focus
          && stage.input.includes(draft) && /Preview ·/.test(stage.preview.text) && stage.preview.inside
          && fs.existsSync(shot.path) && shot.bytes > 0,
        { name: shot.name, width, theme, stage, session: settled.stageSession, layout, sha256: shot.sha256 });
    }
    await ctx.sendKey(ctx.client, "Escape");
    await ctx.waitForEditor(ctx.client, (value) => !value.stage, `${setting} screenshot draft canceled`);
    ctx.assertDiskBytes(ctx.report, `settings ${setting} screenshot draft cancel leaves exact bytes`, notePath, before);
    await ctx.shared.setViewport(ctx.client, 1400, 900);
  }
  ctx.assertDiskBytes(ctx.report, "settings project repaint resize open and cancel leave exact bytes",
    path.join(ctx.vaultDir, PROJECT), projectBefore);
  await ctx.shared.setTheme(ctx.client, "light");
  await ctx.shared.setViewport(ctx.client, 1400, 900);
  await ctx.closePropertyEditor(ctx.client);
  ctx.assertDiskBytes(ctx.report, "settings repaint resize open and cancel leave exact bytes", notePath, before);
}

async function runSettingsAcceptance(ctx) {
  // Each scenario drives separate user gestures. Disk bytes and a report
  // repaint may appear before the write guard clears; do not send the next
  // gesture into that intentionally protected interval.
  const waitForEditor = ctx.waitForEditor;
  ctx = { ...ctx, waitForEditor: (client, predicate, label, timeoutMs) =>
    waitForEditor(client, (probe) => !probe.pendingApply && predicate(probe), label, timeoutMs) };
  // The preceding generic scenario simulates an old bob. Its shim flag has
  // been removed, but the modal's cached capability result must be reset too.
  await ctx.closePropertyEditor(ctx.client);
  const report = await ctx.client.evaluate(`(() => {
    const plugin = app.plugins.plugins["bob-ledger-tools"];
    if (plugin) plugin.propertyCapability = null;
    return { active: plugin?.propertyEditorSettingsEntrypointsActive === true };
  })()`);
  ctx.addCheck(ctx.report, "settings capability fallbacks settings entrypoint is active", report.active, report);
  await entrypointAcceptance(ctx);
  await screenshotAcceptance(ctx);
  await settingHistoryAcceptance(ctx);
  await simpleSettingsAcceptance(ctx);
  await aliasWarningAcceptance(ctx);
  await policyStagesAcceptance(ctx);
  await policyStageScreenshots(ctx);
  await projectTaskAcceptance(ctx);
  await genericParityAcceptance(ctx);
  await capabilityAcceptance(ctx);
  await ctx.closePropertyEditor(ctx.client);
}

function selfTest() {
  const notes = lib.fixtureNotes();
  assert.doesNotMatch(notes[AREA], /^ready_cap:/m, "Ready cap stays absent so it renders as a ghost");
  assert.match(notes[AREA], /theme: "Writing"/);
  assert.match(notes[PROJECT], /^- \[ \] #task #prj .+ \^prj$/m);
  assert.match(notes[PROJECT], /parent: "\[\[projects\/top-level-settings\]\]"/);
  assert.match(notes[PROJECT], /^status: wip$/m);
  assert.match(notes[TOP_PROJECT], /type: "\[\[project\]\]"/);
  const checks = [
    "settings-entrypoints-focus-correct-setting", "settings-ghost-set-clear-undo-redo-bytes",
    "settings-invalid-and-warning-values", "settings-project-task-handoffs-no-schedule-write",
    "settings-managed-generic-property-parity", "settings-capability-fallbacks",
    "settings-screenshots-light-dark-narrow-wide",
  ];
  for (const check of checks) assert.ok(lib.ACCEPTANCE_CHECKS.includes(check), check);
  const scratch = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "settings-self-test-"));
  try {
    const configHome = seedTaskCardConfig(scratch);
    assert.match(fs.readFileSync(path.join(configHome, "bob", "config.yml"), "utf8"), /^properties:$/m,
      "the Task Card handoff needs a hermetic navigation config");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  assert.equal(typeof runSettingsAcceptance, "function");
}

module.exports = { runSettingsAcceptance, seedTaskCardConfig, verifyFixtures, selfTest };
