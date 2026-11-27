// Ref Card acceptance flows beyond the passive takeover/data matrix: native
// restoration surfaces, capability and report states, the Reference editor,
// and the LP Vim keys. Every flow here runs after the passive hash check, so
// deliberate writes (editor saves, renames, scan rewrites) use disposable
// notes or are undone, and none of them can mask a paint-triggered write.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const editorLib = require("./obsidian-property-editor-e2e-lib.cjs");

const PLUGIN_ID = "bob-ledger-tools";
const PLUGIN = `app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]`;
const HELPERS = `${PLUGIN}.constructor.helpers`;
const BLOG = "ref/ref-finished-blog.md";
const PAPER = "ref/ref-arxiv-paper.md";
const NEXT = "ref/ref-next-chat.md";
const REFERENCE_SETTING_VALUES = Object.freeze({
  title: "Agentic coding strains CI",
  summary: "Acceptance summary for the Ref Card editor.",
  author: "Ada Lovelace",
  published: "2026-09-15",
  source: "https://example.com/acceptance-source",
  aliases: "Acceptance alias",
});

const KEY_TABLE = Object.freeze({
  Enter: ["Enter", 13, "\r"], Tab: ["Tab", 9], Escape: ["Escape", 27], ArrowUp: ["ArrowUp", 38],
  "[": ["BracketLeft", 219, "["], "=": ["Equal", 187, "="], "+": ["Equal", 187, "+"],
  "-": ["Minus", 189, "-"], _: ["Minus", 189, "_"],
});

async function sendKey(client, key, options = {}) {
  const entry = KEY_TABLE[key] || ["Key" + key.toUpperCase(), key.toUpperCase().charCodeAt(0), key.length === 1 ? key : undefined];
  const modifiers = (options.ctrl ? 2 : 0) | (options.alt ? 1 : 0) | (options.shift || key === "+" || key === "_" ? 8 : 0);
  const printable = entry[2] && !options.ctrl && !options.alt;
  const type = printable ? "keyDown" : "rawKeyDown";
  await client.call("Input.dispatchKeyEvent", {
    type, key, code: entry[0], windowsVirtualKeyCode: entry[1], nativeVirtualKeyCode: entry[1], modifiers,
    ...(printable ? { text: entry[2], unmodifiedText: entry[2] } : {}),
  });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp", key, code: entry[0], windowsVirtualKeyCode: entry[1], nativeVirtualKeyCode: entry[1], modifiers,
  });
}

