#!/usr/bin/env node
// Real-Obsidian acceptance for requirement close-card behavior, reusing the
// isolated scratch vault/profile and CDP connection from task-reqs e2e.
"use strict";

const assert = require("node:assert/strict");
const base = require("./obsidian-task-reqs-e2e.cjs");

const OWNER_DOC = [
  "- [ ] #task Ship exporter",
  "\t- [ ] Parent requirement",
  "\t\t- [ ] Nested requirement",
].join("\n");
const DROP_REASON = "no longer needed";
const REQUIREMENT_GROUP = ".bob-successor-group.is-requirements";
const CARD = ".bob-cnp-successor-modal";
const cases = [
  { name: "idless Ctrl+Enter shows requirements first" },
  { name: "drop writes receipt and guarded Undo keeps owner Done" },
  { name: "carry creates task and carried stub" },
  { name: "nested requirement pin lands then Ctrl+O returns" },
  { name: "Esc writes no requirement bytes" },
  { name: "direct Ctrl+Shift+T carries and Ctrl+O returns" },
];

async function start(client, doc = OWNER_DOC, caret = [0, 0], vim = false) {
  await base.setMode(client, vim, true);
  await base.closeStrayModals(client);
  await base.setDoc(client, doc, caret);
}

async function openCard(client) {
  await base.key(client, { key: "Enter", modifiers: base.CTRL, vk: 13 });
  await base.waitFor(
    client,
    `Boolean(document.querySelector(${JSON.stringify(CARD)}))`,
    Boolean,
    "requirement close card",
    8000,
  );
  const order = await client.evaluate(
    `(() => { const modal = document.querySelector(${JSON.stringify(CARD)}); if (!modal) return null; ` +
      `const groups = Array.from(modal.querySelectorAll(".bob-successor-group")); ` +
      `const markOf = (row) => { const mark = row.querySelector(".bob-req-mark"); ` +
      `return mark ? { state: mark.getAttribute("data-state"), text: mark.textContent } : null; }; ` +
      `return { firstIsRequirements: groups.length > 0 && groups[0].classList.contains("is-requirements"), ` +
      `headingMark: Boolean(modal.querySelector(".bob-successor-req-heading .bob-req-mark")), ` +
      `groups: groups.map((group) => group.className), rows: Array.from(modal.querySelectorAll(".bob-successor-req-row"))` +
      `.map((row) => ({ text: row.textContent, depth: row.getAttribute("data-requirement-depth"), mark: markOf(row) })) }; })()`,
  );
  assert.ok(order && order.firstIsRequirements, "requirements were not the first card group");
  assert.deepEqual(order.rows.map((row) => Number(row.depth)), [1, 2]);
  assert.ok(order.headingMark, "the requirement group heading has no shared diamond mark");
  for (const row of order.rows) {
    assert.equal(row.mark && row.mark.state, "pending", "a fresh requirement row does not wear the pending mark");
    assert.equal(row.mark && row.mark.text, "◇", "a fresh requirement row does not wear the hollow diamond");
  }
  return order;
}

async function submitCard(client) {
  // The picker ignores Enter for its 350 ms open guard, even when a verdict
  // was staged immediately after it opened.
  await new Promise((resolve) => setTimeout(resolve, 400));
  await base.key(client, "Enter");
  await base.waitForGone(client, CARD, "requirement close card");
  await new Promise((resolve) => setTimeout(resolve, 450));
}

async function runIdlessFirst(client) {
  await start(client);
  await openCard(client);
  await base.key(client, "Escape");
  await base.waitForGone(client, CARD, "requirement close card after Esc");
}

