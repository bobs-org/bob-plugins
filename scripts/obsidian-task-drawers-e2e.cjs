#!/usr/bin/env node
// Real-Obsidian CDP verification of true-case task drawers (typing, Toggle
// Drawer, conversion, Live Preview / reading trays) in an owned scratch
// vault/profile. Never opens the live vault.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const base = require("./obsidian-task-reqs-e2e.cjs");
const look = require("./obsidian-task-drawers-look-e2e.cjs");
const conversion = require("./obsidian-task-drawers-conversion-e2e.cjs");

const GROUPS = ["typing", "vim", "toggle", "req", "conversion", "look"];
const HELP = [
  "Usage: node scripts/obsidian-task-drawers-e2e.cjs [OPTIONS]",
  "",
  "Verify task-drawer typing, Toggle Drawer, conversion, and trays in an",
  "isolated real Obsidian vault through CDP. Never opens the live vault.",
  "",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -h, --help              Print help",
  "      --only NAME         Run only a named group (" + GROUPS.join(", ") + ")",
  "  -r, --report PATH       Write the structured JSON report",
  "  -s, --self-test         Run offline self-tests",
].join("\n");

const TASK = "- [ ] #task Upgrade Postgres";
const EMPTY = `${TASK}\n  - `;
const EMPTY_CARET = [1, "  - ".length];
const STARS = `${TASK}\n  - ****`;
const STARS_CARET = [1, "  - **".length];
const HEADER = `${TASK}\n  - **API Design**`;
const HEADER_END = [1, "  - **API Design".length];
const CTRL = base.CTRL;

const TYPING_CASES = [];
for (const autopair of [true, false]) {
  const tag = autopair ? "autopair on" : "autopair off";
  TYPING_CASES.push(
    {
      name: `expand ${tag}`,
      autopair,
      doc: EMPTY,
      caret: EMPTY_CARET,
      keys: ["*"],
      expect: { doc: STARS, caret: STARS_CARET },
    },
    {
      name: `one Undo returns the literal star ${tag}`,
      autopair,
      doc: EMPTY,
      caret: EMPTY_CARET,
      keys: ["*"],
      expect: { doc: STARS, caret: STARS_CARET },
      thenUndo: `${TASK}\n  - *`,
    },
    {
      name: `overtype closing stars ${tag}`,
      autopair,
      doc: HEADER,
      caret: HEADER_END,
      keys: ["*"],
      expect: { doc: HEADER, caret: [1, HEADER.split("\n")[1].length] },
    },
    {
      name: `atomic Backspace ${tag}`,
      autopair,
      doc: STARS,
      caret: STARS_CARET,
      keys: ["Backspace"],
      expect: { doc: EMPTY, caret: EMPTY_CARET },
    },
    {
      name: `smart Enter nested note ${tag}`,
      autopair,
      doc: HEADER,
      caret: HEADER_END,
      keys: ["Enter"],
      expect: { doc: `${HEADER}\n    - `, caret: [2, "    - ".length] },
    },
    {
      name: `no expansion in a fence ${tag}`,
      autopair,
      doc: "```\n  - \n```",
      caret: [1, 4],
      keys: ["*"],
      expect: { doc: autopair ? "```\n  - **\n```" : "```\n  - *\n```" },
    },
  );
}
TYPING_CASES.push(
  {
    name: "ordinary italic outside the position autopair on",
    autopair: true,
    doc: "hello ",
    caret: [0, 6],
    keys: ["*"],
    expect: { doc: "hello **", caret: [0, 7] },
  },
  {
    name: "ordinary italic outside the position autopair off",
    autopair: false,
    doc: "hello ",
    caret: [0, 6],
    keys: ["*"],
    expect: { doc: "hello *", caret: [0, 7] },
  },
  {
    name: "non-eligible nested bullet stays a note",
    autopair: true,
    doc: `${TASK}\n  - note\n    - `,
    caret: [2, 6],
    keys: ["*"],
    expect: { doc: `${TASK}\n  - note\n    - **` },
  },
);

