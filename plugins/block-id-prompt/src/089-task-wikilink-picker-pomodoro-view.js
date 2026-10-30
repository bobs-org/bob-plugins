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
