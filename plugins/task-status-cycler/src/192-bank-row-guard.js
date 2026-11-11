// Bank-row guard (bob-cli-kd.6.1.2): standalone syntax recognizer so the
// cycler stays safe when ledger-tools is disabled. Mirrors the 241i
// amount/checkbox grammar; the same fixture vectors run here and there
// (see test-task-status-cycler-bank-guard.cjs).

const CYCLER_BANK_MONTH_PATH_RE = /^bank\/(\d{4})-(\d{2})\.md$/i;
const CYCLER_BANK_ROW_NOTICE = "Bank row · not a task status";

function cyclerBankNormalizePath(value) {
  const raw = typeof value === "string"
    ? value
    : value && typeof value.path === "string"
      ? value.path
      : "";
  return raw.replace(/\\/g, "/").replace(/^\.\//, "");
}

function cyclerBankMonthKey(path) {
  const match = cyclerBankNormalizePath(path).match(CYCLER_BANK_MONTH_PATH_RE);
  if (!match) {
    return null;
  }
  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return `${match[1]}-${match[2]}`;
}

function cyclerBankParseCentsUnsigned(input) {
  if (!input || input[0] < "0" || input[0] > "9") {
    return null;
  }
  let index = 0;
  while (index < input.length && ((input[index] >= "0" && input[index] <= "9") || input[index] === ",")) {
    index += 1;
  }
  const integer = input.slice(0, index);
  if (integer.includes(",")) {
    const parts = integer.split(",");
    if (!parts[0] || parts[0].length < 1 || parts[0].length > 3) {
      return null;
    }
    if (parts.slice(1).some((part) => part.length !== 3 || !part.length)) {
      return null;
    }
  }
  const dollars = Number(integer.replace(/,/g, ""));
  if (!Number.isSafeInteger(dollars)) {
    return null;
  }
  let rest = input.slice(index);
  let cents = dollars * 100;
  if (!Number.isSafeInteger(cents)) {
    return null;
  }
  if (rest.startsWith(".")) {
    const afterDot = rest.slice(1);
    let digits = 0;
    while (digits < afterDot.length && afterDot[digits] >= "0" && afterDot[digits] <= "9") {
      digits += 1;
    }
    if (digits === 0 || digits > 2) {
      return null;
    }
    const frac = Number(afterDot.slice(0, digits));
    const scale = digits === 1 ? 10 : 1;
    cents += frac * scale;
    if (!Number.isSafeInteger(cents)) {
      return null;
    }
    rest = afterDot.slice(digits);
  }
  return { cents, rest };
}

function cyclerBankParseAmountLead(body) {
  let rest = String(body || "").replace(/^\s+/, "");
  const bold = rest.startsWith("**");
  if (bold) {
    rest = rest.slice(2);
  }
  // Unsigned amounts are outflows: the sign convention mirrors 241i.
  let sign = -1;
  if (rest.startsWith("+")) {
    sign = 1;
    rest = rest.slice(1);
  } else if (rest.startsWith("-") || rest.startsWith("−")) {
    sign = -1;
    rest = rest.slice(1);
  }
  if (!rest.startsWith("$")) {
    return { kind: "not-amount" };
  }
  rest = rest.slice(1);
  if (rest.startsWith("**")) {
    rest = rest.slice(2);
  }
  if (rest.trimStart() === "") {
    return { kind: "stub" };
  }
  const parsed = cyclerBankParseCentsUnsigned(rest);
  if (!parsed) {
    return { kind: "unparsed" };
  }
  rest = parsed.rest;
  if (bold) {
    rest = rest.startsWith("**") ? rest.slice(2) : rest;
  }
  return { kind: "amount", cents: sign * parsed.cents, rest };
}

function cyclerBankClassifyLine(line) {
  if (typeof line !== "string") {
    return { kind: "not-a-row" };
  }
  if (line.startsWith(" ") || line.startsWith("\t")) {
    return { kind: "not-a-row" };
  }
  if (!line.startsWith("- ")) {
    return { kind: "not-a-row" };
  }
  const afterDash = line.slice(2);
  if (afterDash.startsWith("[")) {
    const status = afterDash[1];
    if (status === undefined) {
      return { kind: "not-a-row" };
    }
    let body = null;
    if (afterDash.startsWith(`[${status}] `)) {
      body = afterDash.slice(4);
    } else if (afterDash.startsWith(`[${status}]`)) {
      body = afterDash.slice(3).trimStart();
    } else {
      return { kind: "not-a-row" };
    }
    const lead = cyclerBankParseAmountLead(body);
    if (lead.kind === "not-amount") {
      return { kind: "not-a-row" };
    }
    if (lead.kind === "stub") {
      return { kind: "stub", status, body };
    }
    return { kind: "checkbox", status, body, lead };
  }
  const lead = cyclerBankParseAmountLead(afterDash);
  if (lead.kind === "not-amount" || lead.kind === "stub") {
    return { kind: "not-a-row" };
  }
  return { kind: "amount-no-checkbox", lead };
}

// Guard kinds for a line in a canonical bank month note: "row" is a
// complete checkbox row (any status; only space/x flips), "stub" is an
// empty amount stub, "amount-invalid" is amount-like but not a clean row
// (bad status handled by callers, unparsed amount, or missing checkbox).
// Anything else is null: ordinary tasks and prose pass through.
function cyclerBankLineKind(path, lineText) {
  if (cyclerBankMonthKey(path) === null) {
    return null;
  }
  const classified = cyclerBankClassifyLine(lineText);
  if (classified.kind === "stub") {
    return "stub";
  }
  if (classified.kind === "amount-no-checkbox") {
    return "amount-invalid";
  }
  if (classified.kind !== "checkbox") {
    return null;
  }
  if (!classified.lead || classified.lead.kind !== "amount") {
    return "amount-invalid";
  }
  return "row";
}

class TaskStatusCyclerBankGuardMixin {
  cyclerBankActivePath() {
    try {
      const file = this.app && this.app.workspace &&
        typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null;
      return (file && typeof file.path === "string") ? file.path : "";
    } catch (error) {
      return "";
    }
  }

  // Bank context for one line: kind plus the task status when the line
  // is also task-shaped. Null when the path is not a bank month note or
  // the line is not amount-like.
  cyclerBankInfoForLine(path, lineText, line = 0) {
    const kind = cyclerBankLineKind(path, lineText);
    if (!kind) {
      return null;
    }
    const text = String(lineText || "");
    const status = typeof getTaskStatusForLine === "function"
      ? getTaskStatusForLine(text, line)
      : null;
    return {
      path: cyclerBankNormalizePath(path),
      line,
      lineText: text,
      kind,
      symbol: status ? status.symbol : null,
      statusStart: status ? status.statusStart : null,
      statusEnd: status ? status.statusEnd : null,
    };
  }

  cyclerBankInfoAtCursor(editor, path = null) {
    try {
      if (!editor || typeof editor.getCursor !== "function" || typeof editor.getLine !== "function") {
        return null;
      }
      const cursor = editor.getCursor();
      if (!cursor || !Number.isInteger(cursor.line)) {
        return null;
      }
      const activePath = typeof path === "string" && path
        ? path
        : this.cyclerBankActivePath();
      return this.cyclerBankInfoForLine(activePath, editor.getLine(cursor.line), cursor.line);
    } catch (error) {
      return null;
    }
  }

  cyclerBankTransclusionIsBank(resolvedTarget) {
    try {
      if (!resolvedTarget) {
        return false;
      }
      const targetPath = resolvedTarget.file && resolvedTarget.file.path;
      const lineText = resolvedTarget.taskStatus && resolvedTarget.taskStatus.lineText;
      return cyclerBankLineKind(targetPath, lineText) !== null;
    } catch (error) {
      return false;
    }
  }

  // The only bank-row write the cycler owns: a single status byte between
  // space and x, with no task metadata, freshness stamp, successor pass,
  // or transclusion follow-up. Stubs, invalid rows, and other statuses
  // refuse without mutating or repairing.
  cyclerBankLocalFlip(editor, info) {
    try {
      if (!info || info.kind !== "row") {
        return false;
      }
      const next = info.symbol === " " ? "x" : info.symbol === "x" || info.symbol === "X" ? " " : null;
      if (next === null || !Number.isInteger(info.statusStart) || !Number.isInteger(info.statusEnd)) {
        return false;
      }
      if (!editor || typeof editor.replaceRange !== "function") {
        return false;
      }
      editor.replaceRange(
        next,
        { line: info.line, ch: info.statusStart },
        { line: info.line, ch: info.statusEnd },
      );
      return true;
    } catch (error) {
      return false;
    }
  }
}