const VIM_CASES = [
  {
    name: "vim insert expansion",
    autopair: true,
    vim: true,
    doc: EMPTY,
    caret: EMPTY_CARET,
    keys: ["Escape", "A", "*"],
    expect: { doc: STARS, caret: STARS_CARET },
  },
  {
    name: "vim insert expansion autopair off",
    autopair: false,
    vim: true,
    doc: EMPTY,
    caret: EMPTY_CARET,
    keys: ["Escape", "A", "*"],
    expect: { doc: STARS, caret: STARS_CARET },
  },
  {
    name: "vim insert one Undo returns the literal star",
    autopair: true,
    vim: true,
    doc: EMPTY,
    caret: EMPTY_CARET,
    keys: ["Escape", "A", "*"],
    expect: { doc: STARS },
    thenUndo: `${TASK}\n  - *`,
  },
];

const TOGGLE_CASES = [
  {
    name: "Toggle Drawer wraps a plain title",
    doc: `${TASK}\n  - API Design\n    - nested stays`,
    caret: [1, 5],
    viaCommand: "task-status-cycler:toggle-task-drawer",
    expect: { doc: `${TASK}\n  - **API Design**\n    - nested stays` },
  },
  {
    name: "Toggle Drawer unwraps a bold header",
    doc: `${TASK}\n  - **API Design**\n    - nested stays`,
    caret: [1, 8],
    viaCommand: "task-status-cycler:toggle-task-drawer",
    expect: { doc: `${TASK}\n  - API Design\n    - nested stays` },
  },
  {
    name: "Toggle Drawer wraps uppercase plain content as a drawer",
    doc: `${TASK}\n  - NOTES\n    - filed`,
    caret: [1, 4],
    viaCommand: "task-status-cycler:toggle-task-drawer",
    expect: { doc: `${TASK}\n  - **NOTES**\n    - filed` },
  },
  {
    name: "Toggle Drawer refuses a reserved title",
    doc: `${TASK}\n  - TASKS`,
    caret: [1, 4],
    viaCommand: "task-status-cycler:toggle-task-drawer",
    expect: { doc: `${TASK}\n  - TASKS`, notice: "reserved" },
  },
  {
    name: "Toggle Drawer refuses a checkbox",
    doc: `${TASK}\n  - [ ] req`,
    caret: [1, 8],
    viaCommand: "task-status-cycler:toggle-task-drawer",
    expect: { doc: `${TASK}\n  - [ ] req`, notice: "plain bullet" },
  },
  {
    name: "Toggle Drawer refuses a deeper position",
    doc: `${TASK}\n  - note\n    - deep`,
    caret: [2, 8],
    viaCommand: "task-status-cycler:toggle-task-drawer",
    expect: { doc: `${TASK}\n  - note\n    - deep`, notice: "direct child" },
  },
];

const REQ_CASES = [
  {
    name: "requirement expansion is unchanged",
    autopair: true,
    doc: `${TASK}\n  - `,
    caret: EMPTY_CARET,
    keys: ["[", " "],
    expect: { doc: `${TASK}\n  - [ ] `, caret: [1, "  - [ ] ".length] },
  },
];

async function runTypingCase(client, entry) {
  await client.evaluate(
    `(()=>{const v=window.app.vault;v.setConfig("autoPairMarkdown",${JSON.stringify(entry.autopair !== false)});`
      + `if(window.app.workspace.updateOptions)window.app.workspace.updateOptions();return true;})()`,
  );
  return base.runCase(client, entry);
}

