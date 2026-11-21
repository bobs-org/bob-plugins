// Pure bank-row tokenization and presentation. Syntax only: spans point
// at the original line bytes. Amounts, tails, and math-dollar ranges are
// derived here; CodeMirror and Reading view only apply them.

const BANK_MATH_NODE_NAMES = [
  "math",
  "math-inline",
  "math-block",
  "mathjax",
  "mjx-container",
  "cm-math",
];

function bankSpan(start, end, text) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    return null;
  }
  return { start, end, text: typeof text === "string" ? text : "" };
}

function bankSplitTrailingBlockId(text) {
  const raw = String(text || "");
  const match = raw.match(BANK_TRAILING_BLOCK_ID_RE);
  if (!match) {
    return { without: raw, id: null, idStart: null, idEnd: null, bankId: null };
  }
  const id = match[1];
  const trimmed = raw.replace(/[ \t]+$/, "");
  const caret = trimmed.lastIndexOf("^");
  if (caret < 0) {
    return { without: raw, id: null, idStart: null, idEnd: null, bankId: null };
  }
  const without = trimmed.slice(0, caret).replace(/[ \t]+$/, "");
  const hex = id.match(BANK_ACK_ID_RE);
  return {
    without,
    id,
    idStart: caret,
    idEnd: caret + 1 + id.length,
    bankId: hex ? hex[1].toLowerCase() : null,
  };
}

function bankPayeeEnd(text) {
  const raw = String(text || "");
  let end = raw.length;
  const markers = [" [", "[[", "—", "--", "⚑", "!!"];
  for (const marker of markers) {
    const index = raw.indexOf(marker);
    if (index >= 0 && index < end) {
      end = index;
    }
  }
  return end;
}

function bankParseInlineField(text) {
  const raw = String(text || "");
  if (!raw.startsWith("[")) {
    return null;
  }
  const rest = raw.slice(1);
  const colon = rest.indexOf("::");
  if (colon < 0) {
    return null;
  }
  const key = rest.slice(0, colon).trim();
  if (!key || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
    return null;
  }
  const afterKey = rest.slice(colon + 2);
  const close = afterKey.indexOf("]");
  if (close < 0) {
    return null;
  }
  return {
    key,
    value: afterKey.slice(0, close).trim(),
    consumed: 1 + colon + 2 + close + 1,
    raw: raw.slice(0, 1 + colon + 2 + close + 1),
  };
}

function bankParseRowTail(tail, base) {
  const raw = String(tail || "");
  const origin = Number.isInteger(base) ? base : 0;
  let category = null;
  let account = null;
  const extraFields = [];
  const links = [];
  let flagged = false;
  let flagSpan = null;
  let noteStart = null;
  let index = 0;
  while (index < raw.length) {
    if (raw.startsWith("[[", index)) {
      const close = raw.indexOf("]]", index + 2);
      if (close >= 0) {
        const end = close + 2;
        links.push(bankSpan(origin + index, origin + end, raw.slice(index, end)));
        index = end;
        continue;
      }
    }
    if (raw[index] === "[") {
      const field = bankParseInlineField(raw.slice(index));
      if (field) {
        const span = bankSpan(origin + index, origin + index + field.consumed, field.raw);
        if (field.key === "cat") {
          category = { key: field.value, span, raw: field.raw };
        } else if (field.key === "acct") {
          account = { alias: field.value, span, raw: field.raw };
        } else {
          extraFields.push({ key: field.key, value: field.value, span, raw: field.raw });
        }
        index += field.consumed;
        continue;
      }
    }
    if (raw.startsWith("⚑", index)) {
      flagged = true;
      const width = "⚑".length;
      if (!flagSpan) {
        flagSpan = bankSpan(origin + index, origin + index + width, "⚑");
      }
      if (noteStart === null) {
        noteStart = index + width;
      }
      index += width;
      continue;
    }
    if (raw.startsWith("!!", index)) {
      flagged = true;
      if (!flagSpan) {
        flagSpan = bankSpan(origin + index, origin + index + 2, "!!");
      }
      if (noteStart === null) {
        noteStart = index + 2;
      }
      index += 2;
      continue;
    }
    if (raw.startsWith("—", index)) {
      const width = "—".length;
      if (noteStart === null) {
        noteStart = index + width;
      }
      index += width;
      continue;
    }
    if (
      raw.startsWith("--", index) &&
      (index + 2 >= raw.length || raw[index + 2] !== "-")
    ) {
      if (noteStart === null) {
        noteStart = index + 2;
      }
      index += 2;
      continue;
    }
    index += 1;
  }
  const noteText = noteStart === null ? null : bankCleanNote(raw.slice(noteStart));
  const contents = bankNoteContents(raw, origin, noteStart);
  const first = contents[0] || null;
  return {
    category,
    account,
    extraFields,
    links,
    flagged,
    flagSpan,
    note: noteText,
    noteSpan: first ? first.span : null,
    noteMarkerSpan: first ? first.marker : null,
    noteEditable: contents.length === 1,
  };
}

