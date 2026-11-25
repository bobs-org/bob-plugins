// Restricted home picker as a choose-only API (plan:202611/area_project_cards.md
// phase editor-parent). The Property Editor's Lives under stage reuses the
// nav-hotkeys parent picker model (208) through this namespace instead of
// copying it. Every method is read-only: it never writes frontmatter and
// never runs bob. Bob validates the committed `setting.set parent` value.
function parentPickerChooseRecordShape(record) {
  if (!record || typeof record !== "object" || typeof record.path !== "string" || !record.path) return null;
  const noteInfo = record.noteInfo && typeof record.noteInfo === "object" ? record.noteInfo : { kind: "plain" };
  return {
    path: record.path,
    basename: typeof record.basename === "string" && record.basename ? record.basename : parentNoteBasenameFromPath(record.path),
    kind: typeof noteInfo.kind === "string" ? noteInfo.kind : "plain",
    ruleKind: typeof record.ruleKind === "string" ? record.ruleKind : "other",
    current: false,
    up: false,
    recent: Number.isFinite(record.recentRank),
    childCount: Number.isInteger(record.childCount) ? record.childCount : 0,
  };
}

function parentPickerChooseListShape(index, record, options = {}) {
  const shaped = parentPickerChooseRecordShape(record);
  if (!shaped) return null;
  const currentParentPath = options.currentParentPath || (index && index.currentParentPath) || null;
  const grandparentPath = options.grandparentPath || (index && index.grandparentPath) || null;
  shaped.current = record.path === currentParentPath;
  shaped.up = record.path === grandparentPath;
  return shaped;
}

// Pure candidate query over the live index. `query` ranks through the same
// `rankParentCandidates` the Change parent panel uses; an empty query returns
// the current parent, the grandparent, recents, then the most-used parents.
function parentPickerChooseList(plugin, sourcePath, query = "", limit = 50) {
  if (!plugin || typeof plugin.parentChangeLiveIndex !== "function" || !sourcePath) return null;
  let index = null;
  try {
    index = plugin.parentChangeLiveIndex(sourcePath);
  } catch (_) {
    return null;
  }
  if (!index) return null;
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 50;
  let ranked = null;
  try {
    ranked = rankParentCandidates(index, String(query == null ? "" : query), {
      currentParentPath: index.currentParentPath,
      grandparentPath: index.grandparentPath,
      limit: cap,
    });
  } catch (_) {
    return null;
  }
  if (!ranked) return null;
  const items = (Array.isArray(ranked.items) ? ranked.items : [])
    .map((record) => parentPickerChooseListShape(index, record))
    .filter(Boolean);
  return {
    ok: true,
    items,
    total: Number.isInteger(ranked.total) ? ranked.total : items.length,
    excludedOnly: ranked.excludedOnly === true,
    kindRefusal: ranked.kindRefusal || null,
    kindRefusalName: ranked.kindRefusalName || null,
    emptyText: parentEmptyStateText(String(query == null ? "" : query), ranked.excludedOnly === true, ranked.kindRefusal, ranked.kindRefusalName),
    currentParentPath: index.currentParentPath || null,
    grandparentPath: index.grandparentPath || null,
  };
}

// Headless validation of one candidate path against the live index. Cycle,
// kind, and same-note refusals mirror `commitParentChange`; missing and
// ambiguous stems are bob's to refuse at preview time, so an unknown path
// resolves to `{ ok: false, reason: "not-found" }` without writing.
function parentPickerChooseValidate(plugin, sourcePath, candidatePath) {
  if (!plugin || !sourcePath || !candidatePath) return { ok: false, reason: "unavailable", message: "The parent picker is unavailable." };
  let index = null;
  try {
    index = plugin.parentChangeLiveIndex(sourcePath);
  } catch (_) {
    return { ok: false, reason: "unavailable", message: "The parent picker is unavailable." };
  }
  if (!index) return { ok: false, reason: "unavailable", message: "The parent picker is unavailable." };
  const byPath = index.byPath || new Map();
  const candidate = byPath.get(candidatePath) || null;
  if (!candidate) return { ok: false, reason: "not-found", message: "The parent must be an existing note." };
  if (sourcePath === candidatePath) {
    return { ok: false, reason: "cycle", message: "A note cannot hang under itself." };
  }
  try {
    if (parentChangeWouldCycle(index, sourcePath, candidatePath)) {
      return { ok: false, reason: "cycle", message: `Can't make ${candidate.basename} the parent: it is inside this note's subtree` };
    }
  } catch (_) {}
  let refusal = null;
  try {
    refusal = parentChangeKindRefusal(index, sourcePath, candidatePath);
  } catch (_) {
    refusal = null;
  }
  if (refusal) return { ok: false, reason: "kind", message: `Can't change parent: ${refusal}` };
  return { ok: true, path: candidate.path, basename: candidate.basename };
}

