"use strict";
// Real-Obsidian window-prefix tabs group: in-place jumps through
// `runWindowPrefixPaletteKey("N")` against every tab decision-contract vector.
// The main harness requires this module for vectors, extra fixtures, and the
// runner, and passes CDP helpers so this file does not require the harness.

const actionsMod = require("./obsidian-window-prefix-e2e-actions.cjs");

const TAB_DECISION_VECTORS = Object.freeze([
  Object.freeze({
    name: "across-selected",
    from: "[ A  B* ] | [ C'  D ]",
    key: "3",
    to: "[ A  B' ] | [ C*  D ]",
  }),
  Object.freeze({
    name: "across-unselected",
    from: "[ A  B* ] | [ C'  D ]",
    key: "4",
    to: "[ A  B' ] | [ C  D* ]",
  }),
  Object.freeze({
    name: "same-split",
    from: "[ A  B* ] | [ C' ]",
    key: "1",
    to: "[ A*  B ] | [ C' ]",
  }),
  Object.freeze({
    name: "pinned-are-tabs",
    from: "[ P!  B* ] | [ C' ]",
    key: "1",
    to: "[ P!*  B ] | [ C' ]",
  }),
  Object.freeze({
    name: "already-here",
    from: "[ A  B* ] | [ C' ]",
    key: "2",
    to: "[ A  B* ] | [ C' ]",
  }),
  Object.freeze({
    name: "no-such-tab",
    from: "[ A  B* ] | [ C' ]",
    key: "7",
    to: "[ A  B* ] | [ C' ]",
    expectOk: false,
  }),
]);

const TAB_EXTRA_NOTES = Object.freeze([
  "WP-G", "WP-H", "WP-I", "WP-J", "WP-K", "WP-L", "WP-M", "WP-LONG",
]);

const HEADER_VISIBLE_PROBE = [
  '((title) => { try {',
  'const w = window.app.workspace;',
  'let leaf = null;',
  'w.iterateRootLeaves((l) => {',
  '  try {',
  '    const t = (l.getDisplayText && l.getDisplayText()) || (l.view && l.view.file && l.view.file.path || "").replace(/\\.md$/, "");',
  '    if (t === title) leaf = l;',
  '  } catch (_) {}',
  '});',
  'if (!leaf) return { ok: false, error: "leaf missing" };',
  'const el = leaf.tabHeaderEl;',
  'if (!el || typeof el.getBoundingClientRect !== "function") return { ok: true, header: false, fullyVisible: null };',
  'const rect = el.getBoundingClientRect();',
  'const parent = el.closest(".workspace-tab-header-container-inner") || el.closest(".workspace-tab-header-container") || el.parentElement;',
  'const prect = parent && parent.getBoundingClientRect ? parent.getBoundingClientRect() : null;',
  'const fullyVisible = !prect ? null : rect.left >= prect.left - 0.5 && rect.right <= prect.right + 0.5 && rect.width > 2;',
  'return { ok: true, header: true, fullyVisible, rect: { left: rect.left, right: rect.right, width: rect.width }, parent: prect && { left: prect.left, right: prect.right, width: prect.width } };',
  '} catch (e) { return { ok: false, error: String(e && e.message || e) }; } })',
].join("");

const SCROLL_STATE_PROBE = [
  '(() => { try {',
  'const leaf = window.app.workspace.activeLeaf;',
  'const e = leaf && leaf.view && leaf.view.editor;',
  'let scrollTop = null, method = "none";',
  'try { if (e && e.cm && e.cm.scrollDOM) { scrollTop = e.cm.scrollDOM.scrollTop; method = "scrollDOM"; } } catch (_) {}',
  'let ephemeral = null;',
  'try { if (leaf && typeof leaf.getEphemeralState === "function") ephemeral = leaf.getEphemeralState(); } catch (_) {}',
  'return { ok: true, scrollTop, method, ephemeral, viewType: leaf && leaf.view && leaf.view.getViewType && leaf.view.getViewType() };',
  '} catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()',
].join("");

