#!/usr/bin/env node
// Real-Obsidian title-block walkthrough: shipped album, record, day, and
// period cards in Live Preview and Reading. Isolated Git vault and profile,
// owned Obsidian under Xvfb, working-tree bob-ledger-tools only. Never opens
// the live vault. A refusing bob shim on PATH records any child invocations.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lib = require("./obsidian-title-block-e2e-lib.cjs");
const shared = require("./obsidian-record-card-e2e.cjs");

const repoRoot = path.resolve(__dirname, "..");
const PLUGIN_ID = "bob-ledger-tools";
const SNAP_BIN = "/snap/bin/obsidian";
const ELECTRON_FALLBACK = "/snap/obsidian/current/app/obsidian";
const MODE_STATE = {
  live: { mode: "source", source: false },
  source: { mode: "source", source: true },
  reading: { mode: "preview" },
};
const { sleep, waitFor, capture } = shared;

function findExecutable(override) {
  const candidates = [override, process.env.OBSIDIAN_BIN, SNAP_BIN, ELECTRON_FALLBACK].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {}
  }
  return candidates[0] || SNAP_BIN;
}

function writeBobRefusal(shimDir, logPath) {
  fs.mkdirSync(shimDir, { recursive: true });
  const file = path.join(shimDir, "bob");
  fs.writeFileSync(file, "#!/usr/bin/env node\n"
    + "try { require('node:fs').appendFileSync(" + JSON.stringify(logPath)
    + ", JSON.stringify({ at: new Date().toISOString(), args: process.argv.slice(2) }) + '\\n'); } catch (_) {}\n"
    + "process.stderr.write('bob is disabled in the title-block walkthrough\\n');\nprocess.exit(3);\n");
  fs.chmodSync(file, 0o755);
  return file;
}

function installVault(vaultDir) {
  const obsidian = path.join(vaultDir, ".obsidian");
  const dest = path.join(obsidian, "plugins", PLUGIN_ID);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ["manifest.json", "main.js", "styles.css"]) {
    fs.copyFileSync(path.join(repoRoot, "plugins", PLUGIN_ID, name), path.join(dest, name));
  }
  fs.writeFileSync(path.join(obsidian, "community-plugins.json"), JSON.stringify([PLUGIN_ID], null, 2));
  fs.writeFileSync(path.join(obsidian, "core-plugins.json"), JSON.stringify([
    "file-explorer", "command-palette", "page-preview", "properties", "outline", "editor-status",
  ], null, 2));
  fs.writeFileSync(path.join(obsidian, "app.json"), JSON.stringify({
    livePreview: true, showInlineTitle: true, propertiesInDocument: "visible", readableLineLength: true,
    vimMode: true, showLineNumber: false, alwaysUpdateLinks: false,
  }, null, 2));
  fs.writeFileSync(path.join(obsidian, "appearance.json"), JSON.stringify({ cssTheme: "", theme: "moonstone" }, null, 2));
}

function pluginProvenance() {
  const git = (args) => String(spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).stdout || "");
  const dir = path.join(repoRoot, "plugins", PLUGIN_ID);
  const files = {};
  for (const name of ["manifest.json", "main.js", "styles.css"]) files[name] = shared.sha256File(path.join(dir, name));
  return {
    head: git(["rev-parse", "HEAD"]).trim() || null,
    dirtyPaths: git(["status", "--porcelain"]).split("\n").filter(Boolean),
    version: JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).version,
    files,
  };
}

function hashFixtures(vaultDir, names) {
  return Object.fromEntries(names.map((name) => {
    const file = path.join(vaultDir, name);
    return [name, fs.existsSync(file) ? shared.sha256File(file) : null];
  }));
}

