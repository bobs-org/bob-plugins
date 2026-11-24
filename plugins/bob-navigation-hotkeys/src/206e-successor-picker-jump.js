// Successor picker jump pin (`api.successors` v5,
// docs/task-dependencies.md §12.24 successor jump). State, keys, commit,
// and render helpers for the Ctrl+J pin. Follows the 206c prototype-patch
// pattern: `successorInstallJumpModalPatches` runs from 206's onOpen next
// to the verdict patches (plus a load-time install below, as in 206d), and
// 206 itself keeps only one-line hooks. Shared scope with 206 and 206a-206d.
const SUCCESSOR_JUMP_STATUS_SET_PREFIX = "↗ Jumps to ";
const SUCCESSOR_JUMP_STATUS_SET_SUFFIX = " after the close";
const SUCCESSOR_JUMP_STATUS_CLEARED = "Jump cleared";
const SUCCESSOR_JUMP_STATUS_NOT_PINNABLE = "Jump works on offer rows only";
const SUCCESSOR_JUMP_STATUS_LOST_KEY = "Jump target is no longer offered — cleared";
const SUCCESSOR_JUMP_ROW_SUFFIX = "jump target";
const SUCCESSOR_JUMP_BUTTON_LABEL = "↗";
const SUCCESSOR_JUMP_SUMMARY_MAX = 40;

// The card opts in through the normalized model: `jump: {supported: true}`.
// Callers that do not opt in see no chip, and Ctrl+J falls through to
// today's behavior.
function successorJumpSupported(modal) {
  try {
    return Boolean(modal && modal.model && modal.model.jump && modal.model.jump.supported === true);
  } catch (_error) {
    return false;
  }
}

function successorJumpHasStaged(modal) {
  try {
    return Boolean(modal && modal.jumpKey != null && successorJumpSupported(modal));
  } catch (_error) {
    return false;
  }
}

// v1 pins keyed, selectable offer rows only. Muted rows, headers, `+N more`
// folds, and the empty list refuse with a status line.
function successorJumpIsPinnableRow(row) {
  try {
    return Boolean(row && typeof row === "object" && row.selectable === true &&
      typeof row.key === "string" && row.key);
  } catch (_error) {
    return false;
  }
}

function successorJumpTruncate(text) {
  try {
    const value = String(text === null || text === undefined ? "" : text);
    const chars = Array.from(value);
    if (chars.length <= SUCCESSOR_JUMP_SUMMARY_MAX) {
      return value;
    }
    return `${chars.slice(0, SUCCESSOR_JUMP_SUMMARY_MAX).join("").trimEnd()}…`;
  } catch (_error) {
    return "";
  }
}

function successorJumpSetStatus(modal, row) {
  try {
    modal.statusLine = {
      text: `${SUCCESSOR_JUMP_STATUS_SET_PREFIX}${successorQuoteTitle(row.text)}${SUCCESSOR_JUMP_STATUS_SET_SUFFIX}`,
      kind: "consequence",
    };
  } catch (_error) {
    modal.statusLine = { text: SUCCESSOR_JUMP_STATUS_CLEARED, kind: "consequence" };
  }
}

