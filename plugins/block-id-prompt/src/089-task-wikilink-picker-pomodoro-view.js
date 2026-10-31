function taskWikilinkActionLine(row, options) {
  const guard = options && options.guard;
  if (guard) {
    return { kind: "guarded", text: guard.full };
  }
  const pomodoro = options && options.pomodoroMode ? options.pomodoroDetail : null;
  if (pomodoro && pomodoro.checking) {
    return { kind: "guarded", text: "Checking project and prerequisite status…" };
  }
  if (pomodoro && pomodoro.waitingOn > 0) {
    return {
      kind: "pomodoro-blocked",
      text: `↵ raises ${pomodoro.waitingOn} prerequisites to Next · it stays unlinked`,
    };
  }
  if (pomodoro && pomodoro.guardText) {
    return { kind: "guarded", text: pomodoro.guardText };
  }
  if (row && row.blockId) {
    const target = (options && options.linkTarget) || row.linkTarget || taskWikilinkPathStem(row.notePath);
    const replacement = `[[${target}#^${row.blockId}]]`;
    if (pomodoro) {
      return {
        kind: "pomodoro",
        text: taskWikilinkPomodoroConsequenceText(row, pomodoro),
        replacement,
      };
    }
    return { kind: "identified", text: `↵ inserts ${replacement}`, replacement };
  }
  const suggestion = (options && options.suggestion) || taskWikilinkSuggestedBlockId(row, options && options.blockIds);
  const note = taskWikilinkSourceBasename(row && row.notePath);
  if (pomodoro) {
    return {
      kind: "pomodoro",
      text: taskWikilinkPomodoroConsequenceText(row, pomodoro, suggestion, note),
      suggestion,
    };
  }
  if (suggestion) {
    return {
      kind: "idless",
      text: `↵ names it ^${suggestion} in ${note}, then links it`,
      suggestion,
    };
  }
  return {
    kind: "idless",
    text: `↵ names it in ${note}, then links it`,
    suggestion: null,
  };
}

function taskWikilinkPomodoroConsequenceText(row, detail, suggestion, note) {
  const clauses = [];
  if (!row.blockId) {
    clauses.push(suggestion
      ? `↵ names it ^${suggestion} in ${note}, then links it here`
      : `↵ names it in ${note}, then links it here`);
  } else {
    clauses.push("↵ links it here");
  }
  if (row.status === " ") {
    clauses.push("Ready → Next");
  }
  if (detail.scheduledDate) {
    clauses.push(`pulls it into today (was scheduled ${detail.scheduledDate})`);
    if (detail.scheduleLogPresent) {
      clauses.push("logs the schedule change");
    }
  }
  if (detail.typeClause) {
    clauses.push(detail.typeClause);
  }
  if (detail.dependencyUnavailable) {
    clauses.push("dependency status unavailable · Enter rechecks before writing");
  }
  return clauses.join(" · ");
}

function renderTaskWikilinkResults(el, plan, options) {
  el.empty();
  if (!plan) {
    return null;
  }
  if (plan.empty) {
    const emptyEl = el.createDiv({ cls: "bid-tlp-empty bid-twl-empty" });
    emptyEl.createDiv({ cls: "bid-tlp-empty-text", text: plan.empty.message });
    return null;
  }
  let selectedEl = null;
  for (const item of plan.items || []) {
    if (item.kind === "section") {
      renderTaskWikilinkSection(el, item);
    } else if (item.kind === "note") {
      renderTaskWikilinkNoteHeader(el, item);
    } else if (item.kind === "row") {
      const rowEl = renderTaskWikilinkRow(el, item, options);
      if (item.selected) {
        selectedEl = rowEl;
      }
    }
  }
  return selectedEl;
}

function renderTaskWikilinkDetail(el, detail) {
  el.empty();
  if (!detail) {
    return;
  }
  const titleEl = el.createDiv({ cls: "bid-twl-detail-title" });
  appendTaskWikilinkTitle(titleEl, detail.titleParts);
  const metaEl = el.createDiv({ cls: "bid-twl-detail-meta" });
  if (detail.metaParts && detail.metaParts.icon) {
    const iconEl = metaEl.createSpan({
      cls: "bid-twl-detail-icon",
      attr: { "aria-hidden": "true" },
    });
    applyIcon(iconEl, detail.metaParts.icon);
  }
  metaEl.createSpan({ cls: "bid-twl-detail-meta-text", text: detail.meta });
  const action = detail.action || {};
  const actionEl = el.createDiv({
    cls: `bid-twl-detail-action is-${action.kind || "identified"}`,
  });
  if (action.kind === "identified" && action.replacement) {
    actionEl.createSpan({ text: "↵ inserts " });
    actionEl.createSpan({
      cls: "bid-twl-inline-link",
      text: action.replacement,
    });
  } else {
    actionEl.setText(action.text || "");
  }
}

function renderTaskWikilinkFooter(el, footer) {
  el.empty();
  const hints = footer && footer.hints ? footer.hints : [];
  for (const hint of hints) {
    const group = el.createDiv({ cls: "bid-tlp-hint" });
    for (const key of hint.keys || []) {
      group.createEl("kbd", { cls: "bid-tlp-kbd", text: key });
    }
    group.createEl("span", { cls: "bid-tlp-hint-label", text: hint.label });
  }
  if (footer && footer.warningNote) {
    el.createDiv({
      cls: "bid-twl-warning",
      text: footer.warningNote,
    });
  }
}
