"use strict";
// Real-Obsidian window-prefix tabs group: in-place jumps through
// `runWindowPrefixPaletteKey("N")` against every tab decision-contract vector,
// plus Ctrl+W digit cases (armed catalog, held-Ctrl, numpad, blocked, DOM
// parity, lit/flash, Linux hide+close). The main harness requires this module
// for vectors, extra fixtures, and the runner, and passes CDP helpers so this
// file does not require the harness.

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

const NUMERALS_PROBE = [
  '(()=>{try{',
  'const body=document.body;',
  'const bodyNumbers=!!(body&&body.classList&&body.classList.contains("bob-tab-numbers"));',
  'const bodyLit=!!(body&&body.classList&&body.classList.contains("bob-tab-numbers-lit"));',
  'const w=window.app.workspace,seen=new Map(),order=[];',
  'w.iterateRootLeaves((leaf)=>{const p=leaf.parent;if(!p)return;',
  'if(!seen.has(p)){seen.set(p,[]);order.push(p);}seen.get(p).push(leaf);});',
  'const indexed=order.map((parent)=>{let left=0;',
  'try{left=parent.containerEl.getBoundingClientRect().left;}catch(_){}',
  'const tabs=seen.get(parent).map((leaf)=>{',
  'let title="?";try{title=leaf.getDisplayText();}catch(_){}',
  'const header=leaf.tabHeaderEl;',
  'const inner=header&&header.querySelector?header.querySelector(".workspace-tab-header-inner"):header;',
  'const number=inner&&inner.getAttribute?inner.getAttribute("data-bob-tab"):null;',
  'const flash=!!(inner&&inner.classList&&inner.classList.contains("bob-tab-number-flash"));',
  'return{title:title||"?",number,flash,leafId:leaf&&leaf.id||null};',
  '});',
  'return{left,tabs};});',
  'indexed.sort((a,b)=>a.left-b.left);',
  'const stamped=indexed.flatMap((g)=>g.tabs);',
  'const catalog=[];',
  'let n=1;for(const tab of stamped){catalog.push({title:tab.title,expect:n<=9?String(n):null});n+=1;}',
  'let mismatch=null;',
  'for(let i=0;i<stamped.length;i+=1){',
  'const got=stamped[i].number==null?null:String(stamped[i].number);',
  'const want=catalog[i].expect;',
  'if(got!==want){mismatch={index:i,title:stamped[i].title,got,want};break;}}',
  'return{ok:true,bodyNumbers,bodyLit,stamped,catalog,mismatch,',
  'flashes:stamped.filter((t)=>t.flash).map((t)=>t.title)};',
  '}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
].join("");

function assertNumeralParity(probe, label) {
  if (!probe || probe.ok !== true) throw new Error(label + " numerals probe failed: " + JSON.stringify(probe));
  if (probe.mismatch) throw new Error(label + " data-bob-tab parity: " + JSON.stringify(probe.mismatch));
  return probe;
}

function translateTabVector(vector) {
  const translated = actionsMod.translateDecisionVector({ from: vector.from, to: vector.to });
  return { ...vector, from: translated.from, to: translated.to, mapping: translated.mapping };
}

