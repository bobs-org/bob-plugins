// Shared SV1–SV23 copy for cycler close descriptors.

function successorOfferCloseDisplayFromOffer(offer) {
  const text = String(offer && offer.text || "").trim();
  return text || "task";
}

function successorOfferCloseTaskDisplay(task) {
  try {
    const text = successorDisplayText(task, task && task.globalFilter || "#task");
    return String(text || "").trim() || "task";
  } catch (_error) {
    return String(task && task.text || "task").trim() || "task";
  }
}

function successorOfferCloseStatusName(status) {
  if (status === "?") return "Blocked";
  if (status === "*") return "Next";
  if (status === "/") return "In Progress";
  if (status === " ") return "Ready";
  if (status === "x" || status === "X") return "Done";
  if (status === "-") return "Cancelled";
  return "Unknown";
}

function successorOfferCloseRefusalDescriptor(reason, text, status) {
  const subject = String(text || "task").trim() || "task";
  let why = "Changed since the card opened — reopen to see the current row";
  if (reason === "new_task") {
    why = `“${subject}” is new in this capture — drop it from the draft instead`;
  } else if (reason === "recurring") {
    why = `“${subject}” repeats — close it in Obsidian so Tasks writes the next one`;
  } else if (reason === "status") {
    why = `“${subject}” is ${successorOfferCloseStatusName(status)} — only open tasks close here`;
  }
  return { complete: false, cancel: false, why, unblocks: 0 };
}

function successorOfferCloseOpenScopeCount(path, lineIndex, blockId, noteTexts) {
  const noteText = noteTexts instanceof Map ? noteTexts.get(String(path || "")) : null;
  if (typeof noteText !== "string") return 0;
  const lines = noteText.split(/\r?\n/);
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return 0;
  const isOpen = (symbol) => [" ", "/", "*", "?"].includes(symbol);
  if (successorIsProjectTask(blockId)) {
    const tasks = [
      ...tasksFromDocuments([{ path, text: noteText }]),
      ...successorKeepMovingReferenceTasks(noteText, path),
    ];
    const unique = new Map(tasks.map((task) => [`${task.path}\0${task.line}`, task]));
    return [...unique.values()].filter((task) =>
      Number(task.line) !== lineIndex && isOpen(task.status),
    ).length;
  }
  const indent = (line) => (String(line || "").match(/^\s*/) || [""])[0].length;
  const parentIndent = indent(lines[lineIndex]);
  let count = 0;
  for (let line = lineIndex + 1; line < lines.length; line += 1) {
    const status = getTaskStatusForLine(lines[line], line);
    if (!status) continue;
    if (indent(lines[line]) <= parentIndent) break;
    if (isOpen(status.symbol)) count += 1;
  }
  return count;
}

function successorOfferCloseScopeNote(task, context) {
  const count = successorOfferCloseOpenScopeCount(
    task.path,
    task.line,
    task.blockId,
    context.noteTexts,
  );
  if (count <= 0) return "";
  if (successorIsProjectTask(task.blockId)) {
    return count === 1
      ? `· its ${count} open task stays open`
      : `· its ${count} open tasks stay open`;
  }
  return count === 1
    ? `· its ${count} open subtask stays open`
    : `· its ${count} open subtasks stay open`;
}

function successorOfferCloseConsequences(task, group, simulation) {
  const display = successorOfferCloseTaskDisplay(task);
  const status = successorOfferCloseStatusName(task.status);
  const isProject = group === "project_finished" && successorIsProjectTask(task.blockId);
  let doneBase;
  if (isProject) {
    const file = String(task.path || "").split("/").pop() || "";
    const project = file.replace(/\.md$/i, "") || display;
    doneBase = `✓ Finishes ‹${project}› · ${status} → Done`;
  } else {
    doneBase = `✓ Completes “${display}” · ${status} → Done`;
  }
  const cancelBase = `⊘ Cancels “${display}” · ${status} → Cancelled`;
  const suffix = String(simulation && simulation.suffix || "");
  return {
    complete: `${doneBase}${suffix}`,
    cancel: `${cancelBase}${suffix}`,
    scopeNote: successorOfferCloseScopeNote(task, simulation.context || { noteTexts: new Map() }),
  };
}
