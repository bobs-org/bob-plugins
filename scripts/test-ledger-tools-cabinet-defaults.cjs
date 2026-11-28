"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
    Platform: { isDesktopApp: true }, normalizePath: (value) => value, parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return {};
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

function stubFs({ text = "", stat = { mtimeMs: 1, size: 10 }, readError = null } = {}) {
  return {
    readFileSync: () => {
      if (readError) {
        const error = new Error(readError.message || "read failed");
        error.code = readError.code;
        throw error;
      }
      return text;
    },
    statSync: () => ({ ...stat }),
  };
}

function optsFor({ parsed, parseError = false, fsOptions = {}, platform = undefined, configPath = "/tmp/bob-test/config.yml" } = {}) {
  const fsModule = stubFs(fsOptions);
  const parseYaml = parseError
    ? () => { throw new Error("yaml boom"); }
    : () => parsed;
  return { fsModule, parseYaml, configPath, Platform: platform };
}

test("missing file, mobile, non-mapping block, and parse error all give closed everywhere", () => {
  H.resetPropertyCardCabinetDefaultsCache();
  const missing = optsFor({ parsed: {}, fsOptions: { readError: { code: "ENOENT", message: "missing" } }, configPath: "/tmp/bob-test/missing.yml" });
  assert.equal(H.loadPropertyCardCabinetDefaults(missing).rules && true, true);
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", missing), false);
  assert.equal(H.propertyCardCabinetDefaultOpen("records", { species: "album", ...missing }), false);

  H.resetPropertyCardCabinetDefaultsCache();
  const mobile = optsFor({ parsed: { cabinets: { all: { all: "open" } } }, platform: { isDesktopApp: false }, configPath: "/tmp/bob-test/mobile.yml" });
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", mobile), false);

  H.resetPropertyCardCabinetDefaultsCache();
  const nonMapping = optsFor({ parsed: { cabinets: "oops" }, configPath: "/tmp/bob-test/nonmapping.yml" });
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", nonMapping), false);

  H.resetPropertyCardCabinetDefaultsCache();
  const parseFail = optsFor({ parsed: null, parseError: true, configPath: "/tmp/bob-test/parsefail.yml" });
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", parseFail), false);

  H.resetPropertyCardCabinetDefaultsCache();
  const absent = optsFor({ parsed: {}, configPath: "/tmp/bob-test/absent.yml" });
  for (const kind of ["areas", "projects", "notebooks", "albums", "records", "outline", "schema", "setup", "properties"]) {
    assert.equal(H.propertyCardCabinetDefaultOpen(kind, { ...absent }), false, `${kind} closed with no config`);
  }
});

test("each precedence rung wins in order", () => {
  H.resetPropertyCardCabinetDefaultsCache();
  const parsed = {
    cabinets: {
      all: { all: "open" },
      album: { all: "closed", schema: "open" },
    },
  };
  const injected = optsFor({ parsed, configPath: "/tmp/prec/config.yml" });
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", injected), true, "(type, cabinet) beats (type, all)");
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "records", injected), false, "(type, all) beats (all, all)");

  H.resetPropertyCardCabinetDefaultsCache();
  const parsed2 = { cabinets: { all: { all: "closed", schema: "open" } } };
  const injected2 = optsFor({ parsed: parsed2, configPath: "/tmp/prec2/config.yml" });
  assert.equal(H.propertyCardCabinetConfiguredOpen("bank", "schema", injected2), true, "(all, cabinet) beats (all, all)");
  assert.equal(H.propertyCardCabinetConfiguredOpen("bank", "records", injected2), false);

  H.resetPropertyCardCabinetDefaultsCache();
  const parsed3 = { cabinets: { album: { schema: "open" } } };
  const injected3 = optsFor({ parsed: parsed3, configPath: "/tmp/prec3/config.yml" });
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", injected3), true);
  assert.equal(H.propertyCardCabinetConfiguredOpen("bank", "schema", injected3), false, "unlisted type stays closed");
});

