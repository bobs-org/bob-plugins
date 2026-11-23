// Property editor model: cache-first grouped rows, role routing, and
// degraded states (bob-cli-pf.4.1.2 editor-shell). Pure and DOM-free: no
// top-level document access, no bob spawns, no writes. The modal paints from
// these helpers; later value stages reuse the ops and intents here.
const PROPERTY_EDITOR_GROUPS = ["loose", "card", "identity", "managed"];
const PROPERTY_EDITOR_GROUP_TITLES = {
  loose: "Loose",
  card: "On the kind's card",
  identity: "Identity",
  managed: "Bob-managed",
};
const PROPERTY_EDITOR_NOTE_KIND_LABELS = {
  day: "Day",
  week: "Week",
  quarter: "Quarter",
  year: "Year",
  all_time: "All time",
  record: "Record",
  album: "Album",
  bank: "Bank",
  area: "Area",
  project: "Project",
  notebook: "Notebook",
  reference: "Reference",
  note: "Note",
};
const PROPERTY_EDITOR_OLD_BOB_HINT = "Update bob to edit properties here — y opens YAML";
const PROPERTY_EDITOR_EMPTY_TEXT = "No properties yet — o adds the first";
const PROPERTY_EDITOR_CHECKING_TEXT = "Checking value…";
const PROPERTY_EDITOR_RECOVERY_TEXT = "Frontmatter doesn't parse — y opens YAML";
const PROPERTY_EDITOR_FILTER_SLOT = "filter";