function createParentPickerApi(plugin) {
  return Object.freeze({
    version: 1,
    list(sourcePath, query = "", limit = 50) {
      try {
        return parentPickerChooseList(plugin, sourcePath, query, limit) || { ok: false, reason: "unavailable", items: [] };
      } catch (_) {
        return { ok: false, reason: "unavailable", items: [] };
      }
    },
    validate(sourcePath, candidatePath) {
      try {
        return parentPickerChooseValidate(plugin, sourcePath, candidatePath);
      } catch (_) {
        return { ok: false, reason: "unavailable", message: "The parent picker is unavailable." };
      }
    },
    // Choose-only entry point. With `candidatePath` it validates headlessly
    // and resolves without writing (unit and e2e use this). Without it, it
    // opens the Change parent panel with a choose-only commit that closes
    // the panel and resolves the pick instead of writing frontmatter.
    choose(sourcePath, options = {}) {
      const opts = options && typeof options === "object" ? options : {};
      if (typeof opts.candidatePath === "string" && opts.candidatePath) {
        return Promise.resolve(parentPickerChooseValidate(plugin, sourcePath, opts.candidatePath));
      }
      if (!plugin || typeof plugin.parentChangeLiveIndex !== "function") {
        return Promise.resolve({ ok: false, reason: "unavailable", message: "The parent picker is unavailable." });
      }
      if (!sourcePath) {
        return Promise.resolve({ ok: false, reason: "unavailable", message: "A note path is required." });
      }
      return new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        let records = [];
        try {
          records = typeof plugin.collectParentPickerRecords === "function" ? plugin.collectParentPickerRecords() : [];
        } catch (_) {
          settle({ ok: false, reason: "unavailable", message: "The parent picker is unavailable." });
          return;
        }
        let index = null;
        try {
          index = buildParentPickerIndex(records, { sourcePath });
        } catch (_) {
          settle({ ok: false, reason: "unavailable", message: "The parent picker is unavailable." });
          return;
        }
        let sourceFile = null;
        try {
          const vault = plugin.app && plugin.app.vault;
          sourceFile = (vault && typeof vault.getAbstractFileByPath === "function" && vault.getAbstractFileByPath(sourcePath)) || { path: sourcePath, basename: parentNoteBasenameFromPath(sourcePath) };
        } catch (_) {
          sourceFile = { path: sourcePath, basename: parentNoteBasenameFromPath(sourcePath) };
        }
        let field = null;
        try {
          field = readParentFrontmatterField("");
        } catch (_) {
          field = { state: "absent", raw: "", target: "" };
        }
        let initialQuery = "";
        try {
          initialQuery = typeof plugin.parentChangeInitialQuery === "function" ? plugin.parentChangeInitialQuery(sourceFile, field, index) : "";
        } catch (_) {
          initialQuery = "";
        }
        let picker = null;
        try {
          picker = new ParentNotePickerModal(plugin.app, plugin, {
            sourceFile,
            index,
            field,
            expectedRaw: field && field.raw,
            initialQuery: typeof opts.initialQuery === "string" ? opts.initialQuery : initialQuery,
          });
        } catch (_) {
          settle({ ok: false, reason: "unavailable", message: "The parent picker is unavailable." });
          return;
        }
        const close = picker.close ? picker.close.bind(picker) : null;
        picker.close = function chooseClose(...args) {
          if (!settled) settle({ ok: false, reason: "cancelled" });
          try {
            if (plugin && plugin.activeParentNotePicker === picker) plugin.activeParentNotePicker = null;
          } catch (_) {}
          return close ? close(...args) : undefined;
        };
        // Choose-only commit: validate against the live index, then resolve
        // the pick without touching frontmatter bytes.
        picker.openItem = (record) => {
          const file = parentPickerFileForRow(record);
          const path = file && file.path ? file.path : (record && record.path) || "";
          const verdict = parentPickerChooseValidate(plugin, sourcePath, path);
          try {
            if (plugin && plugin.activeParentNotePicker === picker) plugin.activeParentNotePicker = null;
          } catch (_) {}
          try {
            picker.pickerOpen = false;
            if (typeof picker.close === "function" && picker.close !== close) picker.close();
            else if (typeof Modal !== "undefined" && picker instanceof Modal) Modal.prototype.close.call(picker);
          } catch (_) {}
          settle(verdict.ok ? { ok: true, path: verdict.path, basename: verdict.basename } : verdict);
        };
        try {
          if (plugin) plugin.activeParentNotePicker = picker;
          picker.open();
        } catch (_) {
          settle({ ok: false, reason: "unavailable", message: "The parent picker is unavailable." });
        }
      });
    },
  });
}

const createDependencyNavApiBeforeParentPicker = createDependencyNavApi;
createDependencyNavApi = function createDependencyNavApiWithParentPicker(plugin) {
  const api = createDependencyNavApiBeforeParentPicker(plugin);
  if (!plugin) return api;
  return Object.freeze({ ...api, parentPicker: createParentPickerApi(plugin) });
};

try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      createDependencyNavApi,
      createParentPickerApi,
      parentPickerChooseList,
      parentPickerChooseValidate,
    });
  }
} catch (_error) {}
