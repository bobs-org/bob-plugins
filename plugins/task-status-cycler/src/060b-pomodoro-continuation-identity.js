// Created-continuation identity for MEET placed-last (plan 202611/meet_continuation_landing_repair).
// Pure helpers only: the planner's insert block identifies the continuation
// the close created, so successor relocation beats same-name reuse even when
// another open MEET shares its headline. Content search accounts for removed
// rows, Work Log writes, and note edits that shift lines; failure returns
// null so callers report `failed` rather than guess.
function getCreatedContinuationBlockFromPlan(plan) {
  try {
    if (!plan || plan.createdPomodoro !== true || !Array.isArray(plan.edits)) {
      return null;
    }
    const insert = plan.edits.find((edit) =>
      edit && edit.type === "insertLines" && Array.isArray(edit.lines)
    );
    if (!insert || !Array.isArray(insert.lines) || insert.lines.length === 0) {
      return null;
    }
    if (!Number.isInteger(insert.line)) {
      return null;
    }
    return {
      blockLines: insert.lines.map((line) => String(line ?? "")),
      insertLine: insert.line,
    };
  } catch (error) {
    return null;
  }
}

function findCreatedContinuationEntryLine(dailyAfter, blockLines, createdName, relocatedLine) {
  try {
    const lines = Array.isArray(dailyAfter) ? dailyAfter : [];
    const block = Array.isArray(blockLines)
      ? blockLines.map((line) => String(line ?? ""))
      : null;
    if (!block || block.length === 0) {
      return null;
    }
    if (!Number.isInteger(relocatedLine)) {
      return null;
    }
    const wantedName = typeof createdName === "string" ? createdName : "";
    const entries = parseSuccessorLedgerEntries(lines);
    for (const entry of entries) {
      if (!entry || !entry.open) {
        continue;
      }
      if (!(entry.entryLine > relocatedLine)) {
        continue;
      }
      if (String(entry.name || "") !== wantedName) {
        continue;
      }
      let matches = true;
      for (let index = 0; index < block.length; index += 1) {
        if (String(lines[entry.entryLine + index] || "") !== block[index]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return entry.entryLine;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}