function bankNoteMarkerWidth(raw, index) {
  if (index < 0 || index >= raw.length) {
    return 0;
  }
  if (raw.startsWith("—", index)) {
    return "—".length;
  }
  if (raw.startsWith("--", index) && raw[index + 2] !== "-") {
    return 2;
  }
  return 0;
}

function bankStripNoteDecorations(text) {
  const raw = String(text || "");
  let out = "";
  let index = 0;
  while (index < raw.length) {
    if (raw.startsWith("[[", index)) {
      const close = raw.indexOf("]]", index + 2);
      if (close >= 0) {
        index = close + 2;
        continue;
      }
    }
    if (raw[index] === "[") {
      const field = bankParseInlineField(raw.slice(index));
      if (field) {
        index += field.consumed;
        continue;
      }
    }
    if (raw.startsWith("⚑", index)) {
      index += "⚑".length;
      continue;
    }
    if (raw.startsWith("!!", index)) {
      index += 2;
      continue;
    }
    out += raw[index];
    index += 1;
  }
  return out;
}

function bankCleanNote(text) {
  const collapsed = bankStripNoteDecorations(text).replace(/\s+/g, " ").trim();
  let rest = collapsed;
  if (rest.startsWith("—")) {
    rest = rest.slice("—".length).trim();
  } else if (rest.startsWith("--") && rest[2] !== "-") {
    rest = rest.slice(2).trim();
  }
  return rest || null;
}

function bankNoteProseRuns(raw, fromIndex) {
  const runs = [];
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= raw.length) {
    return runs;
  }
  let index = fromIndex;
  let runStart = fromIndex;
  const flush = (end) => {
    if (end > runStart) {
      runs.push({ start: runStart, end });
    }
  };
  while (index < raw.length) {
    if (raw.startsWith("[[", index)) {
      const close = raw.indexOf("]]", index + 2);
      if (close >= 0) {
        flush(index);
        index = close + 2;
        runStart = index;
        continue;
      }
    }
    if (raw[index] === "[") {
      const field = bankParseInlineField(raw.slice(index));
      if (field) {
        flush(index);
        index += field.consumed;
        runStart = index;
        continue;
      }
    }
    if (raw.startsWith("⚑", index)) {
      flush(index);
      index += "⚑".length;
      runStart = index;
      continue;
    }
    if (raw.startsWith("!!", index)) {
      flush(index);
      index += 2;
      runStart = index;
      continue;
    }
    index += 1;
  }
  flush(raw.length);
  return runs;
}

function bankProseRunContent(raw, origin, start, end) {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(raw[from])) {
    from += 1;
  }
  let marker = null;
  const markerWidth = bankNoteMarkerWidth(raw, from);
  if (markerWidth) {
    marker = bankSpan(origin + from, origin + from + markerWidth, raw.slice(from, from + markerWidth));
    from += markerWidth;
    while (from < to && /\s/.test(raw[from])) {
      from += 1;
    }
  }
  while (to > from && /\s/.test(raw[to - 1])) {
    to -= 1;
  }
  if (from >= to) {
    return null;
  }
  return {
    span: bankSpan(origin + from, origin + to, raw.slice(from, to)),
    marker,
  };
}