async function runDropUndo(client) {
  await start(client);
  await openCard(client);
  await base.key(client, { key: "x", modifiers: base.CTRL | base.SHIFT, vk: 88 });
  await base.waitFor(
    client,
    'Boolean(document.querySelector(".bob-successor-reason-input"))',
    Boolean,
    "requirement drop reason field",
    5000,
  );
  for (const char of DROP_REASON) await base.key(client, char);
  await base.key(client, "Enter");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const stagedMark = await client.evaluate(
    '(() => { const mark = document.querySelector(".bob-successor-group.is-requirements .bob-successor-req-row .bob-req-mark");' +
    ' return mark ? { state: mark.getAttribute("data-state"), text: mark.textContent } : null; })()',
  );
  assert.deepEqual(stagedMark, { state: "dropped", text: "⊘" }, "the staged Drop did not slash the row mark");
  await base.key(client, "Enter");
  await base.waitForGone(client, CARD, "requirement close card after Drop");
  await base.waitFor(
    client,
    'Boolean(document.querySelector(".notice .bob-nh-notice-action"))',
    Boolean,
    "requirement receipt Undo action",
    5000,
  );
  let state = await base.readEditor(client);
  assert.match(state.doc, /- \[x\] #task Ship exporter/);
  assert.match(state.doc, /- \[-\] Parent requirement/);
  assert.ok(state.doc.includes("CANCEL LOG"), "Drop did not write a Cancel Log");
  assert.ok(state.doc.includes(DROP_REASON), "Drop reason was not written");
  const receipt = await client.evaluate(
    'Boolean(document.querySelector(".notice .bob-nh-unblock-row.is-req.is-drop"))',
  );
  assert.ok(receipt, "Drop receipt was not rendered");
  await client.evaluate('document.querySelector(".notice .bob-nh-notice-action").click()');
  await base.waitFor(
    client,
    'window.app.workspace.activeLeaf.view.editor.getValue().includes("- [ ] Parent requirement")',
    Boolean,
    "Undo restores the requirement",
    5000,
  );
  state = await base.readEditor(client);
  assert.match(state.doc, /- \[x\] #task Ship exporter/);
  assert.match(state.doc, /- \[ \] Parent requirement/);
  assert.ok(!state.doc.includes(DROP_REASON), "Undo kept the dropped bytes");
}

async function runCarry(client) {
  await start(client);
  await openCard(client);
  await base.key(client, { key: "t", modifiers: base.CTRL | base.SHIFT, vk: 84 });
  await submitCard(client);
  const state = await base.readEditor(client);
  assert.match(state.doc, /- \[x\] #task Ship exporter/);
  assert.match(state.doc, /- \[>] \[\[#\^/);
  assert.match(state.doc, /#task Parent requirement/);
}

async function runPinnedNestedJump(client) {
  await start(client, OWNER_DOC, [0, 0], true);
  await base.key(client, "Escape");
  await openCard(client);
  await base.key(client, { key: "ArrowDown", vk: 40 });
  await base.key(client, { key: "j", modifiers: base.CTRL, vk: 74 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await base.key(client, "Enter");
  await base.waitForGone(client, CARD, "requirement close card after pin");
  await base.waitFor(
    client,
    'window.app.workspace.activeLeaf.view.editor.getCursor().line === 2',
    Boolean,
    "nested requirement landing",
    5000,
  );
  let state = await base.readEditor(client);
  assert.equal(state.caret[0], 2, "pinned nested requirement did not land on its final line");
  await client.evaluate("(() => { window.app.workspace.activeLeaf.view.editor.focus(); return true; })()");
  await base.key(client, "Escape");
  await base.key(client, { key: "o", modifiers: base.CTRL, vk: 79 });
  await new Promise((resolve) => setTimeout(resolve, 350));
  state = await base.readEditor(client);
  assert.equal(state.caret[0], 0, "Ctrl+O did not return to the close origin");
}

async function runEsc(client) {
  await start(client);
  await openCard(client);
  await base.key(client, "Escape");
  await base.waitForGone(client, CARD, "requirement close card after Esc");
  const state = await base.readEditor(client);
  assert.match(state.doc, /- \[x\] #task Ship exporter/);
  assert.match(state.doc, /- \[ \] Parent requirement/);
  assert.match(state.doc, /- \[ \] Nested requirement/);
  assert.ok(!state.doc.includes("CANCEL LOG"));
  assert.ok(!state.doc.includes("[>]"));
}

async function runDirectCarry(client) {
  await start(client, OWNER_DOC, [2, 7], true);
  await base.key(client, "Escape");
  await base.key(client, { key: "t", modifiers: base.CTRL | base.SHIFT, vk: 84 });
  await base.waitFor(
    client,
    'window.app.workspace.activeLeaf.view.editor.getValue().includes("- [>] [[#^")',
    Boolean,
    "direct requirement carry",
    10_000,
  );
  let state = await base.readEditor(client);
  assert.match(state.doc, /#task Nested requirement/);
  assert.ok(state.caret[0] > 2, "direct Carry did not land on the created task");
  await client.evaluate("(() => { window.app.workspace.activeLeaf.view.editor.focus(); return true; })()");
  await base.key(client, "Escape");
  await base.key(client, { key: "o", modifiers: base.CTRL, vk: 79 });
  await new Promise((resolve) => setTimeout(resolve, 350));
  state = await base.readEditor(client);
  assert.equal(state.caret[0], 2, "Ctrl+O did not return to the carried requirement");
}

async function runCase(client, entry) {
  switch (entry.name) {
    case cases[0].name: return runIdlessFirst(client);
    case cases[1].name: return runDropUndo(client);
    case cases[2].name: return runCarry(client);
    case cases[3].name: return runPinnedNestedJump(client);
    case cases[4].name: return runEsc(client);
    case cases[5].name: return runDirectCarry(client);
    default: throw new Error("unknown close-card case: " + entry.name);
  }
}

function selfTest() {
  assert.equal(cases.length, 6);
  for (const token of [
    "bob-cnp-successor-modal",
    "is-requirements",
    "bob-successor-reason-input",
    "bob-nh-notice-action",
    "Input.dispatchKeyEvent",
    "Undo restores the requirement",
    "Ctrl+O did not return",
  ]) {
    const source = require("node:fs").readFileSync(__filename, "utf8");
    assert.ok(source.includes(token), "e2e missing " + token);
  }
  console.log("offline requirement close-card e2e self-test complete (not an Obsidian pass)");
}

async function main() {
  const args = base.parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/obsidian-req-close-card-e2e.cjs [--executable PATH] [--report PATH] [--self-test]");
    return;
  }
  if (args.selfTest) return selfTest();
  if (args.only && args.only !== "closecard") {
    throw new Error("--only must be closecard");
  }
  await base.runE2e(args, {
    defaultGroups: ["closecard"],
    groups: { closecard: { cases, run: runCase } },
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error((error && error.stack) || error);
    process.exitCode = error && error.exitCode ? error.exitCode : 1;
  });
}

module.exports = { cases, selfTest };
