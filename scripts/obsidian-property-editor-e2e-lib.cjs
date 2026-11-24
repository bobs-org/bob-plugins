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
  "Prove Property Editor writes, panes, entry points, close keys, unload, and visuals",
  "in a disposable Obsidian vault.",
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
  "panes-save-unsaved-editor-text",
  "stale-draft-keeps-preview-requirement",
  "history-survives-close-reopen",
  "yaml-done-restores-leaf-and-key",
  "yaml-done-nearest-row-after-external-delete",
  "yaml-done-retains-duplicate-occurrence",
  "close-esc-q-ctrl-bracket-ladder",
  "q-types-in-text-field",
  "ctrl-bracket-never-types",
  "unload-open-modal-clears-listeners",
  "unload-pending-preview-no-late-reopen",
  "entry-plus-chord-live-preview-vim",
  "entry-plus-chord-shift-equals",
  "entry-palette-edit-note-properties",
  "entry-command-mode-row",
  "entry-drawer-key-label",
  "entry-drawer-add-property",
  "entry-drawer-edit-all",
  "entry-api-open-property-editor",
  "entry-ordinary-and-invalid-yaml-notes",
  "parity-rename-undo-disk-bytes",
  "parity-rename-refusals-keep-draft",
  "parity-reorder-comments-undo-disk-bytes",
  "parity-reorder-filter-lockout",
  "parity-mark-range-delete-undo-disk-bytes",
  "parity-mixed-protected-delete-refused",
  "parity-filter-return-empty-ladder",
  "parity-source-exact-copy",
  "parity-paste-preview-apply-undo-disk-bytes",
  "parity-paste-stale-preview-invalidated",
  "parity-paste-malformed-blocked",
  "parity-yaml-stage-save-disk-bytes",
  "parity-yaml-stage-refusals-kept",
  "parity-kind-convert-undo-disk-bytes",
  "parity-kind-created-warning",
  "parity-vault-type-change-confined",
  "parity-close-ladder-filter-modal",
  "parity-native-clipboard-in-inputs",
  "parity-two-pane-unsaved-rename",
  "parity-unload-paste-no-late-write",
  "parity-screenshots-views-layout",
  "screenshots-light-dark-narrow-wide",
  "screenshots-layout-probes-light-dark-narrow-wide",
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
      "  noun: acceptance_fixture",
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
    "surfaces.md": [
      "---",
      'type: "[[note]]"',
      'keep_me: "original"',
      'edit_me: "draft"',
      "---",
      "",
      "# Surfaces",
      "",
      "Body bytes stay outside pane and stale-draft edits.",
      "",
    ].join("\n"),
    "parity.md": [
      "---",
      "# Parity comment travels with alpha",
      "alpha: one",
      "beta: two",
      "# Comment for gamma",
      "gamma: three",
      "tags: [home]",
      'status: "draft"',
      "details:",
      "  city: Springfield",
      '  zip: "12345"',
      "count: 3",
      "enabled: true",
      "created: 2026-11-23",
      "anchored: &a hello",
      "---",
      "",
      "# Parity",
      "",
      "Body stays outside parity edits.",
      "",
    ].join("\n"),
    "ordinary.md": [
      "---",
      'type: "[[note]]"',
      'title: "Ordinary note"',
      "---",
      "",
      "# Ordinary note",
      "",
    ].join("\n"),
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
      readSettled: Boolean(report || plugin?.propertyEditorModal?.refusal),
      focusedRow: document.activeElement?.getAttribute?.("data-property-row") || "",
      heading: editor.querySelector(".bob-property-editor-heading")?.textContent || "",
      rows: Array.from(editor.querySelectorAll("[data-property-row]")).map((row) => ({
        key: row.getAttribute("data-property-key"),
        id: row.getAttribute("data-property-row"),
        line: Number((row.getAttribute("data-property-row") || "").split("::").pop()) || null,
        action: row.getAttribute("data-property-action"),
        disabled: row.getAttribute("aria-disabled") === "true",
        selected: row.getAttribute("aria-selected") === "true",
        marked: row.getAttribute("data-property-marked") === "true",
        text: row.textContent || "",
        valueText: row.querySelector(".bob-property-row-value")?.textContent ?? null,
        gutter: row.querySelector(".bob-property-row-mark")?.textContent ?? null,
        diagnostic: row.getAttribute("title") || "",
        classes: String(row.className || ""),
        selectedClass: row.classList.contains("is-selected"),
        lockedClass: row.classList.contains("is-locked"),
        markedClass: row.classList.contains("is-marked"),
      })),
      announce: plugin?.propertyEditorModal?.announce || "",
      filterOpen: plugin?.propertyEditorModal?.filterOpen === true,
      filterQuery: editor.querySelector("[data-property-filter-input='true']")?.value || "",
      filterEmpty: editor.querySelector(".bob-property-editor-filter-empty")?.textContent || "",
      filterFocused: document.activeElement?.getAttribute?.("data-property-filter-input") === "true",
      clipboardOpen: Boolean(editor.querySelector("[data-property-clipboard-stage]")),
      clipboardTitle: editor.querySelector("[data-property-clipboard-stage] .bob-property-editor-stage-title")?.textContent || "",
      clipboardRows: Array.from(editor.querySelectorAll(".bob-property-editor-clipboard-row")).map((row) => ({
        key: row.querySelector(".bob-property-editor-clipboard-key")?.textContent || "",
        state: row.querySelector(".bob-property-editor-clipboard-state")?.textContent || "",
        reason: row.querySelector(".bob-property-editor-clipboard-reason")?.textContent || "",
        values: Array.from(row.querySelectorAll(".bob-property-editor-clipboard-value-text")).map((node) => node.textContent || ""),
        classes: String(row.className || ""),
      })),
      clipboardApplyLabel: editor.querySelector("[data-property-clipboard-action='apply']")?.textContent || "",
      clipboardApplyDisabled: editor.querySelector("[data-property-clipboard-action='apply']")?.disabled !== false,
      kindWarning: editor.querySelector("[data-property-kind-warning]")?.textContent || "",
      vaultConfirm: editor.querySelector("[data-property-kind-vault-confirm]")?.textContent || "",
      properties: Array.isArray(report?.properties) ? report.properties.map((row) => ({ key: row.key, line: row.line, kind: row.kind, role: row.role, duplicate: row.duplicate === true, diagnostic: row.diagnostic || "" })) : [],
      banner: editor.querySelector(".bob-property-editor-banner")?.textContent || "",
      recovery: editor.querySelector(".bob-property-editor-banner.is-recovery")?.textContent || "",
      status: editor.querySelector(".bob-property-editor-status")?.textContent || "",
      stage: editor.querySelector("[data-property-stage], [data-property-add]")?.getAttribute("aria-label") || "",
      stageKind: plugin?.propertyEditorModal?.stage?.kind || null,
      stageInput: document.querySelector("[data-property-stage-input], [data-property-add-input]")?.value || "",
      stagePreview: editor.querySelector(".bob-property-editor-stage-preview")?.textContent || "",
      focusTag: document.activeElement?.tagName || "",
      focusClass: String(document.activeElement?.className || ""),
      inInput: Boolean(document.activeElement?.closest?.("input,textarea,[contenteditable='true']")),
      menuOpen: plugin?.propertyEditorModal?.menuOpen === true,
      history: typeof plugin?.propertyHistory?.snapshot === "function"
        ? plugin.propertyHistory.snapshot(plugin?.propertyEditorModal?.filePath || "")
        : null,
      filePath: plugin?.propertyEditorModal?.filePath || "",
      frontmatterState: report?.frontmatter?.state || "",
      frontmatterError: report?.frontmatter?.error?.message || "",
      frontmatterErrorLine: report?.frontmatter?.error?.line || null,
      ownershipDiagnostics: report?.ownership_diagnostics || [],
    };
  })()`;
}

function visualLayoutSource() {
  return `(() => {
    const parse = (value) => {
      const match = String(value || "").match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const lum = (rgb) => {
      if (!rgb) return 0;
      const channel = (value) => {
        const next = value / 255;
        return next <= 0.03928 ? next / 12.92 : ((next + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    };
    const contrast = (left, right) => {
      const hi = Math.max(lum(left), lum(right));
      const lo = Math.min(lum(left), lum(right));
      return (hi + 0.05) / (lo + 0.05);
    };
    const editor = document.querySelector(".bob-property-editor");
    const modal = editor?.closest(".modal") || editor;
    if (!editor || !modal) return { open: false };
    const selected = editor.querySelector("[data-property-row][aria-selected='true']");
    const locked = editor.querySelector("[data-property-row][aria-disabled='true']");
    const marked = editor.querySelector("[data-property-row][data-property-marked='true']");
    const markedGutter = marked?.querySelector?.(".bob-property-row-mark") || null;
    const unmarkedRow = Array.from(editor.querySelectorAll("[data-property-row]"))
      .find((row) => row.getAttribute("data-property-marked") !== "true");
    const unmarkedGutter = unmarkedRow?.querySelector?.(".bob-property-row-mark") || null;
    const loose = Array.from(editor.querySelectorAll("[data-property-row]"))
      .find((row) => row.getAttribute("aria-disabled") !== "true");
    const focused = document.activeElement?.closest?.("[data-property-row]") || null;
    const styleOf = (node) => node ? getComputedStyle(node) : null;
    const boxOf = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const boxesOverlap = (left, right) => Boolean(left && right
      && !(left.right <= right.left + 1 || right.right <= left.left + 1
        || left.bottom <= right.top + 1 || right.bottom <= left.top + 1));
    const modalBox = boxOf(modal);
    const rows = Array.from(editor.querySelectorAll("[data-property-row]"));
    const keyValueOverlap = rows.some((row) => boxesOverlap(
      boxOf(row.querySelector(".bob-property-row-key")),
      boxOf(row.querySelector(".bob-property-row-value")),
    ));
    const rowOverlap = rows.some((row, index) => {
      if (index === 0) return false;
      const prev = rows[index - 1];
      const prevBox = boxOf(prev);
      const prevValue = boxOf(prev.querySelector(".bob-property-row-value"));
      const thisBox = boxOf(row);
      const thisKey = boxOf(row.querySelector(".bob-property-row-key"));
      return boxesOverlap(prevBox, thisBox)
        || boxesOverlap(prevValue, thisBox)
        || boxesOverlap(prevValue, thisKey);
    });
    const valueOverflow = rows.some((row) => {
      const rowBox = boxOf(row);
      const valueBox = boxOf(row.querySelector(".bob-property-row-value"));
      if (!rowBox || !valueBox || valueBox.height === 0) return false;
      return valueBox.bottom > rowBox.bottom + 2 || valueBox.right > rowBox.right + 2
        || valueBox.left < rowBox.left - 2;
    });
    const clipped = valueOverflow || rows.some((row) => {
      const rect = row.getBoundingClientRect();
      return rect.right > modalBox.right + 2 || rect.left < modalBox.left - 2;
    });
    const selectedStyle = styleOf(selected);
    const lockedStyle = styleOf(locked);
    const looseStyle = styleOf(loose);
    const markedGutterStyle = styleOf(markedGutter);
    const unmarkedGutterStyle = styleOf(unmarkedGutter);
    const focusedStyle = styleOf(focused);
    const modalBg = parse(styleOf(modal)?.backgroundColor);
    return {
      open: true,
      clipped,
      keyValueOverlap,
      rowOverlap,
      valueOverflow,
      selectedDisplay: selectedStyle?.display || "",
      selectedBackground: selectedStyle?.backgroundColor || "",
      looseBackground: looseStyle?.backgroundColor || "",
      selectedBorder: selectedStyle?.borderColor || "",
      lockedColor: lockedStyle?.color || "",
      looseColor: looseStyle?.color || "",
      lockedContrast: lockedStyle ? contrast(parse(lockedStyle.color), modalBg || parse(lockedStyle.backgroundColor)) : 0,
      selectedDiffers: Boolean(selectedStyle && looseStyle && selectedStyle.backgroundColor !== looseStyle.backgroundColor),
      markedGutterColor: markedGutterStyle?.color || "",
      unmarkedGutterColor: unmarkedGutterStyle?.color || "",
      markedDiffers: Boolean(markedGutterStyle && unmarkedGutterStyle && markedGutterStyle.color !== unmarkedGutterStyle.color),
      markedReadable: markedGutterStyle ? contrast(parse(markedGutterStyle.color), modalBg || parse(markedGutterStyle.backgroundColor)) : 0,
      markedKey: marked?.getAttribute("data-property-key") || "",
      focusOutlineWidth: focusedStyle ? Number.parseFloat(focusedStyle.outlineWidth || "0") : 0,
      focusOutlineStyle: focusedStyle?.outlineStyle || "",
      rowCount: rows.length,
      selectedKey: selected?.getAttribute("data-property-key") || "",
      lockedKey: locked?.getAttribute("data-property-key") || "",
      selectedClasses: String(selected?.className || ""),
      lockedClasses: String(locked?.className || ""),
    };
  })()`;
}

const COVERAGE_PATTERNS = {
  "project-edit-undo-redo-disk-bytes": [/^project edit (bytes|undo bytes|redo bytes)$/],
  "project-add-disk-bytes": [/^project add bytes$/],
  "project-delete-undo-disk-bytes": [/^project (delete bytes|delete undo bytes|final delete bytes)$/],
  "plain-note-add-undo-redo-framing-disk-bytes": [/plain-note/, /^first plain-note add bytes$/],
  "tab-completion-preserves-known-type": [/Tab completion chooses known type/, /Tab-completed tags add bytes/],
  "shift-enter-keeps-literal-name-as-text": [/Shift\+Enter keeps literal name/, /literal name remains text/, /literal name add bytes/],
  "day-note-edit-disk-bytes": [/^day-note /],
  "record-field-handoff": [/canonical record field/, /record-field handoff/],
  "derived-and-identity-gestures-refused-and-yaml-targets": [/derived /, /identity /],
  "checkbox-flip-disk-bytes": [/checkbox flip bytes/],
  "datetime-no-offset-disk-bytes": [/datetime without offset/],
  "datetime-explicit-offset-disk-bytes": [/datetime with -05:00/],
  "datetime-relative-token-disk-bytes": [/relative datetime token/],
  "tags-without-hash-disk-bytes": [/tags omit leading hash/, /tags use tags stage/],
  "ordered-list-disk-bytes": [/ordered list/],
  "null-versus-empty-string-disk-bytes": [/null and empty/],
  "prose-link-task-band-when-navigation-is-loaded": [/prose stage attaches navigation band/],
  "old-bob-read-only": [/old-bob read-only/],
  "invalid-unclosed-and-duplicate-yaml-recovery-targets": [/invalid YAML/, /unclosed YAML/, /duplicate YAML/, /duplicate y targets/],
  "exact-note-bytes-after-every-write": [/bytes$/],
  "panes-save-unsaved-editor-text": [/unsaved pane/, /apply saved unsaved pane/],
  "stale-draft-keeps-preview-requirement": [/stale refusal/, /fresh preview required after stale/],
  "history-survives-close-reopen": [/history survives close and reopen/, /reopened undo restores bytes/],
  "yaml-done-restores-leaf-and-key": [/Done restores Live Preview/, /Done reopens the same key/],
  "yaml-done-nearest-row-after-external-delete": [/Done lands on nearest remaining edit_me occurrence/],
  "yaml-done-retains-duplicate-occurrence": [/Done reopens the second duplicate title occurrence/],
  "close-esc-q-ctrl-bracket-ladder": [/peels the (menu|stage)/, /closes the modal from browse/],
  "q-types-in-text-field": [/q types in a text field/],
  "ctrl-bracket-never-types": [/Ctrl\+\[ never types/],
  "unload-open-modal-clears-listeners": [/disabling the plugin closes the open modal/, /disabling while browsing leaves no editor/],
  "unload-pending-preview-no-late-reopen": [/pending preview does not reopen after unload/, /no late reopen after browse unload/],
  "entry-plus-chord-live-preview-vim": [/\+ Live Preview Vim key/, /pending = then \+ does not open the editor/],
  "entry-plus-chord-shift-equals": [/Shift\+= Live Preview Vim key/],
  "entry-palette-edit-note-properties": [/palette Edit note properties/],
  "entry-command-mode-row": [/Command Mode row opens the editor/],
  "entry-drawer-key-label": [/drawer key-label/],
  "entry-drawer-add-property": [/drawer Add property/],
  "entry-drawer-edit-all": [/drawer Edit all/],
  "entry-api-open-property-editor": [/API openPropertyEditor/],
  "entry-ordinary-and-invalid-yaml-notes": [/API openPropertyEditor on an ordinary note/, /API openPropertyEditor on invalid YAML/, /palette opens invalid YAML recovery/],
  "parity-rename-undo-disk-bytes": [/parity rename bytes/, /parity rename undo bytes/, /parity rename redo bytes/],
  "parity-rename-refusals-keep-draft": [/parity duplicate rename/, /parity protected rename refused/, /parity rename draft kept/, /parity same-name rename no-op/],
  "parity-reorder-comments-undo-disk-bytes": [/parity reorder moves comment/, /parity reorder undo bytes/, /parity reorder boundary no-op bytes/, /parity move announces source position/],
  "parity-reorder-filter-lockout": [/parity reorder under filter refused/, /parity menu disables reorder under filter/],
  "parity-mark-range-delete-undo-disk-bytes": [/parity range marks rows/, /parity batch delete bytes/, /parity batch delete undo bytes/],
  "parity-mixed-protected-delete-refused": [/parity mixed protected delete refused/, /parity mixed delete leaves bytes unchanged/],
  "parity-filter-return-empty-ladder": [/parity filter narrows/, /parity filter Enter returns focus/, /parity empty filter message/, /parity filter Esc clears layer/, /parity filter change clears marks/],
  "parity-source-exact-copy": [/parity copy announces/, /parity clipboard holds source-exact bytes/, /parity protected row copies/, /parity opaque copy refused/],
  "parity-paste-preview-apply-undo-disk-bytes": [/parity paste preview labels/, /parity paste apply bytes/, /parity paste undo bytes/],
  "parity-paste-stale-preview-invalidated": [/parity stale paste keeps draft/],
  "parity-paste-malformed-blocked": [/parity malformed paste blocked/, /parity all-skipped paste disables apply/],
  "parity-yaml-stage-save-disk-bytes": [/parity YAML map save bytes/, /parity YAML save undo bytes/],
  "parity-yaml-stage-refusals-kept": [/parity YAML malformed shows bob error/, /parity opaque YAML save refused/],
  "parity-kind-convert-undo-disk-bytes": [/parity convert preview names destination/, /parity convert apply bytes/, /parity convert undo bytes/],
  "parity-kind-created-warning": [/parity created datetime warns/],
  "parity-vault-type-change-confined": [/parity type manager probed/, /parity vault confirm names/, /parity vault unsupported explains/],
  "parity-close-ladder-filter-modal": [/parity Esc peels filter before modal/],
  "parity-native-clipboard-in-inputs": [/parity Mod\+C in input stays native/, /parity Mod\+V in input stays native/],
  "parity-two-pane-unsaved-rename": [/parity rename saves unsaved pane/],
  "parity-unload-paste-no-late-write": [/parity unload with paste preview closes without write/],
  "parity-screenshots-views-layout": [/parity screenshot .* contains the populated editor/, /parity views layout probes/],
  "screenshots-light-dark-narrow-wide": [/screenshots light dark narrow wide/, /screenshot .+ contains the populated editor/],
  "screenshots-layout-probes-light-dark-narrow-wide": [/layout probes every screenshot/, /selected and locked rows are legible/, /selected row is visually distinct/, /values stay inside their rows/],
};

function isStaleRefusalCopy(value) {
  const copy = `${value?.status || ""} ${value?.banner || ""} ${value?.recovery || ""} ${value?.stagePreview || ""}`;
  return /note changed|draft is kept|preview again|preview it against|stale|vault changed/i.test(copy);
}

function yamlHasScalar(text, key, value) {
  const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedValue = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedKey}:\\s*(?:${escapedValue}|"${escapedValue}"|'${escapedValue}')\\s*$`, "m").test(String(text || ""));
}

function coverageFromAssertions(checks, assertions) {
  return checks.map((check) => {
    const patterns = COVERAGE_PATTERNS[check];
    if (!patterns) return { check, status: "fail", detail: "missing coverage pattern" };
    const rows = (assertions || []).filter((item) => patterns.some((re) => re.test(item.name)));
    if (!rows.length) return { check, status: "fail", detail: "no matching assertions" };
    if (rows.some((item) => item.status === "fail")) {
      return { check, status: "fail", detail: rows.filter((item) => item.status === "fail").map((item) => item.name) };
    }
    if (rows.every((item) => item.status === "skip")) {
      return { check, status: "skip", detail: rows[0].detail || "" };
    }
    if (rows.some((item) => item.status === "pass")) {
      return { check, status: "pass", detail: rows.filter((item) => item.status === "pass").map((item) => item.name) };
    }
    return { check, status: "fail", detail: rows.map((item) => item.name) };
  });
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
  assert.match(notes["projects-album.md"], /  noun: acceptance_fixture\n/);
  for (const pathValue of ["projects/project-note.md", "2026/20261123.md", "projects-album/acceptance.md", "invalid.md", "unclosed.md", "duplicate.md", "plain.md", "literal-name.md", "value-kinds.md", "old-bob.md", "surfaces.md", "ordinary.md", "parity.md"]) {
    assert.ok(notes[pathValue], `fixture missing ${pathValue}`);
  }
  assert.match(notes["surfaces.md"], /keep_me: "original"/);
  assert.match(notes["ordinary.md"], /title: "Ordinary note"/);
  assert.match(notes["parity.md"], /# Parity comment travels with alpha/);
  assert.match(notes["parity.md"], /# Comment for gamma/);
  assert.match(notes["parity.md"], /anchored: &a hello/);
  assert.match(notes["parity.md"], /city: Springfield/);
  assert.match(notes["parity.md"], /Body stays outside parity edits\./);
  assert.ok(notes["parity.md"], "fixture missing parity.md");
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
  for (const check of ACCEPTANCE_CHECKS) {
    assert.ok(COVERAGE_PATTERNS[check], `coverage pattern missing for ${check}`);
  }
  assert.equal(typeof visualLayoutSource(), "string");
  assert.match(visualLayoutSource(), /selectedDiffers/);
  assert.match(visualLayoutSource(), /markedDiffers/);
  assert.match(visualLayoutSource(), /markedReadable/);
  assert.match(visualLayoutSource(), /rowOverlap/);
  assert.match(visualLayoutSource(), /valueOverflow/);
  assert.match(editorProbeSource(), /selectedClass/);
  assert.match(editorProbeSource(), /markedClass/);
  assert.match(editorProbeSource(), /stagePreview/);
  assert.match(editorProbeSource(), /filterOpen/);
  assert.match(editorProbeSource(), /filterEmpty/);
  assert.match(editorProbeSource(), /clipboardOpen/);
  assert.match(editorProbeSource(), /clipboardApplyDisabled/);
  assert.match(editorProbeSource(), /kindWarning/);
  assert.match(editorProbeSource(), /vaultConfirm/);
  assert.match(editorProbeSource(), /announce/);
  assert.equal(isStaleRefusalCopy({
    status: "The note changed. Your draft is kept; press Enter to preview it against the current note. — Nothing was written.",
    banner: "",
    stagePreview: "The note changed; preview this draft again before saving.",
  }), true);
  assert.equal(isStaleRefusalCopy({ status: "Preview ready · Enter saves", banner: "", stagePreview: "Preview · edit_me: held-draft" }), false);
  assert.equal(yamlHasScalar('edit_me: "draft"\nkeep_me: elsewhere\n', "edit_me", "draft"), true);
  assert.equal(yamlHasScalar("edit_me: draft\n", "edit_me", "draft"), true);
  assert.equal(yamlHasScalar('edit_me: "held-draft"\n', "edit_me", "draft"), false);
  assert.equal(yamlHasScalar('edit_me: "draft"\n', "edit_me", "held-draft"), false);
  assert.equal(/draft/.test("≡edit_meheld-draft"), true);
  assert.equal(({ key: "edit_me", text: "≡edit_meheld-draft", valueText: "held-draft" }).valueText === "draft", false);
  assert.equal(({ key: "edit_me", text: "≡edit_medraft", valueText: "draft" }).valueText === "draft", true);

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
  COVERAGE_PATTERNS,
  HELP_TEXT,
  assertProbe,
  coverageFromAssertions,
  editorProbeSource,
  fixtureNotes,
  isStaleRefusalCopy,
  parseArgs,
  selfTest,
  showFixture,
  visualLayoutSource,
  yamlHasScalar,
};