function bankMarkerBeforeNote(raw, origin, spanStart) {
  let index = spanStart - origin;
  while (index > 0 && /\s/.test(raw[index - 1])) {
    index -= 1;
  }
  const em = "—".length;
  if (index >= em && raw.slice(index - em, index) === "—") {
    return bankSpan(origin + index - em, origin + index, "—");
  }
  if (index >= 2 && bankNoteMarkerWidth(raw, index - 2) === 2) {
    return bankSpan(origin + index - 2, origin + index, "--");
  }
  return null;
}

function bankNoteContents(raw, origin, noteStart) {
  const contents = [];
  for (const run of bankNoteProseRuns(raw, noteStart)) {
    const content = bankProseRunContent(raw, origin, run.start, run.end);
    if (!content || !content.span) {
      continue;
    }
    contents.push({
      span: content.span,
      marker: content.marker || bankMarkerBeforeNote(raw, origin, content.span.start),
    });
  }
  return contents;
}

function bankLineDollarOffsets(line) {
  const raw = String(line || "");
  const offsets = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "$") {
      offsets.push(index);
    }
  }
  return offsets;
}

function bankTokenizeLine(line) {
  const classified = bankClassifyLine(line);
  if (!classified || classified.kind !== "checkbox" || !classified.lead || classified.lead.kind !== "amount") {
    return null;
  }
  const amount = bankAmountSpan(line, classified.checkbox, classified.body, classified.lead);
  if (!amount) {
    return null;
  }
  const afterAmount = line.slice(amount.end);
  const split = bankSplitTrailingBlockId(afterAmount);
  const payeeSource = split.without;
  const payeeEnd = bankPayeeEnd(payeeSource);
  const payee = payeeSource.slice(0, payeeEnd).trim();
  const payeeLead = payeeSource.slice(0, payeeEnd).match(/^\s*/);
  const payeeStart = amount.end + (payeeLead ? payeeLead[0].length : 0);
  const tailStartInWithout = payeeEnd;
  const tailLead = payeeSource.slice(tailStartInWithout).match(/^\s*/);
  const tailAbs = amount.end + tailStartInWithout + (tailLead ? tailLead[0].length : 0);
  const tail = bankParseRowTail(payeeSource.slice(tailStartInWithout).trimStart(), tailAbs);
  const idAbsStart = split.idStart === null ? null : amount.end + split.idStart;
  const idAbsEnd = split.idEnd === null ? null : amount.end + split.idEnd;
  const idText = idAbsStart === null ? "" : line.slice(idAbsStart, idAbsEnd);
  return {
    kind: "row",
    status: classified.status,
    acknowledged: classified.status === "x" || classified.status === "X",
    cents: classified.lead.cents,
    payee,
    checkbox: classified.checkbox,
    amount,
    dollars: bankLineDollarOffsets(line),
    payeeSpan: payee ? bankSpan(payeeStart, payeeStart + payee.length, payee) : null,
    category: tail.category,
    account: tail.account,
    extraFields: tail.extraFields,
    links: tail.links,
    flagged: tail.flagged,
    flagSpan: tail.flagSpan,
    note: tail.note,
    noteSpan: tail.noteSpan,
    noteMarkerSpan: tail.noteMarkerSpan || null,
    noteEditable: tail.noteEditable === true,
    bankId: split.bankId,
    bankIdSpan: split.bankId && idAbsStart !== null
      ? bankSpan(idAbsStart, idAbsEnd, idText)
      : null,
    customId: split.id && !split.bankId ? split.id : null,
    customIdSpan: split.id && !split.bankId && idAbsStart !== null
      ? bankSpan(idAbsStart, idAbsEnd, idText)
      : null,
  };
}

