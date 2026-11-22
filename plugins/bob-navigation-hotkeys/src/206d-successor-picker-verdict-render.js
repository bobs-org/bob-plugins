// Successor picker verdict rendering (`api.successors` v4). DOM helpers
// called from 206. Shared scope with 206, 206a, and 206c.
const SUCCESSOR_VERDICT_FOOTER_BASE = [
  { keys: ["Tab"], label: "toggle and move" },
  { keys: ["Ctrl+A"], label: "mark group" },
];
const SUCCESSOR_VERDICT_FOOTER_VERDICT_HINTS = [
  { keys: ["Ctrl+X"], label: "done" },
  { keys: ["Ctrl+Shift+X"], label: "cancel" },
];
const SUCCESSOR_VERDICT_FOOTER_APPLY = [{ keys: ["↵"], label: "apply" }];
const SUCCESSOR_VERDICT_FOOTER_PULL_IN = [{ keys: ["↵"], label: "pull in" }];
const SUCCESSOR_VERDICT_FOOTER_NONE = [{ keys: ["Esc"], label: "none" }];

// The row being cancelled is the inline reason's subject (T10/T11): `((` shows
// it disabled, plus every ID-less sibling row (T11): naming one would change
// its line digest and refuse its own staged verdict with changed_identity.
// Successor task context carries a 1-based line; the guard's lines are
// 0-based. A row without task context has no stable identity, so it declares
// no subject rather than guessing one. Identified siblings stay linkable.
function successorReasonSubjects(row, modal) {
  try {
    const entries = [];
    const task = row && row.task;
    if (task && typeof task.path === "string" && Number.isInteger(task.line) && task.line >= 1) {
      entries.push({ path: task.path, line: task.line - 1, rawLine: task.preimage });
    }
    try {
      const groups = modal && modal.model && Array.isArray(modal.model.groups) ? modal.model.groups : null;
      if (groups) {
        for (const group of groups) {
          const rows = group && group.rows;
          if (!Array.isArray(rows)) continue;
          for (const sibling of rows) {
            if (!sibling || sibling === row) continue;
            const stask = sibling && sibling.task;
            if (!stask || typeof stask.path !== "string" || !Number.isInteger(stask.line) || stask.line < 1) continue;
            const raw = typeof stask.preimage === "string" ? stask.preimage : (typeof stask.text === "string" ? stask.text : null);
            if (typeof raw !== "string") continue;
            let trailing = null;
            try { trailing = getTrailingBlockId(raw); } catch (_error) { trailing = null; }
            if (trailing) continue;
            entries.push({ path: stask.path, line: stask.line - 1, rawLine: raw });
          }
        }
      }
    } catch (_error) {}
    return proseTaskSubjects(entries);
  } catch (_error) {
    return [];
  }
}

function successorVerdictFooterHints(modal) {
  try {
    const hints = SUCCESSOR_VERDICT_FOOTER_BASE.slice();
    if (successorModalVerdictsActive(modal)) {
      hints.push(...SUCCESSOR_VERDICT_FOOTER_VERDICT_HINTS);
      hints.push(...(successorModalHasVerdicts(modal)
        ? SUCCESSOR_VERDICT_FOOTER_APPLY
        : SUCCESSOR_VERDICT_FOOTER_PULL_IN));
    } else {
      hints.push(...SUCCESSOR_VERDICT_FOOTER_PULL_IN);
    }
    try {
      if (modal && modal.retargetEnabled !== false && typeof getSuccessorDestinationPickerApi === "function") {
        const api = getSuccessorDestinationPickerApi(modal.app);
        if (api) {
          hints.push({ keys: ["Ctrl+Shift+Enter"], label: "retarget" });
        }
      } else if (modal && modal.footerHints && modal.footerHints.some((hint) => hint && hint.label === "retarget")) {
        hints.push({ keys: ["Ctrl+Shift+Enter"], label: "retarget" });
      }
    } catch (_error) {
      // The verdict hints stand without the retarget chip.
    }
    hints.push(...SUCCESSOR_VERDICT_FOOTER_NONE);
    return hints;
  } catch (_error) {
    return SUCCESSOR_VERDICT_FOOTER_BASE.concat(
      SUCCESSOR_VERDICT_FOOTER_PULL_IN,
      SUCCESSOR_VERDICT_FOOTER_NONE,
    );
  }
}

