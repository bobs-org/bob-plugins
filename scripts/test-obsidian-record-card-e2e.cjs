#!/usr/bin/env node
// Offline fixture and assertion checks for the real Record Card proof runner.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const proof = require("./obsidian-record-card-workflow-lib.cjs");

test("field selection avoids populated links and requires native row focus without navigation", async () => {
  const before = { field: "status", activePath: "movies/equilibrium.md" };
  const selected = { field: "reference", stage: null, ready: true, busy: false,
    focusField: "reference", activePath: before.activePath };
  const clicks = [];
  const result = await proof.selectCardField({
    field: "reference",
    click: async selector => clicks.push(selector),
    card: async predicate => {
      if (!predicate) return before;
      assert.deepEqual(clicks, [".bob-record-card-modal button[data-target-key='reference'] .bob-record-card-label"]);
      assert.equal(predicate({ ...selected, activePath: "nj_towns.md" }), false, "navigation is not selection");
      assert.equal(predicate({ ...selected, focusField: null }), false, "editor focus must not receive Enter");
      assert.equal(predicate({ ...selected, focusField: "status" }), false, "old row focus is not ready");
      assert.equal(predicate({ ...selected, busy: true }), false);
      assert.equal(predicate({ ...selected, stage: "link" }), false);
      assert.equal(predicate(selected), true);
      return selected;
    },
  });
  assert.equal(result, selected);
});