function bankTokenizeSource(path, source) {
  const scan = bankScanSource(path, source);
  if (!scan.month) {
    return { path: bankNormalizePath(path), month: null, rows: [], headings: [], dollars: [] };
  }
  const lines = String(source || "").replace(/^\uFEFF/, "").split(/\n/);
  const rows = [];
  const dollars = [];
  for (const row of scan.rows) {
    const raw = (lines[row.line - 1] || "").replace(/\r$/, "");
    const token = bankTokenizeLine(raw);
    if (!token) {
      continue;
    }
    const lineStart = bankSourceLineStart(source, row.line);
    rows.push({
      ...token,
      path: scan.path,
      line: row.line,
      date: row.date,
      heading: row.heading,
      headingLine: row.headingLine,
      lineStart,
      lineText: raw,
    });
    for (const offset of token.dollars) {
      dollars.push({ line: row.line, offset: lineStart + offset });
    }
  }
  return {
    path: scan.path,
    month: scan.month,
    rows,
    headings: scan.headings.filter((heading) => heading.date),
    dollars,
    scan,
  };
}

function bankSourceLineStart(source, lineNumber) {
  const text = String(source || "").replace(/^\uFEFF/, "");
  let line = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (line === lineNumber) {
      return index;
    }
    if (text[index] === "\n") {
      line += 1;
    }
  }
  return text.length;
}

function bankCatalogLookup(list, keyField, key) {
  if (!key || !Array.isArray(list)) {
    return null;
  }
  return list.find((entry) => entry && entry[keyField] === key) || null;
}

function bankRowPresentation(token, catalogs) {
  if (!token || token.kind !== "row") {
    return null;
  }
  const cats = catalogs && Array.isArray(catalogs.categories) ? catalogs.categories : [];
  const accts = catalogs && Array.isArray(catalogs.accounts) ? catalogs.accounts : [];
  const category = token.category
    ? bankCatalogLookup(cats, "key", token.category.key)
    : null;
  const account = token.account
    ? bankCatalogLookup(accts, "alias", token.account.alias)
    : null;
  const amountText = Number.isSafeInteger(token.cents) ? bankFormatCents(token.cents) : token.amount.text;
  return {
    ...token,
    amountDisplay: amountText,
    amountPositive: Number.isSafeInteger(token.cents) ? token.cents > 0 : /^\+/.test(token.amount.text),
    categoryLabel: token.category
      ? [category && category.emoji, category && category.label || token.category.key].filter(Boolean).join(" ")
      : null,
    accountLabel: token.account
      ? (account && account.label) || token.account.alias
      : null,
    idLabel: token.bankId ? "bank ✓" : null,
  };
}

function bankHeadingPresentation(heading, reportDay) {
  if (!heading || !heading.date) {
    return null;
  }
  const waiting = reportDay && Number.isInteger(reportDay.waiting) ? reportDay.waiting : 0;
  const outCents = reportDay && Number.isSafeInteger(reportDay.out_cents) ? reportDay.out_cents : 0;
  const inCents = reportDay && Number.isSafeInteger(reportDay.in_cents) ? reportDay.in_cents : 0;
  const rowCount = reportDay && Array.isArray(reportDay.rows) ? reportDay.rows.length : 0;
  const empty = rowCount === 0 && outCents === 0 && inCents === 0;
  const outText = (bankFormatCents(outCents) || "$0.00").replace(/^\+/, "");
  const inText = bankFormatCents(inCents) || "+$0.00";
  return {
    date: heading.date,
    heading: heading.heading,
    line: heading.line,
    empty,
    waiting,
    outCents,
    inCents,
    label: empty ? "nothing posted" : `out ${outText} · in ${inText}`,
    waitingLabel: waiting > 0 ? `${waiting} waiting` : null,
  };
}

function bankReportDayFor(report, date) {
  if (!report || !Array.isArray(report.days) || !date) {
    return null;
  }
  return report.days.find((day) => day && day.date === date) || null;
}

function bankNaiveMathSpans(source) {
  const text = String(source || "");
  const dollars = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "$") {
      dollars.push(index);
    }
  }
  const spans = [];
  for (let index = 0; index + 1 < dollars.length; index += 2) {
    spans.push({ start: dollars[index], end: dollars[index + 1] + 1 });
  }
  return spans;
}