async function runTabsGroup(harness, args, record, findings) {
  const {
    launchOwned, connectOwned, shutdownOwned, buildFromSignature,
    actionsPaletteKey, runActionsCase, runCase,
    readLive, keys, key, sleep, dumpEditor, placeCursor, reloadAndReconnect,
    keymapFinger, sameKeymap, wplib, RPC_TIMEOUT_MS, waitForVim,
    armPrefix, waitPrefixIdle, prefixDebug, letterKey, screenshot,
    outDir, screenshots, waitPrefix, ctrlW,
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

    async function waitFlash(clientInner, title, label) {
      const deadline = Date.now() + 1500;
      let last = null;
      while (Date.now() < deadline) {
        last = await clientInner.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS);
        if (last && last.ok && Array.isArray(last.flashes) && last.flashes.includes(title)) return last;
        await sleep(30);
      }
      throw new Error((label || "flash") + " never appeared on " + title + ": " + JSON.stringify(last));
    }

    async function runPrefixDigitCases() {
      findings.tabs.prefix = findings.tabs.prefix || {};

      await runActionsCase(record, client, "tabs/prefix-digit-4", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
        await settleVim(client);
        await armPrefix(client);
        await key(client, { key: "4", code: "Digit4" });
        await waitPrefixIdle(client);
        const after = await readLive(client);
        if (wplib.normalizeSignature(after.signature) !== "[ WP-A  WP-B' ] | [ WP-C  WP-D* ]") {
          throw new Error("Ctrl+W 4 failed: " + after.signature);
        }
        findings.tabs.prefix.digit4 = after.signature;
        return after.signature;
      });

      await runActionsCase(record, client, "tabs/prefix-ctrl-3-global", async () => {
        const layout = "[ WP-A  WP-B ] | [ WP-C  WP-D  WP-E* ]";
        await buildFromSignature(client, layout);
        await applyTranslatedState(client, layout);
        await settleVim(client);
        const before = await readLive(client);
        if (!String(before.signature).includes("WP-E*")) {
          throw new Error("ctrl-3 fixture did not land: " + before.signature);
        }
        await armPrefix(client);
        await key(client, { key: "3", code: "Digit3", modifiers: 2, text: "" });
        await waitPrefixIdle(client);
        const after = await readLive(client);
        if (!String(after.signature).includes("WP-C*")) {
          throw new Error("Ctrl+W Ctrl+3 did not land on global tab 3 (WP-C): " + after.signature);
        }
        if (String(after.signature).includes("WP-E*")) {
          throw new Error("Ctrl+W Ctrl+3 ran group-local native Ctrl+3: " + after.signature);
        }
        findings.tabs.prefix.ctrl3 = after.signature;
        return after.signature;
      });

      await runActionsCase(record, client, "tabs/prefix-numpad-2", async () => {
        await buildFromSignature(client, "[ WP-A*  WP-B ] | [ WP-C' ]");
        await applyTranslatedState(client, "[ WP-A*  WP-B ] | [ WP-C' ]");
        await settleVim(client);
        await armPrefix(client);
        await key(client, { key: "2", code: "Numpad2" });
        await waitPrefixIdle(client);
        const after = await readLive(client);
        if (!String(after.signature).includes("WP-B*")) {
          throw new Error("Ctrl+W Numpad 2 failed: " + after.signature);
        }
        findings.tabs.prefix.numpad2 = after.signature;
        return after.signature;
      });

      await runActionsCase(record, client, "tabs/prefix-blocked-7", async () => {
        const layout = "[ WP-A  WP-B*  WP-C ] | [ WP-D  WP-E  WP-F ]";
        await buildFromSignature(client, layout);
        await applyTranslatedState(client, layout);
        await settleVim(client);
        const before = await readLive(client);
        const textBefore = (await dumpEditor(client)).text;
        await armPrefix(client);
        await key(client, { key: "7", code: "Digit7" });
        await sleep(200);
        const state = await prefixDebug(client);
        if (!state.armed) throw new Error("blocked 7 disarmed: " + JSON.stringify(state));
        if (!/No tab 7/i.test(String(state.message || ""))) {
          throw new Error("blocked 7 missing message: " + JSON.stringify(state));
        }
        await keys(client, ["Escape"]);
        await waitPrefixIdle(client);
        const after = await readLive(client);
        const textAfter = (await dumpEditor(client)).text;
        if (wplib.normalizeSignature(after.signature) !== wplib.normalizeSignature(before.signature)) {
          throw new Error("blocked 7+Esc changed layout: " + before.signature + " -> " + after.signature);
        }
        if (textAfter !== textBefore) throw new Error("blocked 7+Esc changed note text");
        findings.tabs.prefix.blocked7 = after.signature;
        return "stayed armed then Esc identical";
      });

      await runActionsCase(record, client, "tabs/prefix-zero", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await settleVim(client);
        const before = await readLive(client);
        await armPrefix(client);
        await key(client, { key: "0", code: "Digit0" });
        await sleep(150);
        const state = await prefixDebug(client);
        if (!state.armed) throw new Error("0 disarmed: " + JSON.stringify(state));
        const after = await readLive(client);
        if (after.signature !== before.signature) throw new Error("0 changed layout: " + after.signature);
        return state.message || "0 consumed";
      });

      await runActionsCase(record, client, "tabs/prefix-shift-3", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await settleVim(client);
        const before = await readLive(client);
        await armPrefix(client);
        await key(client, { key: "#", code: "Digit3", modifiers: 8, text: "#" });
        await sleep(150);
        const state = await prefixDebug(client);
        if (!state.armed) throw new Error("Shift+3 disarmed: " + JSON.stringify(state));
        const after = await readLive(client);
        if (after.signature !== before.signature) throw new Error("Shift+3 changed layout: " + after.signature);
        if (String(after.signature).includes("WP-C*")) {
          throw new Error("Shift+3 jumped to tab 3: " + after.signature);
        }
        return state.message || "Shift+3 consumed";
      });

      await runActionsCase(record, client, "tabs/prefix-already-here", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await settleVim(client);
        const before = await readLive(client);
        await armPrefix(client);
        await key(client, { key: "2", code: "Digit2" });
        await waitPrefixIdle(client);
        const after = await readLive(client);
        if (wplib.normalizeSignature(after.signature) !== wplib.normalizeSignature(before.signature)) {
          throw new Error("already-here digit changed layout: " + after.signature);
        }
        findings.tabs.prefix.alreadyHere = after.signature;
        return after.signature;
      });

      await runActionsCase(record, client, "tabs/prefix-dom-parity", async () => {
        await seedExtraNotes();
        const thirteen = "[ WP-A  WP-B  WP-C  WP-D  WP-E  WP-F  WP-G  WP-H  WP-I*  WP-J  WP-K  WP-L  WP-M ]";
        await buildFromSignature(client, thirteen);
        await applyTranslatedState(client, thirteen);
        await sleep(250);
        const probe = assertNumeralParity(
          await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS),
          "thirteen",
        );
        const numbered = probe.stamped.filter((tab) => tab.number != null);
        const unnumbered = probe.stamped.filter((tab) => tab.number == null);
        if (numbered.length !== 9) throw new Error("expected 9 numbered headers: " + JSON.stringify(probe.stamped));
        if (unnumbered.length < 4) throw new Error("tabs 10+ should carry no data-bob-tab: " + JSON.stringify(probe.stamped));
        findings.tabs.prefix.domParity = { numbered: numbered.length, unnumbered: unnumbered.length };
        return "9 numbered, " + unnumbered.length + " unnumbered";
      });

      await runActionsCase(record, client, "tabs/prefix-renumber-open", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C  WP-D ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C  WP-D ]");
        await sleep(200);
        const before = assertNumeralParity(
          await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS),
          "renumber-open before",
        );
        const cBefore = before.stamped.find((tab) => tab.title === "WP-C");
        if (!cBefore || cBefore.number !== "3") {
          throw new Error("WP-C should be 3 before open: " + JSON.stringify(before.stamped));
        }
        const opened = await client.evaluate(
          '(()=>(async()=>{const f=window.app.vault.getAbstractFileByPath("WP-E.md");if(!f)return{ok:false,error:"missing WP-E"};'
          + 'const w=window.app.workspace;const leaf=w.getLeaf("tab");await leaf.openFile(f);'
          + 'w.setActiveLeaf(leaf,{focus:true});'
          + 'await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));'
          + 'return{ok:true,path:leaf.view&&leaf.view.file&&leaf.view.file.path};})())()',
          RPC_TIMEOUT_MS,
        );
        if (!opened || !opened.ok) throw new Error("open tab in left split failed: " + JSON.stringify(opened));
        await sleep(250);
        const after = assertNumeralParity(
          await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS),
          "renumber-open after",
        );
        const cAfter = after.stamped.find((tab) => tab.title === "WP-C");
        if (!cAfter || cAfter.number !== "4") {
          throw new Error("opening a left-split tab did not renumber WP-C to 4: " + JSON.stringify(after.stamped));
        }
        findings.tabs.prefix.renumberOpen = after.stamped.map((tab) => tab.title + "=" + tab.number);
        return "WP-C 3 → 4";
      });

      await runActionsCase(record, client, "tabs/prefix-renumber-HL", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await settleVim(client);
        const before = assertNumeralParity(
          await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS),
          "renumber-HL before",
        );
        const cBefore = before.stamped.find((tab) => tab.title === "WP-C");
        if (!cBefore || cBefore.number !== "3") {
          throw new Error("WP-C should be 3 before L: " + JSON.stringify(before.stamped));
        }
        await armPrefix(client);
        await letterKey(client, "L");
        await waitPrefixIdle(client, 8000);
        await sleep(250);
        const after = assertNumeralParity(
          await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS),
          "renumber-HL after",
        );
        const cAfter = after.stamped.find((tab) => tab.title === "WP-C");
        const bAfter = after.stamped.find((tab) => tab.title === "WP-B");
        if (!cAfter || cAfter.number !== "2") {
          throw new Error("L did not renumber WP-C to 2: " + JSON.stringify(after.stamped));
        }
        if (!bAfter || bAfter.number !== "3") {
          throw new Error("L did not number moved WP-B as 3: " + JSON.stringify(after.stamped));
        }
        findings.tabs.prefix.renumberHL = after.stamped.map((tab) => tab.title + "=" + tab.number);
        return after.stamped.map((tab) => tab.title + "=" + tab.number).join(" ");
      });

      await runActionsCase(record, client, "tabs/prefix-sidebar", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await sleep(200);
        const before = await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS);
        if (!before || before.bodyNumbers !== true) {
          throw new Error("numerals missing before sidebar focus: " + JSON.stringify(before));
        }
        const focused = await client.evaluate(
          '(()=>{try{const w=window.app.workspace;const leaves=w.getLeavesOfType?w.getLeavesOfType("file-explorer"):[];'
          + 'const leaf=leaves&&leaves[0];if(!leaf)return{ok:false,error:"no file-explorer"};'
          + 'w.setActiveLeaf(leaf,{focus:true});'
          + 'return{ok:true,viewType:leaf.view&&leaf.view.getViewType&&leaf.view.getViewType()};}catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
          RPC_TIMEOUT_MS,
        );
        if (!focused || !focused.ok) throw new Error("sidebar focus failed: " + JSON.stringify(focused));
        await sleep(200);
        const after = await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS);
        if (!after || after.bodyNumbers !== true) {
          throw new Error("sidebar focus hid numerals: " + JSON.stringify(after));
        }
        findings.tabs.prefix.sidebar = after;
        return "sidebar focus keeps numerals";
      });

      await runActionsCase(record, client, "tabs/prefix-single-tab", async () => {
        await buildFromSignature(client, "[ WP-A* ]");
        await applyTranslatedState(client, "[ WP-A* ]");
        await sleep(250);
        const probe = await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS);
        if (!probe || probe.ok !== true) throw new Error("single-tab probe failed: " + JSON.stringify(probe));
        if (probe.bodyNumbers === true) throw new Error("single tab showed numerals: " + JSON.stringify(probe));
        if (probe.stamped.some((tab) => tab.number != null)) {
          throw new Error("single tab carried data-bob-tab: " + JSON.stringify(probe.stamped));
        }
        findings.tabs.prefix.singleTab = probe;
        return "single tab shows none";
      });

      await runActionsCase(record, client, "tabs/prefix-lit-card", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C' ]");
        await settleVim(client);
        if (outDir && typeof screenshot === "function") {
          screenshots.push(await screenshot(client, outDir, "tabs-idle"));
        }
        await armPrefix(client);
        await sleep(80);
        const early = await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS);
        const earlyDebug = await prefixDebug(client);
        if (earlyDebug.hostCarded) throw new Error("card appeared before 300ms: " + JSON.stringify(earlyDebug));
        if (early && early.bodyLit === true) throw new Error("lit arrived before the card: " + JSON.stringify(early));
        await sleep(300);
        const late = await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS);
        const lateDebug = await prefixDebug(client);
        if (!lateDebug.hostCarded) throw new Error("card missing at 300ms: " + JSON.stringify(lateDebug));
        if (!late || late.bodyLit !== true) throw new Error("lit missing with the card: " + JSON.stringify(late));
        if (outDir && typeof screenshot === "function") {
          screenshots.push(await screenshot(client, outDir, "tabs-lit"));
        }
        await keys(client, ["Escape"]);
        await waitPrefixIdle(client);
        const after = await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS);
        if (after && after.bodyLit === true) throw new Error("lit survived Esc: " + JSON.stringify(after));
        findings.tabs.prefix.lit = { early: early && early.bodyLit, late: late.bodyLit, afterEsc: after && after.bodyLit };
        return "lit with card, gone after Esc";
      });

      await runActionsCase(record, client, "tabs/prefix-flash", async () => {
        await buildFromSignature(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
        await applyTranslatedState(client, "[ WP-A  WP-B* ] | [ WP-C'  WP-D ]");
        await settleVim(client);
        await armPrefix(client);
        await key(client, { key: "4", code: "Digit4" });
        const flashing = await waitFlash(client, "WP-D", "tabs/prefix-flash");
        if (outDir && typeof screenshot === "function") {
          screenshots.push(await screenshot(client, outDir, "tabs-flash"));
        }
        await sleep(400);
        const gone = await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS);
        if (gone && Array.isArray(gone.flashes) && gone.flashes.length) {
          throw new Error("flash class lingered past 220ms: " + JSON.stringify(gone.flashes));
        }
        findings.tabs.prefix.flash = { during: flashing.flashes, after: gone && gone.flashes };
        return "flash on WP-D ~220ms";
      });
    }

    if (typeof armPrefix === "function" && typeof key === "function") {
      await runPrefixDigitCases();
    }

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

