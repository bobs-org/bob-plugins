// Tie chords and armed ↵ releases for the four Task Card relationship
// stages (`docs/task-dependencies.md` §§6.4, 15; `docs/task-relations.md`
// LG rows). Dispatched from 450 before the generic handlers. Chords are
// desired-state commands through `applyTieChange` (596); ↵ on a ⇄ row
// converts (Depends/Blocks commit on one press, Links/Linked-from arm
// first). Batches and counted sessions refuse conversions (R8).
function tieChordTarget(event) {
  if (!event || event.metaKey === true || event.altKey === true) return null;
  if (event.isComposing === true || event.keyCode === 229) return null;
  if (event.repeat === true) return null;
  if (isCtrlShiftKey(event, "b")) return "other-waits";
  if (isCtrlShiftKey(event, "l")) return "plain-in";
  if (isCtrlKey(event, "b")) return "owner-waits";
  if (isCtrlKey(event, "l")) return "plain-out";
  return null;
}

function tieChordStageKind(picker) {
  if (!picker || typeof picker.isLocalTaskStage !== "function") return null;
  try {
    if (!picker.isLocalTaskStage()) return null;
  } catch (_error) {
    return null;
  }
  if (picker.relationStage === true) {
    return picker.relationStageDirection === "from" ? "linked-from" : "links";
  }
  if (picker.blocksStage === true) return "blocks";
  if (picker.stage === "value") return "depends";
  return null;
}

function tieHighlightedItem(picker) {
  try {
    const items = picker.visibleItems || [];
    const index = picker.selectedIndex || 0;
    return items[index] || null;
  } catch (_error) {
    return null;
  }
}

function tieItemRef(item) {
  if (!item || typeof item !== "object") return null;
  const path = normalizeVaultRelativePath(item.path || "");
  const blockId = normalizeBulletPropertyValue(
    item.blockId || item.existingBlockId || "",
  );
  if (!path || !blockId) return null;
  return Object.freeze({ path, blockId });
}

function tieOwnerBlockId(dependent) {
  if (!dependent || typeof dependent !== "object") return "";
  if (dependent.blockId) {
    return normalizeBulletPropertyValue(dependent.blockId);
  }
  const key = String(dependent.key || "");
  const sep = key.indexOf("\x00");
  if (sep !== -1 && sep < key.length - 1) {
    return normalizeBulletPropertyValue(key.slice(sep + 1));
  }
  return "";
}

function tieChordOwner(picker) {
  try {
    const stage = picker.vaultStage || null;
    const dependent = stage && stage.dependent ? stage.dependent : null;
    if (dependent && dependent.path) {
      const path = normalizeVaultRelativePath(dependent.path);
      let blockId = tieOwnerBlockId(dependent);
      if (!blockId && picker.filePath && stage.files instanceof Map) {
        const content = stage.files.get(path) || "";
        const lines = String(content).split(/\r?\n/);
        const line = lines[dependent.line];
        if (typeof line === "string") {
          blockId = normalizeBulletPropertyValue(getTrailingBlockId(line) || "");
        }
      }
      if (!blockId && picker.filePath) {
        const editor = typeof picker.getEditorContent === "function"
          ? picker.getEditorContent()
          : null;
        if (typeof editor === "string" && picker.cursor) {
          const line = String(editor).split(/\r?\n/)[picker.cursor.line];
          if (typeof line === "string") {
            blockId = normalizeBulletPropertyValue(getTrailingBlockId(line) || "");
          }
        }
      }
      if (path && blockId) return Object.freeze({ path, blockId });
    }
    if (picker.filePath && picker.cursor && Number.isInteger(picker.cursor.line)) {
      const editor = typeof picker.getEditorContent === "function"
        ? picker.getEditorContent()
        : null;
      if (typeof editor === "string") {
        const line = String(editor).split(/\r?\n/)[picker.cursor.line];
        if (typeof line === "string") {
          const blockId = normalizeBulletPropertyValue(getTrailingBlockId(line) || "");
          const path = normalizeVaultRelativePath(picker.filePath);
          if (path && blockId) return Object.freeze({ path, blockId });
        }
      }
    }
  } catch (_error) {
    // Best-effort owner resolution; the caller refuses when null.
  }
  return null;
}

