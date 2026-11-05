// Merge-label commit through `bob task merge` (`docs/task-relations.md`
// §21 ML1–ML8, the nav-merge phase of
// plan:202611/task_move_merge_split.md). A configured merge label in the
// Links stage previews through the ledger-tools `api.taskMerge` namespace
// (desktop-only, built on `bobSpawnJson` like `api.relationLabels.rename`),
// fills the consequence strip from the preview, routes offers through the
// existing `SuccessorOfferPickerModal`, applies with `-p` picks, and shows
// an Undo merge notice from the shared helper. An already-closed source
// takes the plain relation through the existing JS writer with
// "Already Cancelled · link only"; mobile resolves the desktop refusal and
// writes nothing. Walk parity with cancel labels is structural: the merge
// rides the same chord entries and the same guarded settle call cancel
// uses, which is a no-op where cancel is one.
const RELATION_MERGE_MOBILE_MESSAGE = "⤵ merging needs the desktop app";
const RELATION_MERGE_ALREADY_CLOSED_MESSAGE = "Already Cancelled · link only";
const RELATION_MERGE_UNCHANGED_MESSAGE = "Already merged — nothing to do";
const RELATION_MERGE_MISSING_ID_MESSAGE = "Merging needs a ^block-id on every source and the target";

// Pure target resolution for one merge commit. Links-to merges the stage
// sources into the one picked target; linked-from (Ctrl+Shift+Alt+L)
// merges the picked rows into the task under the cursor. More than one
// links-to target is refused: a merge has exactly one destination.
function relationMergeTargetsFromRefs(args = {}) {
  const linkedFrom = args.linkedFrom === true;
  const sources = Array.isArray(args.sources) ? args.sources : [];
  const targets = Array.isArray(args.targets) ? args.targets : [];
  if (sources.length === 0) {
    return { ok: false, error: "Merging needs a task to merge" };
  }
  if (targets.length === 0) {
    return { ok: false, error: "Merging needs one target task" };
  }
  if (!linkedFrom && targets.length > 1) {
    return { ok: false, error: "Merging needs one target — pick one task to merge into" };
  }
  const into = targets[0];
  if (!into || !into.path) {
    return { ok: false, error: "Merging needs one target task" };
  }
  return { ok: true, sources, into, linkedFrom };
}

function relationMergeSourceStatus(source) {
  const rawLine = source && typeof source.rawLine === "string" ? source.rawLine : "";
  if (!rawLine) return "";
  try {
    return relationCancelSourceStatus(rawLine);
  } catch (_error) {
    return "";
  }
}

// True when every source is already closed. The commit then skips bob and
// writes the plain relation through the existing JS writer.
function relationMergeAllClosed(sources) {
  const list = Array.isArray(sources) ? sources : [];
  if (list.length === 0) return false;
  return list.every((source) => {
    const status = relationMergeSourceStatus(source);
    return status !== "" && !OPEN_OBSIDIAN_TASK_STATUSES.has(status);
  });
}

function relationMergeRefsKey(sources, into, label) {
  const keyOf = (ref) =>
    `${normalizeVaultRelativePath((ref && ref.path) || "")}\x00${normalizeBulletPropertyValue((ref && ref.blockId) || "")}`;
  return JSON.stringify({
    sources: (Array.isArray(sources) ? sources : []).map(keyOf),
    into: keyOf(into),
    label: String(label || ""),
  });
}

