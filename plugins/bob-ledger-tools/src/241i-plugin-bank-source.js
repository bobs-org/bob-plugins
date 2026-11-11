// Pure bank source recognizer. Syntax only: a canonical month path, a
// valid day heading, and a top-level checkbox whose amount begins with
// `$`. Fences, indented children, stubs, and non-day sections are not
// rows. Spans point at the original line bytes.

const BANK_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BANK_MONTHS_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const BANK_HUB_PATH = /^bank\.md$/i;
const BANK_MONTH_PATH = /^bank\/(\d{4})-(\d{2})\.md$/i;

function bankNormalizePath(value) {
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string"
      ? value.path
      : "";
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function bankMonthFromPath(fileOrPath) {
  const match = bankNormalizePath(fileOrPath).match(BANK_MONTH_PATH);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) {
    return null;
  }
  return { year, month, key: `${match[1]}-${match[2]}` };
}

function bankIsHubPath(fileOrPath) {
  return BANK_HUB_PATH.test(bankNormalizePath(fileOrPath));
}

function bankRelevantPath(fileOrPath) {
  const path = bankNormalizePath(fileOrPath);
  return bankIsHubPath(path) || bankMonthFromPath(path) !== null;
}

function bankDiscoverMonthPaths(files) {
  const keys = [];
  const seen = new Set();
  for (const file of Array.isArray(files) ? files : []) {
    const path = bankNormalizePath(file);
    const month = bankMonthFromPath(path);
    if (!month || seen.has(path)) {
      continue;
    }
    seen.add(path);
    keys.push({ path, month: month.key, year: month.year, monthNumber: month.month });
  }
  keys.sort((left, right) => left.path.localeCompare(right.path));
  return keys;
}

function bankFenceMarker(line) {
  let indent = 0;
  while (indent < line.length && line[indent] === " ") {
    indent += 1;
  }
  if (indent > 3) {
    return null;
  }
  const rest = line.slice(indent);
  const character = rest[0];
  if (character !== "`" && character !== "~") {
    return null;
  }
  let length = 0;
  while (length < rest.length && rest[length] === character) {
    length += 1;
  }
  return length >= 3 ? { character, length } : null;
}

function bankClosesFence(line, open) {
  const marker = bankFenceMarker(line);
  if (!marker || marker.character !== open.character || marker.length < open.length) {
    return false;
  }
  return line.trimStart().slice(marker.length).trim() === "";
}

function bankFenceLines(lines) {
  const fenced = new Set();
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (open) {
      fenced.add(index);
      if (bankClosesFence(line, open)) {
        open = null;
      }
    } else {
      const marker = bankFenceMarker(line);
      if (marker) {
        fenced.add(index);
        open = marker;
      }
    }
  }
  return fenced;
}

function bankFrontmatterEnd(lines) {
  if (!lines.length || lines[0].trimEnd() !== "---") {
    return null;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trimEnd() === "---") {
      return index;
    }
  }
  return null;
}

function bankAtxHeading(line) {
  let indent = 0;
  while (indent < line.length && line[indent] === " ") {
    indent += 1;
  }
  if (indent > 3) {
    return null;
  }
  const rest = line.slice(indent);
  let hashes = 0;
  while (hashes < rest.length && rest[hashes] === "#") {
    hashes += 1;
  }
  if (hashes < 1 || hashes > 6) {
    return null;
  }
  if (hashes < rest.length && rest[hashes] !== " " && rest[hashes] !== "\t") {
    return null;
  }
  let title = rest.slice(hashes).trim();
  if (title.endsWith("#")) {
    const stripped = title.replace(/#+$/, "");
    if (!stripped.length || /\s$/.test(stripped)) {
      title = stripped.trimEnd();
    }
  }
  return { level: hashes, title };
}

function bankMonthIndex(name) {
  const index = BANK_MONTHS_ABBR.indexOf(name);
  return index >= 0 ? index + 1 : null;
}

function bankWeekdayAbbr(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return BANK_WEEKDAYS[(date.getDay() + 6) % 7];
}

function bankValidDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return {
    year,
    month,
    day,
    iso: `${year}-${mm}-${dd}`,
  };
}

function bankLooksLikeIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function bankParseDayHeading(title, month) {
  const tokens = String(title || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !month) {
    return null;
  }
  if (bankLooksLikeIsoDate(tokens[0])) {
    if (tokens.length > 2) {
      return null;
    }
    const [yearText, monthText, dayText] = tokens[0].split("-");
    const date = bankValidDate(Number(yearText), Number(monthText), Number(dayText));
    if (!date) {
      return null;
    }
    if (tokens[1]) {
      return {
        date,
        kind: "iso-weekday",
        weekday_mismatch: tokens[1] !== bankWeekdayAbbr(date.year, date.month, date.day),
      };
    }
    return { date, kind: "iso", weekday_mismatch: false };
  }
  if (tokens.length === 3 && BANK_WEEKDAYS.includes(tokens[0])) {
    const monthNum = bankMonthIndex(tokens[1]);
    const day = Number(tokens[2]);
    if (!monthNum || !Number.isInteger(day)) {
      return null;
    }
    const date = bankValidDate(month.year, monthNum, day);
    if (!date) {
      return null;
    }
    return {
      date,
      kind: "canonical",
      weekday_mismatch: tokens[0] !== bankWeekdayAbbr(date.year, date.month, date.day),
    };
  }
  if (tokens.length === 2) {
    const monthNum = bankMonthIndex(tokens[0]);
    const day = Number(tokens[1]);
    if (!monthNum || !Number.isInteger(day)) {
      return null;
    }
    const date = bankValidDate(month.year, monthNum, day);
    if (!date) {
      return null;
    }
    return { date, kind: "month-day", weekday_mismatch: false };
  }
  return null;
}

function bankParseCentsUnsigned(input) {
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

function bankParseAmountLead(body) {
  let rest = String(body || "").replace(/^\s+/, "");
  const amountStartSkip = String(body || "").length - rest.length;
  const bold = rest.startsWith("**");
  if (bold) {
    rest = rest.slice(2);
  }
  let sign = -1;
  if (rest.startsWith("+")) {
    sign = 1;
    rest = rest.slice(1);
  } else if (rest.startsWith("-")) {
    sign = -1;
    rest = rest.slice(1);
  } else if (rest.startsWith("−")) {
    sign = -1;
    rest = rest.slice("−".length);
  }
  if (!rest.startsWith("$")) {
    return { kind: "not-amount" };
  }
  rest = rest.slice(1);
  if (rest.startsWith("**")) {
    rest = rest.slice(2);
  }
  if (rest.trimStart() === "") {
    return { kind: "stub", amountStartSkip };
  }
  const parsed = bankParseCentsUnsigned(rest);
  if (!parsed) {
    return { kind: "unparsed", amountStartSkip };
  }
  rest = parsed.rest;
  if (bold) {
    rest = rest.startsWith("**") ? rest.slice(2) : rest;
  }
  return {
    kind: "amount",
    cents: sign * parsed.cents,
    rest,
    amountStartSkip,
  };
}

function bankClassifyLine(line) {
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
    let checkbox = null;
    if (afterDash.startsWith(`[${status}] `)) {
      checkbox = { start: 2, end: 5, text: `[${status}]` };
      body = afterDash.slice(4);
    } else if (afterDash.startsWith(`[${status}]`)) {
      checkbox = { start: 2, end: 5, text: `[${status}]` };
      body = afterDash.slice(3).trimStart();
    } else {
      return { kind: "not-a-row" };
    }
    const lead = bankParseAmountLead(body);
    if (lead.kind === "not-amount") {
      return { kind: "not-a-row" };
    }
    if (lead.kind === "stub") {
      return { kind: "stub", status, body, checkbox };
    }
    return { kind: "checkbox", status, body, checkbox, lead };
  }
  const lead = bankParseAmountLead(afterDash);
  if (lead.kind === "not-amount") {
    return { kind: "not-a-row" };
  }
  return { kind: "amount-no-checkbox", lead };
}

