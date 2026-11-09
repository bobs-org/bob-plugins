// Create notebook here: the pure model (plan 202611/bob_notebooks.md, phase
// plugins-notebook-gestures). The command runs in an area, a project, or a
// notebook; the modal asks for a required one-line summary, an ID suggested
// from the summary by the block-ID prompt's own naming function, and an
// optional title; `bob notebooks create` writes `<parent>_<id>.md` and every
// affected catalog row in one guarded write. Nothing here reads the vault or
// touches the DOM.
const NOTEBOOK_CREATE_SUMMARY_SOFT_MAX = 140;
const NOTEBOOK_CREATE_ID_RE = /^[A-Za-z0-9-]+$/;

// Why the active note cannot host a notebook, or null when it can.
function notebookCreateHostRefusal(ruleKind, name) {
  if (ruleKind === "area" || ruleKind === "project" || ruleKind === "notebook") {
    return null;
  }
  return `${name || "This note"} is not an area, project, or notebook — open one to create a notebook there`;
}

// `<parent>_<id>` with hyphens turned into underscores, the file stem bob
// writes (`docs/notebooks.md` Create).
function notebookCreateFileStem(parentStem, id) {
  return `${String(parentStem || "")}_${String(id || "").replace(/-/g, "_")}`;
}

// Every ID already spent under `parentStem`, in the hyphenated spelling the
// suggestion function walks: a file `dev_nvim_lua` spends `nvim_lua` and
// `nvim-lua`. Case-insensitive, like bob's collision check.
function notebookCreateTakenIds(parentStem, basenames) {
  const prefix = `${String(parentStem || "")}_`.toLowerCase();
  const taken = new Set();
  for (const basename of Array.isArray(basenames) ? basenames : []) {
    const lower = String(basename || "").toLowerCase();
    if (!lower.startsWith(prefix) || lower.length === prefix.length) {
      continue;
    }
    const rest = lower.slice(prefix.length);
    taken.add(rest);
    taken.add(rest.replace(/_/g, "-"));
  }
  return taken;
}

// The default ID for a summary: the same suggestion the block-ID prompt gives
// a note bullet, collision-aware against the parent's existing notebooks.
// Blank for a blank summary.
function notebookCreateSuggestId(summary, parentStem, basenames) {
  const text = String(summary || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return (
    suggestPromptBlockId(`- ${text}`, "", {
      reservedIds: notebookCreateTakenIds(parentStem, basenames),
    }) || ""
  );
}

function notebookCreateFileExists(parentStem, id, basenames) {
  const stem = notebookCreateFileStem(parentStem, id).toLowerCase();
  return (Array.isArray(basenames) ? basenames : []).some(
    (basename) => String(basename || "").toLowerCase() === stem,
  );
}

// Validate the modal's three fields. `errors` blocks the Create button;
// `warning` (a long summary) never does.
function notebookCreateValidate(input, context = {}) {
  const fields = input && typeof input === "object" ? input : {};
  const summary = String(fields.summary === undefined ? "" : fields.summary)
    .replace(/\s+/g, " ")
    .trim();
  const id = String(fields.id === undefined ? "" : fields.id).trim();
  const title = String(fields.title === undefined ? "" : fields.title)
    .replace(/\s+/g, " ")
    .trim();
  const errors = {};
  if (!summary) {
    errors.summary = "A notebook needs a one-line summary of what belongs in it";
  }
  if (!id) {
    errors.id = "Choose an ID";
  } else if (!NOTEBOOK_CREATE_ID_RE.test(id)) {
    errors.id = "An ID uses only letters, digits, and -";
  } else if (
    notebookCreateFileExists(context.parentStem, id, context.basenames)
  ) {
    errors.id = `${notebookCreateFileStem(context.parentStem, id)}.md already exists`;
  }
  const length = Array.from(summary).length;
  const warning =
    length > NOTEBOOK_CREATE_SUMMARY_SOFT_MAX
      ? `The summary is ${length} characters; keep it to ${NOTEBOOK_CREATE_SUMMARY_SOFT_MAX} or fewer`
      : "";
  return {
    ok: Object.keys(errors).length === 0,
    summary,
    id,
    title,
    errors,
    warning,
  };
}

// One notice for a failed create: bob's refusal message, then its teaching
// hint when it has one.
function notebookCreateFailureNotice(result) {
  const failure = result && typeof result === "object" ? result : {};
  const message =
    typeof failure.message === "string" && failure.message
      ? failure.message
      : "bob notebooks create failed";
  const detail =
    typeof failure.detail === "string" && failure.detail ? failure.detail : "";
  if (failure.code === "desktop_only") {
    return message;
  }
  return detail
    ? `Can't create notebook: ${message} — ${detail}`
    : `Can't create notebook: ${message}`;
}

function notebookCreateSuccessNotice(report) {
  const notebook = report && report.notebook ? report.notebook : {};
  const path = String(notebook.path || "");
  const parent = String(notebook.parent || "");
  const base = parent
    ? `Created notebook ${path} under ${parent}`
    : `Created notebook ${path}`;
  const warnings = Array.isArray(report && report.warnings)
    ? report.warnings.filter((item) => typeof item === "string" && item)
    : [];
  return warnings.length > 0 ? `${base} (${warnings[0]})` : base;
}