// Missing-ID queue for a merge commit. Returns the refs whose normalized
// blockId is empty, in prompt order: every id-less source in stage order,
// then the target, deduped by normalized path and line.
function relationMergeMissingIdRefs(sources, into) {
  const list = [...(Array.isArray(sources) ? sources : []), into].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const ref of list) {
    if (normalizeBulletPropertyValue((ref && ref.blockId) || "")) continue;
    const path = normalizeVaultRelativePath((ref && ref.path) || "");
    const line = ref && ref.line;
    const key = `${path}\x00${String(line)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      path,
      line,
      rawLine: ref.rawLine,
      displayText: ref.displayText || ref.text || path,
    });
  }
  return out;
}

function relationMergeBlockIdSubtitle(position, total, lineIndex) {
  const linePart = `line ${lineIndex}`;
  if (Number(total) > 1) {
    return `⤵ Merging needs an ID · ${position} of ${total} · ${linePart}`;
  }
  return `⤵ Merging needs an ID · ${linePart}`;
}

// Save every touched open editor before `bob` reads disk. The minted IDs
// may have landed in an open buffer that is not the active view, for
// example a target note in another tab.
async function saveRelationMergeEditors(app, paths) {
  let saved;
  try {
    saved = await saveActiveRelationLabelEditor(app);
  } catch (_error) {
    saved = { ok: false, message: "Could not save the active note before merging." };
  }
  if (!saved || saved.ok !== true) return saved;
  try {
    const workspace = app && app.workspace;
    if (!workspace) return { ok: true };
    const wanted = new Set(
      (Array.isArray(paths) ? paths : [])
        .map((path) => normalizeVaultRelativePath(path || ""))
        .filter(Boolean),
    );
    if (wanted.size === 0) return { ok: true };
    const leaves = [];
    if (typeof workspace.iterateAllLeaves === "function") {
      workspace.iterateAllLeaves((leaf) => leaves.push(leaf));
    } else if (typeof workspace.getLeavesOfType === "function") {
      for (const type of ["markdown"]) {
        try {
          for (const leaf of workspace.getLeavesOfType(type) || []) leaves.push(leaf);
        } catch (_typeError) {
          // Other leaf types are not Markdown editors.
        }
      }
    }
    let activeView = null;
    try {
      if (typeof workspace.getActiveViewOfType === "function") {
        activeView = workspace.getActiveViewOfType(MarkdownView);
      }
      if (!activeView && workspace.activeLeaf) activeView = workspace.activeLeaf.view || null;
    } catch (_activeError) {
      activeView = null;
    }
    for (const leaf of leaves) {
      try {
        const view = leaf && leaf.view;
        const file = view && view.file;
        if (!view || !file) continue;
        if (view === activeView) continue;
        const normalized = normalizeVaultRelativePath(file.path || "");
        if (!wanted.has(normalized)) continue;
        if (typeof view.save !== "function") {
          return { ok: false, message: "Could not save the active note before merging." };
        }
        await view.save();
      } catch (_leafError) {
        return { ok: false, message: "Could not save the active note before merging." };
      }
    }
    return { ok: true };
  } catch (_error) {
    return { ok: false, message: "Could not save the active note before merging." };
  }
}

// The successor-picker model for one merge preview. Every offer reuses
// group `hand_off` with its additive `merged_from` source key, so the
// Mac Pull-In card and capture need no new group.
function taskMergeOfferPickerModel(summary, label) {
  const offers = summary && Array.isArray(summary.offers) ? summary.offers : [];
  const targetTitle = summary && summary.targetTitle ? String(summary.targetTitle) : "that task";
  const targetPath = summary && summary.targetPath ? String(summary.targetPath) : "";
  const rows = [];
  const seen = new Set();
  for (const offer of offers) {
    const key = offer && typeof offer.key === "string" ? offer.key : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entryName = offer && offer.entry_name != null ? String(offer.entry_name) : "";
    const mergedFrom = offer && offer.merged_from != null ? String(offer.merged_from) : "";
    rows.push({
      key,
      text: targetTitle,
      notePath: targetPath,
      status: "",
      lane: "",
      destinationLabel: "",
      needsBlockId: false,
      selectable: true,
      suffix: entryName ? `under ${entryName}` : "",
      reason: mergedFrom ? `merged from “${mergedFrom}”` : "",
    });
  }
  return {
    title: "Link the merged task?",
    predecessors: [],
    groups: [{
      group: "hand_off",
      header: "Hand off",
      caption: `“${targetTitle}” can take the place of a removed link`,
      tag: "",
      project: "",
      rows,
      folded: {},
    }],
  };
}

// The success notice mirrors the `bob task merge` human header plus the
// Undo affordance; the shared Undo helper renders the button.
function formatTaskMergeSuccessNotice(summary, label) {
  const count = summary && Number.isInteger(summary.mergedCount)
    ? summary.mergedCount
    : summary && Number.isInteger(summary.count) ? summary.count : 0;
  const target = summary && summary.targetTitle
    ? `“${summary.targetTitle}”`
    : summary && summary.targetSection
      ? `## ${summary.targetSection}`
      : "that task";
  const name = String(label || "").trim() || "merged into";
  return `⤵ Merged ${count} ${count === 1 ? "task" : "tasks"} into ${target} · ${name}`;
}