function selfTest() {
  const parsed = base.parseArgs(["--self-test", "--only", "typing", "--report", "/tmp/drawers.json"]);
  if (!parsed.selfTest || parsed.only !== "typing") throw new Error("argument parsing failed");
  const names = new Set();
  for (const entry of TYPING_CASES.concat(VIM_CASES, TOGGLE_CASES, REQ_CASES, conversion.CASES, look.CASES)) {
    if (names.has(entry.name)) throw new Error("duplicate case name: " + entry.name);
    names.add(entry.name);
  }
  for (const entry of TYPING_CASES.concat(VIM_CASES, REQ_CASES)) {
    if (!entry.keys.length || !entry.expect || typeof entry.expect.doc !== "string") {
      throw new Error("malformed case: " + entry.name);
    }
    for (const input of entry.keys) {
      const payload = base.keyPayload(input);
      if (!payload.key || payload.windowsVirtualKeyCode === undefined) throw new Error("bad key in " + entry.name);
    }
  }
  const star = base.keyPayload("*");
  if (star.text !== "*" || star.windowsVirtualKeyCode !== 42) throw new Error("star payload changed");
  if (!TYPING_CASES.some((entry) => entry.name.includes("autopair on"))) throw new Error("missing autopair on");
  if (!TYPING_CASES.some((entry) => entry.name.includes("autopair off"))) throw new Error("missing autopair off");
  if (!TYPING_CASES.some((entry) => entry.thenUndo)) throw new Error("missing Undo case");
  if (!TOGGLE_CASES.some((entry) => entry.expect.notice)) throw new Error("missing Toggle Drawer refusal");
  if (!look.SOURCE.includes("**API Design**") || !look.SOURCE.includes("**Café**")) {
    throw new Error("look fixture missing drawer titles");
  }
  if (!conversion.AREA.includes("**Q1: Goals**") || !conversion.PROJECT.includes("## Café")) {
    throw new Error("conversion fixtures missing verbatim titles");
  }
  const source = fs.readFileSync(__filename, "utf8");
  for (const token of [
    "Input.dispatchKeyEvent",
    "autoPairMarkdown",
    "thenUndo",
    "vimMode",
    "toggle-task-drawer",
    "create-project-note-from-task",
    "Page.captureScreenshot",
    "XDG_CONFIG_HOME",
  ]) {
    if (!source.includes(token) && token !== "Page.captureScreenshot") {
      throw new Error("e2e is missing " + token);
    }
  }
  if (!fs.readFileSync(path.join(__dirname, "obsidian-task-drawers-look-e2e.cjs"), "utf8").includes("Page.captureScreenshot")) {
    throw new Error("look e2e is missing Page.captureScreenshot");
  }
  console.log("offline self-test complete (not an Obsidian pass)");
}

async function main() {
  const args = base.parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.selfTest) {
    selfTest();
    return;
  }
  if (args.only && !GROUPS.includes(args.only)) {
    throw new Error("--only must be one of " + GROUPS.join(", "));
  }
  await base.runE2e(args, {
    defaultGroups: GROUPS,
    groups: {
      typing: { cases: TYPING_CASES, run: runTypingCase },
      vim: { cases: VIM_CASES, run: runTypingCase },
      toggle: { cases: TOGGLE_CASES, run: (client, entry) => base.runGestureCase(client, entry) },
      req: { cases: REQ_CASES, run: runTypingCase },
      conversion: {
        cases: conversion.CASES,
        run: (client, entry) => conversion.run(client, entry, { waitFor: base.waitFor, setDoc: base.setDoc }),
      },
      look: {
        cases: look.CASES,
        run: (client, entry) => look.run(client, entry, {
          setDoc: base.setDoc, setMode: base.setMode, waitFor: base.waitFor, args,
        }),
      },
    },
  });
}

module.exports = {
  GROUPS,
  TYPING_CASES,
  VIM_CASES,
  TOGGLE_CASES,
  REQ_CASES,
  selfTest,
};

if (require.main === module) {
  main().catch((error) => {
    console.error((error && error.stack) || error);
    process.exitCode = error && error.exitCode ? error.exitCode : 1;
  });
}
