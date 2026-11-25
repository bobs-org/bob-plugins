// Tasks classification and daily-path adapters for task settle
// (bob-cli-q4.8.1.2 editor-apply). Snapshot only: no file reads, no daily
// file creation, and never the Tasks cache task list. Dates stay explicit
// in pure calls; editor/scheduler boundaries use these helpers.

const TASK_SETTLE_TASKS_PLUGIN_ID = "obsidian-tasks-plugin";

function taskSettleDefaultStatusTypes() {
  return [
    { symbol: " ", type: "TODO" },
    { symbol: "*", type: "ON_HOLD" },
    { symbol: "/", type: "IN_PROGRESS" },
    { symbol: "?", type: "ON_HOLD" },
    { symbol: "x", type: "DONE" },
    { symbol: "X", type: "DONE" },
    { symbol: "-", type: "CANCELLED" },
    { symbol: "P", type: "TODO" },
  ];
}

function taskSettleDefaultTasksSettings() {
  return {
    globalFilter: "#task",
    statusTypes: taskSettleDefaultStatusTypes(),
  };
}

function taskSettleStatusTypeName(value) {
  if (value === "DONE") return "DONE";
  if (value === "CANCELLED") return "CANCELLED";
  if (value === "NON_TASK") return "NON_TASK";
  if (value === "EMPTY") return "EMPTY";
  if (value === "IN_PROGRESS") return "IN_PROGRESS";
  if (value === "ON_HOLD") return "ON_HOLD";
  return "TODO";
}

function taskSettleNormalizeTasksSettings(value) {
  const defaults = taskSettleDefaultTasksSettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const globalFilter =
    typeof value.globalFilter === "string" ? value.globalFilter : defaults.globalFilter;
  if (Array.isArray(value.statusTypes) && value.statusTypes.length > 0) {
    const statusTypes = [];
    for (const entry of value.statusTypes) {
      if (!entry || typeof entry !== "object") continue;
      const symbol = typeof entry.symbol === "string" ? entry.symbol : "";
      const chars = Array.from(symbol);
      if (chars.length !== 1) continue;
      statusTypes.push({ symbol: chars[0], type: taskSettleStatusTypeName(entry.type) });
    }
    if (statusTypes.length > 0) {
      return { globalFilter, statusTypes };
    }
  }
  const statusTypes = [];
  const seen = new Set();
  const collections = value.statusSettings && typeof value.statusSettings === "object"
    ? value.statusSettings
    : {};
  for (const collection of ["coreStatuses", "customStatuses"]) {
    const statuses = Array.isArray(collections[collection]) ? collections[collection] : [];
    for (const status of statuses) {
      if (!status || typeof status !== "object") continue;
      const symbol = typeof status.symbol === "string" ? status.symbol : "";
      const chars = Array.from(symbol);
      if (chars.length !== 1 || seen.has(chars[0])) continue;
      seen.add(chars[0]);
      statusTypes.push({
        symbol: chars[0],
        type: taskSettleStatusTypeName(status.type),
      });
    }
  }
  if (statusTypes.length === 0) {
    return { globalFilter, statusTypes: defaults.statusTypes };
  }
  return { globalFilter, statusTypes };
}

function taskSettleReadTasksSettings(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins && plugins[TASK_SETTLE_TASKS_PLUGIN_ID];
    if (!holder) return taskSettleDefaultTasksSettings();
    const value = holder.settings || holder.data || holder;
    return taskSettleNormalizeTasksSettings(value);
  } catch (_error) {
    return taskSettleDefaultTasksSettings();
  }
}

function taskSettleClassificationFromTasksSettings(settings) {
  const normalized = taskSettleNormalizeTasksSettings(settings);
  return taskSettleFromStatusTypes(normalized.globalFilter, normalized.statusTypes);
}

function taskSettleCaptureContext(app, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const today = opts.today != null ? String(opts.today) : formatLocalDate(now);
  const dailyOptions =
    opts.dailyOptions && typeof opts.dailyOptions === "object"
      ? opts.dailyOptions
      : getDailyNotesOptions(app);
  const dailyPath =
    opts.dailyPath != null
      ? normalizeVaultPath(opts.dailyPath)
      : todayDailyPath(now, dailyOptions);
  const settings =
    opts.tasksSettings != null
      ? taskSettleNormalizeTasksSettings(opts.tasksSettings)
      : taskSettleReadTasksSettings(app);
  return {
    today,
    dailyPath,
    classification: taskSettleClassificationFromTasksSettings(settings),
    settings,
  };
}

function taskSettleIsMarkdownView(view) {
  if (!view) return false;
  try {
    if (typeof MarkdownView === "function" && view instanceof MarkdownView) return true;
  } catch (_error) {
    // instanceof can throw across realms.
  }
  if (typeof view.getViewType === "function") {
    try {
      if (view.getViewType() === "markdown") return true;
    } catch (_error) {
      return false;
    }
  }
  return false;
}

function taskSettleViewPath(view) {
  const file = view && view.file;
  if (file && typeof file.path === "string") {
    return normalizeVaultPath(file.path);
  }
  return "";
}

function taskSettleEditorMatchesView(editor, view) {
  if (!editor || !view) return false;
  if (view.editor === editor) return true;
  const viewEditor = view.editor;
  if (!viewEditor) return false;
  if (viewEditor.cm === editor) return true;
  if (editor.cm && (editor.cm === viewEditor || editor.cm === viewEditor.cm)) return true;
  if (editor.cmView && (editor.cmView === viewEditor.cmView || editor.cmView === viewEditor.cm)) {
    return true;
  }
  return false;
}

function taskSettleIterateMarkdownLeaves(app, visit) {
  const workspace = app && app.workspace;
  if (!workspace) return;
  if (typeof workspace.iterateAllLeaves === "function") {
    try {
      workspace.iterateAllLeaves((leaf) => visit(leaf));
      return;
    } catch (_error) {
      // Fall through to getLeavesOfType.
    }
  }
  if (typeof workspace.getLeavesOfType === "function") {
    const leaves = workspace.getLeavesOfType("markdown") || [];
    for (const leaf of leaves) visit(leaf);
  }
}

function taskSettleFindMarkdownViewForEditor(app, editor) {
  if (!app || !editor) return null;
  let match = null;
  taskSettleIterateMarkdownLeaves(app, (leaf) => {
    if (match || !leaf) return;
    const view = leaf.view;
    if (!taskSettleIsMarkdownView(view) || !view.editor) return;
    if (taskSettleEditorMatchesView(editor, view)) match = view;
  });
  return match;
}

function taskSettleGuardEditorPath(app, editor, path) {
  const expected = normalizeVaultPath(path);
  if (!expected) {
    return { ok: false, view: null, path: "", reason: "path" };
  }
  const view = taskSettleFindMarkdownViewForEditor(app, editor);
  if (!view) {
    return { ok: false, view: null, path: expected, reason: "view" };
  }
  const viewPath = taskSettleViewPath(view);
  if (!viewPath || !sameVaultPath(viewPath, expected)) {
    return { ok: false, view, path: viewPath, reason: "path" };
  }
  return { ok: true, view, path: viewPath, reason: null };
}
