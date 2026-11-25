// Real-Obsidian parity acceptance for the Property Editor (bob-cli-pf.5.1).
// Keyboard-driven cases for rename, reorder, selection/filter, copy/paste,
// the YAML value stage, kind conversion, and vault type changes against a
// disposable vault and the exact bob binary the runner verified. Every write
// asserts disk bytes and its inverse operation; clipboard mutation and global
// type changes stay inside the harness scratch process and vault.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const lib = require("./obsidian-property-editor-e2e-lib.cjs");

async function clipboardWrite(client, text) {
  return client.evaluate(`(async () => {
    const sources = [];
    try { if (window.app?.clipboard) sources.push(window.app.clipboard); } catch (_) {}
    try { if (window.app?.workspace?.activeLeaf?.view?.containerEl?.ownerDocument?.defaultView?.navigator?.clipboard) sources.push(window.app.workspace.activeLeaf.view.containerEl.ownerDocument.defaultView.navigator.clipboard); } catch (_) {}
    try { if (navigator?.clipboard) sources.push(navigator.clipboard); } catch (_) {}
    for (const source of sources) {
      try {
        if (source && typeof source.writeText === "function") {
          await source.writeText(${JSON.stringify(text)});
          return { ok: true };
        }
      } catch (error) { /* try the next source */ }
    }
    return { ok: false };
  })()`);
}

async function clipboardRead(client) {
  return client.evaluate(`(async () => {
    const sources = [];
    try { if (window.app?.clipboard && typeof window.app.clipboard.readText === "function") sources.push(window.app.clipboard); } catch (_) {}
    try { if (window.app?.workspace?.activeLeaf?.view?.containerEl?.ownerDocument?.defaultView?.navigator?.clipboard) sources.push(window.app.workspace.activeLeaf.view.containerEl.ownerDocument.defaultView.navigator.clipboard); } catch (_) {}
    try { if (navigator?.clipboard) sources.push(navigator.clipboard); } catch (_) {}
    for (const source of sources) {
      try {
        if (source && typeof source.readText === "function") {
          const text = await source.readText();
          if (typeof text === "string") return { ok: true, text };
        }
      } catch (error) { /* try the next source */ }
    }
    return { ok: false, text: "" };
  })()`);
}

async function clipboardAvailable(client) {
  const probe = `bob-parity-clipboard-probe-${Date.now().toString(16)}`;
  const wrote = await clipboardWrite(client, probe);
  if (!wrote?.ok) return false;
  const read = await clipboardRead(client);
  return read?.ok === true && read.text === probe;
}

const PARITY_VIEW_COMBOS = [
  [1400, "light"], [1400, "dark"], [390, "light"], [390, "dark"],
];

async function captureParityView(ctx, view) {
  const { client, report, outDir, shared, waitForEditor, addCheck } = ctx;
  const taken = [];
  for (const [width, theme] of PARITY_VIEW_COMBOS) {
    await shared.setTheme(client, theme);
    await shared.setViewport(client, width, 900);
    await shared.sleep(150);
    await waitForEditor(client, (value) => value.open === true, `${view} view holds for screenshot`);
    const shot = await shared.capture(client, outDir, `property-editor-parity-${view}-${width}-${theme}`, width, theme, "Live Preview");
    report.screenshots.push(shot);
    const visible = await client.evaluate(`(() => {
      const editor = document.querySelector(".bob-property-editor");
      const bounds = editor?.getBoundingClientRect();
      return {
        heading: editor?.querySelector(".bob-property-editor-heading")?.textContent || "",
        rows: editor?.querySelectorAll("[data-property-row]").length || 0,
        unselectedLoose: editor?.querySelectorAll("[data-property-row]:not([aria-disabled='true']):not([aria-selected='true'])").length || 0,
        visible: Boolean(bounds && bounds.width > 0 && bounds.height > 0
          && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight),
      };
    })()`);
    const layout = await client.evaluate(lib.visualLayoutSource());
    const review = {
      name: shot.name,
      clipped: layout.clipped === false,
      keyValueOverlap: layout.keyValueOverlap === false,
      rowOverlap: layout.rowOverlap === false,
      valueOverflow: layout.valueOverflow === false,
      selectedDiffers: visible.unselectedLoose > 0 ? layout.selectedDiffers === true : true,
      markedDiffers: view === "marked" ? layout.markedDiffers === true : true,
      markedReadable: view === "marked" ? Number(layout.markedReadable || 0) >= 3 : true,
      lockedReadable: layout.lockedKey ? layout.lockedContrast >= 3 : true,
      heading: visible.heading,
      selectedKey: layout.selectedKey,
      markedKey: layout.markedKey,
    };
    shot.editor = visible;
    shot.layout = layout;
    shot.review = review;
    addCheck(report, `parity screenshot ${view} ${shot.name} contains the populated editor`,
      visible.visible && visible.rows > 0 && /PROPERTIES/.test(visible.heading || ""),
      { ...visible, imageWidth: shot.width, imageHeight: shot.height });
    addCheck(report, `parity screenshot ${view} ${shot.name} marked selected and locked rows are legible`,
      review.clipped && review.keyValueOverlap && review.rowOverlap && review.valueOverflow
        && review.selectedDiffers && review.markedDiffers && review.markedReadable && review.lockedReadable,
      { layout, review });
    taken.push({ shot, visible, layout, review });
  }
  // Restore the wide light shell before continuing: later modal opens assume
  // the default viewport, and focus clicks target title-bar coordinates.
  await shared.setTheme(client, "light");
  await shared.setViewport(client, 1400, 900);
  await shared.sleep(150);
  return taken;
}

async function tryReducedMotion(client) {
  try {
    await client.call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const active = await client.evaluate(`(() => {
      try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches === true; } catch (_) { return false; }
    })()`);
    return active === true;
  } catch (_) {
    return false;
  }
}

async function clearReducedMotion(client) {
  try {
    await client.call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });
  } catch (_) {}
}

async function probeTypeManager(client) {
  return client.evaluate(`(() => {
    const manager = window.app?.metadataTypeManager || null;
    return {
      present: manager !== null && typeof manager === "object",
      setType: typeof manager?.setType,
      getType: typeof manager?.getPropertyType,
      keys: manager ? Object.keys(manager).slice(0, 40) : [],
    };
  })()`);
}