test("CLI provenance accepts only the pinned base, complete patch and binary", () => {
  const { findBobProvenance } = require("./obsidian-record-card-e2e.cjs");
  const hash = bytes => require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "record-provenance-"));
  try {
    const target = path.join(root, "target");
    const bob = path.join(target, "debug/bob");
    fs.mkdirSync(path.dirname(bob), {recursive:true});
    fs.writeFileSync(bob, "exact test binary");
    const patch = Buffer.from("complete tracked diff\n");
    const sourceSha = "a".repeat(40);
    const expected = {schema_version:1, sourceSha, sourcePatchSha256:hash(patch), binarySha256:hash(fs.readFileSync(bob))};
    const env = {BOB_BIN:bob, BOB_CLI_DIR:root, BOB_CLI_PROVENANCE:path.join(root, "provenance.json")};
    const pin = (manifest = expected) => {
      fs.writeFileSync(env.BOB_CLI_PROVENANCE, JSON.stringify(manifest));
      env.BOB_CLI_PROVENANCE_SHA256 = hash(fs.readFileSync(env.BOB_CLI_PROVENANCE));
    };
    let dirty = " M src/records.rs\n", diff = patch, untracked = Buffer.alloc(0), failGit = "";
    const execute = (command, args) => {
      if (command === "cargo") return {status:0, stdout:JSON.stringify({target_directory:target})};
      if (command === bob) return {status:0, stdout:"bob test\n"};
      assert.equal(command, "git");
      assert.deepEqual(args.slice(0, 2), ["-C", root]);
      const operation = args[2];
      if (operation === failGit) return {status:null, signal:"SIGTERM"};
      if (operation === "rev-parse") return {status:0, stdout:sourceSha + "\n"};
      if (operation === "status") return {status:0, stdout:dirty};
      if (operation === "ls-files") return {status:0, stdout:untracked};
      assert.deepEqual(args.slice(2), ["diff", "--binary", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD"]);
      return {status:0, stdout:diff};
    };
    const probe = () => findBobProvenance({env, execute});
    pin();
    assert.deepEqual(probe().sourcePatch, {manifestSha256:env.BOB_CLI_PROVENANCE_SHA256, sha256:hash(patch), bytes:patch.length});
    for (const [field, value, error] of [
      ["sourceSha", "b".repeat(40), /source SHA mismatch/],
      ["sourcePatchSha256", hash("stale patch"), /source patch hash mismatch/],
      ["binarySha256", hash("stale binary"), /binary hash mismatch/],
      ["schema_version", 2, /Invalid CLI provenance/],
      ["sourcePatchSha256", null, /Invalid CLI provenance/],
    ]) {
      pin({...expected, [field]:value});
      assert.throws(probe, error);
    }
    pin();
    env.BOB_CLI_PROVENANCE_SHA256 = hash("wrong manifest");
    assert.throws(probe, /manifest hash mismatch/);
    pin();
    untracked = Buffer.from("src/new-input.rs\0");
    assert.throws(probe, /untracked source/);
    untracked = Buffer.alloc(0);
    diff = Buffer.from("changed after build\n");
    assert.throws(probe, /source patch hash mismatch/);
    diff = patch;
    for (failGit of ["rev-parse", "status", "ls-files", "diff"]) assert.throws(probe);
    failGit = "";
    const withManifest = {...env};
    delete env.BOB_CLI_PROVENANCE;
    delete env.BOB_CLI_PROVENANCE_SHA256;
    assert.throws(probe, /must be clean/);
    dirty = "";
    assert.equal(probe().sourcePatch, null); // Existing clean-checkout path.
    Object.assign(env, withManifest);
    diff = Buffer.alloc(0);
    assert.throws(probe, /source patch hash mismatch/); // A cleaned tree is drift too.
    pin({...expected, sourcePatchSha256:hash(diff)});
    assert.equal(probe().sourcePatch.bytes, 0);
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});

test("CDP Enter includes the native button activation character; shortcuts never type", () => {
  const [down, up] = proof.keyEvents("Enter");
  assert.equal(down.type, "keyDown");
  assert.equal(down.text, "\r");
  assert.equal(down.unmodifiedText, "\r");
  assert.equal(down.code, "Enter");
  assert.equal(down.windowsVirtualKeyCode, 13);
  assert.equal(up.type, "keyUp");
  assert.equal(up.text, undefined);
  for (const [key, modifiers] of [["a", 2], ["P", 10], ["d", 2]]) {
    const [shortcut] = proof.keyEvents(key, modifiers);
    assert.equal(shortcut.type, "rawKeyDown");
    assert.equal(shortcut.text, undefined);
    assert.equal(shortcut.modifiers, modifiers);
    assert.equal(shortcut.code, "Key" + key.toUpperCase());
  }
  assert.equal(proof.keyEvents("Tab", 8)[0].code, "Tab");
  assert.equal(proof.keyEvents("J", 8)[0].text, "J");
  assert.equal(proof.keyEvents("3")[0].code, "Digit3");
  assert.equal(proof.keyEvents("=")[0].code, "Equal");
});

test("focus evidence rejects boxless, detached and redirected keyboard targets", () => {
  const document = { activeElement: null, querySelectorAll: () => [target] };
  const target = {
    tagName: "DIV", className: "bob-record-sheet-row", isConnected: true, tabIndex: 0,
    display: "contents", getAttribute: () => "claim", getClientRects: () => [],
    scrollIntoView() {}, focus() { document.activeElement = this; },
  };
  const probe = () => new Function("document", "getComputedStyle", "return " +
    proof.focusControlSource("[data-record-key='claim']"))(document, el => ({display: el.display}));
  assert.equal(probe().ok, false);
  assert.equal(probe().candidates[0].display, "contents");
  target.display = "grid";
  target.getClientRects = () => [{x:10,y:20,width:200,height:30}];
  assert.equal(probe().ok, true);
  target.isConnected = false;
  assert.equal(probe().ok, false);
  target.isConnected = true;
  target.focus = () => { document.activeElement = null; };
  assert.equal(probe().ok, false);
});

test("palette activation requires a visible selected result and focused query input", () => {
  const input = {value:"Bob: Command mode"};
  const row = {isConnected:true,textContent:"Bob: Command mode",getClientRects:()=>[{}],classList:{contains:()=>true}};
  const document = {activeElement:input,querySelector:()=>input,querySelectorAll:()=>[row]};
  const probe = new Function("document", "return " + proof.paletteSelectionSource());
  assert.deepEqual(probe(document), {query:input.value,focused:true,rows:[{text:input.value,selected:true}]});
  document.activeElement = {};
  assert.equal(probe(document).focused, false);
  row.isConnected = false;
  assert.deepEqual(probe(document).rows, []);
  row.isConnected = true;
  row.getClientRects = () => [];
  assert.deepEqual(probe(document).rows, []);
  document.querySelectorAll = () => [];
  assert.deepEqual(probe(document).rows, []);
  document.querySelector = () => null;
  assert.equal(probe(document), null);
});

test("palette command selection disambiguates plugin prefixes and rejects unsafe activation", async () => {
  const rows = ["Bob Command ModeBob: Articles", "Bob Command ModeBob: Projects", "Bob Command ModeBob: Command mode"];
  let selected = 0;
  const state = () => ({focused:true,query:"Bob: Command mode",rows:rows.map((text,i)=>({text,selected:i===selected}))});
  const keys = [];
  const trail = await proof.activatePaletteCommand({client:{},query:"Bob: Command mode",title:"Bob: Command mode",
    key:async key => { keys.push(key); if(key === "ArrowDown") selected++; },
    waitFor:async (_client,_source,predicate) => { const value=state(); assert.ok(predicate(value)); return value; }});
  assert.deepEqual(keys, ["ArrowDown","ArrowDown","Enter"]);
  assert.equal(trail.length, 3);
  assert.equal(proof.paletteNavigation(state(), "Bob: Articles"), "ArrowUp");
  assert.throws(()=>proof.paletteNavigation({...state(),focused:false}, "Bob: Command mode"), /lost focus/);
  assert.throws(()=>proof.paletteNavigation(state(), "Missing command"), /exactly one row/);
  assert.throws(()=>proof.paletteNavigation({...state(),rows:[...state().rows,state().rows[2]]}, "Bob: Command mode"), /exactly one row/);
  assert.throws(()=>proof.paletteNavigation({...state(),rows:state().rows.map(row=>({...row,selected:false}))}, "Bob: Command mode"), /selected row/);
  assert.throws(()=>proof.paletteNavigation({...state(),rows:state().rows.map(row=>({...row,selected:true}))}, "Bob: Command mode"), /selected row/);
});

test("obsidian-record-card-e2e --self-test", (t) => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-record-card-e2e.cjs"), "--self-test"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, String(result.stdout || "") + "\n" + String(result.stderr || ""));
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.doesNotMatch(String(result.stdout || ""), /^UNRUN:/m);
});

