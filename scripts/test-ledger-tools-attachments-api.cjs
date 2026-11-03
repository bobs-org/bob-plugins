const test = require("node:test");
const assert = require("node:assert/strict");
const { LedgerToolsPlugin, helpers } = require("./ledger-tools-harness.cjs");

function makePlugin() {
  return Object.create(LedgerToolsPlugin.prototype);
}

test("api.attachments v1 sends origin and import requests to bob", async () => {
  const plugin = makePlugin();
  const calls = [];
  plugin.attachmentsSpawn = async (args, operation) => {
    calls.push({ args, operation });
    return { ok: true, schema_version: 1 };
  };
  const api = plugin.attachmentsApi();
  assert.equal(api.version, 1);
  assert.equal((await api.origin("img/photo.png")).ok, true);
  assert.equal((await api.import("~/tmp/photo.png", { via: "zoom" })).ok, true);
  assert.deepEqual(calls, [
    { args: ["attachments", "origin", "img/photo.png", "-f", "json"], operation: "origin" },
    { args: ["attachments", "import", "--via", "zoom", "-f", "json", "--", "~/tmp/photo.png"], operation: "import" },
  ]);
});

test("origin and import decoders validate schema and payload shape", () => {
  assert.deepEqual(
    helpers.attachmentsDecodeOrigin('{"schema_version":1,"path":"img/x.png","origin":null,"warnings":[]}', ""),
    { ok: true, schema_version: 1, path: "img/x.png", origin: null, warnings: [] },
  );
  const imported = helpers.attachmentsDecodeImport(
    '{"schema_version":1,"attachments":[{"source":"/tmp/x.png","display":"~/tmp/x.png","saved":"img/x.png","kind":"image","reused":false,"embed":"![[img/x.png|400]]","sha256":"deadbeef"}]}',
    "",
  );
  assert.equal(imported.ok, true);
  assert.equal(imported.attachments[0].embed, "![[img/x.png|400]]");
  assert.equal(helpers.attachmentsDecodeOrigin("not json", "detail").code, "unsupported");
  assert.equal(helpers.attachmentsDecodeImport("[]", "").code, "bad-shape");
  assert.equal(helpers.attachmentsDecodeOrigin('{"schema_version":2,"origin":null}', "").code, "bad-version");
  assert.equal(helpers.attachmentsDecodeOrigin('{"schema_version":1,"origin":false}', "").code, "bad-shape");
  assert.equal(helpers.attachmentsDecodeImport('{"schema_version":1,"attachments":false}', "").code, "bad-shape");
  assert.equal(
    helpers.attachmentsDecodeOrigin('{"ok":false,"code":"not_found","message":"missing"}', "").code,
    "not_found",
  );
});

test("attachment API refuses mobile calls and never rejects", async () => {
  const plugin = makePlugin();
  plugin.attachmentsIsDesktop = () => false;
  const api = plugin.attachmentsApi();
  assert.equal((await api.origin("img/x.png")).code, "desktop_only");
  assert.equal((await api.import("/tmp/x.png")).code, "desktop_only");

  plugin.attachmentsIsDesktop = () => true;
  plugin.attachmentsSpawn = async () => { throw new Error("spawn failed"); };
  assert.equal((await api.origin("img/x.png")).code, "failed");
  assert.equal((await api.import("/tmp/x.png")).code, "failed");
});
