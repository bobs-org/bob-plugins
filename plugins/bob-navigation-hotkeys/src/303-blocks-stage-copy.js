// Blocks… stage copy: consequence strip, subtitle, and lane phrases
// (`docs/task-dependencies.md` §15.4 / §15.7).

function blocksStageLanePhrase(status) {
  if (status === "/") {
    return "this task takes In Progress";
  }
  if (status === "*") {
    return "this task takes Next";
  }
  return null;
}

function blocksStagePomodoroPhrase(todayLink) {
  if (!todayLink) {
    return null;
  }
  const range = todayLink.range ? ` ${todayLink.range}` : "";
  const running = todayLink.running ? " (running)" : "";
  let phrase = `\u26a0 removes its link from ${todayLink.label}${range}${running}`;
  const notes = Math.floor(numericOrDefault(todayLink.childNotes, 0));
  if (notes > 0) {
    phrase += ` and the ${notes} note${notes === 1 ? "" : "s"} under it`;
  }
  return phrase;
}

function blocksStageConsequenceStrip(item, context = {}) {
  const sources = Array.isArray(context.sources) ? context.sources : [];
  const marked = Array.isArray(context.marked) ? context.marked : [];
  if (marked.length > 0) {
    let add = 0;
    let remove = 0;
    let takes = null;
    let pomodoro = 0;
    for (const row of marked) {
      if (row.alreadyLinked || row.stageSection === "current") {
        remove += 1;
      } else {
        add += 1;
        const lane = blocksStageLanePhrase(row.status);
        if (lane === "this task takes In Progress") {
          takes = "/";
        } else if (lane && takes !== "/") {
          takes = "*";
        }
        if (row.todayLink) {
          pomodoro += 1;
        }
      }
    }
    const parts = [`\u21b5 blocks ${add}`];
    if (add === 0) {
      parts[0] = `\u21b5 removes ${remove}`;
    } else if (remove > 0) {
      parts[0] = `\u21b5 blocks ${add} \u00b7 removes ${remove}`;
    }
    // A project N is never raised, so the strip never promises a lane.
    if (sources.some((source) => source.isProjectPrj)) {
      takes = null;
    }
    if (takes === "/") {
      parts.push("this task takes In Progress");
    } else if (takes === "*") {
      parts.push("this task takes Next");
    }
    if (pomodoro > 0) {
      parts.push(
        `\u26a0 removes ${pomodoro} Pomodoro link${pomodoro === 1 ? "" : "s"}`,
      );
    }
    return parts.join(" \u00b7 ");
  }
  if (!item || item.kind === "stage-more") {
    return "";
  }
  if (item.disabled) {
    if (
      item.disabledReason === "would create a cycle" &&
      Array.isArray(item.cycleLabels) &&
      item.cycleLabels.length > 0
    ) {
      return `\u27f2 would create a cycle: ${item.cycleLabels.join(" \u2192 ")}`;
    }
    return item.disabledReason || "";
  }
  if (item.stageSection === "current") {
    return item.lastReason
      ? "Stops waiting on this \u00b7 Ready again"
      : "Stops waiting on this \u00b7 still Blocked";
  }
  if (item.isProjectPrj) {
    const wait = Math.max(
      0,
      Math.floor(numericOrDefault(item.projectWaitCount, 0)),
    );
    const links = Math.max(
      0,
      Math.floor(numericOrDefault(item.projectPomodoroCount, 0)),
    );
    const parts = ["Project becomes Blocked"];
    if (wait > 0) {
      parts.push(`${wait} ${wait === 1 ? "task waits" : "tasks wait"}`);
    }
    if (links > 0) {
      parts.push(`\u26a0 removes ${links} Pomodoro link${links === 1 ? "" : "s"}`);
    }
    return parts.join(" \u00b7 ");
  }
  if (item.stageSection === "blocked") {
    // Counted after the add, so this task is one of the open reasons.
    const open =
      Math.max(
        0,
        Math.floor(numericOrDefault(item.waitsOn, item.openCount || 0)),
      ) + 1;
    return `Also waits on this (${open} open)`;
  }
  const parts = ["Becomes Blocked until this is done"];
  const strongest = sources.some((source) => source.isProjectPrj)
    ? null
    : blocksStageLanePhrase(item.status);
  if (strongest) {
    parts.push(strongest);
  }
  const pomodoro = blocksStagePomodoroPhrase(item.todayLink);
  if (pomodoro) {
    parts.push(pomodoro);
  }
  return parts.join(" \u00b7 ");
}

function blocksStageSubtitle(stage, markedDiff, options = {}) {
  const currentCount = Array.isArray(stage && stage.current)
    ? stage.current.length
    : 0;
  const frees = Math.max(
    0,
    Math.floor(numericOrDefault(stage && stage.freesCount, 0)),
  );
  const pool = Math.max(
    0,
    Math.floor(numericOrDefault(stage && stage.poolSize, 0)),
  );
  const needsId = options.needsId === true;
  const marked = markedDiff && typeof markedDiff === "object" ? markedDiff : null;
  if (marked && (marked.add > 0 || marked.remove > 0 || marked.needId > 0)) {
    const parts = [];
    if (marked.add > 0) {
      parts.push(`${marked.add} to block`);
    }
    if (marked.remove > 0) {
      parts.push(`${marked.remove} to remove`);
    }
    parts.push("\u21b5 to apply");
    if (needsId) {
      parts.push("names this task first");
    }
    return parts.join(" \u00b7 ");
  }
  const head =
    currentCount === 0
      ? `Blocks nothing yet \u00b7 searching ${pool} open tasks`
      : `Blocks ${currentCount} \u00b7 frees ${frees} \u00b7 searching ${pool} open tasks`;
  // \u21e5 marks are off in counted sessions, so the hint is dropped there.
  return options.counted === true ? head : `${head} \u00b7 \u21e5 to mark several`;
}
