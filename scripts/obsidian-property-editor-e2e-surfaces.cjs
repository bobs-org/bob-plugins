// Real-Obsidian Property Editor surface acceptance: panes, stale drafts,
// history/YAML return, close keys, unload, every entry point, and visual
// layout metrics. The write-path runner calls this after its disk proofs.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const lib = require("./obsidian-property-editor-e2e-lib.cjs");

function yamlStateSource() {
  return `(() => {
    const leaf = window.app?.workspace?.activeLeaf;
    const view = leaf?.view;
    const editor = view?.editor;
    const cursor = editor?.getCursor?.();
    return {
      path: view?.file?.path || "",
      source: view?.getState?.()?.source === true,
      mode: view?.getMode?.() || "",
      line: cursor ? cursor.line + 1 : null,
      text: cursor && editor?.getLine ? editor.getLine(cursor.line) : "",
      done: Boolean(view?.containerEl?.querySelector?.("[data-album-yaml-done]")),
    };
  })()`;
}

function vimCodeFor(key) {
  if (/^[a-z]$/i.test(key)) return "Key" + key.toUpperCase();
  if (key === "Enter" || key === "Escape") return key;
  if (key === "=" || key === "+") return "Equal";
  if (key === "-") return "Minus";
  if (key === "[") return "BracketLeft";
  return key;
}

async function vimKey(client, input) {
  const spec = typeof input === "string" ? { key: input } : input;
  const modifiers = spec.modifiers || 0;
  const text = Object.prototype.hasOwnProperty.call(spec, "text")
    ? spec.text
    : (!modifiers && spec.key.length === 1 ? spec.key : spec.key === "Enter" ? "\r" : "");
  const payload = {
    key: spec.key,
    code: spec.code || vimCodeFor(spec.key),
    modifiers,
    windowsVirtualKeyCode: 0,
    nativeVirtualKeyCode: 0,
  };
  if (text) {
    payload.text = text;
    payload.unmodifiedText = spec.unmodifiedText || text;
  }
  await client.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...payload });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
  await require("./obsidian-record-card-e2e.cjs").sleep(spec.pause == null ? 24 : spec.pause);
}

async function clickSelector(client, selector) {
  const shared = require("./obsidian-record-card-e2e.cjs");
  const point = await client.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find((node) => node.getClientRects().length > 0) || null;
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!point) throw new Error("click target missing: " + selector);
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.call("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
  });
  await client.call("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
  });
  await shared.sleep(250);
  return point;
}

async function focusLiveEditor(client, sendKey) {
  const shared = require("./obsidian-record-card-e2e.cjs");
  const point = await client.evaluate(`(() => {
    const el = document.querySelector(".cm-editor .cm-content");
    if (!el) return null;
    el.focus();
    const rect = el.getBoundingClientRect();
    return { x: rect.x + Math.min(40, Math.max(8, rect.width / 2)), y: rect.y + Math.min(24, Math.max(8, rect.height / 2)) };
  })()`);
  if (!point) throw new Error("Live Preview editor is not focused");
  await client.call("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1,
  });
  await client.call("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1,
  });
  await sendKey(client, "Escape");
  await shared.sleep(80);
  const ready = await client.evaluate(`Boolean(document.activeElement?.closest?.(".cm-editor"))`);
  if (!ready) throw new Error("CodeMirror editor did not take focus");
}

async function openPaletteCommand(client, sendKey, setInput, title) {
  const shared = require("./obsidian-record-card-e2e.cjs");
  await sendKey(client, "p", { ctrl: true });
  await shared.waitFor(client, "Boolean(document.querySelector('.prompt-input'))", Boolean, "command palette");
  await client.evaluate("document.querySelector('.prompt-input')?.focus()");
  await setInput(client, ".prompt-input", title);
  await shared.waitFor(client,
    `Array.from(document.querySelectorAll('.suggestion-item, .prompt-results .suggestion-item')).map((el) => el.textContent || "").join("\\n")`,
    (text) => text.includes(title), "palette row " + title);
  await sendKey(client, "Enter");
}

