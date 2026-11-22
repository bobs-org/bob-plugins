// Successor picker requirement verdicts (`api.successors` v6,
// docs/task-dependencies.md §12.25). The card owns only staged choices and
// display state; the cycler owns validation and every vault write.
const SUCCESSOR_REQ_VERDICTS = Object.freeze(["met", "drop", "carry", "carry_pulled"]);
const SUCCESSOR_REQ_FOOTER_HINTS = Object.freeze([
  { keys: ["Ctrl+X"], label: "met" },
  { keys: ["Ctrl+Shift+X"], label: "drop" },
  { keys: ["Ctrl+Shift+T"], label: "own task" },
  { keys: ["Space / Tab"], label: "pull in" },
  { keys: ["Esc"], label: "none" },
]);

function successorRequirementIsGroup(group) {
  return Boolean(group && group.group === "requirements" && group.kind === "requirements");
}

function successorRequirementChoice(modal, key) {
  try {
    return modal && modal.requirementChoices instanceof Map
      ? modal.requirementChoices.get(key) || null
      : null;
  } catch (_error) {
    return null;
  }
}

function successorRequirementChoiceValue(modal, key) {
  const choice = successorRequirementChoice(modal, key);
  return choice && SUCCESSOR_REQ_VERDICTS.includes(choice.verdict) ? choice.verdict : "met";
}

function successorRequirementHasStagedChoices(modal) {
  return Boolean(modal && modal.requirementChoices instanceof Map && modal.requirementChoices.size > 0);
}

function successorModalHasStagedChoices(modal) {
  return (typeof successorModalHasVerdicts === "function" && successorModalHasVerdicts(modal)) ||
    successorRequirementHasStagedChoices(modal);
}

function successorRequirementChoiceCount(modal) {
  return modal && modal.requirementChoices instanceof Map ? modal.requirementChoices.size : 0;
}

function successorRequirementStage(modal, key, verdict, reason) {
  if (!modal || !(modal.requirementChoices instanceof Map) || !key || !SUCCESSOR_REQ_VERDICTS.includes(verdict)) {
    return false;
  }
  const current = modal.requirementChoices.get(key) || null;
  if (current && current.verdict === verdict && verdict === "met" && current.explicit === true) {
    modal.requirementChoices.delete(key);
  } else if (current && current.verdict === verdict) {
    // Repeating a decision returns the row to Met. Keep that explicit Met
    // distinct from an untouched default when the cycler checks branches.
    modal.requirementChoices.set(key, { verdict: "met", explicit: true });
  } else {
    const next = { verdict, explicit: true };
    if (verdict === "drop") {
      const normalized = typeof reqCloseNormalizeReason === "function"
        ? reqCloseNormalizeReason(reason)
        : String(reason || "").trim();
      if (normalized) next.reason = normalized;
    }
    modal.requirementChoices.set(key, next);
  }
  if (modal.markedKeys instanceof Set) modal.markedKeys.delete(key);
  modal.escArmed = false;
  return true;
}

function successorRequirementSetChoice(modal, key, verdict, reason) {
  if (!modal || !(modal.requirementChoices instanceof Map) || !key || !SUCCESSOR_REQ_VERDICTS.includes(verdict)) {
    return false;
  }
  const next = { verdict, explicit: true };
  if (verdict === "drop") {
    const normalized = typeof reqCloseNormalizeReason === "function"
      ? reqCloseNormalizeReason(reason)
      : String(reason || "").trim();
    if (normalized) next.reason = normalized;
  }
  modal.requirementChoices.set(key, next);
  modal.escArmed = false;
  return true;
}

function successorRequirementRowsState(modal, group) {
  const rows = Array.isArray(group && group.rows) ? group.rows : [];
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return rows.map((row) => {
    let parentKey = row.req && row.req.parent_key;
    let hiddenBy = null;
    const visited = new Set();
    while (parentKey && !visited.has(parentKey)) {
      visited.add(parentKey);
      const parent = byKey.get(parentKey);
      if (!parent) break;
      if (["drop", "carry", "carry_pulled"].includes(successorRequirementChoiceValue(modal, parent.key))) {
        hiddenBy = parent;
        break;
      }
      parentKey = parent.req && parent.req.parent_key;
    }
    const choice = successorRequirementChoice(modal, row.key);
    return {
      row,
      choice,
      verdict: choice ? choice.verdict : "met",
      hiddenBy,
      conflict: Boolean(hiddenBy && choice),
      nestedGoWithIt: ["drop", "carry", "carry_pulled"].includes(choice && choice.verdict)
        ? Number(row.req && row.req.pending_descendants) || 0
        : 0,
    };
  });
}