function bankMathConflictSpans(path, source) {
  const tokens = bankTokenizeSource(path, source);
  if (!tokens.month) {
    return [];
  }
  const protectedDollars = new Set(tokens.dollars.map((entry) => entry.offset));
  return bankNaiveMathSpans(source).filter((span) =>
    protectedDollars.has(span.start) || protectedDollars.has(span.end - 1),
  );
}

function bankMathDollarRanges(path, source) {
  const tokens = bankTokenizeSource(path, source);
  return tokens.dollars.map((entry) => ({
    line: entry.line,
    start: entry.offset,
    end: entry.offset + 1,
  }));
}

function bankLineHasCursor(lineFrom, lineTo, selectionRanges) {
  const ranges = Array.isArray(selectionRanges) ? selectionRanges : [];
  for (const range of ranges) {
    if (!range) {
      continue;
    }
    const from = Number(range.from);
    const to = Number(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      continue;
    }
    if (Math.max(from, lineFrom) <= Math.min(to, lineTo)) {
      return true;
    }
    if (from === to && from >= lineFrom && from <= lineTo) {
      return true;
    }
  }
  return false;
}

function bankMarkEl(doc, tag, attrs, text) {
  if (!doc || typeof doc.createElement !== "function") {
    return null;
  }
  const node = doc.createElement(tag);
  if (attrs && typeof attrs === "object") {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      try {
        node.setAttribute(name, value === true ? name : String(value));
      } catch (error) {}
    }
  }
  if (text !== undefined && text !== null) {
    try {
      if (typeof doc.createTextNode === "function" && typeof node.appendChild === "function") {
        node.appendChild(doc.createTextNode(String(text)));
      } else {
        node.textContent = String(text);
      }
    } catch (error) {}
  }
  return node;
}

function buildBankAmountElement(doc, model) {
  const amount = bankMarkEl(doc, "span", {
    class: "bob-bank-mark-amount" + (model && model.amountPositive ? " is-in" : ""),
  }, model && model.amountDisplay);
  return amount;
}

function buildBankChipElement(doc, kind, text) {
  return bankMarkEl(doc, "span", { class: `bob-bank-mark-chip bob-bank-mark-${kind}` }, text);
}

function buildBankIdElement(doc) {
  return bankMarkEl(doc, "span", { class: "bob-bank-mark-id", title: "Imported bank id" }, "bank ✓");
}

function buildBankHeadingElement(doc, model) {
  const host = bankMarkEl(doc, "span", { class: "bob-bank-mark-heading" + (model && model.empty ? " is-empty" : "") });
  if (!host || !model) {
    return host;
  }
  host.appendChild(bankMarkEl(doc, "span", { class: "bob-bank-mark-heading-label" }, model.label));
  if (model.waitingLabel) {
    host.appendChild(doc.createTextNode(" "));
    host.appendChild(bankMarkEl(doc, "span", { class: "bob-bank-mark-waiting-badge" }, model.waitingLabel));
  }
  return host;
}

function buildBankDollarElement(doc) {
  return bankMarkEl(doc, "span", { class: "bob-bank-math-dollar", "aria-hidden": "true" }, "$");
}

function bankNodeClassList(node) {
  try {
    if (node && node.classList && typeof node.classList.contains === "function") {
      return node.classList;
    }
  } catch (error) {}
  return null;
}

function bankNodeHasClass(node, name) {
  const list = bankNodeClassList(node);
  if (list) {
    try {
      return list.contains(name);
    } catch (error) {
      return false;
    }
  }
  try {
    const raw = typeof node.getAttribute === "function"
      ? node.getAttribute("class") || ""
      : typeof node.className === "string" ? node.className : "";
    return String(raw).split(/\s+/).includes(name);
  } catch (error) {
    return false;
  }
}

