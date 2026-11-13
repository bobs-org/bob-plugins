const test = require("node:test");
const assert = require("node:assert/strict");

const { helpers } = require("./command-mode-harness.cjs");

test("Edit album schema is a Vault surface row behind the palette command", () => {
  const rows = helpers.cmSheetSurfaceRows(() => true);
  const row = rows.find((item) => item.surfaceId === "bob-ledger-tools:edit-album-schema");
  assert.ok(row, "surface row exists");
  assert.equal(row.section, "vault");
  assert.equal(row.kind, "surface");
  assert.match(row.title, /Edit album schema/);
  assert.equal(row.unavailable, null);
});

test("missing plugin disables the surface row with an enable hint", () => {
  const rows = helpers.cmSheetSurfaceRows(() => false);
  const row = rows.find((item) => item.surfaceId === "bob-ledger-tools:edit-album-schema");
  assert.ok(row, "surface row exists even when unavailable");
  assert.match(String(row.unavailable), /Enable /);
  const gated = helpers.cmSheetSurfaceRows((id) => id !== "bob-ledger-tools:edit-album-schema");
  const off = gated.find((item) => item.surfaceId === "bob-ledger-tools:edit-album-schema");
  assert.ok(off.unavailable, "ledger-tools command missing disables the row");
  const on = gated.find((item) => item.surfaceId === "bob-ledger-tools:open-today-daily-note");
  assert.equal(on.unavailable, null);
});

test("Command Mode executes the album schema surface through Obsidian's command route", async () => {
  const calls = [];
  const modal = Object.create(helpers.CommandModeSheetModal.prototype);
  modal.app = { commands: { executeCommandById: async (id) => calls.push(id) } };
  let closed = false;
  modal.close = () => { closed = true; };
  const result = await modal.activateRow({
    kind: "surface", surfaceId: "bob-ledger-tools:edit-album-schema", unavailable: null,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["bob-ledger-tools:edit-album-schema"]);
  assert.equal(closed, true, "the sheet closes before executing the registered surface");
});
