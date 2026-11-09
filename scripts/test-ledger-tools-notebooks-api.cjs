// Notebook creation ledger API (plan:202611/bob_notebooks.md, phase
// plugins-notebook-gestures): `api.notebooks.create` over `bobSpawnJson`,
// desktop-only, decoding bob's schema-1 `notebooks create` envelope.
const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./ledger-tools-harness.cjs");

function okReport(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    command: "create",
    dry_run: false,
    notebook: {
      path: "dev_nvim.md",
      stem: "dev_nvim",
      title: "Nvim",
      summary: "Neovim config notes and plugin picks.",
      parent: "dev",
    },
    changes: [],
    catalogs: [],
    findings: [],
    commit: null,
    sync: null,
    warnings: [],
    ...overrides,
  };
}

test("notebooksCreateDecodeReport accepts the bob notebooks create envelope", () => {
  const decoded = helpers.notebooksCreateDecodeReport(JSON.stringify(okReport()), "");
  assert.equal(decoded.ok, true);
  assert.equal(decoded.report.notebook.path, "dev_nvim.md");
});

test("notebooksCreateDecodeReport keeps the refusal code, message, and hint", () => {
  const refused = helpers.notebooksCreateDecodeReport(
    JSON.stringify({
      ...okReport(),
      ok: false,
      notebook: null,
      error: {
        code: "notebook_exists",
        message: "dev_nvim.md already exists",
        hint: "choose another ID",
      },
    }),
    "",
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "notebook_exists");
  assert.equal(refused.message, "dev_nvim.md already exists");
  assert.equal(refused.detail, "choose another ID");

  const bare = helpers.notebooksCreateDecodeReport(
    JSON.stringify({ ...okReport(), ok: false, notebook: null, error: null }),
    "stderr line\nsecond",
  );
  assert.equal(bare.code, "bob-error");
  assert.equal(bare.detail, "stderr line");
});

test("notebooksCreateDecodeReport rejects unknown bob, versions, and shapes", () => {
  assert.equal(helpers.notebooksCreateDecodeReport("not json", "boom").code, "unsupported");
  assert.equal(helpers.notebooksCreateDecodeReport("[]", "").code, "bad-shape");
  assert.equal(
    helpers.notebooksCreateDecodeReport(JSON.stringify({ ...okReport(), schema_version: 2 }), "").code,
    "bad-version",
  );
  assert.equal(
    helpers.notebooksCreateDecodeReport(JSON.stringify({ ...okReport(), notebook: null }), "").code,
    "bad-shape",
  );
  assert.equal(
    helpers.notebooksCreateDecodeReport(
      JSON.stringify({ ...okReport(), notebook: { stem: "dev_nvim" } }),
      "",
    ).code,
    "bad-shape",
  );
});

test("notebooksCreateArgs puts free text in long options and positionals after --", () => {
  assert.deepEqual(
    helpers.notebooksCreateArgs({
      parent: "dev.md",
      id: "nvim",
      summary: "  Neovim config notes.  ",
      title: "",
    }),
    ["notebooks", "create", "--summary=Neovim config notes.", "-f", "json", "--", "dev.md", "nvim"],
  );
  assert.deepEqual(
    helpers.notebooksCreateArgs({
      parent: "dev.md",
      id: "nvim",
      summary: "-looks like an option",
      title: "Nvim",
    }),
    [
      "notebooks",
      "create",
      "--summary=-looks like an option",
      "--title=Nvim",
      "-f",
      "json",
      "--",
      "dev.md",
      "nvim",
    ],
  );
  assert.equal(helpers.notebooksCreateArgs({ parent: "dev.md", id: "", summary: "x" }), null);
  assert.equal(helpers.notebooksCreateArgs({ parent: "dev.md", id: "x", summary: "  " }), null);
  assert.equal(helpers.notebooksCreateArgs({ parent: "", id: "x", summary: "y" }), null);
  assert.equal(helpers.notebooksCreateArgs(null), null);
});

function makePlugin(spawn, { desktop = true } = {}) {
  const plugin = Object.create(helpers.BobLedgerToolsNotebooksMixin.prototype);
  return Object.assign(plugin, {
    ...(spawn ? { notebooksSpawn: spawn } : {}),
    ...(desktop ? {} : { notebooksIsDesktop: () => false }),
    apiStatsBobPath: () => ({ path: "bob", source: "path" }),
    statsVaultBasePath: () => "/vault",
  });
}

test("apiNotebooksCreate spawns one real create and returns the report", async () => {
  const seen = [];
  const plugin = makePlugin(async (args) => {
    seen.push(args);
    return { ok: true, report: okReport() };
  });
  const result = await plugin.apiNotebooksCreate({
    parent: "dev.md",
    id: "nvim",
    summary: "Neovim config notes.",
    title: "Nvim",
  });
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].includes("-d"));
  assert.ok(!seen[0].includes("-o"));
  assert.equal(seen[0][0], "notebooks");
  assert.equal(seen[0][1], "create");
});

test("apiNotebooksCreate refuses a blank request without spawning", async () => {
  let spawned = 0;
  const plugin = makePlugin(async () => {
    spawned += 1;
    return { ok: true, report: okReport() };
  });
  const result = await plugin.apiNotebooksCreate({ parent: "dev.md", id: "nvim", summary: "" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing");
  assert.equal(spawned, 0);
});

test("apiNotebooksCreate resolves desktop_only off the desktop and never throws", async () => {
  const mobile = makePlugin(null, { desktop: false });
  const refused = await mobile.apiNotebooksCreate({ parent: "dev.md", id: "nvim", summary: "x" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "desktop_only");
  assert.equal(refused.message, helpers.NOTEBOOKS_MOBILE_MESSAGE);

  const broken = makePlugin(async () => {
    throw new Error("spawn exploded");
  });
  const failed = await broken.apiNotebooksCreate({ parent: "dev.md", id: "nvim", summary: "x" });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "failed");
});

test("the notebooks api shape carries version 1 with create", () => {
  const plugin = makePlugin(async () => ({ ok: true, report: okReport() }));
  const api = plugin.notebooksApi();
  assert.equal(api.version, 1);
  assert.equal(typeof api.create, "function");
  assert.equal(plugin.notebooksApi(), api);
  assert.equal(helpers.NOTEBOOKS_API_VERSION, 1);
});