test("Vim probe cursor expression keeps its newline escaped and requires the fixture line", () => {
  let cursor = null;
  let focused = false;
  const editor = {
    getValue: () => "---\ntitle: Fixture\n---\n" + proof.VIM_PROBE_BODY,
    setCursor: value => { cursor = value; }, focus: () => { focused = true; },
  };
  const run = new Function("app", "return " + proof.vimProbeCursorSource());
  const app = {workspace:{activeLeaf:{view:{editor}}}};
  run(app);
  assert.deepEqual(cursor, {line:5,ch:0});
  assert.equal(focused, true);
  editor.getValue = () => "No probe line";
  assert.throws(() => run(app), /probe line is absent/);
});

test("Vim reindent proof requires a changed prefix and preserves every other byte", () => {
  const before = "---\ntitle: Fixture\n---\n" + proof.VIM_PROBE_BODY;
  const after = before.replace("      indent probe", "\t  indent probe");
  proof.assertVimReindent(before, after);
  assert.throws(() => proof.assertVimReindent(before, before), /indentation unchanged/);
  assert.throws(() => proof.assertVimReindent(before, after.replace("Fixture", "Changed")), /outside the probe/);
  assert.throws(() => proof.assertVimReindent(before, after.replace("indent probe", "changed")), /removed the probe/);
  assert.throws(() => proof.assertVimReindent("console.log('indent probe');", after), /missing overindented/);
});

test("hide assertion refuses absent native UI and incorrect visibility", () => {
  const { assertNativeVisibility } = require("./obsidian-record-card-e2e-lib.cjs");
  assert.throws(() => assertNativeVisibility({
    status: "pass",
    properties: { present: false, display: "none", visibility: "hidden", rectVisible: false },
    inlineTitle: { present: true, display: "none", visibility: "hidden", rectVisible: false },
  }, true), /is absent/);
  assert.throws(() => assertNativeVisibility({
    status: "pass",
    properties: { present: true, display: "block", visibility: "visible", rectVisible: true },
    inlineTitle: { present: true, display: "none", visibility: "hidden", rectVisible: false },
  }, false), /visibility mismatch/);
});

