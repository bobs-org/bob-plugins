// Fixtures and DOM probes for the real-Obsidian Property Editor acceptance.
// The online runner uses a pinned bob-cli binary; these offline checks never
// launch Obsidian and exercise fake-bob only at its JSON boundary.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HELP_TEXT = [
  "Usage: node scripts/obsidian-property-editor-e2e.cjs [OPTIONS]",
  "",
  "Prove Property Editor writes and role routing in a disposable Obsidian vault.",
  "Set BOB_BIN and BOB_CLI_DIR to the exact debug binary and bob-cli checkout.",
  "Run under xvfb-run -a on Linux when the Obsidian Electron window needs a display.",
  "",
  "Options:",
  "  -e, --executable PATH   Obsidian Electron binary",
  "  -o, --out DIRECTORY    Save light/dark and narrow/wide screenshots here",
  "  -r, --report PATH      Write the structured JSON report here",
  "  -s, --self-test        Run offline fixtures and fake-bob checks only",
  "  -h, --help             Print this help",
].join("\n");

const ACCEPTANCE_CHECKS = [
  "project-edit-undo-redo-disk-bytes",
  "project-add-disk-bytes",
  "project-delete-undo-disk-bytes",
  "plain-note-add-undo-redo-framing-disk-bytes",
  "tab-completion-preserves-known-type",
  "shift-enter-keeps-literal-name-as-text",
  "day-note-edit-disk-bytes",
  "record-field-handoff",
  "derived-and-identity-gestures-refused-and-yaml-targets",
  "checkbox-flip-disk-bytes",
  "datetime-no-offset-disk-bytes",
  "datetime-explicit-offset-disk-bytes",
  "datetime-relative-token-disk-bytes",
  "tags-without-hash-disk-bytes",
  "ordered-list-disk-bytes",
  "null-versus-empty-string-disk-bytes",
  "prose-link-task-band-when-navigation-is-loaded",
  "old-bob-read-only",
  "invalid-unclosed-and-duplicate-yaml-recovery-targets",
  "exact-note-bytes-after-every-write",
  "screenshots-light-dark-narrow-wide",
];

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const input = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < input.length; i += 1) {
    const value = input[i];
    if (value === "-e" || value === "--executable") {
      const next = input[++i];
      if (!next || next.startsWith("-")) throw new Error("--executable requires a PATH value");
      args.executable = next;
    } else if (value === "-o" || value === "--out") {
      const next = input[++i];
      if (!next || next.startsWith("-")) throw new Error("--out requires a DIRECTORY value");
      args.out = next;
    } else if (value === "-r" || value === "--report") {
      const next = input[++i];
      if (!next || next.startsWith("-")) throw new Error("--report requires a PATH value");
      args.report = next;
    } else if (value === "-s" || value === "--self-test") {
      args.selfTest = true;
    } else if (value === "-h" || value === "--help") {
      args.help = true;
    } else {
      throw new Error("Unknown argument: " + value);
    }
  }
  return args;
}