function successorRequirementConflicts(modal) {
  const conflicts = [];
  for (const group of (modal && modal.model && modal.model.groups) || []) {
    if (!successorRequirementIsGroup(group)) continue;
    for (const state of successorRequirementRowsState(modal, group)) {
      if (state.conflict) {
        conflicts.push({
          key: state.row.key,
          ancestorKey: state.hiddenBy.key,
          message: reqCloseOverlap(state.hiddenBy.text),
        });
      }
    }
  }
  return conflicts;
}

function successorRequirementConsequence(state, group) {
  const row = state && state.row;
  const choice = state && state.choice;
  if (!row) return "";
  if (state.conflict) return reqCloseOverlap(state.hiddenBy.text);
  const verdict = state.verdict || "met";
  const consequences = row.consequences || {};
  const copy = group && group.copy ? group.copy : row.copy || {};
  let consequence = consequences[verdict] || (verdict === "met" ? copy.why : "");
  if (verdict === "drop" && choice && choice.reason) {
    consequence += ` · ${successorQuoteTitle(choice.reason)}`;
  }
  return consequence;
}

function successorRequirementStatusForRow(modal, key) {
  for (const group of (modal && modal.model && modal.model.groups) || []) {
    if (!successorRequirementIsGroup(group)) continue;
    const state = successorRequirementRowsState(modal, group).find((item) => item.row.key === key);
    if (!state) continue;
    return {
      text: successorRequirementConsequence(state, group),
      kind: state.conflict ? "refusal" : "consequence",
    };
  }
  return null;
}

function successorRequirementAccessibility(state) {
  const row = state && state.row;
  const depth = Number(row && row.req && row.req.depth) || 1;
  if (state && state.conflict) return reqCloseAccessibility(depth, "conflicts with an ancestor choice");
  const verbs = {
    met: "will be met",
    drop: "will be dropped",
    carry: "will be carried",
    carry_pulled: "will be carried and pulled in",
  };
  return reqCloseAccessibility(depth, verbs[state && state.verdict] || verbs.met);
}

function successorRequirementCounts(modal) {
  let total = 0;
  let dropped = 0;
  let carried = 0;
  for (const group of (modal && modal.model && modal.model.groups) || []) {
    if (!successorRequirementIsGroup(group)) continue;
    const states = successorRequirementRowsState(modal, group);
    total += states.length;
    for (const state of states) {
      if (state.hiddenBy) continue;
      const descendants = Number(state.row.req && state.row.req.pending_descendants) || 0;
      if (state.verdict === "drop") dropped += 1 + descendants;
      else if (state.verdict === "carry" || state.verdict === "carry_pulled") carried += 1 + descendants;
    }
  }
  return { met: Math.max(0, total - dropped - carried), dropped, carried };
}

function successorRequirementResults(modal) {
  const result = [];
  for (const group of (modal && modal.model && modal.model.groups) || []) {
    if (!successorRequirementIsGroup(group)) continue;
    for (const state of successorRequirementRowsState(modal, group)) {
      if (!state.choice || state.hiddenBy) continue;
      const item = { key: state.row.key, verdict: state.choice.verdict };
      if (state.choice.verdict === "drop" && state.choice.reason) item.reason = state.choice.reason;
      result.push(item);
    }
  }
  return result;
}

function successorRequirementActiveRow(modal) {
  const item = modal && modal.visibleItems && modal.visibleItems[modal.selectedIndex];
  return item && item.kind === "requirement" ? item.row : null;
}

function successorPickerItemKey(item) {
  return item && item.row && (item.kind === "offer" || item.kind === "requirement")
    ? item.row.key
    : null;
}

function successorRequirementFooterHints(modal) {
  const hints = SUCCESSOR_REQ_FOOTER_HINTS.map((hint) => ({ keys: hint.keys.slice(), label: hint.label }));
  if (successorJumpSupported(modal)) hints.splice(4, 0, { keys: ["Ctrl+J"], label: "jump" });
  if (modal && modal.escArmed) hints[hints.length - 1] = { keys: ["Esc"], label: "discard" };
  else if (successorRequirementHasStagedChoices(modal)) hints[hints.length - 1] = { keys: ["Esc"], label: "review" };
  return hints;
}