async function setInput(client, selector, value) {
  const focused = await client.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    input.focus();
    return true;
  })()`);
  if (!focused) throw new Error("Missing input " + selector);
  await client.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await client.call("Input.insertText", { text: String(value) });
}

function yamlLine(source, key) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] || "";
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(key + ":"));
  if (index < 0) return null;
  const block = [lines[index]];
  for (let i = index + 1; i < lines.length && /^\s+-|^\s{2,}\S/.test(lines[i]); i += 1) block.push(lines[i]);
  return block.join("\n");
}

function firstH1(source) {
  return /^#\s+(.+?)\s*$/m.exec(source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""))?.[1] || "";
}

async function runFlows(ctx) {
  const { client, shared, check, probe, viewMode, notes, vaultReal, flagDir } = ctx;
  const ev = (expression, timeout) => client.evaluate(expression, timeout);
  const sleep = shared.sleep;
  const disk = (notePath) => fs.readFileSync(path.join(vaultReal, notePath), "utf8");
  const flag = (name, value) => {
    const file = path.join(flagDir, name);
    if (value === null || value === undefined || value === false) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, String(value));
  };
  const attempt = async (name, fn) => {
    try {
      const result = await fn();
      check(name, result?.ok === true, result);
    } catch (error) {
      check(name, false, { error: String(error?.stack || error) });
    }
  };
  const refresh = () => ev(`(() => { ${PLUGIN}.scheduleRefNoteCardRefresh(); return true; })()`);
  const createNote = (notePath, text) => ev(`(async () => {
    const existing = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    if (existing) await app.vault.modify(existing, ${JSON.stringify(text)});
    else await app.vault.create(${JSON.stringify(notePath)}, ${JSON.stringify(text)});
    return true;
  })()`, 20_000);
  const deleteNote = (notePath) => ev(`(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    if (file) await app.vault.delete(file);
    return !app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
  })()`, 20_000);
  const anyRefCard = (scopeExpr) => ev(`(() => {
    const scope = ${scopeExpr};
    return scope ? scope.querySelectorAll(".bob-ref-card").length : -1;
  })()`);
  const nativeState = (notePath, mode) => shared.openNote(client, notePath, mode).then(() => sleep(700)).then(() => probe(notePath));
  const waitProbe = async (notePath, predicate, label, timeoutMs = 10_000) => {
    const until = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < until) {
      last = await probe(notePath);
      if (predicate(last)) return last;
      await sleep(150);
    }
    throw new Error(label + " timed out: " + JSON.stringify(last));
  };
  const editorProbe = () => ev(editorLib.editorProbeSource());
  const waitEditor = (predicate, label, timeoutMs = 20_000) => shared.waitFor(client, editorLib.editorProbeSource(), predicate, label, timeoutMs);
  const closeEditor = async () => { await ev(`${PLUGIN}.propertyEditorModal?.close?.()`); await sleep(200); };
  const focusEditorBody = () => ev(`(() => {
    const view = app.workspace.activeLeaf?.view;
    try { view?.editor?.focus?.(); } catch (_) {}
    const dom = view?.editor?.cm?.contentDOM;
    return Boolean(dom && dom.contains(document.activeElement));
  })()`);
  const cursor = () => ev(`(() => {
    const editor = app.workspace.activeLeaf?.view?.editor;
    const at = editor?.getCursor?.();
    return at ? { line: at.line, text: editor.getLine(at.line) } : null;
  })()`);

  // ---- Native restoration -------------------------------------------------
  await createNote("ref-embed-host.md", "# Embed host\n\n![[ref/ref-finished-blog]]\n");
  await createNote("ref-hover-host.md", "# Hover host\n\nSee [[ref/ref-finished-blog]] for the reference.\n");
  await createNote("ref-board.canvas", JSON.stringify({ nodes: [{ id: "n1", type: "file", file: BLOG, x: 0, y: 0, width: 640, height: 480 }], edges: [] }));

  await attempt("native-embed-no-card", async () => {
    const rows = {};
    for (const mode of ["reading", "live"]) {
      await shared.openNote(client, "ref-embed-host.md", mode);
      await sleep(900);
      rows[mode] = await ev(`(() => {
        const view = app.workspace.activeLeaf?.view;
        const scope = view?.getMode?.() === "preview" ? view.previewMode?.containerEl : view?.editor?.cm?.dom;
        const embed = scope?.querySelector(".markdown-embed, .internal-embed");
        return { embed: Boolean(embed), embedCards: embed ? embed.querySelectorAll(".bob-ref-card").length : -1,
          cards: scope ? scope.querySelectorAll(".bob-ref-card").length : -1 };
      })()`);
    }
    return { ok: Object.values(rows).every((row) => row.embed && row.cards === 0), rows };
  });

  await attempt("native-hover-no-card", async () => {
    await shared.openNote(client, "ref-hover-host.md", "reading");
    await sleep(500);
    const target = await ev(`(() => {
      const view = app.workspace.activeLeaf?.view;
      const link = view?.previewMode?.containerEl?.querySelector("a.internal-link");
      if (!link) return { found: false };
      const rect = link.getBoundingClientRect();
      const event = new MouseEvent("mouseover", { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.top + 4 });
      app.workspace.trigger("hover-link", { event, source: "preview", hoverParent: view, targetEl: link,
        linktext: link.getAttribute("data-href") || "", sourcePath: view.file.path });
      return { found: true };
    })()`);
    if (!target.found) throw new Error("no hover link");
    await shared.waitFor(client, "Boolean(document.querySelector('.hover-popover .markdown-preview-view'))", Boolean, "hover popover", 15_000);
    await sleep(900);
    const result = await ev(`(() => {
      const pop = document.querySelector(".hover-popover");
      return { popover: Boolean(pop), cards: pop ? pop.querySelectorAll(".bob-ref-card").length : -1,
        text: (pop?.textContent || "").slice(0, 120) };
    })()`);
    await ev("(() => { document.querySelectorAll('.hover-popover').forEach((node) => node.remove()); return true; })()");
    return { ok: result.popover && result.cards === 0 && /Agentic coding/.test(result.text), result };
  });

  await attempt("native-canvas-no-card", async () => {
    await ev(`(async () => {
      const file = app.vault.getAbstractFileByPath("ref-board.canvas");
      await app.workspace.getLeaf(false).openFile(file);
      return true;
    })()`, 20_000);
    await shared.waitFor(client, "Boolean(document.querySelector('.canvas-node .markdown-preview-view, .canvas-node .markdown-embed'))", Boolean, "canvas node render", 15_000);
    await sleep(900);
    const result = await ev(`(() => ({
      nodes: document.querySelectorAll(".canvas-node").length,
      cards: Array.from(document.querySelectorAll(".canvas-node")).reduce((n, node) => n + node.querySelectorAll(".bob-ref-card").length, 0),
      text: (document.querySelector(".canvas-node")?.textContent || "").slice(0, 120),
    }))()`);
    return { ok: result.nodes >= 1 && result.cards === 0, result };
  });

  await attempt("native-print-no-card", async () => {
    // Print renders through a detached `.print` container; paint must
    // refuse it. A control paint into a normal preview container proves the
    // probe is not vacuous.
    await shared.openNote(client, BLOG, "reading");
    await sleep(600);
    const result = await ev(`(() => {
      const plugin = ${PLUGIN};
      const build = (printing) => {
        const host = document.createElement("div");
        if (printing) host.className = "print";
        const scope = document.createElement("div");
        scope.className = "markdown-preview-view markdown-rendered";
        const section = document.createElement("div");
        section.className = "markdown-preview-section";
        const heading = document.createElement("h1");
        heading.textContent = "Agentic coding is straining CI";
        const block = document.createElement("div");
        block.appendChild(heading);
        section.appendChild(block);
        scope.appendChild(section);
        host.appendChild(scope);
        document.body.appendChild(host);
        let card = null;
        try { card = plugin.paintRefNoteCardReading(block, ${JSON.stringify(BLOG)}); } catch (error) { card = "error:" + error.message; }
        const count = host.querySelectorAll(".bob-ref-card").length;
        try { plugin.refNoteCardRemoveReading(scope, scope, ${JSON.stringify(BLOG)}); } catch (_) {}
        host.remove();
        return { returned: card === null ? null : typeof card === "string" ? card : "card", count };
      };
      return { print: build(true), control: build(false) };
    })()`);
    return { ok: result.print.returned === null && result.print.count === 0, result };
  });

  await attempt("native-mobile-emulation", async () => {
    await viewMode(BLOG, "live");
    let mobile = null;
    try {
      await ev(`(() => {
        const platform = ${HELPERS}.propertyCardDesktopPlatform;
        window.__bobRefAcceptancePlatform = Object.getOwnPropertyDescriptor(platform, "isDesktopApp") || null;
        Object.defineProperty(platform, "isDesktopApp", { configurable: true, get: () => false });
        ${HELPERS}.propertyCardFrontmatterCoordinatorReconcile(${PLUGIN});
        ${PLUGIN}.scheduleRefNoteCardRefresh();
        return true;
      })()`);
      mobile = await nativeState(BLOG, "live");
    } finally {
      await ev(`(() => {
        const platform = ${HELPERS}.propertyCardDesktopPlatform;
        const descriptor = window.__bobRefAcceptancePlatform;
        if (descriptor) Object.defineProperty(platform, "isDesktopApp", descriptor); else delete platform.isDesktopApp;
        ${HELPERS}.propertyCardFrontmatterCoordinatorReconcile(${PLUGIN});
        ${PLUGIN}.scheduleRefNoteCardRefresh();
        return true;
      })()`);
    }
    const restored = await viewMode(BLOG, "live");
    return { ok: mobile.cardCount === 0 && mobile.nativeVisible && restored.cardCount === 1 && !restored.nativeVisible,
      mobile, restored: { cardCount: restored.cardCount, nativeVisible: restored.nativeVisible } };
  });

  await attempt("native-failed-mount", async () => {
    // A never-painted note, so no cached card can stand in for the build.
    const mountProbe = "ref/ref-mount-probe.md";
    await createNote(mountProbe, notes[NEXT].replace('title: "Shrinking SASE agent instruction files"', 'title: "Mount probe"')
      .replace("# Shrinking SASE agent instruction files", "# Mount probe"));
    const rows = {};
    try {
      await ev(`(() => { ${PLUGIN}.refNoteCardBuildMounted = () => null; ${PLUGIN}.scheduleRefNoteCardRefresh(); return true; })()`);
      for (const mode of ["live", "reading"]) rows[mode] = await nativeState(mountProbe, mode);
    } finally {
      await ev(`(() => { delete ${PLUGIN}.refNoteCardBuildMounted; ${PLUGIN}.scheduleRefNoteCardRefresh(); return true; })()`);
    }
    const restored = await viewMode(mountProbe, "live");
    await deleteNote(mountProbe);
    const ok = Object.values(rows).every((row) => row.cardCount === 0 && row.nativeVisible
      && row.h1Rows.some((h) => h.text === "Mount probe" && h.visible)) && restored.cardCount === 1;
    return { ok, rows: Object.fromEntries(Object.entries(rows).map(([mode, row]) => [mode,
      { cardCount: row.cardCount, nativeVisible: row.nativeVisible, h1Rows: row.h1Rows }])), restored: restored.cardCount };
  });

  await attempt("native-unload-and-disabled-ledger-tools", async () => {
    let disabled = null;
    try {
      await ev(`(async () => { await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)}); return true; })()`, 20_000);
      await sleep(800);
      disabled = await nativeState(BLOG, "live");
    } finally {
      await ev(`(async () => { await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)}); return true; })()`, 30_000);
      await shared.waitFor(client, `Boolean(${PLUGIN}) && ${PLUGIN}.refNoteCardActive === true`, Boolean, "ledger-tools re-enable", 30_000);
      await shared.waitFor(client, `(() => { const s = ${PLUGIN}.propertyCapabilityState(); return s.status === "confirmed" && s.refContract === "confirmed"; })()`,
        Boolean, "capability re-confirmed after re-enable", 45_000);
    }
    const restored = await viewMode(BLOG, "live");
    return { ok: disabled.cardCount === 0 && disabled.nativeVisible
      && disabled.h1Rows.some((h) => h.text === "Agentic coding is straining CI" && h.visible) && restored.cardCount === 1,
    disabled, restored: { cardCount: restored.cardCount } };
  });

  await attempt("native-source-cache-mismatch-releases", async () => {
    await viewMode(BLOG, "live");
    const result = await ev(`(() => {
      const plugin = ${PLUGIN};
      const cache = app.metadataCache;
      const original = cache.getFileCache;
      const descriptor = Object.getOwnPropertyDescriptor(cache, "getFileCache");
      let intercepted = 0;
      Object.defineProperty(cache, "getFileCache", { configurable: true, writable: true, value(target) {
        const current = original.call(this, target);
        if (target?.path === ${JSON.stringify(BLOG)} && current?.frontmatter) {
          intercepted += 1;
          return { ...current, frontmatter: { ...current.frontmatter, summary: "stale-mismatch" } };
        }
        return current;
      } });
      let released = 0;
      try { released = ${HELPERS}.propertyCardFrontmatterCoordinatorReconcile(plugin); }
      finally {
        if (descriptor) Object.defineProperty(cache, "getFileCache", descriptor); else delete cache.getFileCache;
      }
      return { intercepted, released };
    })()`);
    const restored = await viewMode(BLOG, "live");
    return { ok: result.intercepted >= 1 && result.released >= 1 && restored.cardCount === 1, result };
  });

  await attempt("native-rename-while-open", async () => {
    const source = notes[NEXT].replace('title: "Shrinking SASE agent instruction files"', 'title: "Rename probe"')
      .replace("# Shrinking SASE agent instruction files", "# Rename probe");
    await createNote("ref/ref-rename-probe.md", source);
    const before = await viewMode("ref/ref-rename-probe.md", "live");
    await ev(`(async () => { await app.fileManager.renameFile(app.vault.getAbstractFileByPath("ref/ref-rename-probe.md"), "ref/ref-rename-probe-moved.md"); return true; })()`, 20_000);
    const moved = await waitProbe("ref/ref-rename-probe-moved.md", (row) => row.cardCount === 1, "renamed card");
    const stale = await probe("ref/ref-rename-probe.md");
    await ev(`(async () => { await app.fileManager.renameFile(app.vault.getAbstractFileByPath("ref/ref-rename-probe-moved.md"), "ref-rename-probe-outside.md"); return true; })()`, 20_000);
    await sleep(900);
    const outside = await probe("ref-rename-probe-outside.md");
    const anyCard = await anyRefCard("app.workspace.activeLeaf?.view?.editor?.cm?.dom");
    await deleteNote("ref-rename-probe-outside.md");
    return { ok: before.cardCount === 1 && moved.cardCount === 1 && stale.cardCount === 0
      && anyCard === 0 && outside.nativeVisible,
    before: before.cardCount, moved: moved.cardCount, staleOld: stale.cardCount, outside: { anyCard, native: outside.nativeVisible } };
  });

  await attempt("native-scan-rewrite-while-open", async () => {
    await createNote("ref/ref-scan-probe.md", notes[BLOG].replace("# Agentic coding is straining CI", "# Agentic coding is straining CI")
      .replace("![[done/sase_pypi_releases_done#^ref-agentic-coding-ci]]\n", ""));
    const before = await viewMode("ref/ref-scan-probe.md", "live");
    await ev(`(async () => {
      const file = app.vault.getAbstractFileByPath("ref/ref-scan-probe.md");
      await app.vault.process(file, (text) => text
        .replace("highlights_count: 5", "highlights_count: 6")
        .replace("<!-- highlights:end -->", "> [!quote] A newly scanned highlight.\\n^h-666666666666\\n\\n<!-- highlights:end -->"));
      return true;
    })()`, 20_000);
    await sleep(1500);
    const after = await waitProbe("ref/ref-scan-probe.md", (row) => row.cardCount === 1, "scan rewrite card");
    // The probe shares the blog's identity; remove it so later report reads
    // carry no duplicate-identity diagnostic of the suite's own making.
    await deleteNote("ref/ref-scan-probe.md");
    return { ok: before.cardCount === 1 && after.cardCount === 1 && !after.nativeVisible && after.titleHidden === true,
      before: { cardCount: before.cardCount }, after: { cardCount: after.cardCount, nativeVisible: after.nativeVisible, titleHidden: after.titleHidden } };
  });

  // ---- Capability and report states --------------------------------------
  const setCapability = (patch) => ev(`(() => {
    const plugin = ${PLUGIN};
    const { entry } = plugin.propertyCapabilityEntry();
    Object.assign(entry, ${JSON.stringify(patch)});
    ${HELPERS}.propertyCardFrontmatterCoordinatorReconcile(plugin);
    plugin.scheduleRefNoteCardRefresh();
    return plugin.propertyCapabilityState();
  })()`);
  await attempt("capability-props-v1-pending-absent-failed-keep-native", async () => {
    const rows = {};
    try {
      // A delayed `bob props` keeps a re-probe from settling the forced
      // state before the observation; the state is re-read at observation.
      flag("props-delay-ms", "8000");
      for (const status of ["unknown", "absent", "unconfirmed"]) {
        const state = await setCapability({ status });
        const live = await nativeState(BLOG, "live");
        const observed = await ev(`${PLUGIN}.propertyCapabilityState().status`);
        rows[status] = { state: state.status, observed, cardCount: live.cardCount, nativeVisible: live.nativeVisible };
      }
    } finally {
      flag("props-delay-ms", null);
      await setCapability({ status: "confirmed" });
    }
    const restored = await viewMode(BLOG, "live");
    return { ok: Object.entries(rows).every(([status, row]) => row.observed === status && row.cardCount <= 1 && row.nativeVisible === true)
      && restored.cardCount === 1 && !restored.nativeVisible, rows };
  });

  const pressEquals = async (notePath) => {
    await viewMode(notePath, "live");
    await focusEditorBody();
    await sendKey(client, "Escape");
    await sendKey(client, "=");
    await sendKey(client, "=");
    return waitEditor((value) => value.open && value.readSettled, "editor after ==");
  };
  await attempt("capability-no-ref-contract-title-fallback", async () => {
    let opened = null;
    let modal = null;
    try {
      await setCapability({ refContract: "absent" });
      opened = await pressEquals(BLOG);
      modal = await ev(`(() => { const m = ${PLUGIN}.propertyEditorModal; return { focusSettings: m?.focusSettings === true, noteKind: m?.noteKind || "", requestedKey: m?.requestedKey || m?.key || "" }; })()`);
    } finally {
      await closeEditor();
      await setCapability({ refContract: "confirmed" });
    }
    const selected = (opened?.rows || []).find((row) => row.selected) || null;
    return { ok: Boolean(modal && modal.focusSettings === false && modal.requestedKey === "title"
      && (selected?.key === "title" || selected?.id === "setting::title")), modal, selected: selected && { id: selected.id, key: selected.key } };
  });

  const refetch = () => ev(`(async () => {
    const plugin = ${PLUGIN};
    await plugin.refLibraryReportStartFetch();
    plugin.scheduleRefNoteCardRefresh();
    const state = plugin.refLibraryReportState();
    return { hasSnapshot: Boolean(state.snapshot), stale: state.stale, error: state.error?.code || null };
  })()`, 60_000);
  await attempt("capability-failing-report-identity-only", async () => {
    let state = null;
    let failing = null;
    try {
      flag("ref-list-fail", "1");
      await viewMode(NEXT, "live");
      await ev(`(() => { ${PLUGIN}.refLibraryReportSnapshot = null; ${PLUGIN}.refLibraryReportStale = false; return true; })()`);
      state = await refetch();
      await sleep(600);
      failing = await viewMode(NEXT, "live");
    } finally {
      flag("ref-list-fail", null);
    }
    const recovered = await refetch();
    const back = await waitProbe(NEXT, (row) => /Next/.test(row.laneText), "lane after recovery", 15_000);
    return { ok: state && !state.hasSnapshot && state.error && failing.cardCount === 1 && failing.titlePresent
      && failing.laneText === "" && !failing.nativeVisible && /Next/.test(back.laneText),
    state, failing: { lane: failing.laneText, title: failing.title }, recovered, back: back.laneText };
  });

  await attempt("capability-late-snapshot-keeps-layout", async () => {
    let early = null;
    let arrived = null;
    try {
      flag("ref-list-delay-ms", "3000");
      await viewMode(BLOG, "live");
      await ev(`(() => { ${PLUGIN}.refLibraryReportSnapshot = null; ${PLUGIN}.scheduleRefNoteCardRefresh(); return true; })()`);
      await shared.openNote(client, BLOG, "live");
      early = await waitProbe(BLOG, (row) => row.cardCount === 1 && row.laneText === "", "identity-only before arrival");
      const fetch = refetch();
      arrived = await waitProbe(BLOG, (row) => /Read/.test(row.laneText) && row.annotationsText, "late lane arrival", 20_000);
      await fetch;
    } finally {
      flag("ref-list-delay-ms", null);
    }
    return { ok: Math.abs(arrived.cardHeight - early.cardHeight) <= 2,
      early: { height: early.cardHeight, regions: early.regionHeights, lane: early.laneText },
      arrived: { height: arrived.cardHeight, regions: arrived.regionHeights, lane: arrived.laneText, annotations: arrived.annotationsText, lint: arrived.lintText } };
  });

  await attempt("capability-stale-snapshot-kept", async () => {
    const fresh = await viewMode(NEXT, "live");
    let state = null;
    let stale = null;
    try {
      flag("ref-list-fail", "1");
      await ev(`(() => { ${PLUGIN}.refLibraryReportStale = true; return true; })()`);
      state = await refetch();
      await sleep(600);
      stale = await viewMode(NEXT, "live");
    } finally {
      flag("ref-list-fail", null);
    }
    await refetch();
    return { ok: state.hasSnapshot && state.stale && state.error && stale.laneText === fresh.laneText && /Next/.test(stale.laneText),
      state, fresh: fresh.laneText, stale: stale.laneText };
  });

  // ---- Data interactions --------------------------------------------------
  await attempt("data-today-pill-from-ledger-cache", async () => {
    const row = ctx.truthRows[NEXT];
    const key = row?.task?.path && row?.task?.block_id ? `${/\.md$/i.test(row.task.path) ? row.task.path : row.task.path + ".md"}#${row.task.block_id}` : "";
    if (!key) throw new Error("next-chat row has no task key: " + JSON.stringify(row?.task));
    const pill = () => ev(`Boolean(document.querySelector('.bob-ref-card[data-ref-source="${NEXT}"] .bob-ref-card-today'))`);
    const without = await viewMode(NEXT, "live").then(() => sleep(400)).then(pill);
    let withRank = null;
    try {
      await ev(`(() => {
        const plugin = ${PLUGIN};
        window.__bobRefAcceptanceToday = plugin.todayCache;
        const now = new Date();
        plugin.todayCache = { ...(plugin.todayCache || {}), date: plugin.todayLocalDate(now), dailyPath: plugin.currentTodayDailyPath(now),
          rank: new Map([[${JSON.stringify(key)}, 1]]) };
        plugin.scheduleRefNoteCardRefresh();
        return plugin.isTodayCacheReady(now);
      })()`);
      await sleep(900);
      withRank = await pill();
    } finally {
      await ev(`(() => { ${PLUGIN}.todayCache = window.__bobRefAcceptanceToday; ${PLUGIN}.scheduleRefNoteCardRefresh(); return true; })()`);
    }
    await sleep(700);
    const after = await pill();
    return { ok: without === false && withRank === true && after === false, key, without, withRank, after };
  });

  await attempt("data-annotation-jump", async () => {
    await viewMode(BLOG, "live");
    await ev(`app.workspace.activeLeaf?.view?.editor?.setCursor?.({ line: 0, ch: 0 })`);
    const clicked = await ev(`(() => { const chip = document.querySelector('.bob-ref-card[data-ref-source="${BLOG}"] .bob-ref-card-annotations-chip'); chip?.click(); return Boolean(chip); })()`);
    await sleep(500);
    const at = await cursor();
    return { ok: clicked && at?.text === "## Highlights", clicked, at };
  });

  await attempt("data-identifier-copy", async () => {
    await viewMode(PAPER, "live");
    await ev("navigator.clipboard.writeText('')");
    const clicked = await ev(`(() => { const chip = document.querySelector('.bob-ref-card[data-ref-source="${PAPER}"] [data-ref-identifiers] button'); chip?.click(); return chip ? chip.textContent : null; })()`);
    await sleep(500);
    const copied = await ev("navigator.clipboard.readText()");
    return { ok: Boolean(clicked) && copied === "1706.03762", clicked, copied };
  });

  await attempt("data-pdf-and-listen-open-on-linux", async () => {
    const opened = {};
    for (const [label, selector, file] of [["pdf", "[data-ref-pdf]", "lib/agentic-coding-ci.pdf"], ["listen", "[data-ref-audio]", "lib/agentic-coding-ci.mp3"]]) {
      await viewMode(BLOG, "live");
      await ev(`(() => { document.querySelector('.bob-ref-card[data-ref-source="${BLOG}"] ${selector}')?.click(); return true; })()`);
      await sleep(1200);
      opened[label] = await ev(`(() => {
        const leaves = [];
        app.workspace.iterateAllLeaves((leaf) => { if (leaf.view?.file?.path) leaves.push({ path: leaf.view.file.path, type: leaf.view.getViewType() }); });
        const match = leaves.find((leaf) => leaf.path === ${JSON.stringify(file)}) || null;
        app.workspace.iterateAllLeaves((leaf) => { if (leaf.view?.file?.path === ${JSON.stringify(file)}) leaf.detach(); });
        return { match, leaves: leaves.length };
      })()`);
    }
    return { ok: opened.pdf.match?.type === "pdf" && Boolean(opened.listen.match), opened };
  });

  // ---- Keys and focus ----------------------------------------------------
  await attempt("keys-plus-opens-property-editor", async () => {
    await viewMode(BLOG, "live");
    await focusEditorBody();
    await sendKey(client, "Escape");
    await sendKey(client, "+");
    const opened = await waitEditor((value) => value.open && value.readSettled, "+ property editor");
    const modal = await ev(`(() => ({ focusSettings: ${PLUGIN}.propertyEditorModal?.focusSettings === true, filePath: ${PLUGIN}.propertyEditorModal?.filePath || "" }))()`);
    await sendKey(client, "Escape");
    await sleep(400);
    const closed = await editorProbe();
    return { ok: modal.filePath === BLOG && modal.focusSettings === false && opened.rows.length > 0 && !closed.open, modal, rows: opened.rows.length };
  });

  await attempt("keys-minus-opens-drawer", async () => {
    await viewMode(BLOG, "live");
    const drawer = () => ev(`(() => {
      const card = document.querySelector('.bob-ref-card[data-ref-source="${BLOG}"]');
      const node = card?.querySelector(".bob-property-card-foot-drawer");
      return { open: node?.getAttribute("data-open") ?? null, hidden: node ? node.hidden === true : null,
        disclosure: card?.querySelector(".bob-property-card-foot-disclosure")?.getAttribute("aria-expanded") ?? null };
    })()`);
    const before = await drawer();
    await focusEditorBody();
    await sendKey(client, "Escape");
    await sendKey(client, "-");
    await sleep(500);
    const opened = await drawer();
    await sendKey(client, "Escape");
    await focusEditorBody();
    await sendKey(client, "-");
    await sleep(500);
    const toggled = await drawer();
    return { ok: JSON.stringify(before) !== JSON.stringify(opened), before, opened, toggled };
  });

  await attempt("keys-underscore-compacts-card", async () => {
    await viewMode(BLOG, "live");
    await ctx.setFold(BLOG, false);
    await focusEditorBody();
    await sendKey(client, "Escape");
    await sendKey(client, "_");
    const compact = await waitProbe(BLOG, (row) => row.collapsed === true, "_ compacts");
    await focusEditorBody();
    await sendKey(client, "Escape");
    await sendKey(client, "_");
    const expanded = await waitProbe(BLOG, (row) => row.collapsed === false, "_ expands");
    return { ok: compact.collapsed && !expanded.collapsed && expanded.cardCount === 1 };
  });

  await attempt("keys-vim-gg-k-up-stay-in-visible-body", async () => {
    // Motions must really run (a thrown motion leaves the cursor in place and
    // would look like a pass): `gg` starts well below the body start, `j`
    // must move, and no console error may appear while the keys run.
    await viewMode(BLOG, "live");
    const lines = notes[BLOG].split("\n");
    const bodyLine = lines.findIndex((line) => line.startsWith("![[done/"));
    const lowerLine = lines.findIndex((line) => line.startsWith("## Highlights"));
    const errorsBefore = (ctx.report.consoleErrors || []).length + (ctx.report.consoleExceptions || []).length;
    const moves = {};
    for (const [label, startLine, keys] of [["gg", lowerLine, ["g", "g"]], ["k", bodyLine, ["k"]], ["Up", bodyLine, ["ArrowUp"]], ["j", bodyLine, ["j"]]]) {
      await ev(`(() => { const e = app.workspace.activeLeaf.view.editor; e.focus(); e.setCursor({ line: ${startLine}, ch: 0 }); return true; })()`);
      await sendKey(client, "Escape");
      for (const key of keys) await sendKey(client, key);
      await sleep(250);
      moves[label] = { from: startLine, at: await cursor() };
    }
    await sleep(300);
    const newErrors = [...(ctx.report.consoleErrors || []), ...(ctx.report.consoleExceptions || []).map((row) => row.description || row.text)]
      .slice(errorsBefore);
    const nativeAfter = await probe(BLOG);
    const guard = await ev(`(() => {
      const plugin = ${PLUGIN};
      const view = app.workspace.activeLeaf?.view?.editor?.cm;
      const path = plugin.refNoteCardLivePath?.(view) || null;
      const line = path ? plugin.homeCardVisibleBodyLine?.(view, path) : null;
      return { registered: plugin.refNoteCardVisibleBodyNavigationRegistered === true, path,
        owned: path ? plugin.refNoteCardNavigationOwned?.(view, path) === true : null,
        bodyLine: line ? line.number - 1 : null,
        ownsFrontmatter: Boolean(view?.dom?.classList?.contains("bob-property-card-owns-frontmatter")),
        ownsTitle: Boolean(view?.dom?.classList?.contains("bob-property-card-owns-title")),
        cards: Array.from(view?.dom?.querySelectorAll?.(".bob-ref-card") || []).map((node) => ({
          source: node.getAttribute("data-ref-source"), widget: node.getAttribute("data-cm-widget") })) };
    })()`);
    const ok = ["gg", "k", "Up"].every((label) => moves[label].at?.line === bodyLine)
      && moves.j.at?.line > bodyLine && newErrors.length === 0
      && !nativeAfter.nativeVisible && nativeAfter.titleHidden === true;
    return { ok, bodyLine, lowerLine, moves, guard, newErrors: newErrors.map((text) => String(text).slice(0, 200)), titleHidden: nativeAfter.titleHidden };
  });

  await attempt("keys-tab-never-enters-hidden-properties", async () => {
    await viewMode(BLOG, "live");
    await focusEditorBody();
    const docBefore = await ev("app.workspace.activeLeaf.view.editor.getValue()");
    await sendKey(client, "Tab");
    const afterTab = await ev("Boolean(document.activeElement?.closest?.('.metadata-container'))");
    await sendKey(client, "Tab", { shift: true });
    const afterShift = await ev("Boolean(document.activeElement?.closest?.('.metadata-container'))");
    const docAfter = await ev("app.workspace.activeLeaf.view.editor.getValue()");
    if (docAfter !== docBefore) await ev(`app.workspace.activeLeaf.view.editor.setValue(${JSON.stringify(docBefore)})`);
    return { ok: !afterTab && !afterShift, afterTab, afterShift, bufferChanged: docAfter !== docBefore };
  });

  // ---- The Reference editor -----------------------------------------------
  await runEditorFlows({ ...ctx, ev, sleep, disk, attempt, waitEditor, editorProbe, closeEditor, pressEquals, setInput, sendKey });
}