function tieChordOwnerOther(picker, item) {
  const owner = tieChordOwner(picker);
  const other = tieItemRef(item);
  if (!owner || !other) return null;
  return Object.freeze({ owner, other });
}

// ID-less candidates for the ＋ id prompt flow: same resolution as the
// strict refs above, but keeping path/line when the block ID is missing so
// the chord can mint one and then commit. Returns null when even the path
// cannot be located.
function tieItemCandidate(item, fallbackPath) {
  if (!item || typeof item !== "object") return null;
  const path = normalizeVaultRelativePath(
    item.path || fallbackPath || "",
  );
  if (!path) return null;
  const blockId = normalizeBulletPropertyValue(
    item.blockId || item.existingBlockId || "",
  );
  const candidate = {
    path,
    blockId: blockId || "",
    line: Number.isInteger(item.line) ? item.line : null,
    rawLine: typeof item.rawLine === "string" ? item.rawLine : null,
    displayText: item.displayText || item.searchText || "",
    existingIdField: item.existingIdField || item.idField || null,
  };
  if (!candidate.blockId) delete candidate.blockId;
  return Object.freeze(candidate);
}

function tieOwnerCandidate(picker) {
  try {
    const stage = picker.vaultStage || null;
    const dependent = stage && stage.dependent ? stage.dependent : null;
    if (dependent && dependent.path) {
      const path = normalizeVaultRelativePath(dependent.path);
      let blockId = tieOwnerBlockId(dependent);
      let line = Number.isInteger(dependent.line) ? dependent.line : null;
      let rawLine = typeof dependent.rawLine === "string" ? dependent.rawLine : null;
      if (!blockId && picker.filePath && stage.files instanceof Map) {
        const content = stage.files.get(path) || "";
        const lines = String(content).split(/\r?\n/);
        if (Number.isInteger(line) && typeof lines[line] === "string") {
          blockId = normalizeBulletPropertyValue(getTrailingBlockId(lines[line]) || "");
          if (rawLine === null) rawLine = String(lines[line] || "");
        } else if (line === null) {
          const found = tieFindTaskLine(stage.files, path, "");
          void found;
        }
      }
      if (!blockId && picker.filePath) {
        const editor = typeof picker.getEditorContent === "function"
          ? picker.getEditorContent()
          : null;
        if (typeof editor === "string" && picker.cursor && Number.isInteger(picker.cursor.line)) {
          const editorLine = String(editor).split(/\r?\n/)[picker.cursor.line];
          if (typeof editorLine === "string") {
            const editorId = normalizeBulletPropertyValue(getTrailingBlockId(editorLine) || "");
            if (editorId) blockId = editorId;
            if (line === null) line = picker.cursor.line;
            if (rawLine === null) rawLine = String(editorLine || "");
          }
        }
      }
      if (path) {
        const candidate = {
          path,
          line,
          rawLine,
          displayText: dependent.displayText || "",
        };
        if (blockId) candidate.blockId = blockId;
        return Object.freeze(candidate);
      }
    }
    if (picker.filePath && picker.cursor && Number.isInteger(picker.cursor.line)) {
      const editor = typeof picker.getEditorContent === "function"
        ? picker.getEditorContent()
        : null;
      if (typeof editor === "string") {
        const lineText = String(editor).split(/\r?\n/)[picker.cursor.line];
        if (typeof lineText === "string") {
          const blockId = normalizeBulletPropertyValue(getTrailingBlockId(lineText) || "");
          const candidate = {
            path: normalizeVaultRelativePath(picker.filePath),
            line: picker.cursor.line,
            rawLine: String(lineText || ""),
            displayText: "",
          };
          if (blockId) candidate.blockId = blockId;
          return Object.freeze(candidate);
        }
      }
    }
  } catch (_error) {
    // Best-effort candidate; the caller refuses when null.
  }
  return null;
}