// Fail closed: a pin whose key left the model is dropped with a visible
// status line, never committed.
function successorJumpValidate(modal) {
  try {
    if (!modal || modal.jumpKey == null) {
      return false;
    }
    const row = typeof successorFindRowByKey === "function"
      ? successorFindRowByKey(modal, modal.jumpKey)
      : null;
    if (!row || !successorJumpIsPinnableRow(row)) {
      modal.jumpKey = null;
      modal.statusLine = { text: SUCCESSOR_JUMP_STATUS_LOST_KEY, kind: "refusal" };
      return false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function successorJumpRowClass(modal, row) {
  try {
    return Boolean(successorJumpSupported(modal) && modal.jumpKey != null &&
      row && row.key === modal.jumpKey);
  } catch (_error) {
    return false;
  }
}

function successorJumpRowAriaSuffix(modal, row) {
  try {
    if (successorJumpSupported(modal) && modal.jumpKey != null &&
      row && row.key === modal.jumpKey) {
      return SUCCESSOR_JUMP_ROW_SUFFIX;
    }
    return "";
  } catch (_error) {
    return "";
  }
}

// Footer hints: the Ctrl+J chip sits last before Esc, and the Enter chip
// follows the copy table while a pin is staged.
function successorJumpFooterHints(modal) {
  const fallback = typeof successorVerdictFooterHints === "function"
    ? successorVerdictFooterHints(modal)
    : [];
  try {
    if (!successorJumpSupported(modal)) {
      return fallback;
    }
    const staged = modal && modal.jumpKey != null;
    const out = [];
    for (const hint of fallback) {
      if (hint && Array.isArray(hint.keys) && hint.keys.length === 1 && hint.keys[0] === "↵" && staged) {
        const hasVerdicts = typeof successorModalHasVerdicts === "function" && successorModalHasVerdicts(modal);
        const hasMarks = modal.markedKeys instanceof Set && modal.markedKeys.size > 0;
        out.push({
          keys: ["↵"],
          label: hasVerdicts ? "apply & jump" : hasMarks ? "pull in & jump" : "leave open & jump",
        });
      } else {
        out.push(hint);
      }
    }
    const jumpHint = { keys: ["Ctrl+J"], label: "jump" };
    const escAt = out.findIndex((hint) => hint && Array.isArray(hint.keys) && hint.keys.includes("Esc"));
    if (escAt >= 0) {
      out.splice(escAt, 0, jumpHint);
    } else {
      out.push(jumpHint);
    }
    return out;
  } catch (_error) {
    return fallback;
  }
}

// Footer summary: ` · ↗ “S”`, with S truncated to 40 characters plus `…`.
function successorRenderJumpSummary(modal, summaryEl) {
  try {
    if (!modal || !summaryEl || typeof summaryEl.createSpan !== "function") {
      return;
    }
    if (!successorJumpSupported(modal) || modal.jumpKey == null) {
      return;
    }
    const row = typeof successorFindRowByKey === "function"
      ? successorFindRowByKey(modal, modal.jumpKey)
      : null;
    if (!row) {
      return;
    }
    summaryEl.createSpan({
      cls: "bob-successor-jump-summary",
      text: ` · ↗ “${successorJumpTruncate(row.text)}”`,
    });
  } catch (_error) {
    // The pull count stands without the jump summary.
  }
}

// Row adornments: the solid accent capsule on the pinned row, plus the ↗
// hover button on pinnable rows. The actions container renders on
// jump-enabled cards even when verdicts are not active.
function successorRenderJumpRowAdornments(modal, rowEl, row, navIndex) {
  try {
    if (!modal || !rowEl || !row) {
      return;
    }
    if (!successorJumpSupported(modal)) {
      return;
    }
    if (!successorJumpIsPinnableRow(row)) {
      return;
    }
    const pinned = modal.jumpKey != null && row.key === modal.jumpKey;
    if (pinned) {
      const capsule = rowEl.createSpan({ cls: "bob-successor-jump-pin" });
      const icon = capsule.createSpan({
        cls: "bob-successor-jump-pin-icon",
        attr: { "aria-hidden": "true" },
      });
      try {
        if (typeof applyIcon === "function") {
          applyIcon(icon, "arrow-up-right");
        }
      } catch (_iconError) {
        // The word carries the pin without the icon.
      }
      capsule.createSpan({ cls: "bob-successor-jump-pin-label", text: "Jump" });
    }
    const selected = modal.selectedIndex === navIndex;
    if (!selected && !pinned) {
      return;
    }
    let actions = null;
    try {
      const children = rowEl.children || [];
      for (const child of children) {
        const classes = child && child.classes
          ? child.classes
          : String((child && child.className) || "").split(/\s+/).filter(Boolean);
        if (classes.includes("bob-successor-verdict-actions")) {
          actions = child;
          break;
        }
      }
    } catch (_findError) {
      actions = null;
    }
    if (!actions) {
      actions = rowEl.createDiv({ cls: "bob-successor-verdict-actions" });
    }
    const button = actions.createEl("button", {
      cls: "bob-successor-verdict-btn is-jump",
      text: SUCCESSOR_JUMP_BUTTON_LABEL,
      attr: {
        type: "button",
        "aria-label": `Jump to ${row.text} after the close`,
      },
    });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      modal.selectedIndex = navIndex;
      modal.handleJumpKey({
        key: "j", code: "KeyJ", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
        preventDefault() {}, stopPropagation() {},
      });
    });
  } catch (_error) {
    // Rows render without jump adornments rather than throwing.
  }
}

// Full replacement for applySelection once the jump patches install: the
// 206 logic plus the staged pin. A staged pin commits with no highlight
// fallback, and settles `{picks, closes?, jump: {key}}`.
function successorJumpApplySelection(modal) {
  if (typeof successorRequirementPrepareCommit === "function" && !successorRequirementPrepareCommit(modal)) {
    return false;
  }
  const keys = modal.model.groups.flatMap((group) => group.rows)
    .filter((row) => {
      if (row.group === "requirements" || !row.selectable || !modal.markedKeys.has(row.key)) {
        return false;
      }
      if (modal.verdicts instanceof Map && modal.verdicts.has(row.key)) {
        return false;
      }
      return true;
    })
    .map((row) => row.key);
  const closes = [];
  try {
    if (modal.verdicts instanceof Map) {
      for (const [key, verdict] of modal.verdicts) {
        if (!verdict || !key) {
          continue;
        }
        const row = successorFindRowByKey(modal, key);
        if (!row || !successorRowVerdictEligible(row, verdict.outcome)) {
          continue;
        }
        if (modal.markedKeys instanceof Set && modal.markedKeys.has(key)) {
          continue;
        }
        if (verdict.outcome === SUCCESSOR_VERDICT_CANCELLED) {
          const reason = normalizeSuccessorCancelReason(verdict.reason);
          closes.push(reason ? { key, outcome: "cancelled", reason } : { key, outcome: "cancelled" });
        } else {
          closes.push({ key, outcome: "done" });
        }
      }
    }
  } catch (_error) {
    // Picks still apply without closes rather than refusing the gesture.
  }
  let jump = null;
  let invalidJump = false;
  if (modal.jumpKey != null) {
    const row = successorFindRowByKey(modal, modal.jumpKey);
    if (row && successorJumpIsPinnableRow(row)) {
      jump = { key: modal.jumpKey };
    } else {
      invalidJump = true;
      modal.jumpKey = null;
      modal.statusLine = { text: SUCCESSOR_JUMP_STATUS_LOST_KEY, kind: "refusal" };
    }
  }
  const reqs = typeof successorRequirementResults === "function" ? successorRequirementResults(modal) : [];
  let selected = keys;
  let defaultRequirementSubmit = false;
  if (selected.length === 0 && closes.length === 0 && reqs.length === 0 && jump == null && !invalidJump) {
    const active = modal.visibleItems[modal.selectedIndex];
    if (active && active.kind === "requirement" && active.row.selectable) {
      defaultRequirementSubmit = true;
    } else if (!active || active.kind !== "offer" || !active.row.selectable) {
      return false;
    } else {
      selected = [active.row.key];
    }
  }
  const hasReqGroups = (modal.model.groups || []).some((group) => group && group.group === "requirements");
  const submission = {
    picks: selected.map((key) => {
      const item = { key };
      try {
        const override = modal.destinationOverrides && modal.destinationOverrides.get(key);
        if (override && typeof override === "object") {
          item.destination = override;
        }
      } catch (_overrideError) {
        // A pick without an override still links at its planned spot.
      }
      return item;
    }),
    ...(hasReqGroups && (reqs.length > 0 || defaultRequirementSubmit || jump != null) ? { reqs } : {}),
    ...(closes.length > 0 ? { closes } : {}),
    ...(jump ? { jump } : {}),
  };
  if (closes.length > 0) {
    const targets = closes.map((close) => {
      const row = successorFindRowByKey(modal, close.key);
      if (!row) return null;
      const lineText = typeof row.rawLine === "string"
        ? row.rawLine
        : row.task && typeof row.task.preimage === "string"
          ? row.task.preimage
          : String(row.lineText || row.text || "");
      const before = getObsidianTaskCheckboxStatus(lineText) || String(row.status || " ").slice(0, 1);
      const line = Number.isInteger(row.line) ? row.line + 1 : Number(row.task && row.task.line);
      const path = String(row.notePath || row.path || (row.task && row.task.path) || "");
      if (!path || !Number.isInteger(line)) return null;
      return { path, line, lineText, before, after: close.outcome === "cancelled" ? "-" : "x" };
    }).filter(Boolean);
    if (targets.length !== closes.length) {
      modal.statusLine = { text: "Email task close could not be identified; staged choices remain", kind: "refusal" };
      try { if (typeof modal.renderAll === "function") modal.renderAll(); } catch (_error) {}
      return true;
    }
    if (targets.length > 0) {
      modal.mailCloseGuardPending = true;
      void confirmMailCloseForApp(modal.app, targets).then((guarded) => {
        modal.mailCloseGuardPending = false;
        if (!guarded.confirmed) {
          modal.statusLine = { text: "Email task close kept open; staged choices remain", kind: "consequence" };
          try { if (typeof modal.renderAll === "function") modal.renderAll(); } catch (_error) {}
          return;
        }
        submission.context = { mailCloseConfirmed: guarded.token };
        modal.settle(submission);
      }).catch(() => {
        modal.mailCloseGuardPending = false;
        modal.statusLine = { text: "Email task close could not be confirmed", kind: "refusal" };
        try { if (typeof modal.renderAll === "function") modal.renderAll(); } catch (_error) {}
      });
      return true;
    }
  }
  modal.settle(submission);
  return true;
}

// The single settle implementation used by the picker class in 206.
function successorJumpSettle(modal, result) {
  if (modal.didSettle) return;
  modal.didSettle = true;
  const picks = result && Array.isArray(result.picks) ? result.picks : null;
  const reqs = result && Array.isArray(result.reqs) ? result.reqs : null;
  const closes = result && Array.isArray(result.closes) ? result.closes : null;
  const mailCloseConfirmed = result && result.context && typeof result.context.mailCloseConfirmed === "string"
    ? result.context.mailCloseConfirmed
    : null;
  const jump = result && result.jump && typeof result.jump === "object" &&
    typeof result.jump.key === "string" && result.jump.key
    ? { key: result.jump.key }
    : null;
  if (picks) {
    modal.result = {
      picks,
      ...(reqs ? { reqs } : {}),
      ...(closes ? { closes } : {}),
      ...(mailCloseConfirmed ? { context: { mailCloseConfirmed } } : {}),
      ...(jump ? { jump } : {}),
    };
  } else {
    modal.result = null;
  }
  try {
    modal.close();
  } catch (_error) {
    // Cleanup is delivered below even when Obsidian's modal teardown fails.
  }
  if (!modal.onCloseSettled) {
    modal.onCloseSettled = true;
    try {
      modal.onSettle(modal.result);
    } catch (_settleError) {
      // A settled picker never re-opens or rejects its caller.
    }
  }
}

// Prototype patches for SuccessorOfferPickerModal (defined in 206). They
// live here so 206 stays under the 1000-line fragment cap. They run after
// 206 loads; every call site resolves them at gesture time.
function successorInstallJumpModalPatches() {
  try {
    const proto = typeof SuccessorOfferPickerModal !== "undefined"
      ? SuccessorOfferPickerModal.prototype
      : null;
    if (!proto || proto.successorJumpPatched === true) {
      return;
    }
    proto.successorJumpPatched = true;

    proto.handleJumpKey = function successorHandleJumpKey(event) {
      try {
        if (!event || typeof event !== "object") {
          return false;
        }
        const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
        const code = typeof event.code === "string" ? event.code : "";
        if (key !== "j" && code !== "KeyJ") {
          return false;
        }
        if (event.ctrlKey !== true || event.metaKey === true ||
          event.altKey === true || event.shiftKey === true) {
          return false;
        }
        if (typeof successorVerdictShouldIgnoreEvent === "function" &&
          successorVerdictShouldIgnoreEvent(event)) {
          return false;
        }
        // The reason editor consumes the key and does nothing.
        if (this.reasonEditKey != null) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        if (!successorJumpSupported(this)) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        const active = this.visibleItems && this.visibleItems[this.selectedIndex];
        const row = active && (active.kind === "offer" || active.kind === "requirement") ? active.row : null;
        if (!row || !successorJumpIsPinnableRow(row)) {
          this.statusLine = { text: SUCCESSOR_JUMP_STATUS_NOT_PINNABLE, kind: "refusal" };
          if (typeof successorModalHasStagedChoices === "function" && successorModalHasStagedChoices(this)) {
            this.escArmed = false;
          }
          try {
            if (row && row.key && typeof successorShakeRow === "function") {
              successorShakeRow(this, row.key);
            }
          } catch (_shakeError) {
            // The refusal line stands without the shake.
          }
          this.renderAll();
          return true;
        }
        if (this.jumpKey === row.key) {
          this.jumpKey = null;
          this.statusLine = { text: SUCCESSOR_JUMP_STATUS_CLEARED, kind: "consequence" };
        } else {
          this.jumpKey = row.key;
          successorJumpSetStatus(this, row);
        }
        if (typeof successorModalHasStagedChoices === "function" && successorModalHasStagedChoices(this)) {
          this.escArmed = false;
        }
        this.renderAll();
        return true;
      } catch (_error) {
        return false;
      }
    };

  } catch (_error) {
    // The modal keeps its 206 behavior without jump keys.
  }
}

// Install the 206e prototype patches now that 206 has loaded. The call
// is idempotent; onOpen also retries for harnesses that load fragments
// out of order.
try {
  if (typeof successorInstallJumpModalPatches === "function") {
    successorInstallJumpModalPatches();
  }
} catch (_error) {
  // The modal keeps its 206 behavior without jump keys.
}
