#!/usr/bin/env node
// Offline fixture and probe helpers for the real-Obsidian property-card foot proof.
// Nothing here launches Obsidian or bob.
"use strict";

const assert = require("node:assert/strict");

const FIXTURE_TODAY = "2026-11-20";

const HELP_TEXT = [
  "Usage: node scripts/obsidian-card-foot-e2e.cjs [OPTIONS]",
  "",
  "Prove the shared property-card foot and drawer in an isolated Obsidian vault.",
  "The default full scope requires feet, drawers, entry points, and no-write/no-spawn checks.",
  "Run the real walkthrough under xvfb-run -a on Linux.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY    Save PNG screenshots here",
  "  -r, --report PATH      Write the structured JSON report here",
  "      --scope SCOPE      full (default) or foot (rendering only)",
  "  -s, --self-test        Validate fixtures and probes without launching apps",
  "  -h, --help             Print this help",
].join("\n");

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, scope: "full", selfTest: false, help: false };
  const input = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < input.length; i += 1) {
    const value = input[i];
    if (value === "-e" || value === "--executable") {
      const next = input[++i];
      if (!next || next.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = next;
    } else if (value === "-o" || value === "--out") {
      const next = input[++i];
      if (!next || next.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = next;
    } else if (value === "-r" || value === "--report") {
      const next = input[++i];
      if (!next || next.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = next;
    } else if (value === "--scope") {
      args.scope = input[++i];
      if (!["full", "foot"].includes(args.scope)) throw new Error("--scope requires full or foot");
    } else if (value === "-s" || value === "--self-test") {
      args.selfTest = true;
    } else if (value === "-h" || value === "--help") {
      args.help = true;
    } else {
      throw new Error("Unknown argument: " + value);
    }
  }
  return args;
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

// ---- Fixtures ----

function albumNote() {
  return [
    "---",
    'type: "[[album]]"',
    'parent: "[[body]]"',
    'emoji: "🍽️"',
    "summary: Foot album fixtures.",
    "record:",
    "  noun: restaurant",
    "  fields:",
    "    status: {required: true, values: {to_try: To try, liked: Liked}}",
    "    location: {required: true, suggest: true}",
    "created: 2026-06-11T07:30:00-04:00",
    "tags:",
    '  - "eat"',
    "---",
    "",
    "# Restaurants",
    "",
    "Album body sentinel.",
    "",
  ].join("\n");
}

function recordNote() {
  return [
    "---",
    'type: "[[record]]"',
    'parent: "[[eat]]"',
    'title: "Corner Bistro"',
    "status: to_try",
    'location: "Downtown"',
    "created: 2026-11-15T09:12:00-05:00",
    "tags:",
    '  - "eat"',
    "---",
    "",
    "Record body sentinel with a value link [[eat|Eat]] and a tag #eat.",
    "",
  ].join("\n");
}

function dayNote() {
  return [
    "---",
    'parent: "[[2026/2026-W47]]"',
    'type: "[[day]]"',
    "date: 2026-11-20",
    "id: 20261120",
    "mood: steady",
    "intentions:",
    '  - "Ship the foot"',
    '  - "Walk after lunch"',
    "summary: Foot day summary.",
    "created: 2026-11-20T07:55:00-05:00",
    "tags:",
    "  - daily",
    "---",
    "",
    "# 2026-11-20 Fri",
    "",
    "[[2026/20261119|prev]] · [[2026/2026-W47|W47]] · [[2026/20261121|next]]",
    "",
    "- [ ] #task [[gtd_daily]] GTD-ANCHOR-2026-11-20 [root:: gtd] ^gtd",
    "",
    "## Notes",
    "",
    "- Body sentinel for the foot day.",
    "",
  ].join("\n");
}

function weekNote() {
  return [
    "---",
    'parent: "[[2026/2026-Q4]]"',
    'type: "[[day]]"',
    "id: 2026-W47",
    "date: 2026-11-16",
    "end: 2026-11-22",
    "aliases:",
    '  - "2026-W47 · Nov 16 – 22"',
    "intentions:",
    '  - "Land the foot epic"',
    "created: 2026-11-16",
    "tags:",
    "  - weekly",
    "---",
    "",
    "# 2026-W47 · Nov 16 – 22",
    "",
    "Week body sentinel.",
    "",
  ].join("\n");
}

function quarterNote() {
  return [
    "---",
    'parent: "[[2026]]"',
    'type: "[[day]]"',
    "id: 2026-Q4",
    "intentions:",
    '  - "Make reflection a habit"',
    "created: 2026-10-01",
    "tags:",
    "  - quarterly",
    "---",
    "",
    "# 2026-Q4",
    "",
    "Quarter body sentinel.",
    "",
  ].join("\n");
}

function yearNote() {
  return [
    "---",
    'parent: "[[index]]"',
    'type: "[[day]]"',
    "id: 2026",
    "created: 2026-01-01",
    "tags:",
    "  - yearly",
    "---",
    "",
    "# 2026",
    "",
    "Year body sentinel.",
    "",
  ].join("\n");
}

function bankNote() {
  return [
    "---",
    'type: "[[area]]"',
    'parent: "[[cash]]"',
    "bank:",
    "  accounts:",
    "    checking:",
    "      kind: checking",
    "      start: 2026-11-01",
    "created: 2026-01-02",
    "---",
    "",
    "# Bank",
    "",
    "Bank body sentinel.",
    "",
  ].join("\n");
}

function fixtureNotes() {
  return {
    "type.md": "# Type\n",
    "index.md": '---\ntype: "[[area]]"\nparent: "[[type]]"\n---\n\n# Home\n\n## Albums\n',
    "body.md": '---\ntype: "[[area]]"\nparent: "[[index]]"\n---\n\n# Body\n\n## Albums\n',
    "cash.md": '---\ntype: "[[area]]"\nparent: "[[index]]"\n---\n\n# Cash\n',
    "eat.md": albumNote(),
    "eat/corner-bistro.md": recordNote(),
    "2026/20261120.md": dayNote(),
    "2026/2026-W47.md": weekNote(),
    "2026/2026-Q4.md": quarterNote(),
    "2026.md": yearNote(),
    "bank.md": bankNote(),
    // Identity-only temporal note: type + parent + date only, no created.
    "2026/20261121.md": [
      "---",
      'parent: "[[2026/2026-W47]]"',
      'type: "[[day]]"',
      "date: 2026-11-21",
      "id: 20261121",
      "tags:",
      "  - daily",
      "---",
      "",
      "# 2026-11-21 Sat",
      "",
      "Identity-only day sentinel.",
      "",
    ].join("\n"),
    // Album with no created (faint missing state).
    "snacks.md": [
      "---",
      'type: "[[album]]"',
      'parent: "[[body]]"',
      "summary: Snacks without a stamp.",
      "record:",
      "  noun: snack",
      "  fields:",
      "    status: {required: true, values: {open: Open, done: Done}}",
      "---",
      "",
      "# Snacks",
      "",
      "Missing-created album sentinel.",
      "",
    ].join("\n"),
    // Duplicate top-level keys: two status rows must both render.
    "dup.md": [
      "---",
      'type: "[[album]]"',
      'parent: "[[body]]"',
      "summary: Duplicate fixture.",
      "status: to_try",
      "mood: steady",
      "status: liked",
      "created: 2026-06-11",
      "record:",
      "  noun: dup",
      "  fields:",
      "    status: {}",
      "---",
      "",
      "# Duplicates",
      "",
      "Duplicate-key sentinel.",
      "",
    ].join("\n"),
    // Invalid YAML: recovery line, no value rows.
    "invalid.md": [
      "---",
      'type: "[[album]]"',
      'parent: "[[body]]',
      "summary: [unclosed",
      "created: 2026-06-11",
      "---",
      "",
      "# Invalid",
      "",
      "Invalid-YAML sentinel.",
      "",
    ].join("\n"),
    // Unclosed fence: recovery line as well.
    "unclosed.md": [
      "---",
      'type: "[[album]]"',
      'parent: "[[body]]"',
      "summary: Unclosed fence fixture.",
      "created: not-a-date",
      "",
      "# Unclosed",
      "",
      "Unclosed-fence sentinel.",
      "",
    ].join("\n"),
    "ordinary.md": '---\ntype: "[[note]]"\n---\n\n# Ordinary\n\nNothing to see.\n',
  };
}

// ---- CDP probe: foot state for one note path ----

function probeFootSource(notePath) {
  const quoted = JSON.stringify(notePath);
  return `(() => {
    const path = ${quoted};
    const plugin = window.app?.plugins?.plugins?.["bob-ledger-tools"];
    const leaves = (window.app?.workspace?.getLeavesOfType?.("markdown") || []).filter((item) => item.view?.file?.path === path);
    const leaf = leaves[0] || null;
    const view = leaf?.view || null;
    const container = view?.containerEl || view?.contentEl || null;
    const mode = (() => { try { return view?.getMode?.() || null; } catch (_) { return null; } })();
    const surface = (() => {
      try {
        if (!view) return null;
        if (mode === "preview") return view.previewMode?.containerEl || container;
        return view.sourceMode?.containerEl || container;
      } catch (_) { return container; }
    })();
    const inSurface = (node) => {
      try { return Boolean(surface && node && surface.contains(node)); } catch (_) { return false; }
    };
    const feet = Array.from(document.querySelectorAll(".bob-property-card-foot")).filter(inSurface);
    const foot = feet.find((node) => {
      try {
        const scope = node.closest(".markdown-preview-view, .markdown-source-view, .workspace-leaf-content");
        return Boolean(!surface || (scope && surface.contains(scope)) || surface.contains(node));
      } catch (_) { return true; }
    }) || feet[0] || null;
    const disclosure = foot?.querySelector?.(".bob-property-card-foot-disclosure") || null;
    const drawer = foot?.querySelector?.(".bob-property-card-foot-drawer") || null;
    const rows = Array.from(foot?.querySelectorAll?.("[data-property-key]") || []).map((row) => ({
      key: row.getAttribute("data-property-key"),
      occurrence: row.getAttribute("data-occurrence"),
      line: row.getAttribute("data-line"),
      text: (row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200),
    }));
    const nested = Array.from(foot?.querySelectorAll?.("[data-nested-opener], [data-schema-opener], [data-setup-opener]") || []).map((el) => ({
      tag: String(el.tagName || "").toLowerCase(),
      label: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120),
    }));
    const stamp = foot?.querySelector?.(".bob-property-card-foot-stamp") || null;
    const lint = foot?.querySelector?.(".bob-property-card-foot-lint-chip") || null;
    const style = (() => { try { return foot ? getComputedStyle(foot) : null; } catch (_) { return null; } })();
    const rect = (() => { try { return foot?.getBoundingClientRect?.() || null; } catch (_) { return null; } })();
    const disclosureRect = (() => { try { return disclosure?.getBoundingClientRect?.() || null; } catch (_) { return null; } })();
    const file = (() => { try { return window.app?.vault?.getAbstractFileByPath?.(path) || null; } catch (_) { return null; } })();
    const frontmatter = (() => { try { return window.app?.metadataCache?.getFileCache?.(file)?.frontmatter || {}; } catch (_) { return {}; } })();
    const authoredKeys = Object.keys(frontmatter).filter((key) => key !== "position");
    return {
      status: surface ? "pass" : "fail",
      path,
      mode,
      activePath: (() => { try { return window.app?.workspace?.getActiveFile?.()?.path || null; } catch (_) { return null; } })(),
      leafCount: leaves.length,
      foot: foot ? {
        count: feet.length,
        disclosureId: disclosure?.getAttribute?.("id") || null,
        ariaControls: disclosure?.getAttribute?.("aria-controls") || null,
        drawerId: drawer?.getAttribute?.("id") || null,
        ariaExpanded: disclosure?.getAttribute?.("aria-expanded") || null,
        label: (disclosure?.getAttribute?.("aria-label") || "").slice(0, 200),
        title: disclosure?.getAttribute?.("title") || null,
        countText: (disclosure?.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120),
        drawerOpen: drawer?.getAttribute?.("data-open") || null,
        hasBody: Boolean(drawer?.querySelector?.(".bob-property-card-foot-drawer-body")),
        rowCount: rows.length,
        rows,
        nested,
        nestedCount: nested.length,
        stampText: (stamp?.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200),
        stampClass: stamp?.getAttribute?.("class") || null,
        stampTitle: stamp?.getAttribute?.("title") || null,
        lintText: (lint?.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200),
        lintTitle: lint?.getAttribute?.("title") || null,
        footSource: foot?.getAttribute?.("data-foot-source") || null,
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        disclosureRect: disclosureRect ? { x: disclosureRect.x, y: disclosureRect.y, width: disclosureRect.width, height: disclosureRect.height } : null,
        fontSize: style?.fontSize || null,
        visible: (() => { try { return rect && rect.width > 0 && rect.height > 0; } catch (_) { return null; } })(),
      } : null,
      authoredKeys,
      cardKind: foot?.closest?.("[data-card-kind]")?.getAttribute?.("data-card-kind") || null,
      reducedMotion: (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; } })(),
      viewportWidth: window.innerWidth,
      scrollY: window.scrollY,
    };
  })()`;
}

// ---- Keyboard events (CDP Input.dispatchKeyEvent) ----

function keyEvents(key, modifiers = 0) {
  const vk = key === "Enter" ? 13 : key === "Escape" ? 27 : key === "=" ? 187 : key === "-" ? 189 : key === "+" ? 187 : key.toUpperCase().charCodeAt(0);
  const code = key === "Enter" ? "Enter" : key === "Escape" ? "Escape" : key === "=" ? "Equal" : key === "-" ? "Minus" : key === "+" ? "Equal" : key.length === 1 ? "Key" + key.toUpperCase() : key;
  const payload = { key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  const text = modifiers & 7 ? "" : key === "Enter" ? "\r" : key.length === 1 ? key : "";
  return [
    { type: text ? "keyDown" : "rawKeyDown", ...payload, ...(text ? { text, unmodifiedText: text } : {}) },
    { type: "keyUp", ...payload },
  ];
}

function selfTest() {
  const notes = fixtureNotes();
  const required = [
    "eat.md",
    "eat/corner-bistro.md",
    "2026/20261120.md",
    "2026/2026-W47.md",
    "2026/2026-Q4.md",
    "2026.md",
    "bank.md",
    "2026/20261121.md",
    "snacks.md",
    "dup.md",
    "invalid.md",
    "unclosed.md",
    "ordinary.md",
  ];
  for (const name of required) {
    if (!notes[name]) throw new Error("fixture missing " + name);
  }
  if (!notes["eat.md"].includes('type: "[[album]]"')) throw new Error("album fixture lacks canonical type");
  if (!notes["eat/corner-bistro.md"].includes('type: "[[record]]"')) throw new Error("record fixture lacks canonical type");
  if (!notes["2026/20261120.md"].includes('type: "[[day]]"')) throw new Error("day fixture lacks canonical type");
  if (!notes["bank.md"].includes("bank:")) throw new Error("bank fixture lacks bank config");
  if (notes["2026/20261121.md"].includes("created:")) throw new Error("identity-only day must not carry created");
  if (notes["snacks.md"].includes("created:")) throw new Error("missing-created album must not carry created");
  const dupStatuses = notes["dup.md"].split("\n").filter((line) => /^status:/.test(line));
  if (dupStatuses.length !== 2) throw new Error("duplicate fixture must carry two status rows, got " + dupStatuses.length);
  if (!notes["invalid.md"].includes('parent: "[[body]]')) throw new Error("invalid fixture lost its parse break");
  const parsed = parseArgs(["-e", "/opt/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "--self-test"]);
  if (!parsed.selfTest || parsed.executable !== "/opt/obsidian" || parsed.out !== "/tmp/shots" || parsed.report !== "/tmp/report.json") {
    throw new Error("argument parser fixture failed");
  }
  assert.throws(() => parseArgs(["--scope", "sheet"]), /--scope requires full or foot/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--executable"]), /requires a PATH value/);
  const probe = probeFootSource("eat.md");
  if (!probe.includes(".bob-property-card-foot")) throw new Error("foot probe misses the foot selector");
  if (!probe.includes("aria-expanded") || !probe.includes("data-property-key")) throw new Error("foot probe misses drawer semantics");
  // Probe must parse as a JS expression.
  new Function("return (" + probe + ");");
  const [down, up] = keyEvents("Enter");
  assert.equal(down.text, "\r");
  assert.equal(up.type, "keyUp");
  assert.equal(keyEvents("=", 0)[0].code, "Equal");
  assert.equal(keyEvents("-", 0)[0].code, "Minus");
  assert.equal(keyEvents("y")[0].code, "KeyY");
  process.stdout.write("offline self-test complete (foot fixtures, args, probe syntax, keys; no Obsidian or bob launched)\n");
  return true;
}

module.exports = {
  FIXTURE_TODAY,
  HELP_TEXT,
  fixtureNotes,
  keyEvents,
  parseArgs,
  probeFootSource,
  selfTest,
  albumNote,
  recordNote,
  dayNote,
  weekNote,
  quarterNote,
  yearNote,
  bankNote,
};