function tieMissingIdRequest(picker, item) {
  const fallbackPath = normalizeVaultRelativePath(picker.filePath || "");
  const ownerCand = tieOwnerCandidate(picker);
  const otherCand = tieItemCandidate(item, fallbackPath);
  if (!ownerCand && !otherCand) return null;
  const requests = [];
  if (ownerCand && ownerCand.path && !ownerCand.blockId) {
    requests.push(Object.freeze({ side: "owner", missing: ownerCand }));
  }
  if (otherCand && otherCand.path && !otherCand.blockId) {
    requests.push(Object.freeze({ side: "other", missing: otherCand }));
  }
  if (requests.length === 0) return null;
  return Object.freeze({
    owner: ownerCand,
    other: otherCand,
    missingSide: requests[0].side,
    missing: requests[0].missing,
    requests: Object.freeze(requests),
  });
}

function tieChordDisplayName(item) {
  try {
    const raw = item.displayText || item.searchText || item.path || "that task";
    return cleanTaskDisplayText(String(raw)) || "that task";
  } catch (_error) {
    return "that task";
  }
}

function tieChordKeyName(to) {
  if (to === "other-waits") return "⌃⇧B";
  if (to === "plain-out") return "⌃L";
  if (to === "plain-in") return "⌃⇧L";
  return "⌃B";
}

function tieChordRefusal(picker, item, to) {
  const chord = tieChordKeyName(to);
  try {
    if (picker.isCountedSession && picker.isCountedSession()) {
      return `${chord} acts on one task · needs a single task`;
    }
  } catch (_error) {
    // A helper failure never blocks the chord; applyTieChange guards.
  }
  try {
    const marked = typeof picker.getMarkedCount === "function"
      ? picker.getMarkedCount()
      : 0;
    if (marked > 0) {
      if (item && item.tieConvert === true) {
        const name = tieChordDisplayName(item);
        return `↵ can't replace a dependency in a batch · unmark "${name}" or use ⌃L on it`;
      }
      return `${chord} acts on one task · clear marks first`;
    }
  } catch (_error) {
    // Best-effort batch guard.
  }
  return null;
}

function tieChordExpectedSnapshots(picker, item, refs) {
  const files = picker && picker.vaultStage && picker.vaultStage.files;
  const expected = new Map();
  if (!(files instanceof Map)) return expected;
  const paths = refs
    ? [refs.owner.path, refs.other.path]
    : [tieOwnerCandidate(picker)?.path, item && item.path];
  for (const path of paths) {
    const normalized = normalizeVaultRelativePath(path || "");
    if (normalized && files.has(normalized)) {
      expected.set(normalized, files.get(normalized));
    }
  }
  return expected;
}

function tieShouldHandleChord(picker, event) {
  if (!picker || !event) return null;
  if (picker.stage === "relation-label") return null;
  if (picker.blockIdMode && picker.blockIdMode !== "single") return null;
  if (picker.stage !== "value") return null;
  const kind = tieChordStageKind(picker);
  if (!kind) return null;
  const to = tieChordTarget(event);
  if (!to) return null;
  return Object.freeze({ kind, to });
}

function tieArmedKey(owner, other, to) {
  const o = owner ? `${owner.path}\x00${owner.blockId}` : "";
  const x = other ? `${other.path}\x00${other.blockId}` : "";
  return `${o}→${x}:${to}`;
}

function tieGetArmed(picker) {
  return picker && picker.tieArmedRelease ? picker.tieArmedRelease : null;
}

function tieDisarm(picker) {
  if (picker) picker.tieArmedRelease = null;
}

function tieIsArmedFor(picker, owner, other, to) {
  const armed = tieGetArmed(picker);
  if (!armed) return false;
  return armed.key === tieArmedKey(owner, other, to);
}

function tieEnterToForStage(kind) {
  if (kind === "depends") return "owner-waits";
  if (kind === "blocks") return "other-waits";
  if (kind === "links") return "plain-out";
  if (kind === "linked-from") return "plain-in";
  return null;
}