async function runTabsLinuxGroup(harness, args, record, findings, visual = null) {
  const {
    launchOwned, connectOwned, shutdownOwned, buildFromSignature,
    runCase, keys, ctrlW, sleep, leafCount, prefixDebug, keymapFinger, sameKeymap,
    wplib, RPC_TIMEOUT_MS, screenshot,
  } = harness;
  const launch = await launchOwned(wplib.linuxDefaultHotkeys(), args.executable);
  let client = null;
  try {
    client = await connectOwned(launch);
    findings.linuxAppVersion = findings.linuxAppVersion
      || await client.evaluate("window.app.version||null").catch(() => null);
    findings.tabs = findings.tabs || {};

    await runCase(record, "tabs/linux-numerals-hide", async () => {
      await buildFromSignature(client, "[ WP-A*  WP-B ] | [ WP-C ]");
      await keys(client, ["Escape"]);
      await sleep(300);
      const probe = await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS);
      if (!probe || probe.ok !== true) throw new Error("linux numerals probe failed: " + JSON.stringify(probe));
      if (probe.bodyNumbers === true || probe.bodyLit === true) {
        throw new Error("Linux Close-tab owner still showed numerals: " + JSON.stringify(probe));
      }
      if (probe.stamped.some((tab) => tab.number != null)) {
        throw new Error("Linux idle headers carried data-bob-tab: " + JSON.stringify(probe.stamped));
      }
      findings.tabs.linuxHide = probe;
      if (visual && visual.outDir && Array.isArray(visual.screenshots) && typeof screenshot === "function") {
        for (const dark of [false, true]) {
          const theme = dark ? "dark" : "light";
          await client.evaluate(
            '(()=>{document.body.classList.toggle("theme-dark",' + (dark ? "true" : "false")
            + ');document.body.classList.toggle("theme-light",' + (dark ? "false" : "true") + ');return true;})()',
          );
          await sleep(300);
          const themed = await client.evaluate(NUMERALS_PROBE, RPC_TIMEOUT_MS);
          if (!themed || themed.ok !== true || themed.bodyNumbers || themed.bodyLit
            || themed.stamped.some((tab) => tab.number != null)) {
            throw new Error(`Linux ${theme} theme unexpectedly showed numerals: ` + JSON.stringify(themed));
          }
          visual.screenshots.push(await screenshot(client, visual.outDir, `visual-tabs-linux-hidden-${theme}`));
        }
      }
      return "idle numerals hidden under Close tab";
    });

    await runCase(record, "tabs/linux-ctrl-w-closes", async () => {
      await buildFromSignature(client, "[ WP-A*  WP-B ]");
      await keys(client, ["Escape"]);
      const before = await keymapFinger(client);
      const leavesBefore = await leafCount(client);
      const debugBefore = await prefixDebug(client);
      if (debugBefore.state && debugBefore.state !== "idle") {
        throw new Error("prefix not idle before Linux Ctrl+W: " + JSON.stringify(debugBefore));
      }
      const ctx = { dead: false };
      try {
        await ctrlW(client, 200);
        await sleep(400);
      } catch (_error) {
        ctx.dead = true;
      }
      if (ctx.dead) {
        findings.tabs.linuxClose = { outcome: "window-closed-or-socket-dead", leavesBefore };
        return `socket died after Ctrl+W from ${leavesBefore} leaves (window closed)`;
      }
      const leavesAfter = await leafCount(client);
      const debugAfter = await prefixDebug(client);
      if (debugAfter.armed || (debugAfter.state && debugAfter.state !== "idle")) {
        throw new Error("prefix armed under Linux Close tab: " + JSON.stringify(debugAfter));
      }
      if (leavesAfter !== leavesBefore - 1) {
        throw new Error(`expected tab close ${leavesBefore}->${leavesBefore - 1}, got ${leavesAfter}`);
      }
      const after = await keymapFinger(client);
      if (!sameKeymap(before, after)) {
        throw new Error("scope stack changed on Linux close: " + JSON.stringify({ before, after }));
      }
      findings.tabs.linuxClose = { leavesBefore, leavesAfter, idle: true };
      return `closed ${leavesBefore}->${leavesAfter}, prefix idle`;
    });
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
  NUMERALS_PROBE,
  translateTabVector,
  runTabsGroup,
  runTabsLinuxGroup,
};