class BulletPropertyPickerRelationMergeMixin extends FilteredPickerModal {
  taskMergeLedgerApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-ledger-tools"];
      const api = holder && holder.api && holder.api.taskMerge;
      return api && Number(api.version) >= 1 &&
        typeof api.preview === "function" && typeof api.apply === "function"
        ? api
        : null;
    } catch (_error) {
      return null;
    }
  }

  resetRelationMergeCommit() {
    this.relationMergePreview = null;
    this.relationMergePreviewing = false;
    this.relationMergeConfirmNonce = null;
    this.relationMergeArmedKey = null;
  }

  // Live vault text for Undo preimages: open editor buffers first, then
  // the vault. Null when the note cannot be read.
  async readRelationMergeNoteText(path) {
    const normalized = normalizeVaultRelativePath(path || "");
    if (!normalized) return null;
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.iterateAllLeaves === "function") {
        const found = [];
        workspace.iterateAllLeaves((leaf) => {
          try {
            if (leaf && leaf.view && leaf.view.file &&
              normalizeVaultRelativePath(leaf.view.file.path || "") === normalized &&
              leaf.view.editor && typeof leaf.view.editor.getValue === "function") {
              found.push(String(leaf.view.editor.getValue() || ""));
            }
          } catch (_leafError) {
            // An unreadable buffer is not the vault text.
          }
        });
        if (found.length === 1) return found[0];
        if (found.length > 1) return null;
      }
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.cachedRead !== "function") return null;
      const file = typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(normalized)
        : null;
      if (!file) return null;
      return String((await vault.cachedRead(file)) || "");
    } catch (_error) {
      return null;
    }
  }

  async previewRelationMerge(sources, into) {
    const api = this.taskMergeLedgerApi();
    if (!api) {
      return {
        ok: false,
        error: "Update Bob Ledger Tools to merge from a relation label.",
      };
    }
    let result;
    try {
      result = await api.preview(sources, into);
    } catch (_error) {
      return { ok: false, error: "bob task merge preview failed." };
    }
    if (!result || result.ok !== true) {
      const code = result && result.code ? String(result.code) : "";
      if (code === "desktop_only") {
        return { ok: false, error: RELATION_MERGE_MOBILE_MESSAGE };
      }
      return {
        ok: false,
        error: (result && result.message) || "bob task merge preview failed.",
      };
    }
    const summary = taskMergePreviewSummary(result.report);
    return { ok: true, summary, report: result.report };
  }

  // The merge branch of `commitRelationLabel`. Returns true when the
  // gesture is fully handled (written, refused with a notice, or armed
  // behind the batch banner).
  async commitRelationMergeLabel(item, label, withLabel, options = {}) {
    const resumed = Boolean(options && options.resumed === true);
    const targets = Array.isArray(this.relationLabelTargets)
      ? this.relationLabelTargets
      : [];
    const linkedFrom = this.isLinkedFromSession();
    const stageSources = typeof this.relationStageSourceRefs === "function"
      ? this.relationStageSourceRefs()
      : [];
    const resolved = relationMergeTargetsFromRefs({
      sources: linkedFrom ? targets : stageSources,
      targets: linkedFrom ? stageSources.slice(0, 1) : targets,
      linkedFrom,
    });
    if (!resolved.ok) {
      new Notice(resolved.error);
      return false;
    }
    const sources = resolved.sources;
    const into = resolved.into;
    if (relationMergeAllClosed(sources)) {
      const groups = this.relationLabelMode === "relabel"
        ? { add: [], remove: [], relabel: withLabel }
        : { add: withLabel, remove: [], relabel: [] };
      const committed = await this.commitRelationEdit(groups);
      if (committed) new Notice(RELATION_MERGE_ALREADY_CLOSED_MESSAGE);
      return committed;
    }
    const missingRefs = relationMergeMissingIdRefs(sources, into);
    for (const ref of missingRefs) {
      if (typeof ref.rawLine !== "string" || !ref.rawLine) {
        try {
          const content = this.relationCancelContentForRef(ref);
          const lines = String(content || "").split(/\r?\n/);
          if (Number.isInteger(ref.line) && typeof lines[ref.line] === "string" && lines[ref.line]) {
            ref.rawLine = lines[ref.line];
            if (!ref.displayText || ref.displayText === ref.path) {
              try {
                ref.displayText = cleanTaskDisplayText(ref.rawLine) || ref.displayText;
              } catch (_displayError) {
                // Keep the path fallback.
              }
            }
          }
        } catch (_contentError) {
          // The fallback below refuses without prompting.
        }
      }
    }
    if (missingRefs.some((ref) => !Number.isInteger(ref.line) || typeof ref.rawLine !== "string" || !ref.rawLine)) {
      new Notice(RELATION_MERGE_MISSING_ID_MESSAGE);
      return false;
    }
    if (missingRefs.length > 0) {
      if (resumed) {
        new Notice(RELATION_MERGE_MISSING_ID_MESSAGE);
        return false;
      }
      let rawQuery = "";
      try {
        rawQuery = typeof this.getRawQuery === "function" ? String(this.getRawQuery() || "") : "";
      } catch (_queryError) {
        rawQuery = "";
      }
      const queue = missingRefs.map((ref) => ({
        path: ref.path,
        line: ref.line,
        rawLine: ref.rawLine,
        displayText: ref.displayText || ref.path,
      }));
      this.pendingRelation = {
        add: [],
        remove: [],
        relabel: [],
        overrides: new Map(),
        queue,
        reservedIds: new Set(),
        reverseOwner: null,
        merge: {
          label: String(label || ""),
          mode: this.relationLabelMode,
          targets: targets.slice(),
          query: rawQuery,
          total: queue.length,
        },
      };
      return this.promptNextRelationTargetId();
    }
    let saved;
    try {
      saved = await saveRelationMergeEditors(
        this.app,
        [...sources.map((ref) => ref.path), into.path],
      );
    } catch (_error) {
      saved = { ok: false, message: "Could not save the active note before merging." };
    }
    if (!saved || saved.ok !== true) {
      new Notice((saved && saved.message) || "Could not save the active note before merging.");
      return false;
    }
    this.relationMergePreview = null;
    this.relationMergePreviewing = true;
    try {
      if (typeof this.refreshRelationConsequenceStrip === "function") {
        this.refreshRelationConsequenceStrip();
      }
    } catch (_stripError) {
      // The strip is a preview aid; the commit continues without it.
    }
    const preview = await this.previewRelationMerge(sources, into);
    this.relationMergePreviewing = false;
    if (!preview.ok) {
      try {
        if (typeof this.refreshRelationConsequenceStrip === "function") {
          this.refreshRelationConsequenceStrip();
        }
      } catch (_stripError) {
        // Keep the refusal notice without the strip.
      }
      new Notice(preview.error);
      return false;
    }
    this.relationMergePreview = preview.summary;
    if (preview.summary.count >= 2) {
      const refsKey = relationMergeRefsKey(sources, into, label);
      if (
        this.relationMergeConfirmNonce !== preview.summary.nonce ||
        this.relationMergeArmedKey !== refsKey
      ) {
        this.relationMergeConfirmNonce = preview.summary.nonce;
        this.relationMergeArmedKey = refsKey;
        try {
          if (typeof this.renderResults === "function") this.renderResults();
          if (typeof this.refreshRelationConsequenceStrip === "function") {
            this.refreshRelationConsequenceStrip();
          }
        } catch (_bannerError) {
          // The banner is a preview aid; the second Return still confirms.
        }
        return false;
      }
      this.relationMergeConfirmNonce = null;
      this.relationMergeArmedKey = null;
    }
    if (preview.summary.mergedCount === 0 && preview.summary.offers.length === 0) {
      try {
        if (typeof this.refreshRelationConsequenceStrip === "function") {
          this.refreshRelationConsequenceStrip();
        }
      } catch (_stripError) {
        // The notice below carries the outcome.
      }
      new Notice(RELATION_MERGE_UNCHANGED_MESSAGE);
      return true;
    }
    let picks = null;
    if (preview.summary.offers.length > 0) {
      try {
        const model = taskMergeOfferPickerModel(preview.summary, label);
        const result = this.plugin && typeof this.plugin.pickSuccessorOffers === "function"
          ? await this.plugin.pickSuccessorOffers(model, { retarget: false })
          : null;
        picks = result && Array.isArray(result.picks) ? result.picks : null;
      } catch (_pickerError) {
        picks = null;
      }
    }
    const candidatePaths = [...new Set(
      [...sources.map((ref) => ref.path), into.path]
        .map((path) => normalizeVaultRelativePath(path || ""))
        .filter(Boolean),
    )];
    const preimages = new Map();
    for (const path of candidatePaths) {
      preimages.set(path, await this.readRelationMergeNoteText(path));
    }
    const api = this.taskMergeLedgerApi();
    let applied;
    try {
      applied = await api.apply(sources, into, picks);
    } catch (_error) {
      applied = { ok: false, code: "failed", message: "bob task merge failed." };
    }
    if (!applied || applied.ok !== true) {
      new Notice((applied && applied.message) || "bob task merge failed.");
      return false;
    }
    const appliedSummary = taskMergePreviewSummary(applied.report);
    const restores = [];
    const appliedPaths = applied.report && Array.isArray(applied.report.applied_paths)
      ? applied.report.applied_paths
      : [];
    for (const rawPath of appliedPaths) {
      const path = normalizeVaultRelativePath(String(rawPath || ""));
      if (!path || !preimages.has(path)) continue;
      const before = preimages.get(path);
      if (typeof before !== "string") continue;
      const after = await this.readRelationMergeNoteText(path);
      if (typeof after !== "string" || after === before) continue;
      let file = null;
      try {
        const vault = this.app && this.app.vault;
        file = vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(path)
          : null;
      } catch (_fileError) {
        file = null;
      }
      restores.push({ path, file, before, after });
    }
    const notice = formatTaskMergeSuccessNotice(appliedSummary, label);
    try {
      if (this.plugin && typeof this.plugin.showGuardedUndoNotice === "function") {
        this.plugin.showGuardedUndoNotice(notice, restores, {
          actionLabel: "Undo merge",
          successMessage: "Undid merge",
          failureLabel: "Could not undo merge",
        });
      } else {
        new Notice(notice);
      }
    } catch (_noticeError) {
      new Notice(notice);
    }
    try {
      const walkOrigin = this.reviewOrigin || null;
      if (walkOrigin && typeof this.settleReviewOrigin === "function") {
        await this.settleReviewOrigin("complete", { notice });
      }
    } catch (_walkError) {
      // Walk parity with cancel labels: best effort only.
    }
    try {
      if (typeof this.clearPendingBatch === "function") this.clearPendingBatch();
    } catch (_batchError) {
      // The picker closes with no pending batch either way.
    }
    this.pendingRelation = null;
    this.resetRelationMergeCommit();
    return true;
  }

  // Resume a merge after its missing block IDs were minted through the
  // relation-target prompt. The session sees the new IDs, the relation
  // field returns with the merge query, and the merge commits as if the
  // second Return just happened.
  async resumeRelationMergeAfterIds(pending) {
    const merge = pending && pending.merge ? pending.merge : null;
    const overrides = pending && pending.overrides instanceof Map
      ? pending.overrides
      : new Map();
    const label = merge && merge.label ? String(merge.label) : "";
    const mode = merge && merge.mode ? merge.mode : "add";
    const query = merge && typeof merge.query === "string" ? merge.query : "";
    this.pendingRelation = null;
    try {
      const stage = this.vaultStage;
      const sources = stage && Array.isArray(stage.sources) ? stage.sources : [];
      const updatedSources = sources.map((source) => {
        const key = `${normalizeVaultRelativePath(source.path || "")}\x00${source.line}`;
        const extra = overrides.get(key);
        if (!extra) return source;
        return {
          ...source,
          blockId: extra.blockId || source.blockId,
          rawLine: typeof extra.rawLine === "string" ? extra.rawLine : source.rawLine,
        };
      });
      if (stage) {
        this.vaultStage = { ...stage, sources: Object.freeze(updatedSources) };
      }
    } catch (_sourcesError) {
      // The commit below re-reads the session and refuses on stale state.
    }
    let updatedTargets = [];
    try {
      const baseTargets = merge && Array.isArray(merge.targets) ? merge.targets : [];
      updatedTargets = baseTargets.map((target) => {
        const key = `${normalizeVaultRelativePath(target.path || "")}\x00${target.line}`;
        const extra = overrides.get(key);
        if (!extra) return { ...target };
        return {
          ...target,
          blockId: extra.blockId || target.blockId,
          rawLine: typeof extra.rawLine === "string" ? extra.rawLine : target.rawLine,
        };
      });
    } catch (_targetsError) {
      updatedTargets = [];
    }
    try {
      this.showRelationLabelStage(updatedTargets, { mode });
    } catch (_stageError) {
      // The commit below still runs against the updated session.
    }
    try {
      const want = query || label;
      if (this.inputEl && typeof want === "string") {
        this.inputEl.value = want;
      }
      if (!this.inputEl) {
        try {
          this.getRawQuery = () => want;
        } catch (_queryError) {
          // The stored query still drives the commit label.
        }
      }
      if (typeof this.renderResults === "function") {
        try {
          this.renderResults();
        } catch (_renderError) {
          // Selection below is best effort.
        }
      }
      try {
        const items = Array.isArray(this.visibleItems)
          ? this.visibleItems
          : (Array.isArray(this.items) ? this.items : []);
        const wantKey = relationCancelLabelKey(label);
        const index = items.findIndex(
          (row) => row && typeof row.label === "string" && relationCancelLabelKey(row.label) === wantKey,
        );
        if (index >= 0) this.selectedIndex = index;
      } catch (_selectError) {
        // Keep the current selection.
      }
    } catch (_restoreError) {
      // The commit below carries the label explicitly.
    }
    return this.commitRelationMergeLabel(
      null,
      label,
      updatedTargets.map((target) => ({ ...target, label })),
      { resumed: true },
    );
  }

  relationCancelStayHintForItem(item) {
    if (!item || item.stageSection !== "current") return "";
    const close = this.relationCloseLabelsConfig();
    const cancelKeys = relationCancelLabelsSet(close.cancel || this.relationCancelLabelsConfig());
    const completeKeys = relationCompleteLabelsSet(close.complete);
    const label = this.isLinkedFromSession()
      ? item.storedLabel || item.label
      : item.label;
    const key = relationCancelLabelKey(label);
    const sources = this.isLinkedFromSession() ? [item] : this.relationStageSourceRefs();
    for (const source of sources) {
      const rawLine = this.relationCancelContentForRef(source).split(/\r?\n/)[
        Math.max(0, Math.floor(numericOrDefault(source.line, 0)))
      ] || source.rawLine || "";
      const status = relationCancelSourceStatus(rawLine);
      if (cancelKeys.has(key) && status === "-") {
        return "⊘ Stays Cancelled · reopen with Alt+]";
      }
      if (completeKeys.has(key) && (status === "x" || status === "X")) {
        return "stays Done · reopen with Alt+[";
      }
    }
    return "";
  }

  restoreRelationList() {
    this.clearRelationLabelSubscriptions();
    this.relationLabelTargets = null;
    this.relationLabelMode = null;
    this.relationLabelShowHidden = false;
    this.relationLabelOneOff = false;
    this.relationLabelGhosts = new Map();
    this.relationLabelWrites = new Set();
    this.relationCancelExpected = null;
    this.relationCloseExpected = null;
    this.relationCancelConfirmNonce = null;
    this.resetRelationMergeCommit();
    this.stage = "value";
    this.selectedIndex = 0;
    const items = this.vaultStage
      ? planRelationStageItemsFromVault(
          this.vaultStage,
          this.getQuery ? this.getQuery() : "",
        )
      : [];
    this.resetLocalTaskMarks(items);
    this.applyOptions(this.relationStageListOptions());
    if (this.resultsEl) {
      this.renderAll({ clearQuery: true });
    }
    this.refreshRelationConsequenceStrip();
    return true;
  }
}