function fixtureNotes(today = "2026-11-23") {
  const [year, month, day] = today.split("-");
  const dayPath = `${year}/${year}${month}${day}.md`;
  return {
    "root.md": "# Root\n",
    "projects.md": [
      "---",
      'type: "[[area]]"',
      'parent: "[[root]]"',
      "---",
      "",
      "# Projects",
      "",
      "## Albums",
      "",
      "- [[projects]]",
      "",
    ].join("\n"),
    "projects/project-note.md": [
      "---",
      "# Keep this comment exactly as authored",
      'type: "[[project]]"',
      'parent: "[[projects]]"',
      'launch_window: "draft"',
      'keep_exact: "keep : and # exactly"',
      "remove_me: temporary",
      "project_digest: sha256:0123456789abcdef",
      "review_enabled: false",
      "locked_toggle: false",
      "---",
      "",
      "# Project note",
      "",
      "Body bytes stay outside the property edit.",
      "",
    ].join("\n"),
    "projects-album/acceptance.md": [
      "---",
      'type: "[[record]]"',
      'parent: "[[projects-album]]"',
      'title: "Acceptance record"',
      "created: 2026-11-23",
      'status: "draft"',
      "---",
      "",
      "# Acceptance record",
      "",
    ].join("\n"),
    "projects-album.md": [
      "---",
      'type: "[[album]]"',
      'parent: "[[projects]]"',
      "title: Projects",
      "summary: Property editor acceptance fixtures.",
      "record:",
      "  noun: project",
      "  fields:",
      "    status: {required: true, values: {draft: Draft, ready: Ready}}",
      "---",
      "",
      "# Projects album",
      "",
    ].join("\n"),
    [dayPath]: [
      "---",
      'parent: "[[2026-W48]]"',
      "intentions: []",
      "created: 2026-11-23",
      'day_marker: "day stays : exact #"',
      "review_digest: sha256:fedcba9876543210",
      "day_remove_me: temporary",
      "---",
      "",
      `# ${today}`,
      "",
    ].join("\n"),
    "invalid.md": [
      "---",
      'type: "[[note]]"',
      "broken: [unterminated",
      "---",
      "",
      "# Invalid YAML fixture",
      "",
    ].join("\n"),
    "unclosed.md": [
      "---",
      'type: "[[note]]"',
      "broken: [unterminated",
      "# Unclosed YAML fixture",
      "",
    ].join("\n"),
    "duplicate.md": [
      "---",
      'type: "[[note]]"',
      'title: "first"',
      'title: "second"',
      "---",
      "",
      "# Duplicate YAML fixture",
      "",
    ].join("\n"),
    "plain.md": [
      "# Plain note",
      "",
      "Body bytes stay outside the new frontmatter block.",
      "",
    ].join("\n"),
    "literal-name.md": [
      "# Literal name note",
      "",
      "Body bytes stay outside the new frontmatter block.",
      "",
    ].join("\n"),
    "value-kinds.md": [
      "---",
      'type: "[[note]]"',
      "enabled: false",
      'no_offset_at: "2026-11-23T09:30:00"',
      'offset_at: "2026-11-23T09:30:00-05:00"',
      'relative_at: "2026-11-23T09:30:00"',
      "tags: [home]",
      'steps: ["first", "second"]',
      "nullable: null",
      'empty_text: ""',
      'description: "Plain prose"',
      "---",
      "",
      "# Value kinds",
      "",
    ].join("\n"),
    "old-bob.md": ["---", 'custom: "cached row"', "---", "", "# Old bob", ""].join("\n"),
  };
}

function showFixture(pathValue = "projects/project-note.md") {
  return {
    schema_version: 1,
    ok: true,
    path: pathValue,
    note_kind: "project",
    capabilities: ["props_v1"],
    fingerprint: "sha256:offline-fixture",
    frontmatter: { state: "ok", start_line: 1, end_line: 9 },
    properties: [{
      key: "status", line: 4, end_line: 4, value: "draft", kind: "text",
      style: null, role: "loose", owner: null, editor: null, reason: null,
      duplicate: false, opaque: false,
    }],
  };
}

function editorProbeSource() {
  return `(() => {
    const editor = document.querySelector(".bob-property-editor");
    if (!editor) return { open: false };
    const plugin = window.app?.plugins?.plugins?.["bob-ledger-tools"];
    const report = plugin?.propertyEditorModal?.report || null;
    return {
      open: true,
      heading: editor.querySelector(".bob-property-editor-heading")?.textContent || "",
      rows: Array.from(editor.querySelectorAll("[data-property-row]")).map((row) => ({
        key: row.getAttribute("data-property-key"),
        id: row.getAttribute("data-property-row"),
        line: Number((row.getAttribute("data-property-row") || "").split("::").pop()) || null,
        action: row.getAttribute("data-property-action"),
        disabled: row.getAttribute("aria-disabled") === "true",
        selected: row.getAttribute("aria-selected") === "true",
        text: row.textContent || "",
        diagnostic: row.getAttribute("title") || "",
      })),
      properties: Array.isArray(report?.properties) ? report.properties.map((row) => ({ key: row.key, line: row.line, kind: row.kind, role: row.role, duplicate: row.duplicate === true, diagnostic: row.diagnostic || "" })) : [],
      banner: editor.querySelector(".bob-property-editor-banner")?.textContent || "",
      recovery: editor.querySelector(".bob-property-editor-banner.is-recovery")?.textContent || "",
      status: editor.querySelector(".bob-property-editor-status")?.textContent || "",
      stage: editor.querySelector("[data-property-stage], [data-property-add]")?.getAttribute("aria-label") || "",
      stageKind: plugin?.propertyEditorModal?.stage?.kind || null,
      frontmatterState: report?.frontmatter?.state || "",
      frontmatterError: report?.frontmatter?.error?.message || "",
      frontmatterErrorLine: report?.frontmatter?.error?.line || null,
      ownershipDiagnostics: report?.ownership_diagnostics || [],
    };
  })()`;
}