function bankIsMathNode(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  let tag = "";
  try {
    tag = String(node.tagName || node.nodeName || "").toLowerCase();
  } catch (error) {
    tag = "";
  }
  if (tag === "mjx-container" || tag === "mjx-assistive-mml") {
    return true;
  }
  for (const name of BANK_MATH_NODE_NAMES) {
    if (bankNodeHasClass(node, name)) {
      return true;
    }
  }
  return false;
}

function bankMathNodeTouchesBankAmount(node, tokens) {
  let text = "";
  try {
    text = String(node && node.textContent || "");
  } catch (error) {
    text = "";
  }
  let original = "";
  try {
    original = typeof node.getAttribute === "function"
      ? String(node.getAttribute("data-original") || "")
      : "";
  } catch (error) {
    original = "";
  }
  const haystack = `${text}\n${original}`;
  if (!haystack.trim() || !tokens || !Array.isArray(tokens.rows)) {
    return false;
  }
  return tokens.rows.some((row) => {
    const amount = row && row.amount && row.amount.text;
    if (amount) {
      const compact = amount.replace(/\*/g, "");
      const bare = compact.replace(/^[+\u2212\-]?\$/, "");
      if (
        haystack.includes(amount)
        || haystack.includes(compact)
        || (bare.length >= 3 && haystack.includes(bare))
      ) {
        return true;
      }
    }
    const lineText = row && typeof row.lineText === "string" ? row.lineText : "";
    if (!lineText) {
      return false;
    }
    if (original && original.trim() && lineText.includes(original)) {
      return true;
    }
    return Boolean(text && text.includes("$") && lineText.includes(text));
  });
}

function bankProtectMathInElement(root, path, source) {
  if (!root) {
    return 0;
  }
  const tokens = bankTokenizeSource(path, source);
  if (!tokens.month || !tokens.rows.length) {
    return 0;
  }
  const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
  let changed = 0;
  const visit = (node) => {
    if (!node) {
      return;
    }
    const children = node.childNodes ? Array.from(node.childNodes) : [];
    if (bankIsMathNode(node)) {
      if (!bankMathNodeTouchesBankAmount(node, tokens)) {
        return;
      }
      const parent = node.parentNode;
      if (!parent || typeof parent.replaceChild !== "function" || !doc) {
        return;
      }
      if (bankNodeHasClass(node, "bob-bank-math-protected")) {
        return;
      }
      const original = (typeof node.getAttribute === "function" && node.getAttribute("data-original"))
        || node.textContent
        || "";
      const replacement = bankMarkEl(doc, "span", { class: "bob-bank-math-protected" }, original);
      if (!replacement) {
        return;
      }
      try {
        parent.replaceChild(replacement, node);
        changed += 1;
      } catch (error) {}
      return;
    }
    for (const child of children) {
      visit(child);
    }
  };
  visit(root);
  return changed;
}

function bankRestoreMarkHosts(root) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return;
  }
  for (const host of Array.from(root.querySelectorAll(".bob-bank-mark-host"))) {
    const parent = host.parentNode;
    const native = typeof host.querySelector === "function" ? host.querySelector(".bob-bank-mark-native") : null;
    if (!parent || !native) {
      continue;
    }
    try {
      while (native.firstChild) {
        parent.insertBefore(native.firstChild, host);
      }
      parent.removeChild(host);
    } catch (error) {}
  }
  for (const extra of Array.from(root.querySelectorAll(".bob-bank-mark-sub.is-appended"))) {
    try {
      if (extra.parentNode) {
        extra.parentNode.removeChild(extra);
      }
    } catch (error) {}
  }
  for (const extra of Array.from(root.querySelectorAll(".bob-bank-mark-heading"))) {
    try {
      if (extra.parentNode) {
        extra.parentNode.removeChild(extra);
      }
    } catch (error) {}
  }
  try {
    for (const marked of Array.from(root.querySelectorAll(".bob-bank-mark-waiting, .bob-bank-mark-acked"))) {
      try {
        if (marked.classList && typeof marked.classList.remove === "function") {
          marked.classList.remove("bob-bank-mark-waiting");
          marked.classList.remove("bob-bank-mark-acked");
        }
      } catch (error) {}
    }
  } catch (error) {}
}
