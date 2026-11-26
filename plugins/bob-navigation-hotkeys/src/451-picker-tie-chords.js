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

function tieChordDisplayName(item) {
  try {
    const raw = item.displayText || item.searchText || item.path || "that task";
    return cleanTaskDisplayText(String(raw)) || "that task";
  } catch (_error) {
    return "that task";
  }
}

function tieChordRefusal(picker, item, to) {
  try {
    if (picker.isCountedSession && picker.isCountedSession()) {
      return "⌃B acts on one task · needs a single task";
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
      return "⌃B acts on one task · clear marks first";
    }
  } catch (_error) {
    // Best-effort batch guard.
  }
  return null;
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
  if (item.tieConvert !== true) return null;
  const kind = tieChordStageKind(picker);
  if (!kind) return null;
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
  if (item.disabled) {
    new Notice(item.disabledReason || "That task cannot change its tie");
    return true;
  }
  const refs = tieChordOwnerOther(picker, item);
  if (!refs) {
    new Notice("That task could not be located");
    return true;
  }
  const refusal = tieChordRefusal(picker, item, to);
  if (refusal) {
    new Notice(refusal);
    return true;
  }
  tieDisarm(picker);
  let outcome = null;
  try {
    outcome = await picker.plugin.applyTieChange(refs.owner, refs.other, to, {
      promptBlockId: picker.showBlockIdStage
        ? (ref) => picker.showBlockIdStage(ref, { mode: "tie-change" })
        : null,
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

function tieChordHintsForItem(picker, item) {
  const kind = tieChordStageKind(picker);
  if (!kind || !item || item.kind === "stage-more" || item.disabled) return [];
  const enterTo = tieEnterToForStage(kind);
  const chords = [
    { to: "owner-waits", keys: ["⌃B"], label: "wait on it" },
    { to: "other-waits", keys: ["⌃⇧B"], label: "make it wait" },
    { to: "plain-out", keys: ["⌃L"], label: "plain link" },
    { to: "plain-in", keys: ["⌃⇧L"], label: "link here" },
  ];
  const out = [];
  for (const chord of chords) {
    if (chord.to === enterTo) continue;
    if (tieChordNoopForItem(item, chord.to)) continue;
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