async function runSurfaceAcceptance(ctx) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, closePropertyEditor, propertyRowClick, saveStage, setInput,
    finishYamlExcursion, selectorClick,
  } = ctx;
  const surfacesPath = path.join(vaultDir, "surfaces.md");
  const surfacesBefore = fs.readFileSync(surfacesPath, "utf8");

  const closed = () => shared.waitFor(client, lib.editorProbeSource(), (probe) => !probe?.open, "property editor closed");
  const peel = async (key, options) => {
    await sendKey(client, key, options);
    await shared.sleep(120);
  };

  await closePropertyEditor(client);
  await shared.openNote(client, "surfaces.md", "live");

  // Two panes of one note with unsaved editor text; apply saves both first.
  const split = await client.evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath("surfaces.md");
    const first = app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view?.file?.path === "surfaces.md")
      || app.workspace.activeLeaf;
    app.workspace.setActiveLeaf(first, { focus: true });
    const second = app.workspace.getLeaf("split", "vertical");
    await second.openFile(file, { state: { mode: "source", source: true } });
    const body = "Unsaved pane text for acceptance.";
    const next = first.view.editor.getValue().includes(body)
      ? first.view.editor.getValue()
      : first.view.editor.getValue().replace(/\\s*$/, "\\n" + body + "\\n");
    first.view.editor.setValue(next);
    second.view.editor.setValue(next);
    window.__propertyEditorPanes = { first, second, body };
    return {
      leaves: app.workspace.getLeavesOfType("markdown").filter((leaf) => leaf.view?.file?.path === "surfaces.md").length,
      dirty: first.view.editor.getValue().includes(body) && second.view.editor.getValue().includes(body),
    };
  })()`, 20_000);
  addCheck(report, "two panes show one unsaved note", split?.leaves >= 2 && split?.dirty === true, split);
  await client.evaluate(`app.workspace.setActiveLeaf(window.__propertyEditorPanes.first, { focus: true })`);
  let probe = await openPropertyEditor(client, "surfaces.md", { key: "keep_me", mode: "edit" });
  await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "surfaces keep_me stage");
  await saveStage(client, "[data-property-stage-input]", "pane-saved", "keep_me");
  const afterPanes = fs.readFileSync(surfacesPath, "utf8");
  addCheck(report, "apply saved unsaved pane text",
    afterPanes.includes("keep_me: pane-saved") && afterPanes.includes("Unsaved pane text for acceptance."),
    { afterPanes });

  // External modify during a draft: stale refusal keeps the draft.
  await propertyRowClick(client, "edit_me");
  await sendKey(client, "Enter");
  await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "stale draft stage");
  await setInput(client, "[data-property-stage-input]", "held-draft");
  await shared.waitFor(client,
    `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
    (text) => /Preview ·/.test(text), "stale draft preview");
  const external = await client.evaluate(`(async () => {
    const view = window.__propertyEditorPanes.second.view;
    const text = view.editor.getValue();
    const next = text.replace('keep_me: pane-saved', 'keep_me: elsewhere');
    if (next === text) return { ok: false, text };
    view.editor.setValue(next);
    await view.save();
    return { ok: true };
  })()`, 20_000);
  addCheck(report, "external pane modify landed", external?.ok === true, external);
  await sendKey(client, "Enter");
  probe = await waitForEditor(client, (value) => value.open && value.stage && /stale|vault changed|preview again/i.test(`${value.status} ${value.banner}`),
    "stale refusal keeps the stage");
  addCheck(report, "stale refusal keeps the draft",
    probe.stageKind === "text" && probe.stageInput.includes("held-draft"), probe);
  const staleBytes = fs.readFileSync(surfacesPath, "utf8");
  addCheck(report, "stale refusal writes nothing", staleBytes.includes("edit_me: draft") && staleBytes.includes("keep_me: elsewhere"), { staleBytes });
  await shared.waitFor(client,
    `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
    (text) => /Preview ·/.test(text), "fresh preview after stale");
  await sendKey(client, "Enter");
  await waitForEditor(client, (value) => !value.stage && /Saved/.test(value.status) && value.rows.some((row) => row.key === "edit_me"),
    "retry after stale saves");
  addCheck(report, "fresh preview required after stale", fs.readFileSync(surfacesPath, "utf8").includes("edit_me: held-draft"),
    { text: fs.readFileSync(surfacesPath, "utf8") });
  await client.evaluate(`(() => {
    const second = window.__propertyEditorPanes && window.__propertyEditorPanes.second;
    if (second) try { second.detach(); } catch (_) {}
    window.__propertyEditorPanes = null;
  })()`);

  // Close/reopen keeps history.
  probe = await waitForEditor(client, (value) => value.open && value.history && value.history.undo > 0, "history after writes");
  const undoBefore = probe.history?.undo || 0;
  addCheck(report, "history recorded before close", undoBefore > 0, probe.history);
  await closePropertyEditor(client);
  await closed();
  probe = await openPropertyEditor(client, "surfaces.md");
  addCheck(report, "history survives close and reopen", (probe.history?.undo || 0) === undoBefore, probe.history);
  await sendKey(client, "u");
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "edit_me" && /draft/.test(row.text)),
    "undo after reopen");
  addCheck(report, "reopened undo restores bytes", fs.readFileSync(surfacesPath, "utf8").includes("edit_me: draft"),
    { text: fs.readFileSync(surfacesPath, "utf8") });

  // y then Done restores Live Preview and the same key; external delete uses nearest.
  await propertyRowClick(client, "keep_me");
  await sendKey(client, "y");
  const yaml = await shared.waitFor(client, yamlStateSource(),
    (value) => value?.done && /keep_me:/.test(value.text || ""), "surfaces YAML keep_me");
  addCheck(report, "surfaces YAML keep_me", /keep_me:/.test(yaml.text || ""), yaml);
  addCheck(report, "YAML excursion is Source mode", yaml.source === true || yaml.mode === "source", yaml);
  await finishYamlExcursion(client, "surfaces YAML keep_me");
  probe = await waitForEditor(client, (value) => value.open && value.rows.some((row) => row.key === "keep_me" && row.selected),
    "Done reopens the same key");
  const view = await client.evaluate("app.workspace.activeLeaf.view.getState()");
  addCheck(report, "Done restores Live Preview", view.source === false, view);
  addCheck(report, "Done reopens the same key", probe.rows.some((row) => row.key === "keep_me" && row.selected), probe);

  await propertyRowClick(client, "keep_me");
  await sendKey(client, "y");
  await shared.waitFor(client, yamlStateSource(), (value) => value?.done, "YAML before external delete");
  await client.evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath("surfaces.md");
    const text = await app.vault.read(file);
    await app.vault.modify(file, text.replace(/^keep_me:.*\\n/m, ""));
  })()`);
  await finishYamlExcursion(client, "YAML after external keep_me delete");
  probe = await waitForEditor(client, (value) => value.open && value.readSettled && !value.rows.some((row) => row.key === "keep_me"),
    "keep_me gone after Done");
  addCheck(report, "Done lands on a nearest remaining row",
    probe.rows.some((row) => row.selected) && !probe.rows.some((row) => row.key === "keep_me"), probe);

  // Close keys: Esc/q/Ctrl+[ peel menu, then stage, then modal. q types in a field.
  await closePropertyEditor(client);
  await shared.openNote(client, "ordinary.md", "live");
  probe = await openPropertyEditor(client, "ordinary.md");
  await client.evaluate(`app.plugins.plugins["bob-ledger-tools"].propertyEditorModal.menuOpen = true`);
  probe = await waitForEditor(client, (value) => value.open && value.menuOpen === true, "menu armed for Esc");
  await peel("Escape");
  probe = await waitForEditor(client, (value) => value.open && value.menuOpen === false, "Esc peels the menu");
  addCheck(report, "Esc peels the menu", probe.open && probe.menuOpen === false, probe);
  await client.evaluate(`app.plugins.plugins["bob-ledger-tools"].propertyEditorModal.menuOpen = true`);
  await peel("q");
  probe = await waitForEditor(client, (value) => value.open && value.menuOpen === false, "q peels the menu");
  addCheck(report, "q peels the menu", probe.open && probe.menuOpen === false, probe);
  await client.evaluate(`app.plugins.plugins["bob-ledger-tools"].propertyEditorModal.menuOpen = true`);
  await peel("[", { ctrl: true });
  probe = await waitForEditor(client, (value) => value.open && value.menuOpen === false, "Ctrl+[ peels the menu");
  addCheck(report, "Ctrl+[ peels the menu", probe.open && probe.menuOpen === false, probe);
  await closePropertyEditor(client);

  probe = await openPropertyEditor(client, "ordinary.md", { key: "title", mode: "edit" });
  await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "ordinary title stage");
  await sendKey(client, "q");
  probe = await waitForEditor(client, (value) => value.stage && /q/.test(value.stageInput), "q types in the stage");
  addCheck(report, "q types in a text field", probe.inInput === true && /q/.test(probe.stageInput), probe);
  await sendKey(client, "[", { ctrl: true });
  probe = await waitForEditor(client, (value) => value.open && !value.stage, "Ctrl+[ peels the stage");
  addCheck(report, "Ctrl+[ never types", !/\[/.test(probe.stageInput || "") && !probe.stage, probe);
  await sendKey(client, "[", { ctrl: true });
  await closed();
  addCheck(report, "Ctrl+[ closes the modal from browse", true, { closedBy: "Ctrl+[" });

  probe = await openPropertyEditor(client, "ordinary.md", { key: "title", mode: "edit" });
  await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "Esc stage");
  await sendKey(client, "Escape");
  probe = await waitForEditor(client, (value) => value.open && !value.stage, "Esc peels the stage");
  addCheck(report, "Esc peels the stage", !probe.stage, probe);
  await sendKey(client, "Escape");
  await closed();
  addCheck(report, "Esc closes the modal from browse", true, { closedBy: "Escape" });

  probe = await openPropertyEditor(client, "ordinary.md");
  await peel("q");
  await closed();
  addCheck(report, "q closes the modal from browse", true, { closedBy: "q" });

  // Entry points: palette, Command Mode, =+, Shift+=, API, drawer.
  await shared.openNote(client, "ordinary.md", "live");
  await openPaletteCommand(client, sendKey, setInput, "Edit note properties");
  probe = await waitForEditor(client, (value) => value.open && value.readSettled, "palette opens the editor");
  addCheck(report, "palette Edit note properties", probe.open && probe.filePath === "ordinary.md", probe);
  await closePropertyEditor(client);

  await openPaletteCommand(client, sendKey, setInput, "Bob: Command mode");
  await shared.waitFor(client, "Boolean(document.querySelector('.bob-cmd-sheet-input'))", Boolean, "Command Mode input");
  await client.evaluate("document.querySelector('.bob-cmd-sheet-input')?.focus()");
  await setInput(client, ".bob-cmd-sheet-input", "Edit note properties");
  const commandRows = await shared.waitFor(client,
    `Array.from(document.querySelectorAll('.bob-cmd-row')).filter((el) => el.getClientRects().length).map((el) => ({ title: el.querySelector('.bob-cmd-row-title')?.textContent || '', selected: el.classList.contains('is-selected') }))`,
    (rows) => rows.some((row) => row.title === "Edit note properties"), "Command Mode row");
  for (let i = 0; i < commandRows.length && !commandRows.some((row) => row.title === "Edit note properties" && row.selected); i += 1) {
    const selected = commandRows.findIndex((row) => row.selected);
    const wanted = commandRows.findIndex((row) => row.title === "Edit note properties");
    await sendKey(client, selected < wanted ? "ArrowDown" : "ArrowUp");
    await shared.sleep(80);
    commandRows.splice(0, commandRows.length, ...(await client.evaluate(
      `Array.from(document.querySelectorAll('.bob-cmd-row')).filter((el) => el.getClientRects().length).map((el) => ({ title: el.querySelector('.bob-cmd-row-title')?.textContent || '', selected: el.classList.contains('is-selected') }))`,
    )));
  }
  addCheck(report, "Command Mode lists Edit note properties", commandRows.some((row) => row.title === "Edit note properties"), commandRows);
  await sendKey(client, "Enter");
  probe = await waitForEditor(client, (value) => value.open && value.readSettled, "Command Mode opens the editor");
  addCheck(report, "Command Mode row opens the editor", probe.open && probe.filePath === "ordinary.md", probe);
  await closePropertyEditor(client);

  await shared.openNote(client, "ordinary.md", "live");
  await focusLiveEditor(client, sendKey);
  await vimKey(client, "=");
  await vimKey(client, "+");
  probe = await waitForEditor(client, (value) => value.open && value.readSettled, "=+ chord opens the editor");
  addCheck(report, "=+ Live Preview Vim chord", probe.open && probe.filePath === "ordinary.md", probe);
  await closePropertyEditor(client);

  await focusLiveEditor(client, sendKey);
  await vimKey(client, "=");
  await vimKey(client, { key: "+", modifiers: 8, text: "+", unmodifiedText: "=" });
  probe = await waitForEditor(client, (value) => value.open && value.readSettled, "Shift+= chord opens the editor");
  addCheck(report, "Shift+= Live Preview Vim chord", probe.open && probe.filePath === "ordinary.md", probe);
  await closePropertyEditor(client);

  probe = await openPropertyEditor(client, "ordinary.md", { key: "title", mode: "browse" });
  addCheck(report, "API openPropertyEditor on an ordinary note", probe.open && probe.rows.some((row) => row.key === "title"), probe);
  await closePropertyEditor(client);
  probe = await openPropertyEditor(client, "invalid.md", { resetCapability: true });
  addCheck(report, "API openPropertyEditor on invalid YAML", probe.open && Boolean(probe.recovery), probe);
  await closePropertyEditor(client);
  await shared.openNote(client, "invalid.md", "live");
  await openPaletteCommand(client, sendKey, setInput, "Edit note properties");
  probe = await waitForEditor(client, (value) => value.open && Boolean(value.recovery), "palette on invalid YAML");
  addCheck(report, "palette opens invalid YAML recovery", probe.open && Boolean(probe.recovery), probe);
  await closePropertyEditor(client);

  await shared.openNote(client, "projects-album.md", "live");
  await shared.waitFor(client, "Boolean(document.querySelector('.bob-property-card-foot-disclosure'))", Boolean,
    "album property drawer disclosure", 20_000);
  const disclosure = await client.evaluate(`document.querySelector('.bob-property-card-foot-disclosure')?.getAttribute('aria-expanded')`);
  if (disclosure !== "true") await clickSelector(client, ".bob-property-card-foot-disclosure");
  await shared.waitFor(client, "Boolean(document.querySelector('.bob-property-card-foot-key-button'))", Boolean, "drawer key labels");
  await clickSelector(client, ".bob-property-card-foot-key-button");
  probe = await waitForEditor(client, (value) => value.open && value.readSettled, "drawer key-label opens the editor");
  addCheck(report, "drawer key-label click opens the editor", probe.open, probe);
  await closePropertyEditor(client);
  if ((await client.evaluate(`document.querySelector('.bob-property-card-foot-disclosure')?.getAttribute('aria-expanded')`)) !== "true") {
    await clickSelector(client, ".bob-property-card-foot-disclosure");
  }
  await shared.waitFor(client, "Boolean(document.querySelector('.bob-property-card-foot-add'))", Boolean, "drawer add button");
  await clickSelector(client, ".bob-property-card-foot-add");
  await shared.waitFor(client,
    `Boolean(document.querySelector(".bob-property-editor [data-property-add='name'], .bob-property-editor [data-property-stage]"))`,
    Boolean, "drawer add property");
  probe = await waitForEditor(client, (value) => value.open && (value.stage || value.stageKind), "drawer add property open");
  addCheck(report, "drawer Add property opens add mode", probe.open && (probe.stage || probe.stageKind), probe);
  await closePropertyEditor(client);
  if ((await client.evaluate(`document.querySelector('.bob-property-card-foot-disclosure')?.getAttribute('aria-expanded')`)) !== "true") {
    await clickSelector(client, ".bob-property-card-foot-disclosure");
  }
  await clickSelector(client, ".bob-property-card-foot-edit-all");
  probe = await waitForEditor(client, (value) => value.open && value.readSettled, "drawer Edit all");
  addCheck(report, "drawer Edit all =+ opens the editor", probe.open, probe);
  await closePropertyEditor(client);

  // Restore the surfaces note to a known shape is unnecessary: later unload
  // does not assert its bytes. Keep the original fixture text for the report.
  report.surfacesBytes = {
    before: surfacesBefore,
    after: fs.readFileSync(surfacesPath, "utf8"),
  };
}