function propertyEditorKindLabel(noteKind) {
  const key = String(noteKind || "").trim().toLowerCase();
  if (PROPERTY_EDITOR_NOTE_KIND_LABELS[key]) return PROPERTY_EDITOR_NOTE_KIND_LABELS[key];
  if (!key) return "Note";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function propertyEditorRoleOf(row) {
  const role = row && typeof row.role === "string" ? row.role.trim().toLowerCase() : "";
  if (role === "loose" || role === "card" || role === "identity" || role === "derived") return role;
  return "unresolved";
}

function propertyEditorIsCheckbox(row) {
  return Boolean(row && (row.kind === "checkbox" || row.kind === "bool" || row.kind === "boolean"));
}

function propertyEditorRowId(row, index) {
  const key = row && typeof row.key === "string" ? row.key : "";
  const line = row && Number.isInteger(row.line) ? row.line : null;
  if (line !== null) return `${key}::${line}`;
  return `${key}::${Number.isInteger(index) ? index : 0}`;
}

function propertyEditorGroupForRow(row) {
  const role = propertyEditorRoleOf(row);
  if (role === "loose") return "loose";
  if (role === "card") return "card";
  if (role === "identity") return "identity";
  return "managed";
}

// Source order is preserved within each group; duplicate keys stay separate
// rows keyed by their source line so they remain separately visible.
function propertyEditorGroupRows(properties) {
  const rows = Array.isArray(properties) ? properties : [];
  const groups = { loose: [], card: [], identity: [], managed: [] };
  rows.forEach((row, index) => {
    if (!row || typeof row.key !== "string") return;
    const group = propertyEditorGroupForRow(row);
    groups[group].push({ id: propertyEditorRowId(row, index), index, group, row });
  });
  return PROPERTY_EDITOR_GROUPS.map((group) => ({
    group,
    title: PROPERTY_EDITOR_GROUP_TITLES[group],
    rows: groups[group],
  })).filter((entry) => entry.rows.length > 0);
}

function propertyEditorOrderedIds(properties) {
  const rows = Array.isArray(properties) ? properties : [];
  return rows
    .map((row, index) => ({ row, index }))
    .filter((entry) => entry.row && typeof entry.row.key === "string")
    .map((entry) => propertyEditorRowId(entry.row, entry.index));
}

function propertyEditorHeaderModel(input = {}) {
  const kindLabel = propertyEditorKindLabel(input.noteKind);
  const path = typeof input.path === "string" ? input.path : "";
  const count = Number.isInteger(input.count)
    ? input.count
    : Array.isArray(input.properties) ? input.properties.length : 0;
  return {
    kindLabel,
    heading: `${kindLabel.toUpperCase()} · PROPERTIES`,
    title: typeof input.title === "string" && input.title ? input.title : kindLabel,
    sub: `${path} · ${count} ${count === 1 ? "property" : "properties"}`,
    path,
    count,
  };
}

// Roles gate every action, not only Enter. Card rows dispatch a typed
// hand-off intent for the entrypoints phase; identity/derived/unresolved rows
// are locked with bob's reason/writer and a YAML escape. Loose rows are
// editable here (checkboxes flip immediately; other kinds open a typed stage
// in the value-stages phase).
function propertyEditorActionForRow(row) {
  const role = propertyEditorRoleOf(row);
  if (role === "card") {
    return {
      action: "handoff",
      editor: row && typeof row.editor === "string" && row.editor ? row.editor : "==",
      owner: row && typeof row.owner === "string" ? row.owner : "",
      key: row ? row.key : "",
    };
  }
  if (role === "loose") {
    if (propertyEditorIsCheckbox(row)) return { action: "toggle", key: row.key };
    return { action: "edit", key: row ? row.key : "" };
  }
  const reason = row && typeof row.reason === "string" && row.reason
    ? row.reason
    : role === "unresolved"
      ? "Ownership is unresolved; writes stay disabled until bob reports a role."
      : "This property is managed elsewhere.";
  const writer = row && typeof row.owner === "string" ? row.owner : "";
  return { action: "locked", reason, writer, key: row ? row.key : "", yamlEscape: true };
}

function propertyEditorCanMutate(row) {
  const decision = propertyEditorActionForRow(row);
  return decision.action === "toggle" || decision.action === "edit";
}

// Cache values may paint first but never authorize a mutation: cache rows
// carry pending:true and stay locked until a validated current report
// reconciles them.
function propertyEditorCacheRows(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return [];
  return Object.keys(frontmatter).map((key, index) => ({
    key,
    value: frontmatter[key],
    line: null,
    end_line: null,
    kind: null,
    style: null,
    role: null,
    owner: null,
    editor: null,
    reason: null,
    duplicate: false,
    opaque: false,
    pending: true,
    cacheIndex: index,
  }));
}

function propertyEditorFrontmatterState(report) {
  if (report && report.frontmatter && typeof report.frontmatter.state === "string") {
    return report.frontmatter.state;
  }
  return "";
}

function propertyEditorRecoveryIssue(report) {
  if (!report || typeof report !== "object") return null;
  const state = propertyEditorFrontmatterState(report);
  if (state !== "invalid" && state !== "unclosed" && state !== "duplicate") return null;
  const rows = Array.isArray(report.properties) ? report.properties : [];
  let line = null;
  for (const row of rows) {
    if (row && Number.isInteger(row.line)) {
      if (line === null || row.line < line) line = row.line;
    }
  }
  if (line === null && report.frontmatter && Number.isInteger(report.frontmatter.start_line)) {
    line = report.frontmatter.start_line;
  }
  return { state, line };
}

// Degraded states: old bob (cached rows, writes disabled), recovery
// (diagnostics + source-line target), empty (first-add hint), cache
// (pre-report paint), or ready. Never invents roles for cache rows.
function propertyEditorDegradedFor(input = {}) {
  const capability = input.capability;
  if (capability === false) {
    return { mode: "old-bob", writable: false, hint: PROPERTY_EDITOR_OLD_BOB_HINT };
  }
  const report = input.report || null;
  if (!report) {
    const cacheRows = Array.isArray(input.cacheRows) ? input.cacheRows : [];
    if (cacheRows.length === 0) return { mode: "empty", writable: false, text: PROPERTY_EDITOR_EMPTY_TEXT };
    return { mode: "cache", writable: false, hint: PROPERTY_EDITOR_CHECKING_TEXT };
  }
  if (report.ok === false) {
    const code = report.error && typeof report.error.code === "string" ? report.error.code : "";
    const message = report.error && typeof report.error.message === "string" ? report.error.message : "";
    const hint = report.error && typeof report.error.hint === "string" ? report.error.hint : "";
    return { mode: "report-error", writable: false, code, message, hint };
  }
  const issue = propertyEditorRecoveryIssue(report);
  if (issue) {
    return {
      mode: "recovery",
      writable: false,
      state: issue.state,
      line: issue.line,
      text: PROPERTY_EDITOR_RECOVERY_TEXT,
    };
  }
  const rows = Array.isArray(report.properties) ? report.properties : [];
  if (rows.length === 0) return { mode: "empty", writable: true, text: PROPERTY_EDITOR_EMPTY_TEXT };
  return { mode: "ready", writable: typeof propertyShowAllowsWrite === "function" ? propertyShowAllowsWrite(report) : false };
}

function propertyEditorToggleOp(row) {
  if (!row || typeof row.key !== "string" || !row.key) return null;
  return { op: "prop.set", key: row.key, value: !(row.value === true) };
}

function propertyEditorUnsetOp(row) {
  if (!row || typeof row.key !== "string" || !row.key) return null;
  return { op: "prop.unset", key: row.key };
}

function propertyEditorStatusSaved() {
  return { kind: "saved", text: "✓ Saved · u undo" };
}

function propertyEditorStatusChecking() {
  return { kind: "checking", text: PROPERTY_EDITOR_CHECKING_TEXT };
}

function propertyEditorStatusRefusal(report) {
  const error = report && typeof report === "object" ? report : {};
  const model = typeof propertyUpdateErrorModel === "function"
    ? propertyUpdateErrorModel(error.code ? error : { code: "failed", message: String(error.message || ""), hint: error.hint })
    : { code: error.code || "failed", hint: error.hint || error.message || "" };
  return {
    kind: "refusal",
    code: error.code || model.code || "failed",
    message: error.message || model.code || "The property update failed.",
    hint: error.hint || model.hint || "",
  };
}