function successorRequirementInk(owner) {
  const ink = owner && typeof owner.ink === "string" ? owner.ink.trim() : "";
  return ink && /^[\w\s#(),.%+-]+$/.test(ink) ? `--bob-successor-req-ink:${ink}` : "";
}

function successorRequirementGlyph(row) {
  const depth = Math.max(1, Number(row && row.req && row.req.depth) || 1);
  const run = String((row && row.run) || (row && row.req && row.req.run) ||
    (typeof taskReqRun === "function" ? taskReqRun(depth) : "⌗⌗"));
  const count = Math.max(2, Math.min(4, (run.match(/⌗/g) || []).length || depth + 1));
  return "⌗".repeat(count);
}

function successorRequirementRenderGroup(modal, group, groupIndex, matches, query, navigation) {
  if (!modal || !modal.resultsEl || !group) return;
  const groupEl = modal.resultsEl.createDiv({ cls: "bob-successor-group is-requirements" });
  const heading = groupEl.createDiv({ cls: "bob-successor-group-heading bob-successor-req-heading" });
  const titleRow = heading.createDiv({ cls: "bob-successor-group-titlebar" });
  titleRow.createDiv({ cls: "bob-successor-group-title", text: group.copy.title });
  titleRow.createSpan({ cls: "bob-successor-group-tag bob-successor-req-scope", text: group.copy.scope });
  if (group.copy.why) heading.createDiv({ cls: "bob-successor-group-caption", text: group.copy.why });
  const inkStyle = successorRequirementInk(group.owner);
  if (inkStyle) heading.setAttribute("style", inkStyle);
  if (group.copy.history) {
    groupEl.createDiv({ cls: "bob-successor-folded-count bob-successor-req-history", text: group.copy.history });
  }
  const states = successorRequirementRowsState(modal, group);
  const stateByKey = new Map(states.map((state) => [state.row.key, state]));
  for (const match of matches) {
    const row = match.row;
    const state = stateByKey.get(row.key);
    if (!state || (state.hiddenBy && !state.choice)) continue;
    const depth = Math.max(1, Number(row.req.depth) || 1);
    const navIndex = navigation.push({ kind: "requirement", groupIndex, rowIndex: match.index, row }) - 1;
    const selected = navIndex === modal.selectedIndex || (modal.highlightKeyAfterRender === row.key);
    const classes = ["bob-successor-row", "bob-successor-req-row", `is-depth-${Math.min(depth, 16)}`];
    if (selected) classes.push("is-highlighted");
    if (state.choice) classes.push("is-req-staged", `is-req-${state.verdict}`);
    if (state.conflict) classes.push("is-req-conflict");
    const jumpSuffix = typeof successorJumpRowAriaSuffix === "function"
      ? successorJumpRowAriaSuffix(modal, row) : "";
    const aria = `${successorRequirementAccessibility(state)} — ${row.text}${jumpSuffix ? ` — ${jumpSuffix}` : ""}`;
    const rowEl = groupEl.createDiv({
      cls: classes.join(" "),
      attr: {
        role: "option",
        "aria-selected": selected ? "true" : "false",
        "aria-checked": state.choice ? "true" : "false",
        "aria-disabled": "false",
        "aria-label": aria,
        "data-successor-key": row.key,
        "data-requirement-depth": String(depth),
        ...(state.choice ? { "data-requirement-verdict": state.verdict } : {}),
        style: `--bob-successor-req-depth:${Math.min(depth, 16)};${inkStyle}`,
      },
    });
    const glyph = successorRequirementGlyph(row);
    rowEl.createSpan({ cls: "bob-successor-mark bob-successor-req-glyph", text: glyph, attr: { "aria-hidden": "true" } });
    try {
      if (typeof successorRenderJumpRowAdornments === "function") {
        successorRenderJumpRowAdornments(modal, rowEl, row, navIndex);
      }
    } catch (_error) {
      // A missing pin button does not block requirement review.
    }
    const content = rowEl.createDiv({ cls: "bob-successor-row-content" });
    content.createDiv({ cls: "bob-successor-row-text bob-successor-req-text", text: row.text });
    if (modal.reasonEditKey === row.key && modal.reasonEditKind === "requirement") {
      successorRenderReasonEditor(modal, content, row, state.choice && state.choice.reason || "", { requirement: true });
    } else {
      const consequence = successorRequirementConsequence(state, group);
      if (consequence) content.createDiv({ cls: "bob-successor-row-details bob-successor-req-consequence", text: consequence });
    }
    if (state.nestedGoWithIt > 0) {
      content.createDiv({
        cls: "bob-successor-row-details bob-successor-req-nested",
        text: reqCloseNestedGoWithIt(state.nestedGoWithIt),
      });
    }
    rowEl.addEventListener("mousedown", (event) => event.preventDefault());
    rowEl.addEventListener("click", (event) => {
      if (event && typeof event.defaultPrevented === "boolean" && event.defaultPrevented) return;
      modal.selectedIndex = navIndex;
      modal.statusLine = { text: successorRequirementConsequence(state, group), kind: state.conflict ? "refusal" : "consequence" };
      modal.renderResults();
    });
  }
  if (group.copy.footer) {
    groupEl.createDiv({ cls: "bob-successor-folded-count bob-successor-req-legend", text: group.copy.footer });
  }
}

function successorRequirementHandleKey(modal, event) {
  if (!event || typeof event !== "object" || modal.reasonEditKey != null ||
      successorVerdictShouldIgnoreEvent(event)) return false;
  const row = successorRequirementActiveRow(modal);
  if (!row) return false;
  const key = String(event.key || "").toLowerCase();
  const code = String(event.code || "");
  const ctrl = event.ctrlKey === true && event.metaKey !== true && event.altKey !== true;
  const current = successorRequirementChoice(modal, row.key);
  let verdict = null;
  let advance = false;
  if (ctrl && (key === "x" || code === "KeyX")) {
    if (successorVerdictIsLinuxCut(modal, event)) return false;
    verdict = event.shiftKey === true ? "drop" : "met";
  } else if (ctrl && event.shiftKey === true && (key === "t" || code === "KeyT")) {
    verdict = "carry";
  } else if (!event.ctrlKey && !event.metaKey && !event.altKey && key === "Tab") {
    if (event.shiftKey === true) return false;
    verdict = "carry_pulled";
    advance = true;
  } else if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === " " &&
      modal.inputEl && modal.inputEl.value === "") {
    verdict = "carry_pulled";
  }
  if (!verdict) return false;
  event.preventDefault();
  event.stopPropagation();
  if (verdict === "drop" && !(current && current.verdict === "drop")) {
    modal.reasonPreviousRequirementChoice = current ? Object.assign({}, current) : null;
    successorRequirementSetChoice(modal, row.key, "drop", null);
    modal.reasonEditKey = row.key;
    modal.reasonEditKind = "requirement";
    modal.reasonOpenedAt = modal.currentTime();
    modal.statusLine = { text: successorRequirementConsequence({ row, choice: { verdict: "drop" }, verdict: "drop" }, { copy: row.copy }), kind: "consequence" };
    modal.renderAll();
    return true;
  }
  const before = current ? current.verdict : null;
  successorRequirementStage(modal, row.key, verdict);
  modal.reasonEditKey = null;
  modal.reasonEditKind = null;
  modal.reasonPreviousRequirementChoice = null;
  const after = successorRequirementChoiceValue(modal, row.key);
  const state = { row, choice: successorRequirementChoice(modal, row.key), verdict: after, conflict: false };
  const conflicts = successorRequirementConflicts(modal);
  const conflict = conflicts.find((item) => item.key === row.key);
  modal.statusLine = conflict
    ? { text: conflict.message, kind: "refusal" }
    : { text: successorRequirementConsequence(state, { copy: row.copy }), kind: "consequence" };
  modal.renderAll();
  if (advance && modal.visibleItems && modal.visibleItems.length > 0) modal.moveSelection(1);
  return true;
}

function successorRequirementPrepareCommit(modal) {
  const conflict = successorRequirementConflicts(modal)[0];
  if (!conflict) return true;
  modal.statusLine = { text: conflict.message, kind: "refusal" };
  const index = (modal.visibleItems || []).findIndex((item) => item.kind === "requirement" && item.row.key === conflict.key);
  if (index >= 0) modal.selectedIndex = index;
  modal.renderAll();
  return false;
}

function successorInstallRequirementModalPatches() {
  try {
    const proto = typeof SuccessorOfferPickerModal !== "undefined" ? SuccessorOfferPickerModal.prototype : null;
    if (!proto || proto.successorRequirementPatched === true) return;
    proto.successorRequirementPatched = true;
    proto.handleRequirementKey = function handleRequirementKey(event) {
      return successorRequirementHandleKey(this, event);
    };
  } catch (_error) {
    // Older picker behavior remains available if the requirement patch fails.
  }
}

try {
  if (typeof successorInstallRequirementModalPatches === "function") successorInstallRequirementModalPatches();
} catch (_error) {
  // onOpen retries the idempotent install.
}