function bankAmountSpan(line, checkbox, body, lead) {
  if (!lead || lead.kind === "not-amount") {
    return null;
  }
  const bodyStart = checkbox ? checkbox.end + (line[checkbox.end] === " " ? 1 : 0) : 2;
  const trimmedBody = body || "";
  const skip = lead.amountStartSkip || 0;
  const amountStart = bodyStart + skip;
  const afterAmount = lead.kind === "amount" ? lead.rest : "";
  const consumed = trimmedBody.length - skip - afterAmount.length;
  const amountEnd = amountStart + consumed;
  return {
    start: amountStart,
    end: amountEnd,
    text: line.slice(amountStart, amountEnd),
  };
}

function bankScanSource(path, source) {
  const month = bankMonthFromPath(path);
  if (!month || typeof source !== "string") {
    return { path: bankNormalizePath(path), month: null, days: [], rows: [], headings: [] };
  }
  const lines = source.replace(/^\uFEFF/, "").split(/\n/);
  const frontmatterEnd = bankFrontmatterEnd(lines);
  const fenced = bankFenceLines(lines);
  const days = [];
  const rows = [];
  const headings = [];
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].replace(/\r$/, "");
    if ((frontmatterEnd !== null && index <= frontmatterEnd) || fenced.has(index)) {
      continue;
    }
    const lineNumber = index + 1;
    const heading = bankAtxHeading(raw);
    if (heading && heading.level === 2) {
      const parsed = bankParseDayHeading(heading.title, month);
      if (parsed) {
        current = {
          date: parsed.date.iso,
          heading: heading.title,
          line: lineNumber,
          weekday_mismatch: parsed.weekday_mismatch,
        };
        days.push(current);
        headings.push(current);
      } else {
        current = null;
        headings.push({ date: null, heading: heading.title, line: lineNumber });
      }
      continue;
    }
    const classified = bankClassifyLine(raw);
    if (classified.kind === "not-a-row" || classified.kind === "stub") {
      continue;
    }
    if (!current) {
      continue;
    }
    if (classified.kind !== "checkbox") {
      continue;
    }
    const amount = bankAmountSpan(raw, classified.checkbox, classified.body, classified.lead);
    rows.push({
      path: bankNormalizePath(path),
      line: lineNumber,
      date: current.date,
      headingLine: current.line,
      heading: current.heading,
      status: classified.status,
      acknowledged: classified.status === "x" || classified.status === "X",
      cents: classified.lead.kind === "amount" ? classified.lead.cents : null,
      unparsed: classified.lead.kind !== "amount",
      spans: {
        checkbox: classified.checkbox,
        amount,
        line: { start: 0, end: raw.length, text: raw },
      },
    });
  }
  return { path: bankNormalizePath(path), month: month.key, days, rows, headings };
}

function bankRecognizeRow(path, source, lineNumber) {
  const scan = bankScanSource(path, source);
  if (!scan.month) {
    return null;
  }
  const line = Number(lineNumber);
  return scan.rows.find((row) => row.line === line) || null;
}

function bankLocateDayHeading(source, month, dateIso) {
  if (typeof source !== "string" || !month || !dateIso) {
    return null;
  }
  const monthSpec = typeof month === "string"
    ? bankMonthFromPath(`bank/${month}.md`)
    : month;
  if (!monthSpec) {
    return null;
  }
  const lines = source.replace(/^\uFEFF/, "").split(/\n/);
  const frontmatterEnd = bankFrontmatterEnd(lines);
  const fenced = bankFenceLines(lines);
  for (let index = 0; index < lines.length; index += 1) {
    if ((frontmatterEnd !== null && index <= frontmatterEnd) || fenced.has(index)) {
      continue;
    }
    const raw = lines[index].replace(/\r$/, "");
    const heading = bankAtxHeading(raw);
    if (!heading || heading.level !== 2) {
      continue;
    }
    const parsed = bankParseDayHeading(heading.title, monthSpec);
    if (parsed && parsed.date.iso === dateIso) {
      return {
        line: index + 1,
        heading: heading.title,
        text: raw,
        weekday_mismatch: parsed.weekday_mismatch,
      };
    }
  }
  return null;
}

function bankSourceFenceLines(source) {
  const lines = String(source || "").replace(/^\uFEFF/, "").split(/\n/);
  return bankFenceLines(lines);
}