function tieEnterForRow(picker, item) {
  if (!picker || !item || item.kind === "stage-more") return null;
  if (item.disabled) return null;
  const kind = tieChordStageKind(picker);
  if (!kind) return null;
  const tie = item.tieInfo || null;
  const hasKeptRelation = Boolean(
    (kind === "depends" || kind === "blocks") &&
    tie &&
    ((Array.isArray(tie.labelledOut) && tie.labelledOut.length > 0) ||
      (Array.isArray(tie.labelledIn) && tie.labelledIn.length > 0)),
  );
  if (item.tieConvert !== true && !hasKeptRelation) return null;
  const to = tieEnterToForStage(kind);
  if (!to) return null;
  if (kind === "depends" || kind === "blocks") {
    return Object.freeze({ action: "convert-dependency", to });
  }
  return Object.freeze({ action: "arm-release", to });
}

async function tieCommitChord(picker, to) {
  const item = tieHighlightedItem(picker);
  if (!item || item.kind === "stage-more") return false;
  const refusal = tieChordRefusal(picker, item, to);
  if (refusal) {
    new Notice(refusal);
    return true;
  }
  const refs = tieChordOwnerOther(picker, item);
  const stage = picker.vaultStage;
  if (tieChordHintIsStale(picker, item, stage, refs)) {
    if (typeof picker.refuseDependencyStale === "function") {
      picker.refuseDependencyStale("changed — reopen");
    } else {
      new Notice("changed — reopen");
    }
    return true;
  }
  if (item.disabled) {
    const guarded = !refs
      ? null
      : tieVisibilityTieChangePlan(
          stage,
          picker.plugin,
          refs.owner,
          refs.other,
          to,
        );
    if (!guarded || guarded.kind !== "change" || guarded.reversing !== true) {
      new Notice(item.disabledReason || (guarded && guarded.notice) || "That task cannot change its tie");
      return true;
    }
  }
  if (!refs) {
    // ID-less rows or owners go through the ＋ id prompt flow; Esc writes
    // nothing. Only a truly unlocatable pair refuses here.
    try {
      const missing = typeof tieMissingIdRequest === "function"
        ? tieMissingIdRequest(picker, item)
        : null;
      if (missing && missing.missing && missing.missing.path) {
        if (typeof picker.showBlockIdStage === "function") {
          const stage = picker.vaultStage;
          const expected = new Map();
          for (const candidate of [missing.owner, missing.other]) {
            const path = normalizeVaultRelativePath(candidate && candidate.path || "");
            if (path && stage && stage.files instanceof Map && stage.files.has(path)) {
              expected.set(path, stage.files.get(path));
            }
          }
          if (picker.filePath && typeof picker.getEditorContent === "function") {
            const ownerPath = normalizeVaultRelativePath(picker.filePath);
            const ownerContent = picker.getEditorContent();
            if (ownerPath && typeof ownerContent === "string" && !expected.has(ownerPath)) {
              expected.set(ownerPath, ownerContent);
            }
          }
          picker.pendingTieChange = Object.freeze({
            owner: missing.owner,
            other: missing.other,
            missingSide: missing.missingSide,
            missing: missing.missing,
            to,
            requests: missing.requests || Object.freeze([
              Object.freeze({ side: missing.missingSide, missing: missing.missing }),
            ]),
            promptIndex: 0,
            confirmedIds: Object.freeze({}),
            preparations: Object.freeze([]),
            expected,
            reservedIds: new Set(),
          });
          const promptTask = {
            path: missing.missing.path,
            line: missing.missing.line,
            rawLine: missing.missing.rawLine,
            displayText: missing.missing.displayText || tieChordDisplayName(item),
            existingIdField: missing.missing.existingIdField || null,
          };
          picker.showBlockIdStage(promptTask, { mode: "tie-change" });
          return true;
        }
      }
    } catch (_missingPromptError) {
      // A helper failure falls through to the locate refusal below.
    }
    new Notice("That task could not be located");
    return true;
  }
  tieDisarm(picker);
  // Missing IDs are handled before this call through the ＋ id prompt flow
  // (pendingTieChange); the writer only sees resolved refs here.
  let outcome = null;
  try {
    outcome = await picker.plugin.applyTieChange(refs.owner, refs.other, to, {
      promptBlockId: null,
      expected: tieChordExpectedSnapshots(picker, item, refs),
    });
  } catch (_error) {
    new Notice("Could not update the tie");
    return true;
  }
  if (!outcome) {
    new Notice("Could not update the tie");
    return true;
  }
  if (outcome.ok === true) {
    if (outcome.notice) new Notice(outcome.notice);
    try {
      if (typeof picker.reopenDependencyStageFresh === "function") {
        picker.reopenDependencyStageFresh();
      }
    } catch (_error) {
      // The notice already committed; reopen is best-effort.
    }
    return true;
  }
  if (outcome.reason === "stale") {
    try {
      if (typeof picker.refuseDependencyStale === "function") {
        picker.refuseDependencyStale(outcome.notice || "changed — reopen");
      } else {
        new Notice(outcome.notice || "changed — reopen");
      }
    } catch (_error) {
      new Notice(outcome.notice || "changed — reopen");
    }
    return true;
  }
  new Notice(outcome.notice || "Could not update the tie");
  return true;
}