const SOURCE_SELECTION_PROBE = [
  '(() => { try {',
  'const w = window.app.workspace; const groups = []; const seen = new Set();',
  'w.iterateRootLeaves((l) => { const p = l.parent; if (p && !seen.has(p)) { seen.add(p); groups.push(p); } });',
  'groups.sort((a, b) => {',
  '  let al = 0, bl = 0;',
  '  try { al = a.containerEl.getBoundingClientRect().left; } catch (_) {}',
  '  try { bl = b.containerEl.getBoundingClientRect().left; } catch (_) {}',
  '  return al - bl;',
  '});',
  'return groups.map((g) => {',
  '  const kids = Array.isArray(g.children) ? g.children : [];',
  '  let currentTab = null; try { currentTab = g.currentTab; } catch (_) {}',
  '  const titles = kids.map((l) => { try { return l.getDisplayText(); } catch (_) { return "?"; } });',
  '  const selectedTitle = typeof currentTab === "number" && kids[currentTab] ? titles[currentTab] : null;',
  '  const active = kids.includes(w.activeLeaf);',
  '  return { titles, currentTab, selectedTitle, active };',
  '});',
  '} catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()',
].join("");

function translateTabVector(vector) {
  const translated = actionsMod.translateDecisionVector({ from: vector.from, to: vector.to });
  return { ...vector, from: translated.from, to: translated.to, mapping: translated.mapping };
}