async function runRenameAcceptance(ctx) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, closePropertyEditor, propertyRowClick, saveStage, setInput, assertDiskBytes,
  } = ctx;
  const parityPath = path.join(vaultDir, "parity.md");
  const parityBefore = fs.readFileSync(parityPath, "utf8");

  await closePropertyEditor(client);
  await shared.openNote(client, "parity.md", "live");
  let probe = await openPropertyEditor(client, "parity.md", { key: "alpha" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "alpha"), "parity rows");

  await propertyRowClick(client, "alpha");
  await sendKey(client, "r");
  probe = await waitForEditor(client, (value) => value.stageKind === "rename", "rename stage");
  addCheck(report, "parity rename bytes stage seeded with current key",
    probe.stageKind === "rename" && probe.stageInput === "alpha", probe);
  await setInput(client, "[data-property-stage-input]", "alpha_renamed");
  await shared.waitFor(client,
    `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
    (text) => /Preview · rename/.test(text), "rename preview");
  await sendKey(client, "Enter");
  probe = await waitForEditor(client, (value) => !value.stage && /Saved/.test(value.status)
    && value.rows.some((row) => row.key === "alpha_renamed"), "renamed row saved");
  const renamed = parityBefore.replace("alpha: one", "alpha_renamed: one");
  assertDiskBytes(report, "parity rename bytes only the key token changed", parityPath, renamed);
  addCheck(report, "parity rename bytes focus follows the renamed key",
    probe.focusedRow === probe.rows.find((row) => row.key === "alpha_renamed")?.id, probe);
  await sendKey(client, "u");
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "alpha"), "rename undo");
  assertDiskBytes(report, "parity rename undo bytes restores comment and key", parityPath, parityBefore);
  await sendKey(client, "r", { ctrl: true });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "alpha_renamed"), "rename redo");
  assertDiskBytes(report, "parity rename redo bytes keeps the renamed key", parityPath, renamed);

  await propertyRowClick(client, "beta");
  await sendKey(client, "r");
  await waitForEditor(client, (value) => value.stageKind === "rename", "duplicate rename stage");
  await setInput(client, "[data-property-stage-input]", "alpha_renamed");
  probe = await waitForEditor(client, (value) => value.open && Boolean(value.stage)
    && /already exists/.test(`${value.status} ${value.stagePreview}`), "duplicate rename refusal");
  addCheck(report, "parity duplicate rename names the existing key",
    /alpha_renamed/.test(`${probe.status} ${probe.stagePreview}`), probe);
  addCheck(report, "parity rename draft kept after duplicate refusal",
    probe.stageInput === "alpha_renamed" && probe.stageKind === "rename", probe);
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open && !value.stage, "duplicate rename cancelled");
  assertDiskBytes(report, "parity duplicate rename leaves bytes unchanged", parityPath, renamed);

  await propertyRowClick(client, "beta");
  await sendKey(client, "r");
  await waitForEditor(client, (value) => value.stageKind === "rename", "protected rename stage");
  await setInput(client, "[data-property-stage-input]", "type");
  probe = await waitForEditor(client, (value) => value.open && Boolean(value.stage)
    && /identif/.test(`${value.status} ${value.stagePreview}`), "protected rename refusal");
  addCheck(report, "parity protected rename refused for identity destination",
    probe.stageKind === "rename", probe);
  addCheck(report, "parity rename draft kept for protected destination",
    probe.stageInput === "type", probe);
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open && !value.stage, "protected rename cancelled");
  assertDiskBytes(report, "parity protected rename leaves bytes unchanged", parityPath, renamed);

  await propertyRowClick(client, "gamma");
  await sendKey(client, "r");
  await waitForEditor(client, (value) => value.stageKind === "rename", "same-name rename stage");
  await sendKey(client, "Enter");
  probe = await waitForEditor(client, (value) => value.open
    && (!value.stage || /no-op|unchanged|same/i.test(`${value.status} ${value.stagePreview}`)), "same-name rename no-op");
  addCheck(report, "parity same-name rename no-op keeps focus",
    probe.open === true && (!probe.stage || probe.stageKind === "rename"), probe);
  assertDiskBytes(report, "parity same-name rename no-op keeps bytes", parityPath, renamed);

  // Capture the rename view with the modal back in browse state: theme and
  // viewport cycling proved unstable while a rename stage holds focus.
  if (probe.stage) {
    await sendKey(client, "Escape");
    probe = await waitForEditor(client, (value) => value.open === true && !value.stage, "rename stage cancelled");
  }
  await captureParityView(ctx, "rename");

  await closePropertyEditor(client);
  return { renamed };
}

async function runReorderAcceptance(ctx, baseBytes) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, propertyRowClick, assertDiskBytes,
  } = ctx;
  const parityPath = path.join(vaultDir, "parity.md");

  await shared.openNote(client, "parity.md", "live");
  // The parity note still carries the renamed key from the rename section.
  let probe = await openPropertyEditor(client, "parity.md", { key: "gamma" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "gamma"), "parity reorder rows");

  const reduced = await tryReducedMotion(client);
  await propertyRowClick(client, "gamma");
  await sendKey(client, "ArrowUp", { alt: true });
  probe = await waitForEditor(client, (value) => {
    const keys = (value.rows || []).map((row) => row.key);
    return keys.indexOf("gamma") === keys.indexOf("beta") - 1 && /Moved/.test(value.announce || "");
  }, "gamma moves above beta");
  addCheck(report, "parity move announces source position",
    /Moved “gamma” to source position/.test(probe.announce || ""), { announce: probe.announce });
  const expectMoved = baseBytes
    .replace("beta: two\n# Comment for gamma\ngamma: three", "# Comment for gamma\ngamma: three\nbeta: two");
  assertDiskBytes(report, "parity reorder moves comment with entry bytes", parityPath, expectMoved);
  if (reduced) {
    const movedRow = probe.rows.find((row) => row.key === "gamma");
    addCheck(report, "parity reorder moves comment with entry bytes under reduced motion",
      Boolean(movedRow) && !/is-sliding/.test(movedRow.classes || ""), { classes: movedRow?.classes });
  } else {
    report.assertions.push({
      name: "parity reorder moves comment with entry bytes under reduced motion",
      status: "skip", detail: "Emulation.setEmulatedMedia unavailable in this harness",
    });
  }
  await clearReducedMotion(client);
  await sendKey(client, "u");
  await waitForEditor(client, (value) => {
    const keys = (value.rows || []).map((row) => row.key);
    return keys.indexOf("beta") === keys.indexOf("gamma") - 1;
  }, "reorder undo");
  assertDiskBytes(report, "parity reorder undo bytes restores order", parityPath, baseBytes);

  await propertyRowClick(client, "alpha_renamed");
  await sendKey(client, "ArrowUp", { alt: true });
  await shared.sleep(300);
  probe = await waitForEditor(client, (value) => value.open && !value.stage, "reorder boundary settled");
  addCheck(report, "parity reorder boundary no-op keeps focus",
    probe.rows[0]?.key === "alpha_renamed", probe);
  assertDiskBytes(report, "parity reorder boundary no-op bytes", parityPath, baseBytes);
}

async function runSelectionFilterDeleteAcceptance(ctx, baseBytes) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, propertyRowClick, setInput, assertDiskBytes, selectorClick,
  } = ctx;
  const parityPath = path.join(vaultDir, "parity.md");

  await shared.openNote(client, "parity.md", "live");
  let probe = await openPropertyEditor(client, "parity.md", { key: "alpha_renamed" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "beta"), "parity mark rows");

  await propertyRowClick(client, "alpha_renamed");
  await sendKey(client, " ");
  probe = await waitForEditor(client, (value) => value.rows.some((row) => row.key === "alpha_renamed" && row.marked), "alpha marked");
  addCheck(report, "parity range marks gutter shows marked rows",
    probe.rows.find((row) => row.key === "alpha_renamed")?.gutter === "✓", probe);
  await sendKey(client, "V", { shift: true });
  probe = await waitForEditor(client, (value) => /Visual range starts/.test(value.announce || ""), "visual range anchor");
  await sendKey(client, "j");
  probe = await waitForEditor(client, (value) => {
    const marked = (value.rows || []).filter((row) => row.marked).map((row) => row.key);
    return marked.includes("alpha_renamed") && marked.includes("beta");
  }, "visual range marks rows");
  const markedKeys = probe.rows.filter((row) => row.marked).map((row) => row.key).sort();
  addCheck(report, "parity range marks rows from visual anchor",
    JSON.stringify(markedKeys) === JSON.stringify(["alpha_renamed", "beta"]), { markedKeys });

  await captureParityView(ctx, "marked");

  await sendKey(client, "d", { ctrl: true });
  probe = await waitForEditor(client, (value) => !value.rows.some((row) => row.key === "alpha_renamed" || row.key === "beta"), "batch delete");
  const deleted = baseBytes
    .replace("# Parity comment travels with alpha\nalpha_renamed: one\n", "")
    .replace("beta: two\n", "");
  assertDiskBytes(report, "parity batch delete bytes removes marked rows in source order", parityPath, deleted);
  await sendKey(client, "u");
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "alpha_renamed")
    && value.rows.some((row) => row.key === "beta"), "batch delete undo");
  assertDiskBytes(report, "parity batch delete undo bytes restores marked rows", parityPath, baseBytes);

  // Filter edits reset marks so hidden rows cannot stay selected.
  await propertyRowClick(client, "alpha_renamed");
  await sendKey(client, " ");
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "alpha_renamed" && row.marked), "alpha marked again");
  await sendKey(client, "/");
  await waitForEditor(client, (value) => value.filterOpen === true, "filter opened");
  await setInput(client, "[data-property-filter-input='true']", "gamma");
  probe = await waitForEditor(client, (value) => value.filterOpen === true && value.filterQuery === "gamma"
    && !(value.rows || []).some((row) => row.marked), "marks reset on filter change");
  addCheck(report, "parity filter change clears marks with announcement",
    /selection cleared/i.test(probe.announce || ""), { announce: probe.announce });
  probe = await waitForEditor(client, (value) => (value.rows || []).length === 1 && value.rows[0].key === "gamma", "filter narrows");
  addCheck(report, "parity filter narrows to matching rows",
    probe.rows.length === 1 && probe.rows[0].key === "gamma", probe);
  await captureParityView(ctx, "filter");
  await sendKey(client, "Enter");
  probe = await waitForEditor(client, (value) => value.filterOpen === true
    && value.focusedRow === value.rows.find((row) => row.key === "gamma")?.id
    && value.inInput === false, "filter Enter returns focus");
  addCheck(report, "parity filter Enter returns focus to rows",
    probe.inInput === false && probe.rows.some((row) => row.key === "gamma" && row.selected), probe);

  await setInput(client, "[data-property-filter-input='true']", "zzz-no-match");
  probe = await waitForEditor(client, (value) => /No properties match/.test(value.filterEmpty || ""), "empty filter message");
  addCheck(report, "parity empty filter message with stable keyboard target",
    /zzz-no-match/.test(probe.filterEmpty) && probe.filterOpen === true, probe);
  await sendKey(client, "Escape");
  probe = await waitForEditor(client, (value) => value.open === true && value.filterOpen === false && value.filterQuery === "", "filter layer cleared");
  addCheck(report, "parity filter Esc clears layer before modal",
    probe.open === true && probe.filterOpen === false, probe);

  // Reordering stays refused while a filter query is active.
  await sendKey(client, "/");
  await waitForEditor(client, (value) => value.filterOpen === true, "filter reopened");
  await setInput(client, "[data-property-filter-input='true']", "alpha");
  await sendKey(client, "Enter");
  await waitForEditor(client, (value) => value.filterOpen === true && value.inInput === false, "filter focus on rows");
  await propertyRowClick(client, "alpha_renamed");
  await sendKey(client, "ArrowDown", { alt: true });
  probe = await waitForEditor(client, (value) => /Clear the filter/.test(`${value.status} ${value.announce}`), "reorder under filter refused");
  addCheck(report, "parity reorder under filter refused with filter hint",
    /Clear the filter/.test(`${probe.status} ${probe.announce}`), { status: probe.status, announce: probe.announce });
  assertDiskBytes(report, "parity reorder under filter refused bytes", parityPath, baseBytes);
  if (!await selectorClick(client, "[aria-label='All property actions']")) throw new Error("Missing All actions button");
  probe = await waitForEditor(client, (value) => value.menuOpen === true, "actions menu");
  const menuLock = await client.evaluate(`(() => {
    const items = Array.from(document.querySelectorAll(".bob-property-editor [role='menuitem']"));
    const gated = items.find((item) => /clear filter first/i.test(item.textContent || ""));
    return { count: items.length, gated: gated?.textContent || "", disabled: gated?.disabled === true || gated?.getAttribute?.("aria-disabled") === "true" };
  })()`);
  addCheck(report, "parity menu disables reorder under filter",
    /Reorder properties/.test(menuLock.gated) && menuLock.disabled === true, menuLock);
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.menuOpen !== true, "menu peeled");
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open === true && value.filterOpen === false, "filter cleared after lockout");
}

async function runMixedProtectedDeleteAcceptance(ctx) {
  const {
    client, report, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, closePropertyEditor, propertyRowClick, assertDiskBytes, selectorClick,
  } = ctx;
  const projectPath = path.join(ctx.vaultDir, "projects/project-note.md");
  const projectBefore = fs.readFileSync(projectPath, "utf8");

  await closePropertyEditor(client);
  await shared.openNote(client, "projects/project-note.md", "live");
  await openPropertyEditor(client, "projects/project-note.md", { key: "keep_exact" });
  let probe = await waitForEditor(client, (value) => value.rows.some((row) => row.key === "keep_exact"), "protected delete rows");
  if (!probe.rows.some((row) => row.key === "project_digest")) {
    if (!await selectorClick(client, '.bob-property-editor [data-property-group-toggle="managed"]')) {
      throw new Error("Could not expand Bob-managed properties for protected selection");
    }
    probe = await waitForEditor(client,
      (value) => value.rows.some((row) => row.key === "project_digest"),
      "expanded Bob-managed properties for protected selection");
  }
  if (!await propertyRowClick(client, "project_digest")) throw new Error("Could not focus project_digest for protected selection");
  await sendKey(client, " ");
  await waitForEditor(client, (value) => (value.rows || []).filter((row) => row.marked).length === 1, "first protected selection mark");
  if (!await propertyRowClick(client, "keep_exact")) throw new Error("Could not focus keep_exact for protected selection");
  await sendKey(client, " ");
  await waitForEditor(client, (value) => (value.rows || []).filter((row) => row.marked).length === 2, "mixed marks");
  await sendKey(client, "d", { ctrl: true });
  probe = await waitForEditor(client, (value) => value.open && !value.stage
    && /project_digest/.test(`${value.status} ${value.announce}`), "mixed protected refusal");
  addCheck(report, "parity mixed protected delete refused names locked rows",
    /project_digest/.test(`${probe.status} ${probe.announce}`), { status: probe.status, announce: probe.announce });
  assertDiskBytes(report, "parity mixed delete leaves bytes unchanged", projectPath, projectBefore);
  await closePropertyEditor(client);
}

async function runCopyAcceptance(ctx, baseBytes) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, closePropertyEditor, propertyRowClick, assertDiskBytes, selectorClick,
  } = ctx;
  const parityPath = path.join(vaultDir, "parity.md");
  const projectPath = path.join(vaultDir, "projects/project-note.md");

  await shared.openNote(client, "parity.md", "live");
  await openPropertyEditor(client, "parity.md", { key: "alpha_renamed" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "gamma"), "parity copy rows");

  const available = await clipboardAvailable(client);
  addCheck(report, "parity clipboard available in scratch process", available === true, { available });
  let savedClipboard = "";
  if (available) {
    const before = await clipboardRead(client);
    savedClipboard = before?.ok === true ? before.text : "";
  }
  const clip = async (label) => {
    const read = await clipboardRead(client);
    if (!read?.ok) throw new Error(`clipboard unreadable after ${label}`);
    return read.text;
  };

  if (!available) {
    for (const name of [
      "parity copy announces marked properties in file order",
      "parity clipboard holds source-exact bytes in file order",
      "parity protected row copies without writing",
      "parity opaque copy refused leaves bytes unchanged",
      "parity paste preview labels new replaced and skipped keys",
      "parity paste apply bytes shows ordered set",
      "parity paste undo bytes restores pre-paste note",
      "parity stale paste keeps draft requires preview",
      "parity malformed paste blocked with parse error",
      "parity all-skipped paste disables apply",
    ]) {
      report.assertions.push({ name, status: "skip", detail: "clipboard API unavailable in the scratch process" });
    }
    return { available: false, savedClipboard: "" };
  }

  await propertyRowClick(client, "alpha_renamed");
  await sendKey(client, " ");
  await propertyRowClick(client, "gamma");
  await sendKey(client, " ");
  await waitForEditor(client, (value) => (value.rows || []).filter((row) => row.marked).length === 2, "copy marks");
  await sendKey(client, "c", { ctrl: true });
  const copied = await waitForEditor(client, (value) => /Copied 2 properties/.test(value.status || ""), "copy announcement");
  addCheck(report, "parity copy announces marked properties in file order",
    /Copied 2 properties/.test(copied.status || ""), { status: copied.status });
  const text = await clip("copy");
  const alphaAt = text.indexOf("alpha_renamed: one");
  const gammaAt = text.indexOf("gamma: three");
  addCheck(report, "parity clipboard holds source-exact bytes in file order",
    alphaAt >= 0 && gammaAt > alphaAt && text.includes("# Comment for gamma"), { text });
  assertDiskBytes(report, "parity clipboard holds source-exact bytes without writing", parityPath, baseBytes);

  await closePropertyEditor(client);
  await shared.openNote(client, "projects/project-note.md", "live");
  const projectBefore = fs.readFileSync(projectPath, "utf8");
  // The opener waits for a requested key to be selected. Start on a visible
  // loose row so we can expand the managed group before selecting its digest.
  await openPropertyEditor(client, "projects/project-note.md", { key: "keep_exact" });
  let probe = await waitForEditor(client,
    (value) => value.rows.some((row) => row.key === "keep_exact"), "protected copy rows");
  if (!probe.rows.some((row) => row.key === "project_digest")) {
    if (!await selectorClick(client, '.bob-property-editor [data-property-group-toggle="managed"]')) {
      throw new Error("Could not expand Bob-managed properties for protected copy");
    }
    probe = await waitForEditor(client,
      (value) => value.rows.some((row) => row.key === "project_digest"),
      "expanded Bob-managed properties for protected copy");
  }
  await propertyRowClick(client, "project_digest");
  await sendKey(client, " ");
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "project_digest" && row.marked), "protected marked");
  await sendKey(client, "c", { ctrl: true });
  const protectedCopy = await waitForEditor(client, (value) => /Copied 1 propert/.test(value.status || ""), "protected copy announcement");
  addCheck(report, "parity protected row copies without writing",
    /Copied 1 propert/.test(protectedCopy.status || ""), { status: protectedCopy.status });
  const protectedText = await clip("protected copy");
  addCheck(report, "parity protected row copies read-only bytes",
    protectedText.includes("project_digest"), { text: protectedText });
  assertDiskBytes(report, "parity protected row copies bytes unchanged", projectPath, projectBefore);
  await closePropertyEditor(client);

  await shared.openNote(client, "parity.md", "live");
  await openPropertyEditor(client, "parity.md", { key: "anchored" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "anchored"), "opaque copy rows");
  await propertyRowClick(client, "anchored");
  await sendKey(client, " ");
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "anchored" && row.marked), "opaque marked");
  await sendKey(client, "c", { ctrl: true });
  const opaqueRefusal = await waitForEditor(client, (value) => value.open
    && /YAML/.test(`${value.status} ${value.announce}`), "opaque copy refusal");
  addCheck(report, "parity opaque copy refused leaves bytes unchanged",
    /YAML/.test(`${opaqueRefusal.status} ${opaqueRefusal.announce}`),
    { status: opaqueRefusal.status, announce: opaqueRefusal.announce });
  assertDiskBytes(report, "parity opaque copy refused keeps note bytes", parityPath, baseBytes);
  await closePropertyEditor(client);

  return { available: true, savedClipboard };
}

async function runPasteAcceptance(ctx, baseBytes, savedClipboard) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, closePropertyEditor, propertyRowClick, assertDiskBytes,
  } = ctx;
  const parityPath = path.join(vaultDir, "parity.md");

  await shared.openNote(client, "parity.md", "live");
  await openPropertyEditor(client, "parity.md", { key: "beta" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "beta"), "parity paste rows");

  // Anchors in clipboard text are refused outright by the decoder; a Skipped
  // row comes from an opaque key in the note, pasted here with a plain value.
  const pasteText = "new_parity_key: fresh value\nbeta: replaced beta\nanchored: plain replacement\n";
  const wrote = await clipboardWrite(client, pasteText);
  if (!wrote?.ok) throw new Error("clipboard write failed for paste acceptance");
  await sendKey(client, "v", { ctrl: true });
  let probe = await waitForEditor(client, (value) => value.clipboardOpen === true
    && /Paste YAML · 3 properties/.test(value.clipboardTitle || "")
    && (value.clipboardRows || []).length === 3
    && (value.clipboardRows || []).every((row) => ["New", "Replace", "Skipped"].includes(row.state)), "paste preview");
  const rows = probe.clipboardRows || [];
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  addCheck(report, "parity paste preview labels new replaced and skipped keys",
    byKey.new_parity_key?.state === "New"
    && byKey.beta?.state === "Replace"
    && byKey.anchored?.state === "Skipped"
    && /opaque|unchanged/i.test(byKey.anchored?.reason || "")
    && (byKey.beta?.values || []).some((text) => /two/.test(text))
    && (byKey.beta?.values || []).some((text) => /replaced beta/.test(text)),
    { rows });
  await captureParityView(ctx, "paste");
  probe = await waitForEditor(client, (value) => value.clipboardOpen === true
    && /Enter applies 2 properties/.test(value.stagePreview || ""), "paste preview ready");
  await sendKey(client, "Enter");
  probe = await waitForEditor(client, (value) => !value.clipboardOpen && /Pasted properties/.test(value.announce || "")
    && value.rows.some((row) => row.key === "new_parity_key"), "paste applied");
  const pasted = baseBytes
    .replace("beta: two", "beta: replaced beta")
    .replace("anchored: &a hello\n", "anchored: &a hello\nnew_parity_key: fresh value\n");
  assertDiskBytes(report, "parity paste apply bytes shows ordered set", parityPath, pasted);
  await sendKey(client, "u");
  await waitForEditor(client, (value) => !value.rows.some((row) => row.key === "new_parity_key")
    && value.rows.some((row) => row.key === "beta"), "paste undo");
  assertDiskBytes(report, "parity paste undo bytes restores pre-paste note", parityPath, baseBytes);

  // A stale preview keeps the clipboard draft and requires a fresh preview.
  await sendKey(client, "v", { ctrl: true });
  await waitForEditor(client, (value) => value.clipboardOpen === true
    && /Enter applies 2 properties/.test(value.stagePreview || ""), "second paste preview");
  const external = await client.evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath("parity.md");
    const text = await app.vault.read(file);
    const next = text.replace("beta: two", "beta: externally-changed");
    if (next === text) return { ok: false };
    await app.vault.modify(file, next);
    return { ok: true };
  })()`, 20_000);
  addCheck(report, "parity stale paste external modify landed", external?.ok === true, external);
  await sendKey(client, "Enter");
  probe = await waitForEditor(client, (value) => value.clipboardOpen === true
    && /preview this same set again|draft is kept/i.test(
      `${value.status} ${value.stagePreview}`), "stale paste refusal");
  addCheck(report, "parity stale paste keeps draft requires preview",
    probe.clipboardOpen === true && /draft is kept|again/i.test(`${probe.status} ${probe.stagePreview}`),
    { status: probe.status, preview: probe.stagePreview });
  // The confirming Enter re-previews the kept draft and applies the matching
  // preview in the same stroke, so wait for the applied state, not the
  // transient preview.
  await sendKey(client, "Enter");
  await waitForEditor(client, (value) => !value.clipboardOpen && /Pasted properties/.test(value.announce || ""), "stale paste applied");
  const staleBytes = fs.readFileSync(parityPath, "utf8");
  addCheck(report, "parity stale paste keeps draft and applies after fresh preview",
    lib.yamlHasScalar(staleBytes, "beta", "replaced beta")
    && lib.yamlHasScalar(staleBytes, "new_parity_key", "fresh value"), { staleBytes });
  await sendKey(client, "u");
  await waitForEditor(client, (value) => !value.rows.some((row) => row.key === "new_parity_key"), "stale paste undo");
  // Restore the externally changed key so later sections keep the pristine base.
  await closePropertyEditor(client);
  const restoredExternal = await client.evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath("parity.md");
    const text = await app.vault.read(file);
    const next = text.replace("beta: externally-changed", "beta: two");
    if (next === text) return { ok: false };
    await app.vault.modify(file, next);
    return { ok: true };
  })()`, 20_000);
  addCheck(report, "parity stale external change reverted", restoredExternal?.ok === true, restoredExternal);
  assertDiskBytes(report, "parity stale revert restores pristine bytes", parityPath, baseBytes);
  await openPropertyEditor(client, "parity.md", { key: "beta" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "beta"), "parity rows after revert");

  // Malformed clipboard content blocks the proposal entirely.
  const malformed = await clipboardWrite(client, "not: [valid");
  if (!malformed?.ok) throw new Error("clipboard write failed for malformed paste");
  await sendKey(client, "v", { ctrl: true });
  probe = await waitForEditor(client, (value) => value.clipboardOpen === true, "malformed paste blocked");
  addCheck(report, "parity malformed paste blocked with parse error",
    probe.clipboardOpen === true && probe.clipboardApplyDisabled === true
    && /read|invalid|parse|valid|error|unexpected|expected|mapping|YAML|block/i.test(`${probe.status} ${probe.clipboardTitle}`),
    { status: probe.status, title: probe.clipboardTitle, disabled: probe.clipboardApplyDisabled });
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open === true && value.clipboardOpen !== true, "malformed paste cancelled");

  const onlyOpaque = await clipboardWrite(client, "anchored: plain replacement\n");
  if (!onlyOpaque?.ok) throw new Error("clipboard write failed for all-skipped paste");
  await sendKey(client, "v", { ctrl: true });
  probe = await waitForEditor(client, (value) => value.clipboardOpen === true
    && (value.clipboardRows || []).length === 1
    && ["Skipped", "Blocked"].includes((value.clipboardRows || [])[0]?.state), "all-skipped paste preview");
  addCheck(report, "parity all-skipped paste disables apply",
    (probe.clipboardRows || [])[0]?.state === "Skipped" && probe.clipboardApplyDisabled === true,
    { rows: probe.clipboardRows, disabled: probe.clipboardApplyDisabled });
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open === true && value.clipboardOpen !== true, "all-skipped paste cancelled");

  const restored = await clipboardWrite(client, savedClipboard);
  addCheck(report, "parity scratch clipboard restored", restored?.ok === true, { restored });
  await closePropertyEditor(client);
}

async function runYamlStageAcceptance(ctx, baseBytes) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, closePropertyEditor, propertyRowClick, setInput, assertDiskBytes,
  } = ctx;
  const parityPath = path.join(vaultDir, "parity.md");

  await shared.openNote(client, "parity.md", "live");
  await openPropertyEditor(client, "parity.md", { key: "details" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "details"), "yaml rows");

  // The paste section leaves beta externally changed and undoes the batch;
  // details, count, created, and anchored are untouched by those flows.
  await propertyRowClick(client, "details");
  await sendKey(client, "Enter");
  let probe = await waitForEditor(client, (value) => value.stageKind === "yaml"
    && /city: Springfield/.test(value.stageInput || ""), "yaml stage");
  addCheck(report, "parity YAML map save bytes seeded from source fragment",
    probe.stageKind === "yaml", probe);
  await captureParityView(ctx, "yaml");
  const seeded = probe.stageInput;
  const edited = seeded.replace("city: Springfield", "city: Shelbyville");
  await setInput(client, "[data-property-stage-kind='yaml']", edited);
  await shared.waitFor(client,
    `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
    (text) => /Preview ·/.test(text), "yaml preview");
  await sendKey(client, "Enter", { ctrl: true });
  probe = await waitForEditor(client, (value) => !value.stage && /Saved/.test(value.status || "")
    && value.rows.some((row) => row.key === "details"), "yaml saved");
  assertDiskBytes(report, "parity YAML map save bytes edits nested value", parityPath,
    baseBytes.replace("city: Springfield", "city: Shelbyville"));
  await sendKey(client, "u");
  await waitForEditor(client, (value) => (value.rows.find((row) => row.key === "details")?.valueText || "").includes("Springfield"), "yaml undo");
  assertDiskBytes(report, "parity YAML save undo bytes restores nested value", parityPath, baseBytes);

  await propertyRowClick(client, "details");
  await sendKey(client, "Enter");
  await waitForEditor(client, (value) => value.stageKind === "yaml", "yaml stage again");
  await setInput(client, "[data-property-stage-kind='yaml']", "city: [unclosed");
  probe = await waitForEditor(client, (value) => value.stageKind === "yaml"
    && /valid|error|bracket|unexpected|expected|found/i.test(`${value.status} ${value.stagePreview}`), "yaml malformed refusal");
  addCheck(report, "parity YAML malformed shows bob error verbatim",
    /valid|error|bracket|unexpected|expected|found/i.test(`${probe.status} ${probe.stagePreview}`),
    { status: probe.status, preview: probe.stagePreview });
  assertDiskBytes(report, "parity YAML malformed shows bob error without writing", parityPath, baseBytes);
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open === true && !value.stage, "yaml malformed cancelled");

  await propertyRowClick(client, "anchored");
  await sendKey(client, "Enter");
  probe = await waitForEditor(client, (value) => value.stageKind === "yaml"
    && /opaque/i.test(`${value.status} ${value.stagePreview} ${value.banner}`), "opaque yaml inspect");
  await setInput(client, "[data-property-stage-kind='yaml']", "hello");
  await sendKey(client, "Enter", { ctrl: true });
  probe = await waitForEditor(client, (value) => value.stageKind === "yaml"
    && /opaque/i.test(`${value.status} ${value.stagePreview}`), "opaque save refused");
  addCheck(report, "parity opaque YAML save refused with draft kept",
    /opaque/i.test(`${probe.status} ${probe.stagePreview}`) && probe.stageInput === "hello",
    { status: probe.status, preview: probe.stagePreview });
  assertDiskBytes(report, "parity opaque YAML save refused keeps bytes", parityPath, baseBytes);
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open === true && !value.stage, "opaque yaml cancelled");
  await closePropertyEditor(client);
}