function successorVerdictMarkText(row, verdict) {
  try {
    if (verdict && verdict.outcome === SUCCESSOR_VERDICT_DONE) {
      return "✓";
    }
    if (verdict && verdict.outcome === SUCCESSOR_VERDICT_CANCELLED) {
      return "⊘";
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function successorApplyVerdictMarkIcon(markEl, verdict) {
  try {
    if (!markEl || !verdict) {
      return;
    }
    const icon = verdict.outcome === SUCCESSOR_VERDICT_DONE ? "circle-check" : "circle-slash";
    if (typeof applyIcon === "function") {
      applyIcon(markEl, icon);
    }
  } catch (_error) {
    // Text fallback already carries the verdict.
  }
}

function successorVerdictCapsuleText(verdict) {
  if (!verdict) {
    return "";
  }
  if (verdict.outcome === SUCCESSOR_VERDICT_DONE) {
    return "✓ Done";
  }
  return "⊘ Cancel";
}

function successorVerdictRowAriaSuffix(row, verdict) {
  try {
    if (!verdict) {
      return "";
    }
    return successorVerdictAccessibleSuffix(verdict.outcome, verdict.reason);
  } catch (_error) {
    return "";
  }
}

// Status line model: consequence of the most recent staging, the
// highlighted verdict row, an armed-Esc warning, or an ineligible why.
function successorUpdateStatusLine(modal, next) {
  try {
    if (!modal) {
      return;
    }
    if (next === undefined) {
      return;
    }
    if (next === null) {
      modal.statusLine = null;
      return;
    }
    modal.statusLine = { text: String(next.text || ""), kind: next.kind || "consequence" };
  } catch (_error) {
    // The card renders without a status line rather than throwing.
  }
}

function successorStatusForHighlight(modal) {
  try {
    if (!modal || modal.escArmed === true) {
      return null;
    }
    const active = modal.visibleItems && modal.visibleItems[modal.selectedIndex];
    if (!active || active.kind !== "offer" || !active.row) {
      return null;
    }
    const verdict = modal.verdicts instanceof Map ? modal.verdicts.get(active.row.key) : null;
    if (!verdict) {
      return null;
    }
    return { text: successorStatusTextForRow(active.row, verdict.outcome), kind: "consequence" };
  } catch (_error) {
    return null;
  }
}

function successorRenderStatusLine(modal, footerHost) {
  try {
    if (!modal || !footerHost || typeof footerHost.createDiv !== "function") {
      return;
    }
    let status = modal.statusLine || null;
    if (modal.escArmed === true) {
      const counts = successorVerdictCounts(modal);
      const total = counts.done + counts.cancel;
      if (total > 0) {
        status = { text: successorEscArmedText(total), kind: "warning" };
      }
    } else if (!status) {
      status = successorStatusForHighlight(modal);
    }
    if (!status || !status.text) {
      return;
    }
    const cls = status.kind === "warning"
      ? "bob-successor-status is-warning"
      : status.kind === "refusal"
        ? "bob-successor-status is-refusal"
        : "bob-successor-status";
    const line = footerHost.createDiv({ cls, attr: { "aria-live": "polite" } });
    line.textContent = status.text;
  } catch (_error) {
    // Footer summary still renders without the status line.
  }
}

function successorShakeRow(modal, key) {
  try {
    if (!modal || !modal.resultsEl || typeof modal.resultsEl.querySelector === "function") {
      return;
    }
    const reduceMotion = typeof window === "object" && window &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
    if (reduceMotion) {
      return;
    }
    const selected = modal.resultsEl.querySelector(`[data-successor-key="${key}"]`);
    if (selected && selected.classList && typeof selected.classList.add === "function") {
      selected.classList.add("is-shake");
      const done = () => {
        try {
          selected.classList.remove("is-shake");
        } catch (_error) {
          // The row may have re-rendered away.
        }
      };
      if (typeof window === "object" && window && typeof window.setTimeout === "function") {
        window.setTimeout(done, 200);
      } else {
        done();
      }
    }
  } catch (_error) {
    // A missing shake never blocks the refusal copy.
  }
}

// Hover buttons (✓, ⊘) left of the capsule. Clicking stages the same
// highlighted-row verdict as the chord, minus the advance. Ineligible rows
// render disabled with the engine's `why` as the tooltip.
function successorRenderVerdictActions(modal, rowEl, row, verdict, navIndex) {
  try {
    const actions = rowEl.createDiv({ cls: "bob-successor-verdict-actions" });
    const doneBtn = actions.createEl("button", {
      cls: "bob-successor-verdict-btn is-done",
      text: "✓",
      attr: {
        type: "button",
        "aria-label": `Mark ${row.text} Done`,
        ...(successorRowVerdictEligible(row, SUCCESSOR_VERDICT_DONE)
          ? {}
          : { disabled: "true", title: (successorRowCloseFor(row) && successorRowCloseFor(row).why) || "Only open tasks close here" }),
      },
    });
    doneBtn.addEventListener("mousedown", (event) => event.preventDefault());
    doneBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      modal.selectedIndex = navIndex;
      modal.handleVerdictKey({
        key: "x", code: "KeyX", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
        preventDefault() {}, stopPropagation() {},
      });
      try {
        modal.selectedIndex = navIndex;
        modal.renderResults();
      } catch (_error) {
        // The chord already rendered.
      }
      if (verdict && verdict.outcome === SUCCESSOR_VERDICT_DONE) {
        successorClearVerdict(modal, row.key);
        modal.renderAll();
      }
    });
    const cancelBtn = actions.createEl("button", {
      cls: "bob-successor-verdict-btn is-cancel",
      text: "⊘",
      attr: {
        type: "button",
        "aria-label": `Mark ${row.text} Cancelled`,
        ...(successorRowVerdictEligible(row, SUCCESSOR_VERDICT_CANCELLED)
          ? {}
          : { disabled: "true", title: (successorRowCloseFor(row) && successorRowCloseFor(row).why) || "Only open tasks close here" }),
      },
    });
    cancelBtn.addEventListener("mousedown", (event) => event.preventDefault());
    cancelBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      modal.selectedIndex = navIndex;
      modal.handleVerdictKey({
        key: "X", code: "KeyX", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true,
        preventDefault() {}, stopPropagation() {},
      });
      try {
        modal.selectedIndex = navIndex;
        modal.renderResults();
      } catch (_error) {
        // The chord already rendered.
      }
      if (verdict && verdict.outcome === SUCCESSOR_VERDICT_CANCELLED) {
        successorClearVerdict(modal, row.key);
        modal.reasonEditKey = null;
        modal.renderAll();
      }
    });
  } catch (_error) {
    // Rows render without hover buttons rather than throwing.
  }
}