test("article is an alias of prose with trim and case-insensitive values", () => {
  H.resetPropertyCardCabinetDefaultsCache();
  const injected = optsFor({
    parsed: { cabinets: { article: { outline: "  OPEN " } } },
    configPath: "/tmp/alias/config.yml",
  });
  assert.equal(H.propertyCardCabinetConfiguredOpen("prose", "outline", injected), true);
  assert.equal(H.propertyCardCabinetConfiguredOpen("article", "outline", injected), true);

  H.resetPropertyCardCabinetDefaultsCache();
  const mixed = optsFor({
    parsed: { cabinets: { album: { schema: "  Closed " } } },
    configPath: "/tmp/case/config.yml",
  });
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", mixed), false);
  assert.equal(H.propertyCardCabinetConfiguredOpen("ALBUM", "SCHEMA", mixed), false);
});

test("a bad key or value is ignored on its own while siblings still apply, with one warning per fingerprint", () => {
  H.resetPropertyCardCabinetDefaultsCache();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const injected = optsFor({
      parsed: { cabinets: { album: { schma: "open", schema: "open" }, bogus: { schema: "open" } } },
      configPath: "/tmp/warn/config.yml",
    });
    assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", injected), true, "sibling still applies");
    assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schma", injected), false);
    assert.equal(warnings.length, 1, "one warning per fingerprint");
    assert.match(warnings[0], /cabinets\.album\.schma/);
    assert.match(warnings[0], /cabinets\.bogus/);
    const second = H.loadPropertyCardCabinetDefaults(injected);
    assert.equal(warnings.length, 1, "second read with same fingerprint does not warn again");
    assert.ok(second.warnings.length >= 2);
  } finally {
    console.warn = originalWarn;
  }
});

test("the stat cache refreshes on an mtime or size change", () => {
  H.resetPropertyCardCabinetDefaultsCache();
  let stat = { mtimeMs: 1, size: 10 };
  let parsed = { cabinets: { album: { schema: "open" } } };
  const fsModule = {
    readFileSync: () => "dummy",
    statSync: () => ({ ...stat }),
  };
  const parseYaml = () => parsed;
  const injected = { fsModule, parseYaml, configPath: "/tmp/stat/config.yml" };
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", injected), true);
  parsed = { cabinets: { album: { schema: "closed" } } };
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", injected), true, "cached until stat changes");
  stat = { mtimeMs: 2, size: 10 };
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", injected), false, "mtime change re-reads");
  parsed = { cabinets: { album: { schema: "open" } } };
  stat = { mtimeMs: 2, size: 11 };
  assert.equal(H.propertyCardCabinetConfiguredOpen("album", "schema", injected), true, "size change re-reads");
});

test("Properties foot honors config, explicit choice wins, and rename carries false", () => {
  H.resetPropertyCardCabinetDefaultsCache();
  const injected = optsFor({
    parsed: { cabinets: { album: { properties: "open" } } },
    configPath: "/tmp/foot/config.yml",
  });
  H.propertyCardFootResetAll();
  assert.equal(H.propertyCardFootIsOpen("eat/a.md", "album", injected), true, "configured-open Properties");
  assert.equal(H.propertyCardFootIsOpen("eat/b.md", "bank", injected), false);
  H.propertyCardFootSetOpen("eat/a.md", false, "album");
  assert.equal(H.propertyCardFootIsOpen("eat/a.md", "album", injected), false, "explicit close beats configured open");
  assert.equal(H.propertyCardFootRenamePath("eat/a.md", "eat/c.md"), true);
  assert.equal(H.propertyCardFootIsOpen("eat/c.md", "album", injected), false, "rename carries stored false");
  H.propertyCardFootResetAll();
  H.propertyCardFootSetOpen("eat/d.md", false, "album");
  H.resetPropertyCardCabinetDefaultsCache();
  const closed = optsFor({ parsed: {}, configPath: "/tmp/foot2/config.yml" });
  assert.equal(H.propertyCardFootIsOpen("eat/d.md", "album", closed), false);
});
