const test = require("node:test");
const assert = require("node:assert/strict");

const { helpers } = require("./command-mode-harness.cjs");

test("Edit note properties is a Vault surface row behind the palette command", () => {
  const rows = helpers.cmSheetSurfaceRows(() => true);
  const row = rows.find((item) => item.surfaceId === "bob-ledger-tools:edit-note-properties");
  assert.ok(row, "surface row exists");
  assert.equal(row.section, "vault");
  assert.equal(row.kind, "surface");
  assert.equal(row.title, "Edit note properties");
  assert.equal(row.unavailable, null);
});

test("missing ledger-tools plugin disables Edit note properties with an enable hint", () => {
  const rows = helpers.cmSheetSurfaceRows(() => false);
  const row = rows.find((item) => item.surfaceId === "bob-ledger-tools:edit-note-properties");
  assert.ok(row, "surface row exists even when unavailable");
  assert.match(String(row.unavailable), /Enable /);
});

test("Command Mode runs Edit note properties through Obsidian's command route", async () => {
  const calls = [];
  const modal = Object.create(helpers.CommandModeSheetModal.prototype);
  modal.app = { commands: { executeCommandById: async (id) => calls.push(id) } };
  let closed = false;
  modal.close = () => { closed = true; };
  const result = await modal.activateRow({
    kind: "surface", surfaceId: "bob-ledger-tools:edit-note-properties", unavailable: null,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["bob-ledger-tools:edit-note-properties"]);
  assert.equal(closed, true, "the sheet closes before executing the registered surface");
});
