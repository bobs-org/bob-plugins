// Successor picker verdict state and keys (`api.successors` v4,
// docs/task-dependencies.md §12.22). Pure helpers plus small modal
// operations. Rendering lives in 206d. Shared scope with 206 and 206a.
const SUCCESSOR_VERDICT_DONE = "done";
const SUCCESSOR_VERDICT_CANCELLED = "cancelled";
const SUCCESSOR_VERDICT_REASON_PLACEHOLDER = "Why cancel? (optional)";
const SUCCESSOR_VERDICT_REASON_HINT = "↵ · Esc back";
const SUCCESSOR_VERDICT_ESC_SINGULAR = "Esc again to discard 1 close";
const SUCCESSOR_VERDICT_ESC_PLURAL = "Esc again to discard {N} closes";
const SUCCESSOR_VERDICT_RETARGET_REFUSAL = "Retarget applies to pull-in rows only";

function normalizeSuccessorVerdictOutcome(value) {
  try {
    const text = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
    if (text === "done" || text === SUCCESSOR_VERDICT_DONE) {
      return SUCCESSOR_VERDICT_DONE;
    }
    if (text === "cancelled" || text === "canceled" || text === SUCCESSOR_VERDICT_CANCELLED) {
      return SUCCESSOR_VERDICT_CANCELLED;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function normalizeSuccessorCancelReason(value) {
  try {
    const collapsed = String(value === null || value === undefined ? "" : value)
      .replace(/[\r\n]+/g, " ")
      .trim();
    return collapsed.slice(0, 500);
  } catch (_error) {
    return "";
  }
}

function successorModalCloseSupported(modal) {
  try {
    return Boolean(modal && modal.model && modal.model.close && modal.model.close.supported === true);
  } catch (_error) {
    return false;
  }
}

function successorRowCloseFor(row) {
  try {
    if (!row || typeof row !== "object" || !row.selectable) {
      return null;
    }
    return row.close && typeof row.close === "object" ? row.close : null;
  } catch (_error) {
    return null;
  }
}

function successorRowVerdictEligible(row, outcome) {
  try {
    const close = successorRowCloseFor(row);
    if (!close) {
      return false;
    }
    if (outcome === SUCCESSOR_VERDICT_DONE) {
      return close.complete === true;
    }
    if (outcome === SUCCESSOR_VERDICT_CANCELLED) {
      return close.cancel === true;
    }
    return close.complete === true || close.cancel === true;
  } catch (_error) {
    return false;
  }
}

function successorModalHasVerdicts(modal) {
  try {
    return Boolean(modal && modal.verdicts instanceof Map && modal.verdicts.size > 0);
  } catch (_error) {
    return false;
  }
}

function successorVerdictCounts(modal) {
  let done = 0;
  let cancel = 0;
  try {
    if (modal && modal.verdicts instanceof Map) {
      for (const verdict of modal.verdicts.values()) {
        if (verdict && verdict.outcome === SUCCESSOR_VERDICT_DONE) {
          done += 1;
        } else if (verdict && verdict.outcome === SUCCESSOR_VERDICT_CANCELLED) {
          cancel += 1;
        }
      }
    }
  } catch (_error) {
    // Counts stay at zero.
  }
  return { done, cancel };
}

// Rule 11: hints, hover buttons, and chords appear only when the model
// carries close support and at least one visible row is eligible.
function successorModalVerdictsActive(modal) {
  try {
    if (!successorModalCloseSupported(modal)) {
      return false;
    }
    const visible = modal && Array.isArray(modal.visibleItems) ? modal.visibleItems : null;
    if (visible) {
      for (const item of visible) {
        if (item && item.kind === "offer" && successorRowVerdictEligible(item.row)) {
          return true;
        }
      }
      return false;
    }
    if (modal && modal.model && Array.isArray(modal.model.groups)) {
      for (const group of modal.model.groups) {
        for (const row of group.rows || []) {
          if (successorRowVerdictEligible(row)) {
            return true;
          }
        }
      }
    }
    return false;
  } catch (_error) {
    return false;
  }
}

function successorQuoteTitle(text) {
  const value = String(text === null || text === undefined ? "" : text).trim();
  return `“${value}”`;
}

function successorConsequenceForRow(row, outcome) {
  try {
    const close = successorRowCloseFor(row);
    const lane = (row && row.lane) ? String(row.lane) : "";
    const laneSuffix = lane ? ` · ${lane} → ` : " → ";
    if (outcome === SUCCESSOR_VERDICT_DONE) {
      if (close && close.completeConsequence) {
        return String(close.completeConsequence);
      }
      return `✓ Completes ${successorQuoteTitle(row.text)}${laneSuffix}Done`;
    }
    if (close && close.cancelConsequence) {
      return String(close.cancelConsequence);
    }
    return `⊘ Cancels ${successorQuoteTitle(row.text)}${laneSuffix}Cancelled`;
  } catch (_error) {
    return "";
  }
}

function successorScopeSuffixForRow(row) {
  try {
    const close = successorRowCloseFor(row);
    if (close && close.scopeNote) {
      return ` · ${String(close.scopeNote)}`;
    }
    return "";
  } catch (_error) {
    return "";
  }
}

function successorUnblocksSuffixForRow(row) {
  try {
    const close = successorRowCloseFor(row);
    const count = close && Number.isFinite(Number(close.unblocks)) ? Math.floor(Number(close.unblocks)) : 0;
    if (count <= 0) {
      return "";
    }
    return count === 1 ? " · unblocks 1 task" : ` · unblocks ${count} tasks`;
  } catch (_error) {
    return "";
  }
}

function successorStatusTextForRow(row, outcome) {
  try {
    return `${successorConsequenceForRow(row, outcome)}${successorUnblocksSuffixForRow(row)}${successorScopeSuffixForRow(row)}`;
  } catch (_error) {
    return successorConsequenceForRow(row, outcome);
  }
}

function successorEscArmedText(count) {
  if (count <= 1) {
    return SUCCESSOR_VERDICT_ESC_SINGULAR;
  }
  return SUCCESSOR_VERDICT_ESC_PLURAL.replace("{N}", String(count));
}

function successorFooterSummaryText(pickCount, doneCount, cancelCount) {
  const parts = [];
  if (pickCount > 0) {
    parts.push(`pull in ${pickCount}`);
  }
  if (doneCount > 0) {
    parts.push(`✓ ${doneCount} done`);
  }
  if (cancelCount > 0) {
    parts.push(`⊘ ${cancelCount} cancel`);
  }
  if (parts.length === 0) {
    return "pull in 0";
  }
  return parts.join(" · ");
}

function successorVerdictAccessibleSuffix(outcome, reason) {
  if (outcome === SUCCESSOR_VERDICT_DONE) {
    return "will be completed";
  }
  const trimmed = normalizeSuccessorCancelReason(reason);
  if (trimmed) {
    return `will be cancelled: ${trimmed}`;
  }
  return "will be cancelled, no reason";
}

// Canonical v4 close filter: keep only closes whose descriptor allows
// that outcome. Unknown keys and disallowed outcomes are dropped.
function normalizeSuccessorClosesForResult(modal, closes) {
  const out = [];
  try {
    if (!Array.isArray(closes)) {
      return out;
    }
    const byKey = new Map();
    for (const group of (modal && modal.model && modal.model.groups) || []) {
      for (const row of (group && group.rows) || []) {
        if (row && typeof row.key === "string" && !byKey.has(row.key)) {
          byKey.set(row.key, row);
        }
      }
    }
    const seen = new Set();
    for (const close of closes) {
      if (!close || typeof close !== "object") {
        continue;
      }
      const key = typeof close.key === "string" ? close.key : "";
      const outcome = normalizeSuccessorVerdictOutcome(close.outcome);
      if (!key || !outcome || seen.has(`${key}::${outcome}`)) {
        continue;
      }
      const row = byKey.get(key);
      if (!row || !successorRowVerdictEligible(row, outcome)) {
        continue;
      }
      seen.add(`${key}::${outcome}`);
      const item = { key, outcome };
      if (outcome === SUCCESSOR_VERDICT_CANCELLED) {
        const reason = normalizeSuccessorCancelReason(close.reason);
        if (reason) {
          item.reason = reason;
        }
      }
      out.push(item);
    }
  } catch (_error) {
    return [];
  }
  return out;
}

function successorVerdictKeyForEvent(event) {
  try {
    if (!event || typeof event !== "object") {
      return null;
    }
    if (event.ctrlKey !== true || event.metaKey === true || event.altKey === true) {
      return null;
    }
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    const code = typeof event.code === "string" ? event.code : "";
    const isX = key === "x" || code === "KeyX";
    if (!isX) {
      return null;
    }
    if (event.shiftKey === true) {
      return SUCCESSOR_VERDICT_CANCELLED;
    }
    return SUCCESSOR_VERDICT_DONE;
  } catch (_error) {
    return null;
  }
}

function successorVerdictShouldIgnoreEvent(event) {
  try {
    if (!event || typeof event !== "object") {
      return true;
    }
    if (event.repeat === true || event.isComposing === true || event.keyCode === 229) {
      return true;
    }
    return false;
  } catch (_error) {
    return true;
  }
}

// Linux Cut exception: Ctrl+X in a non-empty filter selection stays native.
function successorVerdictIsLinuxCut(modal, event) {
  try {
    if (!event || event.shiftKey === true) {
      return false;
    }
    const input = modal && modal.inputEl;
    if (!input || typeof input.selectionStart !== "number" || typeof input.selectionEnd !== "number") {
      return false;
    }
    if (input.selectionStart === input.selectionEnd) {
      return false;
    }
    if (typeof input.value !== "string" || !input.value) {
      return false;
    }
    const platform = (typeof obsidian !== "undefined" && obsidian && obsidian.Platform) || null;
    if (platform && platform.isLinux === true) {
      return true;
    }
    if (typeof navigator === "object" && navigator && typeof navigator.userAgent === "string" &&
      /linux/i.test(navigator.userAgent)) {
      return true;
    }
    if (typeof process === "object" && process && process.platform === "linux") {
      return true;
    }
    return false;
  } catch (_error) {
    return false;
  }
}

function successorFindRowByKey(modal, key) {
  try {
    if (!modal || !modal.model || !key) {
      return null;
    }
    for (const group of modal.model.groups || []) {
      for (const row of (group && group.rows) || []) {
        if (row && row.key === key) {
          return row;
        }
      }
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function successorNextSelectableKey(modal, fromKey) {
  try {
    const visible = modal && Array.isArray(modal.visibleItems) ? modal.visibleItems : [];
    let fromIndex = -1;
    for (let index = 0; index < visible.length; index += 1) {
      const item = visible[index];
      if (item && item.kind === "offer" && item.row && item.row.key === fromKey) {
        fromIndex = index;
        break;
      }
    }
    for (let index = fromIndex + 1; index < visible.length; index += 1) {
      const item = visible[index];
      if (item && item.kind === "offer" && item.row && item.row.selectable) {
        return item.row.key;
      }
    }
    return null;
  } catch (_error) {
    return null;
  }
}

// One setter enforces exclusivity: a verdict clears the pull-in mark and
// a mark clears the verdict. Returns true when the map changed.
function successorSetVerdict(modal, key, outcome, reason) {
  try {
    if (!modal || !(modal.verdicts instanceof Map) || !key) {
      return false;
    }
    const normalized = normalizeSuccessorVerdictOutcome(outcome);
    if (!normalized) {
      return false;
    }
    const row = successorFindRowByKey(modal, key);
    if (!row || !successorRowVerdictEligible(row, normalized)) {
      return false;
    }
    if (modal.markedKeys instanceof Set) {
      modal.markedKeys.delete(key);
    }
    if (normalized === SUCCESSOR_VERDICT_CANCELLED) {
      modal.verdicts.set(key, { outcome: normalized, reason: normalizeSuccessorCancelReason(reason) });
    } else {
      modal.verdicts.set(key, { outcome: normalized });
    }
    modal.escArmed = false;
    return true;
  } catch (_error) {
    return false;
  }
}

function successorClearVerdict(modal, key) {
  try {
    if (!modal || !(modal.verdicts instanceof Map)) {
      return false;
    }
    return modal.verdicts.delete(key);
  } catch (_error) {
    return false;
  }
}

// Tab or click-mark on a verdict row converts it to Pull in.
function successorConvertVerdictToMark(modal, key) {
  try {
    if (!modal || !(modal.verdicts instanceof Map) || !key) {
      return false;
    }
    if (!modal.verdicts.has(key)) {
      return false;
    }
    const row = successorFindRowByKey(modal, key);
    if (!row || row.selectable !== true) {
      return false;
    }
    modal.verdicts.delete(key);
    if (modal.markedKeys instanceof Set) {
      modal.markedKeys.add(key);
    }
    return true;
  } catch (_error) {
    return false;
  }
}

// Prototype patches for SuccessorOfferPickerModal (defined in 206). They
// live here so 206 stays under the 1000-line fragment cap. They run after
// 206 loads; every call site resolves them at gesture time.
function successorInstallVerdictModalPatches() {
  try {
    const proto = typeof SuccessorOfferPickerModal !== "undefined"
      ? SuccessorOfferPickerModal.prototype
      : null;
    if (!proto || proto.successorVerdictPatched === true) {
      return;
    }
    proto.successorVerdictPatched = true;

    proto.close = function successorVerdictClose() {
      try {
        if (this.didSettle === true || this.allowCloseWithoutArm === true) {
          return Object.getPrototypeOf(proto).close.call(this);
        }
        if (this.verdicts instanceof Map && this.verdicts.size > 0) {
          if (this.escArmed !== true) {
            this.escArmed = true;
            try {
              this.renderAll();
            } catch (_error) {
              // The warning still arms without a re-render.
            }
            return this;
          }
          this.verdicts.clear();
          this.escArmed = false;
          this.statusLine = null;
          this.reasonEditKey = null;
          this.reasonPreviousVerdict = null;
        }
        return Object.getPrototypeOf(proto).close.call(this);
      } catch (_error) {
        try {
          return Object.getPrototypeOf(proto).close.call(this);
        } catch (_closeError) {
          return this;
        }
      }
    };

    proto.handleVerdictKey = function successorHandleVerdictKey(event) {
      try {
        if (successorVerdictShouldIgnoreEvent(event)) {
          return false;
        }
        const outcome = successorVerdictKeyForEvent(event);
        if (!outcome) {
          return false;
        }
        if (!successorModalVerdictsActive(this)) {
          return false;
        }
        if (successorVerdictIsLinuxCut(this, event)) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        const active = this.visibleItems[this.selectedIndex];
        if (!active || active.kind !== "offer" || !active.row) {
          return true;
        }
        const row = active.row;
        if (!successorRowVerdictEligible(row, outcome)) {
          const close = successorRowCloseFor(row);
          this.statusLine = {
            text: (close && close.why) || "Only open tasks close here",
            kind: "refusal",
          };
          this.escArmed = false;
          successorShakeRow(this, row.key);
          this.renderAll();
          return true;
        }
        const current = this.verdicts instanceof Map ? this.verdicts.get(row.key) : null;
        if (current && current.outcome === outcome) {
          successorClearVerdict(this, row.key);
          if (this.statusLine && this.statusLine.text === successorStatusTextForRow(row, outcome)) {
            this.statusLine = successorStatusForHighlight(this);
          }
          this.escArmed = false;
          this.renderAll();
          return true;
        }
        if (outcome === SUCCESSOR_VERDICT_CANCELLED) {
          this.reasonPreviousVerdict = current || null;
          successorSetVerdict(this, row.key, outcome, (current && current.reason) || "");
          this.reasonEditKey = row.key;
          this.reasonOpenedAt = this.currentTime();
          this.statusLine = {
            text: successorStatusTextForRow(row, outcome),
            kind: "consequence",
          };
          this.escArmed = false;
          this.renderAll();
          return true;
        }
        successorSetVerdict(this, row.key, outcome);
        this.reasonEditKey = null;
        this.reasonPreviousVerdict = null;
        this.statusLine = {
          text: successorStatusTextForRow(row, outcome),
          kind: "consequence",
        };
        this.escArmed = false;
        const advance = successorNextSelectableKey(this, row.key);
        this.renderAll();
        if (advance) {
          const at = this.visibleItems.findIndex((item) => item.kind === "offer" && item.row && item.row.key === advance);
          if (at >= 0) {
            this.selectedIndex = at;
            this.renderResults();
          }
        }
        return true;
      } catch (_error) {
        return false;
      }
    };

    proto.handleEscapeKey = function successorHandleEscapeKey(event) {
      try {
        if (!successorModalHasVerdicts(this)) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        if (this.escArmed !== true) {
          this.escArmed = true;
          this.renderAll();
          return true;
        }
        this.verdicts.clear();
        this.escArmed = false;
        this.statusLine = null;
        this.reasonEditKey = null;
        this.reasonPreviousVerdict = null;
        this.renderAll();
        return true;
      } catch (_error) {
        return false;
      }
    };
  } catch (_error) {
    // The modal keeps its 206 behavior without verdict keys.
  }
}
