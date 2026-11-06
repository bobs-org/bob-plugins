// Pure successor-picker model helpers: destination/intent normalizers,
// optional per-row task context, and a preimage-checked note refresh used
// before the nested destination picker. Shared scope with
// 206-successor-picker-modal.js.

// Strict validation for additive themeIntent on a destination override.
// Malformed intent is dropped so it can never enable a write; absent
// intent keeps the legacy destination shape. An explicit retype is carried
// separately from the default merge landing.
function normalizeSuccessorThemeIntent(intent) {
  try {
    if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
      return null;
    }
    if (typeof intent.deliberate !== "boolean") {
      return null;
    }
    if (typeof intent.retype !== "boolean") {
      return null;
    }
    let shown = null;
    if (intent.shown === undefined || intent.shown === null) {
      shown = null;
    } else if (typeof intent.shown !== "object") {
      return null;
    } else {
      const theme = intent.shown.theme;
      if (!theme || typeof theme !== "object") {
        return null;
      }
      if (typeof theme.key !== "string" || !theme.key) {
        return null;
      }
      shown = intent.shown;
    }
    return Object.freeze({
      deliberate: intent.deliberate,
      retype: intent.retype,
      shown,
    });
  } catch (_error) {
    return null;
  }
}

// Per-row destination override (docs/task-dependencies.md §12.13,
// obsidian_destination): `{kind: "existing", entryLine, entryText, title?} |
// {kind: "new", name, preserveSpelling?}`. Optional `themeIntent` rides
// along when valid. Null unless the destination shape is exact.
function normalizeSuccessorDestinationOverride(choice) {
  try {
    if (!choice || typeof choice !== "object") {
      return null;
    }
    const themeIntent = normalizeSuccessorThemeIntent(choice.themeIntent);
    if (choice.kind === "existing") {
      if (!Number.isInteger(choice.entryLine) || choice.entryLine < 0) {
        return null;
      }
      if (typeof choice.entryText !== "string" || !choice.entryText) {
        return null;
      }
      const title = typeof choice.title === "string" ? choice.title.trim() : "";
      return Object.freeze({
        kind: "existing",
        entryLine: choice.entryLine,
        entryText: choice.entryText,
        ...(title ? { title } : {}),
        ...(themeIntent ? { themeIntent } : {}),
      });
    }
    if (choice.kind === "new") {
      const name = typeof choice.name === "string" ? choice.name.trim() : "";
      if (!name || /[\r\n]/.test(name)) {
        return null;
      }
      return Object.freeze({
        kind: "new",
        name,
        ...(choice.preserveSpelling === true ? { preserveSpelling: true } : {}),
        ...(themeIntent ? { themeIntent } : {}),
      });
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function successorDestinationOverrideLabel(destination) {
  try {
    if (!destination || typeof destination !== "object") {
      return "";
    }
    if (destination.kind === "new") {
      return typeof destination.name === "string" ? destination.name.trim() : "";
    }
    if (destination.kind === "existing") {
      if (typeof destination.title === "string" && destination.title.trim()) {
        return destination.title.trim();
      }
      if (typeof destination.name === "string" && destination.name.trim()) {
        return destination.name.trim();
      }
      if (Number.isInteger(destination.entryLine)) {
        return `line ${destination.entryLine + 1}`;
      }
    }
    return "";
  } catch (_error) {
    return "";
  }
}

// Defensive feature detection for block-id-prompt
// `api.pomodoroLinkPicker` v1 (§12.13). Null when the plugin is missing,
// older, or torn down.
function getSuccessorDestinationPickerApi(app) {
  try {
    const plugins = (app && app.plugins && app.plugins.plugins) || {};
    const prompt = plugins["block-id-prompt"];
    const api = prompt && prompt.api;
    const picker = api && api.pomodoroLinkPicker;
    if (!picker || !(Number(picker.version) >= 1)) {
      return null;
    }
    if (typeof picker.pick !== "function") {
      return null;
    }
    return picker;
  } catch (_error) {
    return null;
  }
}

function successorPickerText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function successorPickerCount(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.floor(Number(value))
    : 0;
}

function successorPickerNoteName(path) {
  const value = successorPickerText(path);
  const leaf = value.split("/").pop() || value;
  return leaf.toLowerCase().endsWith(".md") ? leaf.slice(0, -3) : leaf;
}

// Lane names shown on every picker row (§12.13 picker API v2): the raw
// status symbol is never displayed. A supplied `lane` wins when it is one of
// the four lane names; otherwise the lane derives from the row `status`, which
// is either a status symbol (" ", "*", "/", "?") or already a lane name.
const SUCCESSOR_PICKER_LANE_BY_SYMBOL = Object.freeze({
  " ": "Ready",
  "*": "Next",
  "/": "Pending",
  "?": "Blocked",
});
const SUCCESSOR_PICKER_LANE_NAMES = Object.freeze(["Pending", "Next", "Ready", "Blocked"]);

function successorPickerLaneName(lane, status) {
  const named = successorPickerText(lane).toLowerCase();
  const byName = SUCCESSOR_PICKER_LANE_NAMES.find((name) => name.toLowerCase() === named);
  if (byName) {
    return byName;
  }
  if (typeof status === "string" && SUCCESSOR_PICKER_LANE_BY_SYMBOL[status]) {
    return SUCCESSOR_PICKER_LANE_BY_SYMBOL[status];
  }
  const text = successorPickerText(status);
  if (!text) {
    return "";
  }
  const byStatusName = SUCCESSOR_PICKER_LANE_NAMES.find((name) => name.toLowerCase() === text.toLowerCase());
  if (byStatusName) {
    return byStatusName;
  }
  // An unmapped single-character mark is a raw symbol, never shown.
  return text.length === 1 ? "" : text;
}

// Picker title (§12.15 copy table). An explicit model title always wins;
// without one, a model whose groups are all keep_moving reads `Keep ‹N›
// moving` / `Keep k projects moving`.
function successorPickerKeepMovingProject(group) {
  const fromProject = successorPickerNoteName(group && group.project);
  if (fromProject) {
    return fromProject;
  }
  const first = group && Array.isArray(group.rows) ? group.rows[0] : null;
  return successorPickerNoteName(first && first.notePath) || "project";
}

function successorPickerAllKeepMoving(groups) {
  return Array.isArray(groups) && groups.length > 0 &&
    groups.every((group) => group && group.group === "keep_moving");
}

function successorPickerKeepMovingTitle(groups) {
  const names = [];
  for (const group of groups) {
    const name = successorPickerKeepMovingProject(group);
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names.length === 1 ? `Keep ‹${names[0]}› moving` : `Keep ${names.length} projects moving`;
}

// Per-row close descriptor (`api.successors` v4, docs/task-dependencies.md
// §12.5). Rust emits snake_case; the JS model uses the camelCase names in
// brackets. Presenters render these fields and never infer eligibility.
// Null unless the shape is exact enough to render.
function normalizeSuccessorCloseDescriptor(raw) {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const complete = raw.complete === true;
    const cancel = raw.cancel === true;
    if (complete !== true && cancel !== true && raw.why == null &&
      raw.completeConsequence == null && raw.complete_consequence == null &&
      raw.cancelConsequence == null && raw.cancel_consequence == null &&
      raw.scopeNote == null && raw.scope_note == null && raw.unblocks == null) {
      return null;
    }
    const why = successorPickerText(raw.why);
    const completeConsequence = successorPickerText(
      raw.completeConsequence != null ? raw.completeConsequence : raw.complete_consequence,
    );
    const cancelConsequence = successorPickerText(
      raw.cancelConsequence != null ? raw.cancelConsequence : raw.cancel_consequence,
    );
    const scopeNote = successorPickerText(
      raw.scopeNote != null ? raw.scopeNote : raw.scope_note,
    );
    const unblocksRaw = Number(raw.unblocks);
    const unblocks = Number.isFinite(unblocksRaw) && unblocksRaw > 0
      ? Math.floor(unblocksRaw)
      : 0;
    return Object.freeze({
      complete,
      cancel,
      ...(why ? { why } : {}),
      ...(completeConsequence ? { completeConsequence } : {}),
      ...(cancelConsequence ? { cancelConsequence } : {}),
      ...(scopeNote ? { scopeNote } : {}),
      unblocks,
    });
  } catch (_error) {
    return null;
  }
}

// Whether the normalized model carries close support (`close.supported`).
function successorPickerCloseSupported(model) {
  try {
    return Boolean(model && model.close && model.close.supported === true);
  } catch (_error) {
    return false;
  }
}

// Optional validated task context for `api.pick({task})`. `line` is
// one-based and `text` is the full note. `preimage` is the original task
// line used to refuse a changed/missing source before the nested picker.
// Malformed context is dropped so older row shapes stay selectable.
function normalizeSuccessorPickerTaskContext(task) {
  try {
    if (!task || typeof task !== "object") {
      return null;
    }
    const path = typeof task.path === "string" ? task.path : "";
    if (!path) {
      return null;
    }
    if (!Number.isInteger(task.line) || task.line < 1) {
      return null;
    }
    if (typeof task.text !== "string") {
      return null;
    }
    if (typeof task.preimage !== "string") {
      return null;
    }
    const displayText = typeof task.displayText === "string" ? task.displayText : "";
    const status = typeof task.status === "string" ? task.status : "";
    return Object.freeze({
      path,
      line: task.line,
      text: task.text,
      displayText,
      status,
      preimage: task.preimage,
    });
  } catch (_error) {
    return null;
  }
}

function normalizeSuccessorPickerModel(model) {
  try {
    if (!model || typeof model !== "object" || !Array.isArray(model.groups)) {
      return null;
    }
    const allowedGroups = new Set(["hand_off", "project", "project_finished", "keep_moving", "relation"]);
    const seenKeys = new Set();
    const groups = [];
    let selectableCount = 0;
    let taskRowCount = 0;
    const closeSupported = Boolean(model.close && typeof model.close === "object" && model.close.supported === true);
    for (const source of model.groups) {
      if (!source || typeof source !== "object" || !allowedGroups.has(source.group)) {
        continue;
      }
      const rows = [];
      for (const row of Array.isArray(source.rows) ? source.rows : []) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const key = typeof row.key === "string" ? row.key : "";
        const text = successorPickerText(row.text);
        if (!key || !text || seenKeys.has(key)) {
          if (key && seenKeys.has(key)) {
            return null;
          }
          continue;
        }
        if (typeof row.notePath !== "string" || typeof row.selectable !== "boolean") {
          continue;
        }
        const task = normalizeSuccessorPickerTaskContext(row.task);
        const suffix = successorPickerText(row.suffix);
        const reason = successorPickerText(row.reason);
        const close = closeSupported ? normalizeSuccessorCloseDescriptor(row.close) : null;
        const normalized = Object.freeze({
          key,
          text,
          notePath: row.notePath,
          status: successorPickerText(row.status),
          lane: successorPickerLaneName(row.lane, row.status),
          destinationLabel: successorPickerText(row.destinationLabel),
          needsBlockId: row.needsBlockId === true,
          selectable: row.selectable,
          mutedReason: successorPickerText(row.mutedReason),
          destination: row.destination,
          ...(suffix ? { suffix } : {}),
          ...(reason ? { reason } : {}),
          ...(task ? { task } : {}),
          ...(close ? { close } : {}),
        });
        seenKeys.add(key);
        rows.push(normalized);
        taskRowCount += 1;
        if (normalized.selectable) {
          selectableCount += 1;
        }
      }
      const foldedSource = source.folded && typeof source.folded === "object" ? source.folded : {};
      const folded = source.group === "relation"
        ? Object.freeze({
            hidden: successorPickerCount(foldedSource.hidden),
            alreadyPlanned: successorPickerCount(foldedSource.alreadyPlanned),
            subProjects: successorPickerCount(foldedSource.subProjects),
            blocked: successorPickerCount(foldedSource.blocked),
            scheduled: successorPickerCount(foldedSource.scheduled),
            alreadyStarted: successorPickerCount(foldedSource.alreadyStarted),
            waitsFor: successorPickerCount(foldedSource.waitsFor),
          })
        : Object.freeze({
            hidden: successorPickerCount(foldedSource.hidden),
            alreadyPlanned: successorPickerCount(foldedSource.alreadyPlanned),
            subProjects: successorPickerCount(foldedSource.subProjects),
            blocked: successorPickerCount(foldedSource.blocked),
            scheduled: successorPickerCount(foldedSource.scheduled),
          });
      const relationFields = source.group === "relation"
        ? {
            foldText: successorPickerText(source.foldText),
            after: successorPickerNormalizeRelationAfter(source.after),
            event: relationCopyEvent(source.event),
            label: successorPickerText(source.label),
          }
        : {};
      groups.push(Object.freeze({
        group: source.group,
        header: successorPickerText(source.header),
        caption: successorPickerText(source.caption),
        tag: successorPickerText(source.tag),
        project: successorPickerText(source.project),
        rows: Object.freeze(rows),
        folded,
        ...relationFields,
      }));
    }
    if (selectableCount === 0 || groups.length === 0) {
      return null;
    }
    const budget = model.budget && typeof model.budget === "object"
      ? Object.freeze({
          links: successorPickerCount(model.budget.links),
          max: successorPickerCount(model.budget.max),
        })
      : null;
    const predecessors = Array.isArray(model.predecessors)
      ? model.predecessors.filter((row) => row && typeof row === "object").map((row) => Object.freeze({
          notePath: successorPickerText(row.notePath),
          blockId: successorPickerText(row.blockId),
          text: successorPickerText(row.text),
        }))
      : [];
    const keepMovingOnly = successorPickerAllKeepMoving(groups);
    const relationOnly = successorPickerAllRelation(groups);
    return Object.freeze({
      title: successorPickerText(model.title) ||
        (keepMovingOnly ? successorPickerKeepMovingTitle(groups) :
          relationOnly ? successorPickerRelationTitle(groups, selectableCount) :
            "Choose successor tasks"),
      predecessors: Object.freeze(predecessors),
      groups: Object.freeze(groups),
      budget,
      keepMovingOnly,
      relationOnly,
      selectableCount,
      taskRowCount,
      ...(closeSupported ? { close: Object.freeze({ supported: true }) } : {}),
    });
  } catch (_error) {
    return null;
  }
}

// Live note text for a vault-relative path: open editor buffers first,
// then the vault. Null when the note cannot be read, including
// ambiguous open buffers.
async function readSuccessorPickerNoteText(app, path) {
  try {
    const normalized = normalizeVaultRelativePath(path);
    if (!normalized) {
      return null;
    }
    const buffers = getOpenMarkdownBufferContents(app);
    if (buffers.ambiguous) {
      return null;
    }
    if (buffers.has(normalized)) {
      return String(buffers.get(normalized) || "");
    }
    const vault = app && app.vault;
    const file = vault && typeof vault.getAbstractFileByPath === "function"
      ? vault.getAbstractFileByPath(normalized)
      : null;
    if (!vault || !file) {
      return null;
    }
    if (typeof vault.cachedRead === "function") {
      return String((await vault.cachedRead(file)) || "");
    }
    if (typeof vault.read === "function") {
      return String((await vault.read(file)) || "");
    }
    return null;
  } catch (_error) {
    return null;
  }
}

async function refreshSuccessorPickerTaskContext(app, task) {
  try {
    const normalized = normalizeSuccessorPickerTaskContext(task);
    if (!normalized) {
      return null;
    }
    const liveText = await readSuccessorPickerNoteText(app, normalized.path);
    if (typeof liveText !== "string") {
      return null;
    }
    const lines = liveText.split(/\r?\n/);
    const index = normalized.line - 1;
    if (index < 0 || index >= lines.length) {
      return null;
    }
    if (lines[index] !== normalized.preimage) {
      return null;
    }
    return Object.freeze({
      path: normalized.path,
      line: normalized.line,
      text: liveText,
      displayText: normalized.displayText,
      status: normalized.status,
      preimage: normalized.preimage,
    });
  } catch (_error) {
    return null;
  }
}

function successorPickerTaskPickRequest(task) {
  if (!task) {
    return {};
  }
  return {
    task: {
      path: task.path,
      line: task.line,
      text: task.text,
      displayText: task.displayText,
      status: task.status,
    },
  };
}

// Marked selectable rows in displayed (model) order, else the highlighted
// row. Never reconstructs identity from display text or the opaque key.
// Verdict rows are never retargeted: bulk keys skip them and a lone
// verdict highlight resolves to no rows (the caller shows a soft refusal).
function successorPickerRetargetRows(modal) {
  const rows = [];
  try {
    if (!modal || !modal.model) {
      return rows;
    }
    const verdicts = modal.verdicts instanceof Map ? modal.verdicts : null;
    if (modal.markedKeys && modal.markedKeys.size > 0) {
      for (const group of modal.model.groups) {
        for (const row of group.rows) {
          if (verdicts && verdicts.has(row.key)) {
            continue;
          }
          if (row.selectable && modal.markedKeys.has(row.key)) {
            rows.push(row);
          }
        }
      }
      return rows;
    }
    const active = modal.visibleItems && modal.visibleItems[modal.selectedIndex];
    if (active && active.kind === "offer" && active.row && active.row.selectable) {
      if (verdicts && verdicts.has(active.row.key)) {
        return rows;
      }
      rows.push(active.row);
    }
  } catch (_error) {
    return [];
  }
  return rows;
}