function snapshot(root) {
  const result = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", ".obsidian"].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        result[path.relative(root, file).split(path.sep).join("/")] = fs.readFileSync(file, "utf8");
      }
    }
  };
  walk(root);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function makeHelpers(ctx) {
  const { client, report, outDir } = ctx;
  const ev = (expression, timeoutMs = 30_000) => client.evaluate(expression, timeoutMs);
  const key = async (name, modifiers = 0) => {
    for (const event of lib.keyEvents(name, modifiers)) await client.call("Input.dispatchKeyEvent", event);
  };
  const keys = async (sequence, delay = 40) => {
    for (const name of sequence) { await key(name); if (delay) await sleep(delay); }
  };
  const typeText = async (text) => {
    const value = String(text);
    if (!value) return;
    try {
      await client.call("Input.insertText", { text: value });
    } catch (_) {
      for (const ch of value) await key(ch);
    }
  };
  const open = async (notePath, mode = "live") => {
    const state = MODE_STATE[mode] || MODE_STATE.live;
    const opened = await ev(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
      if (!file) return { ok: false, error: "missing file" };
      const active = app.workspace.activeLeaf;
      const leaf = active && active.getRoot?.() === app.workspace.rootSplit ? active : app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: ${JSON.stringify(state)}, active: true });
      if (leaf.view?.setState) await leaf.view.setState(Object.assign({}, leaf.view.getState?.() || {}, ${JSON.stringify(state)}), { history: false });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 450));
      return { ok: leaf.view?.file?.path === ${JSON.stringify(notePath)}, path: leaf.view?.file?.path || null,
        mode: leaf.view?.getMode?.() || null, source: Boolean(leaf.view?.getState?.().source), leafId: leaf.id };
    })()`, 30_000);
    if (!opened.ok) throw new Error("Could not open " + notePath + ": " + JSON.stringify(opened));
    return opened;
  };
  const split = async (fromId) => ev(`(() => {
    const from = app.workspace.getLeafById(${JSON.stringify(fromId)});
    const leaf = app.workspace.createLeafBySplit(from, "vertical");
    return leaf.id;
  })()`);
  const openIn = async (leafId, notePath, mode = "live") => {
    const state = MODE_STATE[mode] || MODE_STATE.live;
    const opened = await ev(`(async () => {
      const leaf = app.workspace.getLeafById(${JSON.stringify(leafId)});
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
      if (!leaf || !file) return { ok: false, error: "missing leaf or file" };
      await leaf.openFile(file, { state: ${JSON.stringify(state)}, active: true });
      if (leaf.view?.setState) await leaf.view.setState(Object.assign({}, leaf.view.getState?.() || {}, ${JSON.stringify(state)}), { history: false });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { ok: leaf.view?.file?.path === ${JSON.stringify(notePath)}, path: leaf.view?.file?.path || null, leafId: leaf.id };
    })()`, 30_000);
    if (!opened.ok) throw new Error("openIn failed: " + JSON.stringify(opened));
    return opened;
  };
  const detach = (leafId) => ev(`(() => { const leaf = app.workspace.getLeafById(${JSON.stringify(leafId)}); if (leaf) leaf.detach(); return Boolean(leaf); })()`);
  const probe = (notePath) => ev(lib.probeSource(notePath));
  const waitCard = (notePath, predicate = (value) => value?.cardCount === 1, label = "title card on " + notePath) =>
    waitFor(client, lib.probeSource(notePath), predicate, label, 25_000);
  const shot = async (name, mode, options = {}) => {
    const width = options.width || 1400;
    const theme = options.theme || "light";
    const row = await capture(client, outDir, name, width, theme, mode);
    report.screenshots.push(row);
    return row;
  };
  const clickAt = async (x, y) => {
    await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const clickIn = async (notePath, selector) => {
    const box = await ev(`(() => {
      const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === ${JSON.stringify(notePath)});
      const view = leaf?.view;
      const root = view?.getMode?.() === "preview" ? view.previewMode?.containerEl : view?.contentEl;
      const node = Array.from(root?.querySelectorAll(${JSON.stringify(selector)}) || [])
        .find((item) => !item.closest(".markdown-embed, .internal-embed"));
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height, text: (node.textContent || "").slice(0, 80) };
    })()`);
    if (!box || !(box.width > 0)) throw new Error("nothing to click for " + selector + " on " + notePath);
    await clickAt(box.x, box.y);
    return box;
  };
  const clickWikilink = async (notePath, needle) => {
    const box = await ev(`(() => {
      const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === ${JSON.stringify(notePath)});
      const view = leaf?.view;
      const root = view?.getMode?.() === "preview" ? view.previewMode?.containerEl : view?.contentEl;
      const nodes = Array.from(root?.querySelectorAll("a.internal-link, span.cm-hmd-internal-link, .internal-link") || [])
        .filter((item) => !item.closest(".markdown-embed, .internal-embed, .hover-popover"));
      const node = nodes.find((item) => {
        const href = item.getAttribute("data-href") || item.getAttribute("href") || "";
        const text = item.textContent || "";
        return href.includes(${JSON.stringify(needle)}) || text.includes(${JSON.stringify(needle)}) || /Source heading/i.test(text);
      });
      if (!node) return { found: false, count: nodes.length, sample: nodes.slice(0, 6).map((item) => ({
        tag: item.tagName, href: item.getAttribute("data-href") || item.getAttribute("href") || "", text: (item.textContent || "").slice(0, 60),
      })) };
      const rect = node.getBoundingClientRect();
      return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height, text: (node.textContent || "").slice(0, 80) };
    })()`);
    if (!box?.found || !(box.width > 0)) throw new Error("nothing to click for wikilink " + needle + " on " + notePath + ": " + JSON.stringify(box));
    await clickAt(box.x, box.y);
    return box;
  };
  const focusEditor = (notePath) => ev(`(() => {
    const leaf = app.workspace.getLeavesOfType("markdown").find((item) => item.view?.file?.path === ${JSON.stringify(notePath)});
    if (!leaf) return { ok: false };
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view?.editor?.focus?.();
    return { ok: true, path: leaf.view?.file?.path || null };
  })()`);
  const placeCursor = async (needle, notePath) => ev(`(() => {
    const view = app.workspace.activeLeaf?.view;
    if (!view?.editor || view.file?.path !== ${JSON.stringify(notePath)}) return { ok: false, path: view?.file?.path || null };
    const lines = view.editor.getValue().split("\\n");
    const line = lines.findIndex((text) => text.includes(${JSON.stringify(needle)}));
    if (line < 0) return { ok: false, reason: "needle missing" };
    view.editor.setCursor({ line, ch: 0 });
    view.editor.focus();
    return { ok: true, line, text: lines[line].slice(0, 120) };
  })()`);
  return { ev, key, keys, typeText, open, split, openIn, detach, probe, waitCard, shot, clickIn, clickWikilink, clickAt, focusEditor, placeCursor };
}

function expectOwned(state, expect) {
  const failures = lib.placementFailures(state, expect);
  if (failures.length) throw new Error(failures.join("; ") + " :: " + JSON.stringify({
    card: state.card, title: state.title, slot: state.card?.slot, mode: state.mode,
  }).slice(0, 1800));
  return { slot: state.card.slot, title: state.card.title, species: state.card.species, tile: state.card.tileForm };
}

async function proveSpecies(ctx, name, notePath, expect) {
  const { attempt, open, waitCard, shot } = ctx;
  const species = lib.expectedSpecies()[expect.spec];
  for (const mode of expect.modes) {
    await attempt(name + "-" + mode, async () => {
      await open(notePath, mode);
      const state = await waitCard(notePath, (value) => value?.cardCount === 1 && value.card?.kind === species.kind);
      const result = expectOwned(state, { ...species, title: expect.title, mode });
      if (mode === "live") await shot("title-block-" + name + "-live", "Live Preview");
      return result;
    });
  }
}

async function walkthrough(ctx) {
  const { plan, attempt, open, waitCard, probe, shot, split, openIn, detach, keys, typeText, key,
    focusEditor, placeCursor, clickWikilink, ev, client, vaultDir, notes } = ctx;
  const titles = plan.titles;
  const paths = plan.paths;
  const species = lib.expectedSpecies();

  await proveSpecies(ctx, "species-album", paths.album, { spec: "album", title: titles.album, modes: ["live", "reading"] });
  await proveSpecies(ctx, "species-album-h1less", paths.h1less, { spec: "h1less", title: titles.h1less, modes: ["live", "reading"] });
  await proveSpecies(ctx, "species-album-authored-h1", paths.authored, { spec: "authored", title: titles.authored, modes: ["live", "reading"] });
  await proveSpecies(ctx, "species-record", paths.record, { spec: "record", title: titles.record, modes: ["live", "reading"] });
  await proveSpecies(ctx, "species-day-today", paths.today, { spec: "day", title: titles.today, modes: ["live", "reading"] });
  await proveSpecies(ctx, "species-day-past", paths.yesterday, { spec: "day", title: titles.yesterday, modes: ["live"] });
  await proveSpecies(ctx, "species-day-empty", paths.empty, { spec: "empty", title: titles.empty, modes: ["live"] });
  await proveSpecies(ctx, "species-day-future", paths.future, { spec: "future", title: titles.future, modes: ["live"] });
  await proveSpecies(ctx, "species-day-legacy-2024", paths.legacy2024, { spec: "legacy2024", title: titles.legacy2024, modes: ["live", "reading"] });
  await proveSpecies(ctx, "species-day-legacy-2025", paths.legacy2025, { spec: "legacy2025", title: titles.legacy2025, modes: ["live", "reading"] });
  await proveSpecies(ctx, "species-day-legacy-2026", paths.legacy2026, { spec: "legacy2026", title: titles.legacy2026, modes: ["live", "reading"] });
  await proveSpecies(ctx, "species-week", paths.week, { spec: "week", title: titles.week, modes: ["live", "reading"] });
  await proveSpecies(ctx, "species-quarter", paths.quarter, { spec: "quarter", title: titles.quarter, modes: ["live", "reading"] });
  await proveSpecies(ctx, "species-year", paths.year, { spec: "year", title: titles.year, modes: ["live", "reading"] });

  let right = null;
  await attempt("scope-same-note-two-panes", async () => {
    const left = await open(paths.today, "live");
    await waitCard(paths.today, (value) => value?.cardCount === 1);
    right = await split(left.leafId);
    await openIn(right, paths.today, "live");
    await sleep(500);
    const leftProbe = await ev(lib.probeSource(paths.today, { leafId: left.leafId }));
    const rightProbe = await ev(lib.probeSource(paths.today, { leafId: right }));
    const both = await ev(`(() => {
      const leaves = app.workspace.getLeavesOfType("markdown").filter((item) => item.view?.file?.path === ${JSON.stringify(paths.today)});
      const cards = leaves.map((leaf) => {
        const root = leaf.view?.contentEl;
        return {
          id: leaf.id,
          cards: root?.querySelectorAll(".bob-property-card").length || 0,
          owns: root?.querySelectorAll(".bob-property-card-owns-title").length || 0,
        };
      });
      return { leaves: leaves.length, cards };
    })()`);
    await shot("title-block-split-same-note", "Live Preview split");
    if (both.leaves < 2 || both.cards.some((row) => row.cards !== 1)) {
      throw new Error("split ownership: " + JSON.stringify({ both, left: leftProbe.cardCount, right: rightProbe && rightProbe.cardCount }));
    }
    return both;
  });

  await attempt("scope-unrelated-note", async () => {
    if (!right) throw new Error("right pane missing");
    await openIn(right, paths.ordinary, "live");
    await sleep(400);
    const ordinary = await ev(`(() => {
      const leaf = app.workspace.getLeafById(${JSON.stringify(right)});
      const root = leaf?.view?.contentEl;
      return {
        path: leaf?.view?.file?.path || null,
        cards: root?.querySelectorAll(".bob-property-card").length || 0,
        owns: root?.querySelectorAll(".bob-property-card-owns-title").length || 0,
        inline: (() => {
          const title = root?.querySelector(".inline-title");
          if (!title) return null;
          const style = getComputedStyle(title);
          const rect = title.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.height > 0;
        })(),
      };
    })()`);
    const left = await probe(paths.today);
    if (ordinary.path !== paths.ordinary || ordinary.cards !== 0 || ordinary.owns !== 0 || ordinary.inline === false) {
      throw new Error("unrelated pane: " + JSON.stringify(ordinary));
    }
    if (left.cardCount !== 1) throw new Error("owning pane lost its card: " + JSON.stringify(left.card));
    await detach(right);
    right = null;
    return { ordinary, left: { cards: left.cardCount, title: left.card?.title } };
  });

  await attempt("scope-frontmatter-cursor-keeps-hidden", async () => {
    await open(paths.today, "live");
    const hidden = await waitCard(paths.today, (value) => value?.cardCount === 1 && (value.title.h1Shown || []).length === 0);
    const placed = await placeCursor("type:", paths.today);
    if (!placed.ok) throw new Error("could not place the cursor in frontmatter: " + JSON.stringify(placed));
    await sleep(400);
    const after = await probe(paths.today);
    if ((after.title.h1Shown || []).length) throw new Error("frontmatter selection revealed the H1: " + JSON.stringify(after.title));
    if (after.cardCount !== 1) throw new Error("card unmounted from frontmatter selection");
    return { placed, hidden: hidden.title, after: after.title };
  });

  await attempt("scope-restored-cursor-outside-range", async () => {
    await open(paths.today, "live");
    await waitCard(paths.today, (value) => value?.cardCount === 1);
    const body = await placeCursor("GTD-ANCHOR", paths.today);
    if (!body.ok) throw new Error("could not restore the cursor onto the body: " + JSON.stringify(body));
    await sleep(350);
    const after = await probe(paths.today);
    if ((after.title.h1Shown || []).length || after.title.navShown) {
      throw new Error("a body cursor revealed the title range: " + JSON.stringify(after.title));
    }
    return { body, title: after.title, cursor: after.cursor };
  });

  await attempt("vim-gg-across-hidden", async () => {
    await open(paths.today, "live");
    await waitCard(paths.today, (value) => value?.cardCount === 1 && (value.title.h1Shown || []).length === 0);
    await focusEditor(paths.today);
    await keys(["Escape", "G"]);
    await sleep(250);
    const end = await probe(paths.today);
    await keys(["g", "g"]);
    await sleep(400);
    const start = await probe(paths.today);
    await shot("title-block-vim-gg", "Live Preview");
    if (start.cardCount !== 1) throw new Error("card unmounted on gg");
    return { endCursor: end.cursor, startCursor: start.cursor, revealed: start.title.h1Shown, card: start.card?.title };
  });

  await attempt("vim-jk-across-hidden", async () => {
    await open(paths.today, "live");
    await waitCard(paths.today, (value) => value?.cardCount === 1);
    await focusEditor(paths.today);
    await keys(["Escape", "g", "g"]);
    await sleep(300);
    const atTop = await probe(paths.today);
    await keys(["j", "j", "j"]);
    await sleep(300);
    const down = await probe(paths.today);
    await keys(["k", "k", "k"]);
    await sleep(300);
    const up = await probe(paths.today);
    if (down.cardCount !== 1 || up.cardCount !== 1) throw new Error("card unmounted during j/k");
    const away = await placeCursor("GTD-ANCHOR", paths.today);
    await sleep(300);
    const hidden = await probe(paths.today);
    if ((hidden.title.h1Shown || []).length) throw new Error("moving off the range left the H1 visible");
    return { atTop: atTop.cursor, down: down.cursor, up: up.cursor, away, hidden: hidden.title };
  });

  await attempt("vim-search-into-hidden-title", async () => {
    await open(paths.today, "live");
    const initial = await waitCard(paths.today, (value) => value?.cardCount === 1 && (value.title.h1Shown || []).length === 0);
    await focusEditor(paths.today);
    await keys(["Escape", "g", "g"]);
    await sleep(200);
    await key("/");
    await sleep(150);
    await typeText(plan.today + " " + lib.dayCardTitle(plan.today).slice(0, 3));
    await key("Enter");
    await sleep(450);
    const revealed = await waitFor(client, lib.probeSource(paths.today),
      (value) => value?.cardCount === 1 && (value.title.h1Shown || []).length >= 1, "search revealed the hidden H1", 10_000);
    await shot("title-block-vim-search-reveal", "Live Preview");
    await keys(["Escape"]);
    const away = await placeCursor("GTD-ANCHOR", paths.today);
    await sleep(350);
    const hidden = await waitFor(client, lib.probeSource(paths.today),
      (value) => value?.cardCount === 1 && (value.title.h1Shown || []).length === 0, "H1 hidden again after leaving search", 10_000);
    return {
      initial: initial.title, revealed: revealed.title, revealedCursor: revealed.cursor, away, hidden: hidden.title,
      cardMounted: revealed.cardCount === 1 && hidden.cardCount === 1,
    };
  });

  const outlineJump = async (mode) => {
    await open(paths.album, mode);
    await waitCard(paths.album, (value) => value?.cardCount === 1);
    await ev(`(() => { app.workspace.rightSplit?.expand?.(); return true; })()`);
    const opened = await ev(`(async () => {
      const ran = app.commands.executeCommandById("outline:open");
      await new Promise((resolve) => setTimeout(resolve, 400));
      const leaf = app.workspace.getLeavesOfType("outline")[0];
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      const items = Array.from(document.querySelectorAll('.workspace-leaf-content[data-type="outline"] .tree-item-self'))
        .map((node) => ({ text: (node.textContent || "").trim(), width: node.getBoundingClientRect().width }));
      return { ran, count: items.length, items: items.slice(0, 12) };
    })()`);
    const target = (opened.items || []).find((item) => /Source heading/i.test(item.text));
    if (!target) throw new Error("Outline has no Source heading: " + JSON.stringify(opened));
    const box = await ev(`(() => {
      const node = Array.from(document.querySelectorAll('.workspace-leaf-content[data-type="outline"] .tree-item-self'))
        .find((item) => /Source heading/i.test(item.textContent || ""));
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
    })()`);
    if (!box || !(box.width > 0)) throw new Error("Outline row not clickable");
    await ctx.clickAt(box.x, box.y);
    await sleep(700);
    const after = await probe(paths.album);
    const heading = after.headings?.source;
    if (!heading?.found || !heading.inViewport) throw new Error("Outline did not land on Source heading: " + JSON.stringify({ opened, heading, path: after.path }));
    await ev(`(() => { app.workspace.rightSplit?.collapse?.(); return true; })()`);
    return { opened, heading, card: after.card?.title, mode: after.mode };
  };
  await attempt("outline-jump-live", () => outlineJump("live"));
  await attempt("outline-jump-reading", () => outlineJump("reading"));
  await shot("title-block-outline-reading", "Reading");

  const headingLink = async (mode) => {
    await open(paths.links, mode);
    await sleep(500);
    const click = await clickWikilink(paths.links, "eat#Source heading");
    const landed = await waitFor(client, `(() => ({ path: app.workspace.activeLeaf?.view?.file?.path || null }))()`,
      (value) => value?.path === paths.album, "heading link opens eat.md", 15_000);
    await sleep(500);
    const after = await probe(paths.album);
    const heading = after.headings?.source;
    if (!heading?.found || !heading.inViewport) throw new Error("heading link did not scroll to Source heading: " + JSON.stringify({ click, landed, heading }));
    return { click, landed, heading, card: after.card?.title };
  };
  await attempt("heading-link-live", () => headingLink("live"));
  await attempt("heading-link-reading", () => headingLink("reading"));

  const originalToday = notes[paths.today];
  await attempt("edit-revealed-h1-stays-visible", async () => {
    await open(paths.today, "live");
    await waitCard(paths.today, (value) => value?.cardCount === 1);
    await focusEditor(paths.today);
    await keys(["Escape", "g", "g"]);
    await sleep(200);
    await key("/");
    await sleep(150);
    await typeText(plan.today + " " + lib.dayCardTitle(plan.today).slice(0, 3));
    await key("Enter");
    await sleep(400);
    await waitFor(client, lib.probeSource(paths.today),
      (value) => (value.title.h1Shown || []).length >= 1, "H1 revealed for edit", 10_000);
    await keys(["Escape", "A"]);
    await typeText(" authored");
    await keys(["Escape"]);
    await sleep(500);
    const edited = await probe(paths.today);
    const visible = (edited.title.h1Shown || []).join(" ");
    if (!/authored/i.test(visible)) throw new Error("edited H1 is not visible: " + JSON.stringify(edited.title));
    if (edited.cardCount !== 1) throw new Error("card unmounted during the edit");
    await shot("title-block-edited-h1", "Live Preview");
    ctx.editedToday = true;
    return { visible, cursor: edited.cursor, card: edited.card?.title };
  });

  await attempt("edit-undo-restores-bytes", async () => {
    if (!ctx.editedToday) throw new Error("the reveal-and-edit step did not run");
    await focusEditor(paths.today);
    await keys(["Escape", "u"]);
    const deadline = Date.now() + 12_000;
    let disk = "";
    while (Date.now() < deadline) {
      disk = fs.readFileSync(path.join(vaultDir, paths.today), "utf8");
      if (disk === originalToday) break;
      await sleep(200);
    }
    if (disk !== originalToday) {
      throw new Error("native undo did not restore exact original bytes");
    }
    const after = await probe(paths.today);
    return { bytes: lib.sha256Text(disk), card: after.card?.title, h1Shown: after.title.h1Shown };
  });

  await attempt("passive-bytes-neutral", async () => {
    const before = hashFixtures(vaultDir, Object.keys(notes).sort());
    const walk = [
      paths.album, paths.h1less, paths.authored, paths.record, paths.today, paths.empty,
      paths.legacy2024, paths.legacy2025, paths.legacy2026, paths.week, paths.quarter, paths.year,
    ];
    for (const notePath of walk) {
      for (const mode of ["live", "reading"]) {
        await open(notePath, mode);
        await waitCard(notePath).catch(() => null);
      }
    }
    await open(paths.today, "live");
    await waitCard(paths.today, (value) => value?.cardCount === 1);
    await focusEditor(paths.today);
    await keys(["Escape", "g", "g", "j", "k"]);
    await placeCursor("GTD-ANCHOR", paths.today);
    await open(paths.ordinary, "live");
    await sleep(400);
    const after = hashFixtures(vaultDir, Object.keys(notes).sort());
    const changed = Object.keys(before).filter((name) => before[name] !== after[name]);
    if (changed.length) throw new Error("fixture bytes changed: " + changed.join(", "));
    return { files: Object.keys(after).length };
  });
}

async function run(args) {
  const report = {
    pass: false, phase: lib.PHASE, startedAt: new Date().toISOString(), assertions: [], screenshots: [],
    consoleExceptions: [], consoleErrors: [], prerequisites: [], probes: {},
    pluginSource: pluginProvenance(),
    covers: ["ownership", "scope", "vim-reveal", "outline", "heading-link", "edit-undo", "byte-neutrality"],
  };
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), "bob-title-block-e2e-shots-" + crypto.randomBytes(4).toString("hex")));
  const reportPath = path.resolve(args.report || path.join(outDir, "title-block-report.json"));
  Object.assign(report, { reportPath, screenshotDirectory: outDir });
  let scratch = "";
  let child = null;
  let client = null;
  const check = (name, ok, detail = {}, mandatory = true) => {
    report.assertions.push({
      name, status: ok ? "pass" : "fail", mandatory,
      detail: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 8000),
    });
    return ok;
  };
  const attempt = async (name, fn) => {
    try {
      const detail = await fn();
      check(name, true, detail === undefined ? {} : detail);
    } catch (error) {
      check(name, false, { error: String(error && error.stack || error).slice(0, 3000) });
    }
  };

  try {
    fs.mkdirSync(outDir, { recursive: true });
    const executable = findExecutable(args.executable);
    report.executable = executable;
    fs.accessSync(executable, fs.constants.X_OK);
    const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 20_000 });
    if (/unable to find Obsidian/i.test(String(help.stdout || "") + String(help.stderr || ""))) {
      throw new Error("This is the Obsidian CLI shim, not the Electron application: " + executable);
    }
    report.prerequisites.push({ name: "Obsidian-Electron-and-Xvfb-host", status: "pass", detail: { executable, display: process.env.DISPLAY || "" } });

    const today = lib.localToday();
    const { plan, notes } = lib.fixturePlan(today);
    report.testClock = { today, bobNow: today + " 12:00:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    scratch = fs.mkdtempSync(path.join("/tmp", "bob-tbe-"));
    const vaultDir = path.join(scratch, "vault");
    const profileDir = path.join(scratch, "profile");
    const shimDir = path.join(profileDir, "shim");
    const bobLog = path.join(profileDir, "bob-invocations.jsonl");
    fs.mkdirSync(vaultDir, { recursive: true });
    for (const [name, content] of Object.entries(notes)) shared.writeNote(vaultDir, name, content);
    installVault(vaultDir);
    writeBobRefusal(shimDir, bobLog);
    shared.initScratchGit(vaultDir);
    const vaultReal = fs.realpathSync(vaultDir);
    shared.seedProfile(profileDir, vaultReal);
    const names = Object.keys(notes).sort();
    report.fixtures = { names, expected: Object.fromEntries(names.map((name) => [name, lib.sha256Text(notes[name])])), seeded: hashFixtures(vaultReal, names) };
    report.scratch = { root: scratch, vault: vaultReal, profile: profileDir, plan };

    const port = await shared.freePort();
    child = spawn(executable, [
      "--no-sandbox", "--user-data-dir=" + profileDir, "--remote-debugging-port=" + port,
      "--remote-allow-origins=http://127.0.0.1/*", vaultReal,
    ], {
      cwd: os.tmpdir(), stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env, HOME: profileDir, BOB_DIR: vaultReal, BOB_NOW: today + " 12:00:00",
        PATH: shimDir + path.delimiter + (process.env.PATH || ""), TMPDIR: "/tmp", NO_COLOR: "1",
      },
    });
    child.stderr.on("data", () => {});
    report.obsidianProcess = { pid: child.pid, executable, debugPort: port };
    const target = await shared.selectTarget(port, vaultReal, () => child && child.exitCode == null);
    client = target.client;
    client.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      report.consoleExceptions.push({ text: details.text || "", description: details.exception?.description || "", url: details.url || "", lineNumber: details.lineNumber || null });
    });
    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") report.consoleErrors.push((params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 1500));
    });
    client.on("Log.entryAdded", (params) => {
      if (params.entry?.level === "error") report.consoleExceptions.push({ text: params.entry.text || "", url: params.entry.url || "", source: "log" });
    });
    await client.call("Runtime.enable");
    await client.call("Log.enable");
    try { await client.call("Page.enable"); } catch (_) {}
    report.pluginStartup = { trustAction: await shared.trustCommunityPlugins(client) };
    await waitFor(client, "Boolean(app.plugins.plugins['bob-ledger-tools']) && app.workspace.layoutReady", Boolean, "bob-ledger-tools startup", 45_000);
    report.app = await client.evaluate("({ version: (/obsidian\\/([\\d.]+)/i.exec(navigator.userAgent) || [])[1] || '', enabled: Array.from(app.plugins.enabledPlugins || []), manifest: app.plugins.manifests['bob-ledger-tools']?.version || null })");
    check("plugins-loaded", report.app.enabled.includes(PLUGIN_ID) && report.app.manifest === report.pluginSource.version, report.app);
    const pluginToday = await client.evaluate("app.plugins.plugins['bob-ledger-tools'].intentionCardToday()");
    report.testClock.pluginToday = pluginToday;
    check("test-clock-agrees", pluginToday === today, report.testClock);
    report.albumReport = await client.evaluate(`(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const helpers = plugin?.constructor?.helpers;
      if (!helpers?.albumIndexReport) return { ok: false, error: "albumIndexReport missing" };
      const report = helpers.albumIndexReport(${JSON.stringify(lib.albumListReport())});
      plugin.albumReportState = () => ({ report, stale: false, reportGeneration: 1 });
      plugin.scheduleRecordSheetRefresh?.();
      return { ok: true, albums: Array.isArray(report.albums) ? report.albums.length : 0 };
    })()`);
    await sleep(400);
    await shared.collapseSidebars(client);
    await shared.setViewport(client, 1400, 1000);
    await shared.setTheme(client, "light");

    const helpers = makeHelpers({ client, report, outDir });
    const ctx = { client, report, notes, plan, vaultDir: vaultReal, outDir, check, attempt, ...helpers };
    await walkthrough(ctx);

    check("screenshots-captured", report.screenshots.length >= 8, { count: report.screenshots.length });
    check("no-console-exceptions", report.consoleExceptions.length === 0, report.consoleExceptions);
    const invocations = fs.existsSync(bobLog) ? fs.readFileSync(bobLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    report.bobInvocations = { count: invocations.length, refused: true, args: invocations.map((row) => row.args) };
    report.fixtures.final = hashFixtures(vaultReal, names);
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
    report.prerequisites.push({ name: "runner", status: "fail", detail: String(error && error.message || error) });
    if (client) {
      try { report.screenshots.push(await capture(client, outDir, "title-block-runner-failure", 1400, "light", "failure state")); }
      catch (_) {}
    }
  } finally {
    for (const name of lib.REQUIRED_CHECKS) {
      if (!report.assertions.some((row) => row.name === name)) check(name, false, "Required check was not executed");
    }
    report.inventory = lib.inventoryStatus(report.assertions);
    report.pass = report.inventory.ok && report.prerequisites.every((row) => row.status === "pass");
    if (client) client.close();
    if (child && child.exitCode == null) {
      try { child.kill("SIGTERM"); } catch (_) {}
      await sleep(400);
      if (child.exitCode == null) { try { child.kill("SIGKILL"); } catch (_) {} }
    }
    report.finishedAt = new Date().toISOString();
    report.scratchPreserved = Boolean(scratch && !report.pass && fs.existsSync(scratch));
    if (report.pass && scratch) fs.rmSync(scratch, { recursive: true, force: true });
    report.assertionCounts = report.assertions.reduce((counts, item) => { counts[item.status] = (counts[item.status] || 0) + 1; return counts; }, {});
    report.failedChecks = report.assertions.filter((row) => row.status === "fail").map((row) => row.name);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write((report.pass ? "PASS" : "FAIL") + " title-block walkthrough (" + JSON.stringify(report.assertionCounts) + ")\n");
  process.stdout.write("Phase: " + lib.PHASE + "\nReport: " + reportPath + "\nScreenshots: " + outDir + "\n");
  if (!report.pass) {
    for (const row of report.assertions.filter((item) => item.status === "fail")) {
      process.stderr.write("- " + row.name + ": " + String(row.detail).slice(0, 1500) + "\n");
    }
    process.exitCode = 1;
  }
}

async function main(argv) {
  let args;
  try { args = lib.parseArgs(argv); }
  catch (error) {
    process.stderr.write(String(error.message || error) + "\n" + lib.HELP_TEXT + "\n");
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write(lib.HELP_TEXT + "\n");
    return;
  }
  if (args.selfTest) {
    try {
      lib.selfTest();
      new Function("return " + lib.probeSource("eat.md"));
      process.stdout.write("offline self-test complete (title-block fixtures, inventory, probes; no Obsidian or bob launched)\n");
    } catch (error) {
      process.stderr.write(String(error.stack || error) + "\n");
      process.exitCode = 1;
    }
    return;
  }
  await run(args);
}

if (require.main === module) void main(process.argv.slice(2));
module.exports = { REQUIRED_CHECKS: lib.REQUIRED_CHECKS, PHASE: lib.PHASE, findExecutable, pluginProvenance, installVault };