async function runEditorFlows(ctx) {
  const { client, shared, ev, sleep, disk, attempt, waitEditor, editorProbe, closeEditor, pressEquals, viewMode } = ctx;
  // Synced PDF references carry `highlights_marker_base` in the live vault;
  // bob's PDF-marker effect keys on it. Add it (a deliberate post-hash write)
  // so the editor previews show the marker sync line as they do live.
  const markerLines = ["highlights_count: 5", 'highlights_marker_base: "{}"'].join("\n");
  await ev(`(async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(BLOG)});
    await app.vault.process(file, (text) => text.includes("highlights_marker_base:") ? text
      : text.replace("highlights_count: 5", ${JSON.stringify(markerLines)}));
    return true;
  })()`, 20_000);
  await sleep(1500);
  const rowById = (probe, id) => (probe?.rows || []).find((row) => row.id === id) || null;
  const selectRow = async (id) => {
    const clicked = await ev(`(() => {
      const row = document.querySelector('.bob-property-editor [data-property-row="${id}"]');
      if (!row) return false;
      row.scrollIntoView({ block: "nearest" });
      row.click();
      return true;
    })()`);
    if (!clicked) throw new Error("missing editor row " + id);
    return waitEditor((probe) => rowById(probe, id)?.selected === true, "select " + id, 10_000);
  };
  const openReference = async () => {
    await closeEditor();
    const probe = await pressEquals(BLOG);
    const modal = await ev(`(() => ({ focusSettings: ${PLUGIN}.propertyEditorModal?.focusSettings === true }))()`);
    if (!modal.focusSettings) throw new Error("== did not open settings mode");
    return probe;
  };

  let inventory = null;
  await attempt("editor-reference-rows", async () => {
    const probe = await openReference();
    inventory = probe.rows.map((row) => ({ id: row.id, key: row.key, action: row.action, disabled: row.disabled, locked: row.lockedClass, text: row.text.slice(0, 80) }));
    const settingIds = inventory.filter((row) => row.id?.startsWith("setting::")).map((row) => row.id.slice(9));
    const editable = Object.keys(REFERENCE_SETTING_VALUES).filter((id) => settingIds.includes(id));
    return { ok: editable.length === 6 && settingIds.length >= 9, settingIds, inventory };
  });

  for (const id of Object.keys(REFERENCE_SETTING_VALUES)) {
    await attempt(`editor-row-${id}-set-clear-undo`, async () => {
      const original = disk(BLOG);
      await openReference();
      await selectRow(`setting::${id}`);
      await ctx.sendKey(client, "Enter");
      await shared.waitFor(client, `Boolean(document.querySelector('.bob-property-editor [data-property-stage]'))`, Boolean, id + " stage", 10_000);
      const collection = await ev("Boolean(document.querySelector('.bob-property-editor-stage-chip, [data-property-stage-chip]'))");
      if (collection) {
        await ev(`(() => { document.querySelectorAll('.bob-property-editor-stage-chip-remove, [data-property-stage-chip-remove]').forEach((b) => b.click()); return true; })()`);
      }
      await ctx.setInput(client, "[data-property-stage-input]", REFERENCE_SETTING_VALUES[id]);
      // List rows (Authors, Aliases) take the typed item as a chip on the
      // first Enter and save on the next; scalar rows save on the first.
      let preview = "";
      let saved = null;
      for (let press = 0; press < 3 && !saved; press += 1) {
        preview = await shared.waitFor(client, `document.querySelector(".bob-property-editor-stage-preview")?.textContent || ""`,
          (text) => /Preview ·/.test(text), id + " preview", 8_000).catch(() => preview);
        await ctx.sendKey(client, "Enter");
        saved = await waitEditor((probe) => !probe.stage && /Saved/.test(probe.status), id + " saved", 6_000).catch(() => null);
      }
      if (!saved) throw new Error(id + " never saved: " + JSON.stringify(await editorProbe()).slice(0, 1500));
      const afterSet = disk(BLOG);
      await ctx.sendKey(client, "u");
      await waitEditor(() => disk(BLOG) === original, id + " undo set", 20_000);
      const hasValue = yamlLine(original, id === "source" ? "source_url" : id) !== null || (id === "title");
      let afterClear = null;
      let clearStatus = null;
      if (hasValue) {
        await selectRow(`setting::${id}`);
        await ctx.sendKey(client, "d", { ctrl: true });
        await waitEditor(() => disk(BLOG) !== original, id + " clear", 20_000).catch(() => null);
        afterClear = disk(BLOG);
        clearStatus = (await editorProbe()).status;
        if (afterClear !== original) {
          await ctx.sendKey(client, "u");
          await waitEditor(() => disk(BLOG) === original, id + " undo clear", 20_000);
        }
      }
      const restored = disk(BLOG) === original;
      await closeEditor();
      const value = REFERENCE_SETTING_VALUES[id];
      const setOk = afterSet !== original && afterSet.includes(id === "published" ? value : value.split(" ")[0]);
      const titleEffects = id === "title" ? { yaml: yamlLine(afterSet, "title"), h1: firstH1(afterSet), preview } : null;
      const titleOk = id !== "title" || (firstH1(afterSet) === value && /title:\s*"?Agentic coding strains CI/.test(afterSet));
      // Title and Source are set-only in bob's REFERENCE contract: Ctrl+d
      // must be refused with bob's reason and leave the bytes untouched.
      const setOnly = id === "title" || id === "source";
      const clearOk = !hasValue || (setOnly
        ? afterClear === original && /set-only|replace it instead/i.test(clearStatus || "")
        : afterClear !== null && afterClear !== original);
      return { ok: setOk && titleOk && clearOk && restored, collection, preview, saved: saved.status,
        set: yamlLine(afterSet, id === "source" ? "source_url" : id), cleared: afterClear === null ? null : yamlLine(afterClear, id === "source" ? "source_url" : id),
        titleEffects, clearStatus, restored };
    });
  }

  await attempt("editor-title-preview-names-marker-and-link-text", async () => {
    await openReference();
    await selectRow("setting::title");
    await ctx.sendKey(client, "Enter");
    await ctx.setInput(client, "[data-property-stage-input]", REFERENCE_SETTING_VALUES.title);
    const preview = await shared.waitFor(client, `document.querySelector(".bob-property-editor-stage")?.textContent || ""`,
      (text) => /PDF marker/i.test(text) && /link text|reading task/i.test(text), "title effects preview", 15_000).catch(async () =>
      ev(`document.querySelector(".bob-property-editor-stage")?.textContent || ""`));
    await ctx.sendKey(client, "Escape");
    await closeEditor();
    return { ok: /PDF|marker/i.test(preview) && /link text|reading task/i.test(preview), preview: String(preview).slice(0, 1200) };
  });

  await attempt("editor-owned-row-routes", async () => {
    const probe = await openReference();
    const owned = probe.rows.filter((row) => row.id?.startsWith("setting::") && !Object.keys(REFERENCE_SETTING_VALUES).includes(row.id.slice(9)));
    const reading = owned.find((row) => /reading/i.test(row.id + row.text)) || null;
    const fileName = owned.find((row) => /file|rename/i.test(row.id + row.text)) || null;
    let readingRoute = null;
    let renameRoute = null;
    if (reading) {
      await selectRow(reading.id);
      await ctx.sendKey(client, "Enter");
      await sleep(1200);
      readingRoute = await ev(`({ active: app.workspace.getActiveFile()?.path || "", editorOpen: Boolean(document.querySelector(".bob-property-editor")) })`);
    }
    await openReference();
    if (fileName) {
      await ev("navigator.clipboard.writeText('')");
      await selectRow(fileName.id);
      await ctx.sendKey(client, "Enter");
      await sleep(800);
      renameRoute = await ev(`(async () => ({ clipboard: await navigator.clipboard.readText(), status: document.querySelector(".bob-property-editor-status")?.textContent || "" }))()`);
    }
    await closeEditor();
    return { ok: readingRoute?.active === "done/sase_pypi_releases_done.md" && readingRoute.editorOpen === false
      && /^bob ref rename ref-finished-blog <NEW>$/.test(renameRoute?.clipboard || ""),
    owned: owned.map((row) => ({ id: row.id, action: row.action, disabled: row.disabled, text: row.text.slice(0, 80) })), readingRoute, renameRoute };
  });

  await attempt("editor-refusals-protected-keys", async () => {
    const before = disk(BLOG);
    await closeEditor();
    await viewMode(BLOG, "live");
    await ev(`(async () => { await ${PLUGIN}.openPropertyEditor({ filePath: ${JSON.stringify(BLOG)} }); return true; })()`, 20_000);
    const probe = await waitEditor((value) => value.open && value.readSettled, "ordinary editor");
    const protectedKeys = ["ref_type", "source_pdf", "highlights_count", "highlights_synced_at"];
    const rows = protectedKeys.map((key) => {
      const row = probe.rows.find((item) => item.key === key) || null;
      return { key, present: Boolean(row), locked: Boolean(row && (row.lockedClass || row.disabled)), id: row?.id || null };
    });
    let attemptEdit = null;
    const target = rows.find((row) => row.present);
    if (target) {
      await ev(`(() => { document.querySelector('.bob-property-editor [data-property-row="${target.id}"]')?.click(); return true; })()`);
      await ctx.sendKey(client, "Enter");
      await sleep(700);
      attemptEdit = await editorProbe();
      await ctx.sendKey(client, "Escape");
    }
    await closeEditor();
    const unchanged = disk(BLOG) === before;
    return { ok: rows.every((row) => !row.present || row.locked) && rows.some((row) => row.present) && unchanged,
      rows, attempt: attemptEdit ? { stage: attemptEdit.stage, status: attemptEdit.status } : null, unchanged };
  });

  await attempt("editor-esc-q-ctrl-bracket-ladder", async () => {
    const steps = {};
    await openReference();
    await selectRow("setting::summary");
    await ctx.sendKey(client, "Enter");
    await waitEditor((value) => Boolean(value.stage), "ladder stage 1");
    await ctx.sendKey(client, "Escape");
    steps.escStage = await waitEditor((value) => value.open && !value.stage, "Esc backs out of the stage");
    await ctx.sendKey(client, "q");
    await sleep(400);
    steps.qClose = (await editorProbe()).open === false;
    await openReference();
    await selectRow("setting::summary");
    await ctx.sendKey(client, "Enter");
    await waitEditor((value) => Boolean(value.stage), "ladder stage 2");
    await ctx.sendKey(client, "[", { ctrl: true });
    steps.ctrlBracketStage = await waitEditor((value) => value.open && !value.stage, "Ctrl+[ backs out of the stage");
    await ctx.sendKey(client, "[", { ctrl: true });
    await sleep(400);
    steps.ctrlBracketClose = (await editorProbe()).open === false;
    await openReference();
    await ctx.sendKey(client, "Escape");
    await sleep(400);
    steps.escClose = (await editorProbe()).open === false;
    await closeEditor();
    return { ok: Boolean(steps.escStage) && steps.qClose && Boolean(steps.ctrlBracketStage) && steps.ctrlBracketClose && steps.escClose,
      steps: { qClose: steps.qClose, ctrlBracketClose: steps.ctrlBracketClose, escClose: steps.escClose } };
  });
}

module.exports = { runFlows, sendKey, setInput, yamlLine, firstH1, REFERENCE_SETTING_VALUES };