async function handleTieChord(picker, to) {
  return tieCommitChord(picker, to);
}

function tieReleaseArmCopy(item) {
  const name = tieChordDisplayName(item);
  return `⚠ Removes the dependency · "${name}" becomes Ready — ↵ again · esc keeps it`;
}

function tieDisarmOnNavigate(picker, nextIndex) {
  const armed = tieGetArmed(picker);
  if (!armed) return;
  const item = tieHighlightedItem(picker);
  const key = item ? tieArmedKeyForItem(picker, item) : null;
  if (key !== armed.key) tieDisarm(picker);
}

function tieArmedKeyForItem(picker, item) {
  const refs = tieChordOwnerOther(picker, item);
  if (!refs) return null;
  const kind = tieChordStageKind(picker);
  const to = tieEnterToForStage(kind);
  if (!to) return null;
  return tieArmedKey(refs.owner, refs.other, to);
}

function tieLabelPlainGuardReason(target) {
  const tie = target && target.tieInfo ? target.tieInfo : null;
  if (!tie) return null;
  const hasDependency = Boolean(tie.waitsOn || tie.waitedOnBy);
  if (!hasDependency) return null;
  return "A dependency ties them · ⌃L makes it a plain link";
}

function tieChordNoopForItem(item, to) {
  const tie = item && item.tieInfo ? item.tieInfo : null;
  if (!tie) return false;
  if (to === "owner-waits") return tie.waitsOn === true && tie.waitedOnBy !== true;
  if (to === "other-waits") return tie.waitedOnBy === true && tie.waitsOn !== true;
  if (to === "plain-out") return tie.plainOut === true;
  if (to === "plain-in") return tie.plainIn === true;
  return false;
}

function tieChordHintIsStale(picker, item, stage, refs) {
  if (
    !stage || !(stage.files instanceof Map) ||
    item.stale === true || item.staleRow === true || item.isStale === true ||
    item.changedSinceOpen === true || item.disabledReason === "changed — reopen"
  ) {
    return true;
  }
  const liveContent = (path) => {
    if (
      picker.filePath === path &&
      typeof picker.getEditorContent === "function"
    ) {
      try {
        const content = picker.getEditorContent();
        if (typeof content === "string") return content;
      } catch (_error) {}
    }
    const plugin = picker.plugin;
    for (const method of ["findRelationEditOpenEditor", "findBlocksEditOpenEditor"]) {
      try {
        const editor = plugin && typeof plugin[method] === "function"
          ? plugin[method](path)
          : null;
        if (editor && typeof editor.getValue === "function") {
          return String(editor.getValue() || "");
        }
      } catch (_error) {}
    }
    return null;
  };
  const paths = refs
    ? new Set([refs.owner.path, refs.other.path])
    : new Set([item.path]);
  for (const path of paths) {
    if (!path || !stage.files.has(path)) return true;
    const live = liveContent(path);
    if (live !== null && live !== stage.files.get(path)) return true;
  }
  if (refs && typeof item.rawLine === "string") {
    const content = stage.files.get(refs.other.path);
    const found = tieFindTaskLine(
      new Map([[refs.other.path, String(content || "")]]),
      refs.other.path,
      refs.other.blockId,
    );
    if (found.reason || String(found.lines[found.line] || "") !== item.rawLine) {
      return true;
    }
  }
  return false;
}