test("frontmatter cursor expression keeps escaped newlines valid for CDP evaluation", () => {
  const { frontmatterBodyCursorExpression } = require("./obsidian-record-card-e2e-lib.cjs");
  const expression = frontmatterBodyCursorExpression("zettels/bead_lifecycle.md");
  assert.match(expression, /text\.indexOf\("\\n---"/);
  assert.match(expression, /split\(\/\\r\?\\n\//);
  assert.doesNotThrow(() => new Function("return " + expression + ";"));
});

test("frontmatter cursor reaches the closing delimiter even after sync appends a walk footer", () => {
  const { frontmatterBodyCursorExpression } = require("./obsidian-record-card-e2e-lib.cjs");
  const path = "zettels/frontmatter-only.md";
  const frontmatter = '---\ntitle: Frontmatter Only\n---';
  for (const text of [frontmatter, frontmatter + '\n\n[[zettels|⬆]] · [[zettels/next|→]]\n']) {
    const cm = {
      state: { doc: { toString: () => text, length: text.length }, selection: { main: { head: 0 } } },
      dispatch: ({ selection }) => { cm.state.selection.main.head = selection.anchor; },
    };
    const app = { workspace: { getLeavesOfType: () => [{ view: { file: { path }, editor: { cm } } }] } };
    const result = new Function("app", "return " + frontmatterBodyCursorExpression(path, true))(app);
    assert.equal(result.ok, true);
    assert.equal(result.target, frontmatter.length);
    assert.equal(result.delimiter, "---");
    assert.equal(cm.state.selection.main.head, frontmatter.length);
  }
});

test("fixture album sync accepts only its exact malformed-schema and outside-folder findings", () => {
  const { isExpectedFixtureAlbumSync } = require("./obsidian-record-card-e2e-lib.cjs");
  const expected = {
    exitCode: 1,
    signal: null,
    report: {
      command: "sync",
      ok: false,
      schema_version: 1,
      counts: { errors: 2, damaged: 1, warnings: 0 },
      sync: { pre: "ok", post: "ok" },
      io_errors: [],
      findings: [
        { path: "broken.md", code: "album_index_damaged", severity: "error" },
        { path: "broken.md", code: "album_schema_invalid", severity: "error" },
        { path: "misfiled.md", code: "album_child_reparent", severity: "info" },
      ],
    },
  };
  assert.equal(isExpectedFixtureAlbumSync(expected), true);
  assert.equal(isExpectedFixtureAlbumSync({ ...expected, exitCode: 0 }), false);
  assert.equal(isExpectedFixtureAlbumSync({
    ...expected,
    report: { ...expected.report, findings: [...expected.report.findings, { path: "unexpected.md", code: "new_error", severity: "error" }] },
  }), false);
  assert.equal(isExpectedFixtureAlbumSync({
    ...expected,
    report: { ...expected.report, counts: { ...expected.report.counts, errors: 3 } },
  }), false);
});

test("fixture album list accepts only its exact findings while requiring record_values_v1", () => {
  const { isExpectedFixtureAlbumList } = require("./obsidian-record-card-e2e-lib.cjs");
  const expected = {
    args: ["albums", "list", "-f", "json"],
    exitCode: 0,
    signal: null,
    report: {
      ok: false,
      schema_version: 1,
      capabilities: ["record_values_v1"],
      counts: { albums: 6, errors: 2, warnings: 0, records: 10 },
      albums: [
        { path: "broken.md", issues: [
          { path: "broken.md", code: "album_index_damaged", severity: "error" },
          { path: "broken.md", code: "album_schema_invalid", severity: "error" },
        ] },
        { path: "movies.md", issues: [
          { path: "misfiled.md", code: "album_child_reparent", severity: "info" },
        ] },
      ],
    },
  };
  assert.equal(isExpectedFixtureAlbumList(expected), true);
  assert.equal(isExpectedFixtureAlbumList({ ...expected, exitCode: 1 }), false);
  assert.equal(isExpectedFixtureAlbumList({ ...expected, args: ["albums", "sync", "-f", "json"] }), false);
  assert.equal(isExpectedFixtureAlbumList({
    ...expected,
    report: { ...expected.report, capabilities: [] },
  }), false);
  assert.equal(isExpectedFixtureAlbumList({
    ...expected,
    report: { ...expected.report, albums: [...expected.report.albums, { path: "surprise.md", issues: [{ path: "surprise.md", code: "new_issue", severity: "error" }] }] },
  }), false);
});

test("full scope requires every named workflow and sheet scope explicitly skips them", () => {
  const { parseArgs } = require("./obsidian-record-card-e2e-lib.cjs");
  assert.equal(parseArgs([]).scope, "full");
  assert.equal(parseArgs(["--scope", "sheet"]).scope, "sheet");
  assert.throws(() => parseArgs(["--scope", "maybe"]), /full or sheet/);
  assert.equal(new Set(proof.WORKFLOW_ASSERTIONS).size, proof.WORKFLOW_ASSERTIONS.length);
  const report = { assertions: [] };
  proof.requireInventory(report, "full");
  assert.equal(report.assertions.length, proof.WORKFLOW_ASSERTIONS.length);
  assert.ok(report.assertions.every(row => row.mandatory && row.status === "fail"));
  const partial = { assertions: [] };
  proof.requireInventory(partial, "sheet");
  assert.ok(partial.assertions.every(row => !row.mandatory && row.status === "skipped"));
  const complete = { assertions: proof.WORKFLOW_ASSERTIONS.map(name => ({ name, mandatory: true, status: "pass" })) };
  proof.requireInventory(complete, "full");
  assert.ok(complete.assertions.every(row => row.status === "pass"));
  complete.assertions.push(complete.assertions[0]);
  assert.throws(() => proof.requireInventory(complete, "full"), /Duplicate/);
});

test("status proof rejects writes outside the status span and generated callout", () => {
  const before = { "a/r.md": '---\nstatus: "draft"\ntitle: R\n---\nBody\n',
    "a.md": '# Album\n\n> [!records]\n> Draft\n\nTail\n', "unrelated.md": "untouched\n" };
  const after = { ...before, "a/r.md": before["a/r.md"].replace('"draft"', 'ready'),
    "a.md": before["a.md"].replace('> Draft', '> Ready') };
  const verify = value => proof.assertStatusWrite(before, value, "a/r.md", "a.md", "draft", "ready");
  assert.doesNotThrow(() => verify(after));
  assert.throws(() => verify({ ...after, "a/r.md": after["a/r.md"].replace('Body', 'Changed') }));
  assert.throws(() => verify({ ...after, "a.md": after["a.md"].replace('Tail', 'Changed') }));
  assert.throws(() => verify({ ...after, "unrelated.md": "changed" }));
  assert.throws(() => verify({ ...after, "extra.md": "new" }));
  assert.throws(() => verify({ ...after, "a.md": before["a.md"] }), /regroup/);
  assert.throws(() => proof.splitCallout('No callout'), /absent/);
});

test("freshness proof rejects old-value flashes, missing sheets, and inadequate samples", () => {
  const sample = value => ({ value, sheets: 1 });
  const good = [sample('Draft'), sample('Ready'), sample('Ready'), sample('Ready')];
  assert.doesNotThrow(() => proof.assertNoFlash(good, 'Ready'));
  assert.throws(() => proof.assertNoFlash([sample('Draft')], 'Ready'), /never displayed/);
  assert.throws(() => proof.assertNoFlash(good.slice(0, 2), 'Ready'), /insufficient/);
  assert.throws(() => proof.assertNoFlash([...good, sample('Draft')], 'Ready'), /flashed/);
  assert.throws(() => proof.assertNoFlash([...good, {value:'Ready',sheets:2}], 'Ready'), /duplicated/);
});

test("Undo proof permits canonical choice quoting and rejects value or unrelated byte changes", () => {
  const before = { "a/r.md": '---\nstatus: "draft"\n---\nBody\n', "a.md": 'Album\n', "other.md": 'Kept\n' };
  const restored = { ...before, "a/r.md": before["a/r.md"].replace('"draft"', 'draft') };
  const check = value => proof.assertStatusRestored(before, value, "a/r.md", "a.md", "draft");
  assert.doesNotThrow(() => check(restored));
  assert.throws(() => check({ ...restored, "a/r.md": restored["a/r.md"].replace('draft', 'ready') }));
  assert.throws(() => check({ ...restored, "a/r.md": restored["a/r.md"].replace('Body', 'Changed') }));
  assert.throws(() => check({ ...restored, "a.md": 'Changed album\n' }));
  assert.throws(() => check({ ...restored, "other.md": 'Changed unrelated\n' }));
});

test("real-process shim preserves writer stdin, exit status, and separate apply/preview evidence", () => {
  const { writeBobShim } = require('./obsidian-record-card-e2e.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-shim-test-'));
  try {
    const real = path.join(root, 'real-bob');
    fs.writeFileSync(real, '#!/usr/bin/env node\nconst fs=require("node:fs");process.stdout.write(fs.readFileSync(0));process.exit(process.argv.includes("refuse")?3:0);\n', { mode: 0o755 });
    const log = path.join(root, 'log.jsonl');
    const shim = writeBobShim(path.join(root, 'shim'));
    const envelope = JSON.stringify({ schema_version: 1, expect: 'fingerprint', ops: [{op:'field.set',field:'tags',value:['A, B']}] });
    const env = { ...process.env, BOB_RECORD_CARD_E2E_REAL: real, BOB_RECORD_CARD_E2E_LOG: log };
    for (const extra of [[], ['-d'], ['--dry-run'], ['refuse']]) {
      const result = spawnSync(shim, ['records', 'update', 'movies', 'record', '-i', '-', ...extra], { env, input: envelope, encoding:'utf8', timeout:5000 });
      assert.equal(result.status, extra[0] === 'refuse' ? 3 : 0, result.stderr);
      assert.equal(result.stdout, envelope);
    }
    const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(entries.filter(row => row.event === 'finish').length, 4);
    assert.equal(proof.writerCalls(entries).length, 2);
    assert.equal(proof.writerCalls(entries)[0].input, envelope);
    assert.equal(entries.at(-1).exitCode, 3);
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
});

test("typed fixtures cover seven stage kinds and comma-containing list values", () => {
  assert.deepEqual(proof.TYPED_FIELDS.map(row => row.kind), ['number','text','date','url','suggest','link','list']);
  const list = proof.TYPED_FIELDS.find(row => row.kind === 'list');
  assert.deepEqual(list.persisted, ['Science, fiction']);
  const notes = require('./obsidian-record-card-e2e-lib.cjs').fixtureNotes();
  assert.match(notes['movies.md'], /reference: \{values: link\}/);
  assert.match(notes['movies.md'], /tags: \{list: true\}/);
});

test("fresh disk reads accept the records show model without an update ok envelope", () => {
  const note = "movies/equilibrium.md";
  const report = {schema_version:1, record:{path:note, properties:[{key:"year", value:2003}]}};
  const result = {exitCode:0, signal:null, report};
  assert.equal(proof.readRecordResult(result, note), report);
  assert.throws(() => proof.readRecordResult({...result, exitCode:1}, note), /show failed/);
  assert.throws(() => proof.readRecordResult({...result, signal:"SIGTERM"}, note), /interrupted/);
  assert.throws(() => proof.readRecordResult({...result, report:null}, note), /schema/);
  assert.throws(() => proof.readRecordResult({...result, report:{...report, schema_version:2}}, note), /schema/);
  assert.throws(() => proof.readRecordResult(result, "movies/other.md"), /another record/);
  assert.throws(() => proof.readRecordResult({...result, report:{...report, record:{path:note}}}, note), /properties/);
  assert.throws(() => proof.readRecordResult({...result, report:{schema_version:1, ok:true}}, note), /another record/);
});

test("sheet proof compares presentation strings while preserving number and list semantics", () => {
  const sheet = row => ({row:{state:"valid", ...row}, ghost:false});
  proof.assertSheetValue(sheet({raw:"2003", numeric:true}), 2003);
  proof.assertSheetValue(sheet({raw:"Science, fiction", chips:[{value:"Science, fiction"}]}), ["Science, fiction"]);
  for (const value of ["A keyboard edit", "2026-11-17", "https://example.test/edited", "[[nj_towns]]"])
    proof.assertSheetValue(sheet({raw:value}), value);
  proof.assertSheetValue({row:null, ghost:true}, null);
  assert.throws(() => proof.assertSheetValue(null, 2003), /absent/);
  assert.throws(() => proof.assertSheetValue(sheet({raw:"2002", numeric:true}), 2003));
  assert.throws(() => proof.assertSheetValue(sheet({raw:"2003", numeric:false}), 2003));
  assert.throws(() => proof.assertSheetValue(sheet({raw:"2003", state:"invalid"}), 2003), /invalid/);
  assert.throws(() => proof.assertSheetValue(sheet({raw:"Science, fiction", chips:[{value:"Science"},{value:"fiction"}]}), ["Science, fiction"]));
  assert.throws(() => proof.assertSheetValue({row:null, ghost:false}, null), /no ghost/);
  assert.throws(() => proof.assertSheetValue(sheet({raw:"2026-11-17"}), null), /still has a value/);
});
