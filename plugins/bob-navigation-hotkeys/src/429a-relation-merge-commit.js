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
  async commitRelationMergeLabel(item, label, withLabel) {
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
    const missingId = [...sources, into].some(
      (ref) => !normalizeBulletPropertyValue((ref && ref.blockId) || ""),
    );
    if (missingId) {
      new Notice(RELATION_MERGE_MISSING_ID_MESSAGE);
      return false;
    }
    if (relationMergeAllClosed(sources)) {
      const groups = this.relationLabelMode === "relabel"
        ? { add: [], remove: [], relabel: withLabel }
        : { add: withLabel, remove: [], relabel: [] };
      const committed = await this.commitRelationEdit(groups);
      if (committed) new Notice(RELATION_MERGE_ALREADY_CLOSED_MESSAGE);
      return committed;
    }
    let saved;
    try {
      saved = await saveActiveRelationLabelEditor(this.app);
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