function tieChordHintsForItem(picker, item) {
  const kind = tieChordStageKind(picker);
  if (!kind || !item || item.kind === "stage-more") return [];
  const stage = picker.vaultStage;
  const refs = tieChordOwnerOther(picker, item);
  const missing = !refs && typeof tieMissingIdRequest === "function"
    ? tieMissingIdRequest(picker, item)
    : null;
  if (!refs && (!missing || !missing.missing || !missing.missing.path)) return [];
  if (tieChordHintIsStale(picker, item, stage, refs)) return [];
  if (!refs && item.disabled) return [];
  const enterTo = tieEnterToForStage(kind);
  const chords = [
    { to: "owner-waits", keys: ["⌃B"], label: "wait on it" },
    { to: "other-waits", keys: ["⌃⇧B"], label: "make it wait" },
    { to: "plain-out", keys: ["⌃L"], label: "plain link" },
    { to: "plain-in", keys: ["⌃⇧L"], label: "link here" },
  ];
  const out = [];
  for (const chord of chords) {
    if (tieChordRefusal(picker, item, chord.to)) continue;
    if (tieChordNoopForItem(item, chord.to)) continue;
    let planned = null;
    if (refs) {
      planned = tieVisibilityTieChangePlan(
        stage,
        picker.plugin,
        refs.owner,
        refs.other,
        chord.to,
      );
      if (!planned || planned.kind !== "change") continue;
    }
    if (
      chord.to === enterTo &&
      !(item.disabled && planned && planned.reversing === true)
    ) continue;
    if (item.disabled && (!planned || planned.reversing !== true)) continue;
    out.push({ keys: chord.keys, label: chord.label });
  }
  return out;
}

function tieEnterActionForRow(picker, item) {
  return tieEnterForRow(picker, item);
}

function tieRefreshArmedUI(picker) {
  try {
    const armed = tieGetArmed(picker);
    if (picker && typeof picker.refreshRelationConsequenceStrip === "function") {
      picker.refreshRelationConsequenceStrip();
    }
    if (picker && typeof picker.refreshLocalTaskFooter === "function") {
      picker.refreshLocalTaskFooter();
    } else if (picker && typeof picker.renderFooter === "function") {
      try {
        const item = tieHighlightedItem(picker);
        const hints = typeof picker.getRelationStageFooterHints === "function"
          ? picker.getRelationStageFooterHints()
          : picker.footerHints;
        picker.footerHints = hints;
        picker.renderFooter();
      } catch (_footerError) {}
    }
    void armed;
  } catch (_error) {}
}

function tieArmRelease(picker, item, to) {
  const refs = tieChordOwnerOther(picker, item);
  if (!refs) {
    new Notice("That task could not be located");
    return true;
  }
  picker.tieArmedRelease = Object.freeze({
    key: tieArmedKey(refs.owner, refs.other, to),
    owner: refs.owner,
    other: refs.other,
    to,
    display: tieChordDisplayName(item),
  });
  try {
    const el = typeof picker.ensureRelationConsequenceStrip === "function"
      ? picker.ensureRelationConsequenceStrip()
      : picker.consequenceStripEl;
    if (el) {
      el.empty();
      el.createSpan({
        cls: "bob-cnp-consequence-strip-text bob-cnp-tie-armed-effects",
        text: tieReleaseArmCopy(item),
      });
    }
  } catch (_stripError) {}
  try {
    if (typeof picker.getRelationStageFooterHints === "function") {
      picker.footerHints = picker.getRelationStageFooterHints();
      if (typeof picker.renderFooter === "function") picker.renderFooter();
    }
  } catch (_footerError) {}
  return true;
}

function tieLabelGuardForPicker(picker) {
  try {
    const targets = picker && Array.isArray(picker.relationLabelTargets)
      ? picker.relationLabelTargets
      : [];
    const target = targets[0] || null;
    if (typeof tieLabelPlainGuardReason === "function") {
      return tieLabelPlainGuardReason(target);
    }
  } catch (_error) {}
  return null;
}