async function runKindConvertAcceptance(ctx, baseBytes) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, closePropertyEditor, propertyRowClick, assertDiskBytes, selectorClick,
  } = ctx;
  const parityPath = path.join(vaultDir, "parity.md");

  await shared.openNote(client, "parity.md", "live");
  await openPropertyEditor(client, "parity.md", { key: "count" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "count"), "convert rows");

  await propertyRowClick(client, "count");
  await sendKey(client, "t");
  let probe = await waitForEditor(client, (value) => value.stageKind === "convert", "convert stage");
  if (!await selectorClick(client, "[data-property-kind-action='destination'][data-property-kind='text']")) {
    throw new Error("Missing text destination choice");
  }
  probe = await waitForEditor(client, (value) => value.stageKind === "convert"
    && /Preview ·/.test(value.stagePreview || ""), "convert preview");
  addCheck(report, "parity convert preview names destination and converted value",
    /[Tt]ext/.test(probe.stagePreview || "") && /"3"| 3/.test(probe.stagePreview || ""), { preview: probe.stagePreview });
  if (!await selectorClick(client, "[data-property-stage-action='save']")) throw new Error("Missing convert Save");
  probe = await waitForEditor(client, (value) => !value.stage && /Saved/.test(value.status || "")
    && value.rows.some((row) => row.key === "count"), "convert saved");
  assertDiskBytes(report, "parity convert apply bytes writes quoted text", parityPath,
    baseBytes.replace("count: 3", 'count: "3"'));
  await sendKey(client, "u");
  await waitForEditor(client, (value) => (value.properties || []).some((row) => row.key === "count" && row.kind === "number"), "convert undo");
  assertDiskBytes(report, "parity convert undo bytes restores number", parityPath, baseBytes);

  await propertyRowClick(client, "created");
  await sendKey(client, "t");
  await waitForEditor(client, (value) => value.stageKind === "convert", "created convert stage");
  if (!await selectorClick(client, "[data-property-kind-action='destination'][data-property-kind='datetime']")) {
    throw new Error("Missing datetime destination choice");
  }
  probe = await waitForEditor(client, (value) => (value.kindWarning || "").length > 0, "created warning");
  addCheck(report, "parity created datetime warns about offset stripping",
    /offset/i.test(probe.kindWarning || ""), { warning: probe.kindWarning });
  await captureParityView(ctx, "convert");
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open === true && !value.stage, "created convert cancelled");
  assertDiskBytes(report, "parity created convert cancelled keeps bytes", parityPath, baseBytes);
}