async function runVisualReview(ctx) {
  const { client, report, shared, addCheck, openPropertyEditor, propertyRowClick, sendKey } = ctx;
  await shared.openNote(client, "projects/project-note.md", "live");
  await openPropertyEditor(client, "projects/project-note.md", { key: "keep_exact" });
  await propertyRowClick(client, "keep_exact");
  await sendKey(client, "j");
  await shared.waitFor(client, lib.editorProbeSource(),
    (probe) => probe.rows.some((row) => row.selected && row.action === "locked" && row.lockedClass === true),
    "locked derived row selected for visuals");
  const layout = await client.evaluate(lib.visualLayoutSource());
  addCheck(report, "selected row is visually distinct", layout.selectedDiffers === true && /is-selected/.test(layout.selectedClasses || ""), layout);
  addCheck(report, "locked row stays readable", layout.lockedContrast >= 3 && /is-locked/.test(layout.lockedClasses || ""), layout);
  addCheck(report, "key and value do not overlap", layout.keyValueOverlap === false, layout);
  addCheck(report, "rows are not clipped", layout.clipped === false, layout);
  addCheck(report, "selected row shows a focus ring", layout.focusOutlineWidth >= 2, layout);
  report.visualLayout = layout;
  return layout;
}

async function runUnloadAcceptance(ctx) {
  const { client, report, shared, addCheck, openPropertyEditor, waitForEditor, sendKey, setInput } = ctx;
  await shared.openNote(client, "ordinary.md", "live");
  await openPropertyEditor(client, "ordinary.md", { key: "title", mode: "edit" });
  await shared.waitFor(client, `Boolean(document.querySelector(".bob-property-editor [data-property-stage]"))`, Boolean, "unload pending preview stage");
  await setInput(client, "[data-property-stage-input]", "will-not-land");
  const pending = await client.evaluate(`(() => {
    const plugin = app.plugins.plugins["bob-ledger-tools"];
    return {
      open: Boolean(document.querySelector(".bob-property-editor")),
      sessions: plugin?.propertySessions instanceof Map ? plugin.propertySessions.size : 0,
    };
  })()`);
  addCheck(report, "pending preview is mounted before unload", pending.open === true, pending);
  const disabled = await client.evaluate(`(async () => {
    await app.plugins.disablePlugin("bob-ledger-tools");
    return {
      loaded: Boolean(app.plugins.plugins["bob-ledger-tools"]),
      editors: document.querySelectorAll(".bob-property-editor").length,
    };
  })()`, 20_000);
  addCheck(report, "disabling the plugin closes the open modal", disabled.loaded === false && disabled.editors === 0, disabled);
  await shared.sleep(1500);
  const late = await client.evaluate(`({
    loaded: Boolean(app.plugins.plugins["bob-ledger-tools"]),
    editors: document.querySelectorAll(".bob-property-editor").length,
    notices: Array.from(document.querySelectorAll(".notice")).map((node) => node.textContent || ""),
  })`);
  addCheck(report, "pending preview does not reopen after unload", late.editors === 0 && late.loaded === false, late);

  await shared.openNote(client, "ordinary.md", "live");
  const enabled = await client.evaluate(`(async () => {
    await app.plugins.enablePlugin("bob-ledger-tools");
    return Boolean(app.plugins.plugins["bob-ledger-tools"]);
  })()`, 20_000);
  addCheck(report, "plugin re-enable for second unload", enabled === true, { enabled });
  await shared.waitFor(client, `Boolean(app.plugins.plugins["bob-ledger-tools"]?.propertyEditorEntrypointsActive)`, Boolean,
    "entry points active after re-enable");
  await openPropertyEditor(client, "ordinary.md");
  await waitForEditor(client, (value) => value.open, "reopened before browse unload");
  const browseUnload = await client.evaluate(`(async () => {
    await app.plugins.disablePlugin("bob-ledger-tools");
    return {
      loaded: Boolean(app.plugins.plugins["bob-ledger-tools"]),
      editors: document.querySelectorAll(".bob-property-editor").length,
    };
  })()`, 20_000);
  addCheck(report, "disabling while browsing leaves no editor", browseUnload.loaded === false && browseUnload.editors === 0, browseUnload);
  await shared.sleep(800);
  const lateBrowse = await client.evaluate(`document.querySelectorAll(".bob-property-editor").length`);
  addCheck(report, "no late reopen after browse unload", lateBrowse === 0, { lateBrowse });
  void sendKey;
}

module.exports = {
  runSurfaceAcceptance,
  runUnloadAcceptance,
  runVisualReview,
  visualLayoutSource: lib.visualLayoutSource,
};