function assertProbe(probe, { heading, rows = [], banner, recovery } = {}) {
  assert.equal(probe?.open, true, "property editor modal must be open");
  if (heading) assert.equal(probe.heading, heading);
  for (const expected of rows) {
    const row = probe.rows.find((entry) => entry.key === expected.key);
    assert.ok(row, `missing property row ${expected.key}`);
    for (const [key, value] of Object.entries(expected)) {
      if (key === "key") continue;
      assert.equal(row[key], value, `${expected.key}.${key}`);
    }
  }
  if (banner !== undefined) assert.match(probe.banner, banner);
  if (recovery !== undefined) assert.match(probe.recovery, recovery);
}

function selfTest() {
  const parsed = parseArgs(["-e", "/opt/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "--self-test"]);
  assert.deepEqual(parsed, { executable: "/opt/obsidian", out: "/tmp/shots", report: "/tmp/report.json", selfTest: true, help: false });
  assert.throws(() => parseArgs(["--out"]), /requires a DIRECTORY/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown argument/);

  const notes = fixtureNotes();
  for (const pathValue of ["projects/project-note.md", "2026/20261123.md", "projects-album/acceptance.md", "invalid.md", "unclosed.md", "duplicate.md", "plain.md", "literal-name.md", "value-kinds.md", "old-bob.md"]) {
    assert.ok(notes[pathValue], `fixture missing ${pathValue}`);
  }
  assert.match(notes["projects/project-note.md"], /# Keep this comment exactly as authored/);
  assert.match(notes["projects/project-note.md"], /keep_exact: "keep : and # exactly"/);
  assert.match(notes["projects/project-note.md"], /project_digest: sha256:/);
  assert.match(notes["2026/20261123.md"], /intentions: \[\]/);
  assert.match(notes["invalid.md"], /broken: \[unterminated/);
  assert.doesNotMatch(notes["unclosed.md"], /\n---\n/);
  assert.equal((notes["duplicate.md"].match(/^title:/gm) || []).length, 2);
  assert.doesNotMatch(notes["plain.md"], /^---$/m);
  assert.match(notes["value-kinds.md"], /offset_at: "2026-11-23T09:30:00-05:00"/);
  assert.deepEqual(ACCEPTANCE_CHECKS, [...new Set(ACCEPTANCE_CHECKS)]);

  const fakeBob = path.join(__dirname, "fixtures", "fake-bob.cjs");
  const show = showFixture();
  const shown = spawnSync(process.execPath, [fakeBob, "props", "show", show.path, "-f", "json"], {
    encoding: "utf8", env: { ...process.env, FAKE_BOB_PROPS_SHOW_JSON: JSON.stringify(show) }, timeout: 10_000,
  });
  assert.equal(shown.status, 0, shown.stderr || "fake-bob props show failed");
  assert.deepEqual(JSON.parse(shown.stdout), show);

  const envelope = { schema_version: 1, expect: show.fingerprint, ops: [{ op: "prop.set", key: "status", value: "ready", kind: "text" }] };
  const updated = spawnSync(process.execPath, [fakeBob, "props", "update", show.path, "-f", "json", "-i", "-", "-d"], {
    encoding: "utf8", input: JSON.stringify(envelope), timeout: 10_000,
  });
  assert.equal(updated.status, 0, updated.stderr || "fake-bob props update failed");
  assert.deepEqual(JSON.parse(updated.stdout), { schema_version: 1, ok: true, fake_bob: true, envelope });

  const probe = {
    open: true,
    heading: "PROJECT · PROPERTIES",
    rows: [{ key: "project_digest", action: "locked", disabled: true }],
    banner: "Update bob to edit properties here — y opens YAML",
    recovery: "Frontmatter doesn't parse — y opens YAML · line 3",
  };
  assertProbe(probe, { heading: "PROJECT · PROPERTIES", rows: [{ key: "project_digest", action: "locked", disabled: true }], banner: /Update bob/ });
  assertProbe(probe, { recovery: /line 3/ });
  process.stdout.write("offline self-test complete (property fixtures, fake-bob props JSON, and UI probes; no Obsidian launched)\n");
}

module.exports = {
  ACCEPTANCE_CHECKS,
  HELP_TEXT,
  assertProbe,
  editorProbeSource,
  fixtureNotes,
  parseArgs,
  selfTest,
  showFixture,
};
