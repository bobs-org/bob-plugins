"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Match the canonical block emitted by bob's album schema writer, including
// its indented legacy sequence. Kept separate from the editable-card fixture.
const ROUNDTRIP_NOTE = [
  "---", 'type: "[[album]]"', 'parent: "[[body]]"',
  "summary: Before the Properties edit.", "record:",
  "  noun: proof_record", "  label: Proof record", "  dated_notes: true",
  "  fields:", "    verdict:", "      label: Verdict", "      required: true",
  "      values:", "        to_try: To try", "        liked: Liked",
  "  legacy:", "    - lid", "    - source_*",
  "---", "", "# Schema round trip", "",
].join("\n");

function recordBlock(text) {
  const match = /^record:\r?\n(?:[ \t].*(?:\r?\n|$)|\r?\n)*/m.exec(text);
  if (!match) throw new Error("fixture has no block record mapping");
  return match[0];
}

function propertyProbe() {
  return `(() => {
    const view = window.app?.workspace?.activeLeaf?.view;
    const state = view?.getState?.() || {};
    const surface = view?.containerEl?.querySelector(state.mode === "source"
      ? ".markdown-source-view" : ".markdown-preview-view");
    const rows = Array.from(surface?.querySelectorAll('.metadata-property[data-property-key="record"]') || []);
    return { path: view?.file?.path, rows: rows.map((row) => {
      const rect = row.getBoundingClientRect();
      const style = row.ownerDocument.defaultView.getComputedStyle(row);
      return { visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" };
    }) };
  })()`;
}

function propertyVisibility(probe, expectedPath, visible) {
  return probe?.path === expectedPath && probe.rows?.length === 1
    && probe.rows[0].visible === visible;
}

async function propertiesRoundTrip(client, vaultDir) {
  const file = path.join(vaultDir, "schema-proof.md");
  const before = recordBlock(fs.readFileSync(file, "utf8"));
  const prepared = await client.evaluate(`(() => {
    const view = window.app?.workspace?.activeLeaf?.view;
    if (view?.file?.path !== "schema-proof.md") return { ok: false, reason: "wrong note" };
    const inputs = Array.from(view.containerEl.querySelectorAll(
      '.metadata-property[data-property-key="summary"] .metadata-property-value [contenteditable="true"], '
      + '.metadata-property[data-property-key="summary"] .metadata-property-value textarea, '
      + '.metadata-property[data-property-key="summary"] .metadata-property-value input'
    ));
    const input = inputs.find((el) => el.getBoundingClientRect().height > 0);
    if (!input) return { ok: false, reason: "native summary value input missing" };
    input.focus();
    if (typeof input.select === "function") input.select();
    else {
      const range = input.ownerDocument.createRange();
      range.selectNodeContents(input);
      const selection = input.ownerDocument.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return { ok: true, tag: input.tagName, className: input.className };
  })()`);
  if (!prepared?.ok) return { ...prepared, before };
  const summary = "Edited through native Properties for the album schema proof.";
  await client.call("Input.insertText", { text: summary });
  await client.evaluate(`(() => {
    const doc = window.app.workspace.activeLeaf.view.containerEl.ownerDocument;
    doc.activeElement?.blur();
    return true;
  })()`);
  let afterText = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    afterText = fs.readFileSync(file, "utf8");
    if (afterText.includes("\nsummary: " + summary + "\n")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const after = recordBlock(afterText);
  const summarySaved = afterText.includes("\nsummary: " + summary + "\n");
  return { ok: summarySaved && before === after,
    summarySaved, before, after, input: prepared };
}

module.exports = { ROUNDTRIP_NOTE, recordBlock, propertyProbe, propertyVisibility, propertiesRoundTrip };