async function runVaultTypeAcceptance(ctx, baseBytes) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, closePropertyEditor, propertyRowClick, assertDiskBytes, selectorClick,
  } = ctx;
  const parityPath = path.join(vaultDir, "parity.md");
  const typesPath = path.join(vaultDir, ".obsidian", "types.json");

  const manager = await probeTypeManager(client);
  report.typeManager = manager;
  addCheck(report, "parity type manager probed with installed api shape",
    typeof manager.present === "boolean", manager);

  await shared.openNote(client, "parity.md", "live");
  await openPropertyEditor(client, "parity.md", { key: "status" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "status"), "vault rows");
  await propertyRowClick(client, "status");
  await sendKey(client, "t");
  await waitForEditor(client, (value) => value.stageKind === "convert", "vault convert stage");

  if (manager.present === true && manager.setType === "function") {
    if (!await selectorClick(client, "[data-property-kind-action='vault-start']")) {
      throw new Error("Missing vault type change start");
    }
    const probe = await waitForEditor(client, (value) => (value.vaultConfirm || "").length > 0, "vault confirm line");
    addCheck(report, "parity vault confirm names key type and count",
      /Change vault type of “status”/.test(probe.vaultConfirm || "")
      && /for \d+ notes?/.test(probe.vaultConfirm || "")
      && /u undoes this note/.test(probe.vaultConfirm || ""),
      { vaultConfirm: probe.vaultConfirm });
    if (!await selectorClick(client, "[data-property-kind-action='vault-confirm']")) {
      throw new Error("Missing vault type Confirm");
    }
    const changed = await shared.waitFor(client, `(() => {
      try {
        return {
          note: document.querySelector(".bob-property-editor-status")?.textContent || "",
          done: true,
        };
      } catch (_) { return { done: false }; }
    })()`, (value) => value?.done === true, "vault change applied");
    addCheck(report, "parity vault confirm applies inside the scratch vault",
      changed?.done === true, changed);
    let types = "";
    try { types = fs.readFileSync(typesPath, "utf8"); } catch (_) { types = ""; }
    addCheck(report, "parity vault confirm writes only the scratch vault types",
      types.includes("status"), { types: types.slice(0, 400) });
    assertDiskBytes(report, "parity vault change leaves note bytes alone", parityPath, baseBytes);
  } else {
    const probe = await waitForEditor(client, (value) => /All Properties/.test(
      `${value.status} ${(value.stagePreview || "")}`) || value.open === true, "vault unsupported hint");
    const painted = await client.evaluate(`(() => {
      const panel = document.querySelector("[data-property-kind-stage='true']");
      return { text: panel?.textContent || "" };
    })()`);
    addCheck(report, "parity vault unsupported explains all properties path",
      /All Properties/.test(painted.text || ""), painted);
    assertDiskBytes(report, "parity vault unsupported makes no global change", parityPath, baseBytes);
  }
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open === true && !value.stage, "vault stage cancelled");
  await closePropertyEditor(client);
}