// Details line for a row: verdict capsule, unblocks chip, and cancel
// reason replace `→ DEST` on verdict rows; other rows keep today's line
// plus the `unblocks {k}` chip when eligible.
function successorRowDetailsList(modal, row, verdict) {
  const details = [];
  try {
    const note = successorPickerNoteName(row.notePath);
    if (note) details.push(note);
    if (row.lane) details.push(row.lane);
    if (verdict) {
      details.push(successorVerdictCapsuleText(verdict));
      const close = successorRowCloseFor(row);
      if (close && close.unblocks > 0) {
        details.push(close.unblocks === 1 ? "unblocks 1" : `unblocks ${close.unblocks}`);
      }
      if (verdict.outcome === SUCCESSOR_VERDICT_CANCELLED) {
        const reasonText = normalizeSuccessorCancelReason(verdict.reason);
        details.push(reasonText ? successorQuoteTitle(reasonText) : "no reason");
      }
    } else {
      let shownDestination = row.destinationLabel;
      try {
        const override = modal.destinationOverrides && modal.destinationOverrides.get(row.key);
        const overrideLabel = successorDestinationOverrideLabel(override);
        if (overrideLabel) {
          shownDestination = overrideLabel;
        }
      } catch (_error) {
        // Fall through to the planned destination label.
      }
      if (shownDestination) details.push(`→ ${shownDestination}`);
      const close = successorRowCloseFor(row);
      if (close && close.unblocks > 0 && successorRowVerdictEligible(row)) {
        details.push(close.unblocks === 1 ? "unblocks 1" : `unblocks ${close.unblocks}`);
      }
    }
    if (row.needsBlockId) details.push("needs ^id");
    if (!row.selectable && row.mutedReason) details.push(row.mutedReason);
  } catch (_error) {
    // The row keeps whatever details built before the throw.
  }
  return details;
}