async function runTabsGroup(harness, args, record, findings) {
  const {
    launchOwned, connectOwned, shutdownOwned, buildFromSignature,
    actionsPaletteKey, runActionsCase, runCase,
    readLive, keys, sleep, dumpEditor, placeCursor, reloadAndReconnect,
    keymapFinger, sameKeymap, wplib, RPC_TIMEOUT_MS, waitForVim,
  } = harness;

  async function settleVim(clientInner) {
    await keys(clientInner, ["Escape"]);
    await waitForVim(clientInner, 8000).catch(() => null);
  }

  async function applyTranslatedState(clientInner, translatedFrom) {
    const parsed = wplib.parseLayoutSignature(translatedFrom);
    const result = await clientInner.evaluate(
      '((groups) => { try { const w = window.app.workspace; const byTitle = new Map();'
      + ' w.iterateRootLeaves((l) => { try { const p = l.view && l.view.file && l.view.file.path;'
      + ' if (p) { const title = p.replace(/\\.md$/, ""); if (!byTitle.has(title)) byTitle.set(title, []); byTitle.get(title).push(l); } } catch (_) {} });'
      + ' for (const group of groups) { for (const tab of group.tabs) {'
      + ' const leaves = byTitle.get(tab.title) || []; const leaf = leaves[0]; if (!leaf) return { ok: false, missing: tab.title };'
      + ' try { if (tab.pinned && !leaf.pinned && typeof leaf.togglePinned === "function") leaf.togglePinned();'
      + ' if (!tab.pinned && leaf.pinned && typeof leaf.togglePinned === "function") leaf.togglePinned(); } catch (e) { return { ok: false, pinError: String(e && e.message || e) }; } } }'
      + ' for (const group of groups) { const want = group.tabs.find((t) => t.mark === "\u0027") || group.tabs.find((t) => t.mark === "*");'
      + ' if (!want) continue; const leaves = byTitle.get(want.title) || []; const leaf = leaves[0]; if (!leaf) continue;'
      + ' try { const parent = leaf.parent; if (parent && typeof parent.selectTab === "function" && parent.children.includes(leaf)) parent.selectTab(leaf); } catch (_) {} }'
      + ' const active = groups.flatMap((g) => g.tabs).find((t) => t.mark === "*");'
      + ' if (active) { const leaves = byTitle.get(active.title) || []; const leaf = leaves[0];'
      + ' if (leaf) { try { w.setActiveLeaf(leaf, { focus: true }); } catch (_) {} } }'
      + ' return { ok: true }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })('
      + JSON.stringify(parsed.groups.map((group) => ({ tabs: group.tabs }))) + ')',
      RPC_TIMEOUT_MS,
    );
    if (!result || !result.ok) throw new Error("apply pins/selection failed: " + JSON.stringify(result));
    await sleep(400);
  }

  const launch = await launchOwned(wplib.macHotkeys(), args.executable);
  let client = null;
  try {
    client = await connectOwned(launch);
    findings.tabs = { vectors: {}, scroll: {}, clip: {}, deferred: {} };
    findings.appVersion = findings.appVersion || await client.evaluate("window.app.version||null").catch(() => null);

    await runActionsCase(record, client, "tabs/mixin-loaded", async () => {
      const ready = await client.evaluate(
        '(()=>{const p=window.app.plugins.plugins["bob-navigation-hotkeys"];return{has:!!p,run:typeof (p&&p.runWindowPrefixPaletteKey),focus:typeof (p&&p.executeWindowPrefixFocusTab)};})()',
        RPC_TIMEOUT_MS,
      );
      if (!ready || ready.run !== "function" || ready.focus !== "function") {
        throw new Error("tab jump executor missing: " + JSON.stringify(ready));
      }
      return "executeWindowPrefixFocusTab present";
    });

    async function seedExtraNotes() {
      const longBody = ["# WP-LONG", ""].concat(
        Array.from({ length: 160 }, (_, i) => "line " + String(i + 1) + " of the long jump target"),
      ).join("\n");
      const payload = {
        notes: TAB_EXTRA_NOTES.filter((name) => name !== "WP-LONG").map((name) => ({
          path: name + ".md",
          body: "# " + name + "\n\nextra tab fixture " + name + "\n",
        })),
      };
      payload.notes.push({ path: "WP-LONG.md", body: longBody });
      const result = await client.evaluate(
        '((notes) => (async () => { const v = window.app.vault; const out = [];'
        + ' for (const note of notes) {'
        + '   try { if (v.getAbstractFileByPath(note.path)) { out.push({ path: note.path, existed: true }); continue; }'
        + '     await v.create(note.path, note.body); out.push({ path: note.path, created: true });'
        + '   } catch (e) { out.push({ path: note.path, error: String(e && e.message || e) }); }'
        + ' } return { ok: out.every((row) => !row.error), out }; })())(' + JSON.stringify(payload.notes) + ')',
        RPC_TIMEOUT_MS,
      );
      if (!result || !result.ok) throw new Error("seed extra notes failed: " + JSON.stringify(result));
      return result;
    }

    await runActionsCase(record, client, "tabs/seed-extra-notes", async () => {
      const seeded = await seedExtraNotes();
      return "seeded " + seeded.out.length + " extra notes";
    });

    for (const vector of TAB_DECISION_VECTORS) {
      const translated = translateTabVector(vector);
      await runActionsCase(record, client, "tabs/vector-" + vector.name, async () => {
        await buildFromSignature(client, translated.from);
        await applyTranslatedState(client, translated.from);
        await settleVim(client);
        const before = await readLive(client);
        if (wplib.normalizeSignature(before.signature) !== wplib.normalizeSignature(translated.from)) {
          throw new Error("from fixture did not land: want " + translated.from + " got " + before.signature);
        }
        const jumped = await actionsPaletteKey(client, vector.key);
        await sleep(600);
        const after = await readLive(client);
        if (wplib.normalizeSignature(after.signature) !== wplib.normalizeSignature(translated.to)) {
          throw new Error(vector.name + " via " + vector.key + " failed: want " + translated.to + " got " + after.signature + " jump=" + JSON.stringify(jumped));
        }
        if (vector.expectOk === false && jumped === true) {
          throw new Error(vector.name + " should not report success");
        }
        findings.tabs.vectors[vector.name] = after.signature;
        return vector.name + " via " + vector.key + ": " + after.signature;
      });
    }

    await runActionsCase(record, client, "tabs/source-selection-unchanged", async () => {
      await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
      await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
      await settleVim(client);
      await actionsPaletteKey(client, "4");
      await sleep(600);
      const after = await readLive(client);
      if (wplib.normalizeSignature(after.signature) !== "[ WP-A  WP-B' ] | [ WP-C  WP-D* ]") {
        throw new Error("cross-split jump 4 failed: " + after.signature);
      }
      const probe = await client.evaluate(SOURCE_SELECTION_PROBE, RPC_TIMEOUT_MS);
      if (!Array.isArray(probe) || probe.length < 2) throw new Error("source selection probe failed: " + JSON.stringify(probe));
      if (probe[0].selectedTitle !== "WP-B" && !String(after.signature).includes("WP-B'")) {
        throw new Error("source split selection moved: " + JSON.stringify(probe));
      }
      findings.tabs.sourceSelection = probe;
      return after.signature;
    });

    await runActionsCase(record, client, "tabs/undo-round-trip", async () => {
      await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
      await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
      await keys(client, ["Escape"]);
      await waitForVim(client, 8000);
      await actionsPaletteKey(client, "3");
      await sleep(500);
      await waitForVim(client, 8000).catch(() => null);
      const expectedBody = wplib.seedNotes().get("WP-C.md");
      const sane = await dumpEditor(client);
      if (sane.text !== expectedBody) throw new Error("target body drifted: " + sane.text.slice(0, 80));
      await placeCursor(client, 2, 0);
      await keys(client, ["i"]);
      await client.call("Input.insertText", { text: "JUMP " });
      await keys(client, ["Escape"]);
      const typed = await dumpEditor(client);
      if (!typed.text.includes("JUMP spike join target charlie")) throw new Error("typing did not land");
      await actionsPaletteKey(client, "2");
      await sleep(500);
      await actionsPaletteKey(client, "3");
      await sleep(500);
      await waitForVim(client, 8000).catch(() => null);
      await keys(client, ["u"]);
      await sleep(300);
      const undone = await dumpEditor(client);
      if (undone.text !== expectedBody) throw new Error("u did not restore: " + undone.text.slice(0, 120));
      return "type → jump away → jump back → u restores";
    });

    await runActionsCase(record, client, "tabs/scroll-survives", async () => {
      await seedExtraNotes();
      await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-LONG' ]");
      await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-LONG' ]");
      await settleVim(client);
      await actionsPaletteKey(client, "3");
      await sleep(500);
      await waitForVim(client, 8000).catch(() => null);
      await placeCursor(client, 120, 0);
      await client.evaluate(
        '(()=>{try{const e=window.app.workspace.activeLeaf.view.editor;if(e&&e.scrollIntoView)e.scrollIntoView({from:{line:120,ch:0},to:{line:120,ch:0}},true);else if(e&&e.cm&&e.cm.scrollDOM)e.cm.scrollDOM.scrollTop=2400;return true;}catch(e){return String(e&&e.message||e);}})()',
        RPC_TIMEOUT_MS,
      );
      await sleep(200);
      const before = await client.evaluate(SCROLL_STATE_PROBE, RPC_TIMEOUT_MS);
      await actionsPaletteKey(client, "2");
      await sleep(400);
      await actionsPaletteKey(client, "3");
      await sleep(600);
      const after = await client.evaluate(SCROLL_STATE_PROBE, RPC_TIMEOUT_MS);
      findings.tabs.scroll = { before, after };
      const lostDom = Number(before && before.scrollTop) > 50 && Number(after && after.scrollTop) < 20;
      const ephBefore = before && before.ephemeral && (before.ephemeral.scroll || before.ephemeral.cursor);
      const ephAfter = after && after.ephemeral && (after.ephemeral.scroll || after.ephemeral.cursor);
      findings.tabs.scroll.lostDomScroll = lostDom === true;
      findings.tabs.scroll.ephemeralPreserved = Boolean(ephBefore) && JSON.stringify(ephBefore) === JSON.stringify(ephAfter);
      return "scrollTop " + String(before && before.scrollTop) + " → " + String(after && after.scrollTop)
        + " ephemeral " + (findings.tabs.scroll.ephemeralPreserved ? "preserved" : "changed");
    });

    await runActionsCase(record, client, "tabs/pdf-focus", async () => {
      await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
      await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
      await actionsPaletteKey(client, "3");
      await sleep(400);
      const opened = await client.evaluate(
        '((file) => (async () => { const f = window.app.vault.getAbstractFileByPath(file); if (!f) return { ok: false };'
        + ' const w = window.app.workspace; const leaf = w.getLeaf("tab"); await leaf.openFile(f);'
        + ' return { ok: true, viewType: leaf.view && leaf.view.getViewType() }; })())("tiny.pdf")',
        RPC_TIMEOUT_MS,
      );
      if (!opened || !opened.ok || opened.viewType !== "pdf") throw new Error("PDF leaf did not mount: " + JSON.stringify(opened));
      await sleep(400);
      await actionsPaletteKey(client, "2");
      await sleep(400);
      const jumped = await actionsPaletteKey(client, "4");
      await sleep(600);
      const after = await client.evaluate(
        '(()=>{const l=window.app.workspace.activeLeaf;const v=l&&l.view;return{viewType:v&&v.getViewType&&v.getViewType(),hasEditor:!!(v&&v.editor),path:v&&v.file&&v.file.path};})()',
        RPC_TIMEOUT_MS,
      );
      if (!after || after.viewType !== "pdf") throw new Error("PDF was not focused: " + JSON.stringify({ jumped, after }));
      if (after.hasEditor) throw new Error("PDF focus forced an editor: " + JSON.stringify(after));
      findings.tabs.pdf = after;
      return "pdf focused without editor";
    });

    await runActionsCase(record, client, "tabs/stacked", async () => {
      await buildFromSignature(client, "[ WP-A  WP-B*  WP-C ]");
      await applyTranslatedState(client, "[ WP-A  WP-B*  WP-C ]");
      const stacked = await client.evaluate(
        '(()=>{try{const g=window.app.workspace.activeLeaf.parent;'
        + ' if (g && typeof g.setStacked === "function") { g.setStacked(true); return { ok: true, method: "setStacked", stacked: !!g.isStacked }; }'
        + ' if (g && g.containerEl && g.containerEl.classList) { g.containerEl.classList.add("mod-stacked"); return { ok: true, method: "class" }; }'
        + ' return { ok: false, error: "no stacked API" }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()',
        RPC_TIMEOUT_MS,
      );
      if (!stacked || !stacked.ok) throw new Error("could not stack tabs: " + JSON.stringify(stacked));
      await sleep(300);
      const jumped = await actionsPaletteKey(client, "1");
      await sleep(600);
      const after = await readLive(client);
      if (!String(after.signature).includes("WP-A*")) {
        throw new Error("stacked jump to 1 failed: " + after.signature + " " + JSON.stringify(jumped));
      }
      findings.tabs.stacked = { method: stacked.method, signature: after.signature };
      return after.signature + " via " + stacked.method;
    });

    await runActionsCase(record, client, "tabs/thirteen-clip", async () => {
      await seedExtraNotes();
      const thirteen = "[ WP-A  WP-B  WP-C  WP-D  WP-E  WP-F  WP-G  WP-H  WP-I*  WP-J  WP-K  WP-L  WP-M ]";
      await buildFromSignature(client, thirteen);
      await applyTranslatedState(client, thirteen);
      await client.evaluate(
        '(()=>{try{const g=window.app.workspace.activeLeaf.parent;const el=g&&g.containerEl;if(el){el.style.width="280px";if(el.parentElement)el.parentElement.style.width="280px";}return true;}catch(e){return String(e&&e.message||e);}})()',
        RPC_TIMEOUT_MS,
      );
      await sleep(200);
      await actionsPaletteKey(client, "9");
      await sleep(600);
      const after = await readLive(client);
      if (!String(after.signature).includes("WP-I*")) {
        throw new Error("jump to tab 9 failed: " + after.signature);
      }
      const vis = await client.evaluate(HEADER_VISIBLE_PROBE + '("WP-I")', RPC_TIMEOUT_MS);
      findings.tabs.clip = vis;
      return "tab 9 focused; header fullyVisible=" + String(vis && vis.fullyVisible);
    });

    {
      const reloadBefore = await keymapFinger(client);
      await runCase(record, "tabs/deferred-reload", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
        await client.evaluate('(()=>{if(window.app.workspace.requestSaveLayout)window.app.workspace.requestSaveLayout();return true;})()', RPC_TIMEOUT_MS);
        await sleep(800);
        const holder = { port: launch.port, fixturePath: launch.fixturePath, shouldStop: launch.exitedFlag };
        const reconnected = await reloadAndReconnect(holder.port, holder.fixturePath, holder.shouldStop, client);
        client = reconnected;
        const jumped = await actionsPaletteKey(client, "4");
        await sleep(800);
        const after = await readLive(client);
        if (wplib.normalizeSignature(after.signature) !== "[ WP-A  WP-B' ] | [ WP-C  WP-D* ]") {
          throw new Error("deferred jump to tab 4 failed: " + after.signature + " jump=" + JSON.stringify(jumped));
        }
        const fileShown = await client.evaluate(
          '(()=>{try{const l=window.app.workspace.activeLeaf;const v=l&&l.view;return{path:v&&v.file&&v.file.path,viewType:v&&v.getViewType&&v.getViewType(),hasEditor:!!(v&&v.editor)};}catch(e){return{error:String(e&&e.message||e)};}})()',
          RPC_TIMEOUT_MS,
        );
        if (!fileShown || fileShown.path !== "WP-D.md") {
          throw new Error("deferred tab did not show its file: " + JSON.stringify(fileShown));
        }
        findings.tabs.deferred = { signature: after.signature, file: fileShown };
        return after.signature + " file=" + fileShown.path;
      });
      const reloadAfter = await keymapFinger(client).catch(() => null);
      if (!sameKeymap(reloadBefore, reloadAfter)) {
        record("tabs/deferred-reload/scope-stack", "fail", "keymap scope stack changed: " + JSON.stringify({ before: reloadBefore, after: reloadAfter }));
      }
    }
  } finally {
    await shutdownOwned(launch, client);
  }
}

module.exports = {
  TAB_DECISION_VECTORS,
  TAB_EXTRA_NOTES,
  HEADER_VISIBLE_PROBE,
  SCROLL_STATE_PROBE,
  SOURCE_SELECTION_PROBE,
  translateTabVector,
  runTabsGroup,
};