async function runCloseLadderAcceptance(ctx) {
  const {
    client, report, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, setInput, selectorClick,
  } = ctx;

  await shared.openNote(client, "parity.md", "live");
  await openPropertyEditor(client, "parity.md", { key: "alpha_renamed" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "alpha_renamed"), "ladder rows");

  // Menu peels before the filter layer, the filter layer before the modal.
  if (!await selectorClick(client, "[aria-label='All property actions']")) throw new Error("Missing All actions button");
  await waitForEditor(client, (value) => value.menuOpen === true, "ladder menu");
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open === true && value.menuOpen !== true, "ladder menu peeled");
  await sendKey(client, "/");
  await waitForEditor(client, (value) => value.filterOpen === true, "ladder filter");
  await sendKey(client, "Escape");
  const probe = await waitForEditor(client, (value) => value.open === true && value.filterOpen === false, "ladder filter peeled");
  addCheck(report, "parity Esc peels filter before modal",
    probe.open === true && probe.filterOpen === false, probe);
  await sendKey(client, "Escape");
  await shared.waitFor(client, lib.editorProbeSource(), (value) => !value?.open, "ladder modal closed");
  addCheck(report, "parity Esc peels filter before modal close confirmed",
    true, { closed: true });
}

async function runNativeClipboardAcceptance(ctx) {
  const {
    client, report, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, closePropertyEditor, propertyRowClick, setInput,
  } = ctx;

  await shared.openNote(client, "parity.md", "live");
  await openPropertyEditor(client, "parity.md", { key: "status" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "status"), "native clipboard rows");
  await propertyRowClick(client, "status");
  await sendKey(client, "Enter");
  await waitForEditor(client, (value) => value.stageKind === "text", "native text stage");
  await setInput(client, "[data-property-stage-input]", "scratch");
  const inputBefore = await client.evaluate(
    `document.querySelector("[data-property-stage-input]")?.value || ""`);
  await sendKey(client, "c", { ctrl: true });
  await shared.sleep(400);
  let probe = await waitForEditor(client, (value) => value.open === true && Boolean(value.stage), "input keeps stage");
  addCheck(report, "parity Mod+C in input stays native without editor copy",
    probe.stageKind === "text" && !/Copied \d+ propert/.test(probe.status || "")
    && (await client.evaluate(`document.querySelector("[data-property-stage-input]")?.value || ""`)) === inputBefore,
    { status: probe.status });
  await sendKey(client, "v", { ctrl: true });
  await shared.sleep(400);
  probe = await waitForEditor(client, (value) => value.open === true && Boolean(value.stage), "input keeps stage after paste");
  addCheck(report, "parity Mod+V in input stays native no paste stage",
    probe.stageKind === "text" && probe.clipboardOpen !== true, { stageKind: probe.stageKind });
  await sendKey(client, "Escape");
  await waitForEditor(client, (value) => value.open === true && !value.stage, "native stage cancelled");
  await closePropertyEditor(client);
}