// renderResults rebuilds the reason editor. Park the live draft, caret, and
// band handle first so the rebuilt editor rebinds instead of losing them.
function successorParkReasonEditor(modal) {
  try {
    const input = modal.reasonInputEl;
    const key = modal.reasonEditKey;
    if (key != null && input && modal.reasonInputKey === key) {
      modal.reasonParked = {
        key,
        value: String(input.value == null ? "" : input.value),
        start: Number.isInteger(input.selectionStart) ? input.selectionStart : null,
        end: Number.isInteger(input.selectionEnd) ? input.selectionEnd : null,
        handle: modal.reasonRecall || null,
      };
      modal.reasonRecall = null;
    }
  } catch (_error) {
    modal.reasonParked = null;
  }
  modal.reasonInputEl = null;
  modal.reasonInputKey = null;
}

// Drop a parked handle the rebuilt results did not claim.
function successorDropParkedReasonEditor(modal) {
  const parked = modal.reasonParked;
  modal.reasonParked = null;
  try {
    if (parked && parked.handle && typeof parked.handle.detach === "function") parked.handle.detach();
  } catch (_error) {
    // The picker stays usable when band cleanup is unavailable.
  }
}

// Inline cancel reason field. Replaces the row's detail line while open.
// Enter confirms, Esc or Ctrl+[ restores, blur confirms the typed text.
function successorRenderReasonEditor(modal, container, row, draft) {
  try {
    const parked = modal.reasonParked && modal.reasonParked.key === row.key ? modal.reasonParked : null;
    if (parked) modal.reasonParked = null;
    const initial = parked ? parked.value : draft || "";
    const wrap = container.createDiv({ cls: "bob-successor-reason" });
    // Clicks inside the editor (field, band rows) never toggle the offer row.
    wrap.addEventListener("click", (event) => {
      try { if (event && typeof event.stopPropagation === "function") event.stopPropagation(); } catch (_error) {}
    });
    // bob-text: prose S6
    const input = wrap.createEl("input", {
      cls: "bob-successor-reason-input",
      attr: {
        type: "text",
        placeholder: SUCCESSOR_VERDICT_REASON_PLACEHOLDER,
        "aria-label": SUCCESSOR_VERDICT_REASON_PLACEHOLDER,
        value: initial,
      },
    });
    try {
      input.value = initial;
    } catch (_error) {
      // The attribute already carries the draft.
    }
    modal.reasonInputEl = input;
    modal.reasonInputKey = row.key;
    if (parked && parked.start !== null && typeof input.setSelectionRange === "function") {
      try {
        input.setSelectionRange(parked.start, parked.end === null ? parked.start : parked.end);
      } catch (_error) {
        // The caret falls back to the end of the draft.
      }
    }
    const bandHost = wrap.createDiv({ cls: "bob-successor-reason-recall-host" });
    let rebound = false;
    if (parked && parked.handle && typeof parked.handle.rebind === "function") {
      try {
        rebound = parked.handle.rebind({ inputEl: input, bandHost }) !== false;
        if (rebound) modal.reasonRecall = parked.handle;
      } catch (_error) {
        rebound = false;
      }
    }
    if (!rebound) {
      try {
        if (parked && parked.handle && typeof parked.handle.detach === "function") parked.handle.detach();
      } catch (_error) {
        // A stale handle never blocks a fresh attach.
      }
      const recallApi = getNavigationLogRecallApi(modal.app);
      if (recallApi) {
        modal.reasonRecall = recallApi.attach({
          inputEl: input,
          bandHost,
          kind: "cancel",
          density: "dense",
          ownKeys: true,
          links: true,
          subjects: () => successorReasonSubjects(row, modal),
          sourcePath: () => (row && row.notePath ? String(row.notePath) : null),
        });
      }
    }
    const hint = wrap.createSpan({ cls: "bob-successor-reason-hint", text: SUCCESSOR_VERDICT_REASON_HINT });
    hint.setAttribute("aria-hidden", "true");
    let resolved = false;
    const commit = (value) => {
      try {
        if (resolved || modal.reasonEditKey !== row.key) return;
        resolved = true;
        const reason = normalizeSuccessorCancelReason(value);
        const current = modal.verdicts instanceof Map ? modal.verdicts.get(row.key) : null;
        if (current && current.outcome === SUCCESSOR_VERDICT_CANCELLED) {
          modal.verdicts.set(row.key, { outcome: SUCCESSOR_VERDICT_CANCELLED, reason });
        } else {
          successorSetVerdict(modal, row.key, SUCCESSOR_VERDICT_CANCELLED, reason);
        }
        modal.reasonEditKey = null;
        modal.statusLine = {
          text: successorStatusTextForRow(row, SUCCESSOR_VERDICT_CANCELLED),
          kind: "consequence",
        };
        const advance = successorNextSelectableKey(modal, row.key);
        modal.renderAll();
        if (advance) {
          const visible = modal.visibleItems || [];
          const at = visible.findIndex((item) => item.kind === "offer" && item.row && item.row.key === advance);
          if (at >= 0) {
            modal.selectedIndex = at;
            modal.renderResults();
          }
        }
        if (modal.inputEl && typeof modal.inputEl.focus === "function") {
          modal.inputEl.focus();
        }
      } catch (_error) {
        // The verdict stays staged with its previous reason.
      }
    };
    const restore = () => {
      try {
        if (resolved || modal.reasonEditKey !== row.key) return;
        resolved = true;
        const previous = modal.reasonPreviousVerdict || null;
        if (modal.verdicts instanceof Map) {
          if (previous) {
            modal.verdicts.set(row.key, previous);
          } else {
            modal.verdicts.delete(row.key);
          }
        }
        modal.reasonEditKey = null;
        modal.reasonPreviousVerdict = null;
        modal.statusLine = successorStatusForHighlight(modal);
        modal.renderAll();
        if (modal.inputEl && typeof modal.inputEl.focus === "function") {
          modal.inputEl.focus();
        }
      } catch (_error) {
        // The editor closes without touching the verdict map.
      }
    };
    input.addEventListener("keydown", (event) => {
      try {
        if (!event || typeof event !== "object") {
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat === true || event.isComposing === true || event.keyCode === 229) {
            return;
          }
          const openedAt = Number(modal.reasonOpenedAt || 0);
          const now = modal.currentTime ? modal.currentTime() : Date.now();
          if (Number.isFinite(openedAt) && Number.isFinite(now) &&
            now - openedAt < SUCCESSOR_PICKER_ENTER_GUARD_MS) {
            return;
          }
          commit(input.value);
          return;
        }
        // Ctrl+[ mirrors Esc once the LINK band and recall layers are shut.
        if (event.key === "Escape" || event.key === "Esc" || isCtrlLeftBracketKeydown(event)) {
          event.preventDefault();
          event.stopPropagation();
          const handle = modal.reasonRecall;
          if (handle && typeof handle.backOut === "function") {
            try {
              if (handle.backOut(event) === true) return;
            } catch (_error) {}
          }
          restore();
        }
      } catch (_error) {
        // The editor keeps focus rather than throwing.
      }
    });
    input.addEventListener("blur", (event) => {
      try {
        if (modal.reasonEditKey !== row.key) return;
        const related = event && event.relatedTarget;
        if (related && typeof wrap.contains === "function" && wrap.contains(related)) return;
        const active = input.ownerDocument && input.ownerDocument.activeElement;
        if (active === input || (active && typeof wrap.contains === "function" && wrap.contains(active))) return;
        commit(input.value);
      } catch (_error) {
        // Blur never throws away the staged verdict.
      }
    });
    if (typeof input.focus === "function") {
      input.focus();
    }
    try {
      if (parked) {
        // A rebuilt editor keeps the caret where the typing left it.
        if (parked.start !== null && typeof input.setSelectionRange === "function") {
          input.setSelectionRange(parked.start, parked.end === null ? parked.start : parked.end);
        }
      } else if (typeof input.select === "function" && input.value) {
        input.select();
      }
    } catch (_error) {
      // Focus without selection still edits.
    }
    return input;
  } catch (_error) {
    return null;
  }
}

// Install the 206c prototype patches now that 206 has loaded. The call
// is idempotent; onOpen also retries for harnesses that load fragments
// out of order.
try {
  if (typeof successorInstallVerdictModalPatches === "function") {
    successorInstallVerdictModalPatches();
  }
} catch (_error) {
  // The modal keeps its 206 behavior without verdict keys.
}
