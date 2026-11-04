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
    { ok: true, report: { schema_version: 1, path: "img/x.png", origin: null, warnings: [] } },
  );
  const imported = helpers.attachmentsDecodeImport(
    '{"schema_version":1,"attachments":[{"source":"/tmp/x.png","display":"~/tmp/x.png","saved":"img/x.png","kind":"image","reused":false,"embed":"![[img/x.png|400]]","sha256":"deadbeef"}]}',
    "",
  );
  assert.equal(imported.ok, true);
  assert.equal(imported.report.attachments[0].embed, "![[img/x.png|400]]");
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

test("attachment API preserves bob payloads through bobSpawnJson", async () => {
  const plugin = makePlugin();
  plugin.attachmentsIsDesktop = () => true;
  plugin.apiStatsBobPath = () => ({ path: "/usr/local/bin/bob", source: "test" });
  plugin.statsVaultBasePath = () => "/vault/bob";
  const calls = [];
  const responses = [
    JSON.stringify({
      origin: {
        display: "~/tmp/screenshots/20261104_062032.png",
        host: "kellys-mbp",
        source: "/Users/bbugyi/tmp/screenshots/20261104_062032.png",
        state: "present",
        ts: "2026-11-04T06:31:44-05:00",
        via: "capture",
      },
      path: "img/20261104_062032.png",
      schema_version: 1,
      warnings: [],
    }),
    JSON.stringify({
      attachments: [{
        embed: "![[img/imported.png|400]]",
        saved: "img/imported.png",
        kind: "image",
        reused: true,
      }],
      schema_version: 1,
    }),
  ];
  plugin.attachmentsExecFile = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null, responses.shift(), "");
  };
  const api = plugin.attachmentsApi();
  const origin = await api.origin("img/20261104_062032.png");
  assert.equal(origin.ok, true);
  assert.equal(origin.origin.display, "~/tmp/screenshots/20261104_062032.png");
  assert.equal(origin.origin.state, "present");
  const imported = await api.import("~/tmp/imported.png", { via: "zoom" });
  assert.equal(imported.ok, true);
  assert.equal(imported.attachments[0].embed, "![[img/imported.png|400]]");
  assert.equal(imported.attachments[0].saved, "img/imported.png");
  assert.equal(imported.attachments[0].kind, "image");
  assert.equal(imported.attachments[0].reused, true);
  assert.deepEqual(calls.map(({ command, args, options }) => ({ command, args, env: {
    BOB_DIR: options.env.BOB_DIR,
    NO_COLOR: options.env.NO_COLOR,
  } })), [
    {
      command: "/usr/local/bin/bob",
      args: ["attachments", "origin", "img/20261104_062032.png", "-f", "json"],
      env: { BOB_DIR: "/vault/bob", NO_COLOR: "1" },
    },
    {
      command: "/usr/local/bin/bob",
      args: ["attachments", "import", "--via", "zoom", "-f", "json", "--", "~/tmp/imported.png"],
      env: { BOB_DIR: "/vault/bob", NO_COLOR: "1" },
    },
  ]);
});

test("attachment API passes bob JSON failures through", async () => {
  const plugin = makePlugin();
  plugin.attachmentsIsDesktop = () => true;
  plugin.attachmentsExecFile = (_command, _args, _options, callback) => {
    const error = new Error("exit 1");
    error.code = 1;
    callback(error, '{"code":"not_found","message":"no such vault file: img/nope.png","ok":false}', "");
  };
  const result = await plugin.attachmentsApi().origin("img/nope.png");
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_found");
  assert.equal(result.message, "no such vault file: img/nope.png");
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