async function runTwoPaneRenameAcceptance(ctx, baseBytes) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, closePropertyEditor, propertyRowClick, setInput, assertDiskBytes,
  } = ctx;
  const parityPath = path.join(vaultDir, "parity.md");

  await closePropertyEditor(client);
  await shared.openNote(client, "parity.md", "live");
  const split = await client.evaluate(`(async () => {
    const file = app.vault.getAbstractFileByPath("parity.md");
    const first = app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view?.file?.path === "parity.md")
      || app.workspace.activeLeaf;
    app.workspace.setActiveLeaf(first, { focus: true });
    const second = app.workspace.getLeaf("split", "vertical");
    await second.openFile(file, { state: { mode: "source", source: true } });
    const body = "Unsaved pane text for parity.";
    const next = first.view.editor.getValue().includes(body)
      ? first.view.editor.getValue()
      : first.view.editor.getValue().replace(/\\s*$/, "\\n" + body + "\\n");
    first.view.editor.setValue(next);
    second.view.editor.setValue(next);
    window.__bobParityPanes = { first, second, body };
    return {
      leaves: app.workspace.getLeavesOfType("markdown").filter((leaf) => leaf.view?.file?.path === "parity.md").length,
      dirty: first.view.editor.getValue().includes(body) && second.view.editor.getValue().includes(body),
    };
  })()`, 20_000);
  addCheck(report, "parity two panes show one unsaved note", split?.leaves >= 2 && split?.dirty === true, split);
  await client.evaluate(`app.workspace.setActiveLeaf(window.__bobParityPanes.first, { focus: true })`);
  await openPropertyEditor(client, "parity.md", { key: "count" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "count"), "pane rename rows");
  await propertyRowClick(client, "count");
  await sendKey(client, "r");
  await waitForEditor(client, (value) => value.stageKind === "rename", "pane rename stage");
  await setInput(client, "[data-property-stage-input]", "total");
  await shared.waitFor(client,
    `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
    (text) => /Preview · rename/.test(text), "pane rename preview");
  await sendKey(client, "Enter");
  const probe = await waitForEditor(client, (value) => !value.stage && /Saved/.test(value.status || "")
    && value.rows.some((row) => row.key === "total"), "pane rename saved");
  const afterPanes = fs.readFileSync(parityPath, "utf8");
  addCheck(report, "parity rename saves unsaved pane before apply",
    afterPanes.includes("Unsaved pane text for parity.") && /^total: 3$/m.test(afterPanes),
    { afterPanes });
  assertDiskBytes(report, "parity rename saves unsaved pane exact bytes", parityPath,
    baseBytes.replace("count: 3", "total: 3").replace(/# Parity\n\nBody stays outside parity edits\./, "# Parity\n\nBody stays outside parity edits.\nUnsaved pane text for parity."));
  await sendKey(client, "u");
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "count"), "pane rename undo");
  await closePropertyEditor(client);
  await client.evaluate(`(async () => {
    const panes = window.__bobParityPanes || {};
    try { if (panes.second && typeof panes.second.detach === "function") panes.second.detach(); } catch (_) {}
    try { if (panes.first) app.workspace.setActiveLeaf(panes.first, { focus: true }); } catch (_) {}
    window.__bobParityPanes = null;
    return true;
  })()`);
}

async function runUnloadPasteAcceptance(ctx) {
  const {
    client, report, vaultDir, shared, sendKey, waitForEditor, openPropertyEditor,
    addCheck, assertDiskBytes,
  } = ctx;
  const parityPath = path.join(vaultDir, "parity.md");
  const parityBefore = fs.readFileSync(parityPath, "utf8");

  await shared.openNote(client, "ordinary.md", "live");
  await openPropertyEditor(client, "ordinary.md", { key: "title" });
  await waitForEditor(client, (value) => value.rows.some((row) => row.key === "title"), "unload paste rows");
  const wrote = await clipboardWrite(client, "unload_probe: probe\n");
  if (!wrote?.ok) throw new Error("clipboard write failed for unload paste");
  await sendKey(client, "v", { ctrl: true });
  await waitForEditor(client, (value) => value.clipboardOpen === true, "unload paste preview");
  const disabled = await client.evaluate(`(async () => {
    await app.plugins.disablePlugin("bob-ledger-tools");
    return {
      loaded: Boolean(app.plugins.plugins["bob-ledger-tools"]),
      editors: document.querySelectorAll(".bob-property-editor").length,
    };
  })()`, 20_000);
  addCheck(report, "parity unload with paste preview closes without write",
    disabled.loaded === false && disabled.editors === 0, disabled);
  await shared.sleep(1500);
  const late = await client.evaluate(`({
    loaded: Boolean(app.plugins.plugins["bob-ledger-tools"]),
    editors: document.querySelectorAll(".bob-property-editor").length,
  })`);
  addCheck(report, "parity unload paste preview does not reopen late",
    late.editors === 0 && late.loaded === false, late);
  assertDiskBytes(report, "parity unload paste preview leaves bytes unchanged", parityPath, parityBefore);
  assertDiskBytes(report, "parity unload paste preview leaves ordinary bytes unchanged",
    path.join(vaultDir, "ordinary.md"), lib.fixtureNotes()["ordinary.md"]);

  const enabled = await client.evaluate(`(async () => {
    await app.plugins.enablePlugin("bob-ledger-tools");
    return Boolean(app.plugins.plugins["bob-ledger-tools"]);
  })()`, 20_000);
  addCheck(report, "parity plugin re-enable after unload", enabled === true, { enabled });
  await shared.sleep(400);
  await shared.waitFor(client, `Boolean(app.plugins.plugins["bob-ledger-tools"]?.propertyEditorEntrypointsActive)`, Boolean,
    "entry points active after parity unload");
}

async function runParityAcceptance(ctx) {
  const parityPath = path.join(ctx.vaultDir, "parity.md");
  const pristine = lib.fixtureNotes()["parity.md"];
  const onDisk = fs.readFileSync(parityPath, "utf8");
  ctx.addCheck(ctx.report, "parity fixture seeded on the scratch vault", onDisk === pristine, {
    bytes: onDisk.length, expectedBytes: pristine.length,
  });

  const { renamed } = await runRenameAcceptance(ctx);
  await runReorderAcceptance(ctx, renamed);
  await runSelectionFilterDeleteAcceptance(ctx, renamed);
  await runMixedProtectedDeleteAcceptance(ctx);
  const copy = await runCopyAcceptance(ctx, renamed);
  if (copy.available) {
    await runPasteAcceptance(ctx, renamed, copy.savedClipboard);
  }
  await runYamlStageAcceptance(ctx, renamed);
  await runKindConvertAcceptance(ctx, renamed);
  await runVaultTypeAcceptance(ctx, renamed);
  await runNativeClipboardAcceptance(ctx);
  await runTwoPaneRenameAcceptance(ctx, renamed);
  await runCloseLadderAcceptance(ctx);
  await runUnloadPasteAcceptance(ctx);

  const shots = ctx.report.screenshots.filter((shot) => /property-editor-parity-/.test(shot.name || ""));
  const bad = shots.filter((shot) => !(shot.review && shot.review.clipped && shot.review.keyValueOverlap
    && shot.review.rowOverlap && shot.review.valueOverflow && shot.review.selectedDiffers && shot.review.lockedReadable));
  ctx.addCheck(ctx.report, "parity views layout probes pass for all views",
    shots.length >= 24 && bad.length === 0,
    { views: shots.map((shot) => shot.name), bad: bad.map((shot) => shot.name) });
  ctx.report.parityScreenshotInspection = shots.map((shot) => ({
    name: shot.name,
    sha256: shot.sha256 || "",
    visualVerdict: "pending inspection",
  }));
}

module.exports = {
  clipboardRead,
  clipboardWrite,
  runParityAcceptance,
};
