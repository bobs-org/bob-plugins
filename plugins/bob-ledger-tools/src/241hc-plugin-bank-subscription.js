// Subscription chips (bob-cli-ls.7): decode additive row JSON, present
// state-aware 🔁 pills, and plan one-transaction ghost-chip linking.
// Older bob output without these fields stays byte-identical at decode.

const BANK_SUBSCRIPTION_ALIAS = "🔁";
const BANK_SUBSCRIPTION_CANDIDATE_GLYPH = "⟳";
const BANK_SUBSCRIPTION_TITLE_CHARS = 14;
const BANK_SUBSCRIPTION_CANDIDATE_TOOLTIP =
  "Wells Fargo marks this as recurring — press / in the Category card";
const BANK_SUBSCRIPTION_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function bankSubscriptionRecordPath(value) {
  const raw = bankString(value) || (typeof value === "string" && value.trim() ? value.trim() : null);
  if (!raw) return null;
  return raw.replace(/\.md$/i, "");
}

function bankNormalizePriceChange(value) {
  if (value === null || value === undefined) return null;
  if (!bankJsonObject(value)) return null;
  const fromCents = bankSafeCents(value.from_cents);
  const toCents = bankSafeCents(value.to_cents);
  const since = bankIsoDateOrNull(value.since);
  if (!fromCents.ok || !toCents.ok || !since.ok || since.value === null) return null;
  return { from_cents: fromCents.value, to_cents: toCents.value, since: since.value };
}

function bankNormalizeSubscription(value) {
  if (value === null || value === undefined) return null;
  if (!bankJsonObject(value)) return null;
  const stem = bankString(value.stem);
  const path = bankString(value.path);
  const title = bankText(value.title);
  if (!stem || !path || title === null || !title.trim()) return null;
  const amount = bankSafeCents(value.amount_cents);
  if (!amount.ok) return null;
  const source = bankText(value.source);
  const state = bankText(value.state);
  const latest = value.latest === undefined ? { ok: true, value: null } : bankIsoDateOrNull(value.latest);
  const drift = value.drift_cents === null || value.drift_cents === undefined
    ? { ok: true, value: null }
    : bankSafeCents(value.drift_cents);
  if (!latest.ok || !drift.ok) return null;
  const url = bankString(value.url);
  return {
    stem,
    path,
    title: title.trim(),
    status: bankText(value.status) || "",
    status_label: bankText(value.status_label) || "",
    cadence: bankText(value.cadence) || "",
    pricing: bankText(value.pricing) || "",
    amount_cents: amount.value,
    source: source === "link" || source === "match" ? source : null,
    needle: value.needle === null || value.needle === undefined ? null : bankText(value.needle),
    latest: latest.value,
    drift_cents: drift.value,
    price_change: bankNormalizePriceChange(value.price_change),
    state: state || "ok",
    url: url,
  };
}

function bankParseWikilinkSpan(span) {
  if (!span || typeof span.text !== "string") return null;
  const match = span.text.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/);
  if (!match) return null;
  return {
    span,
    path: match[1].trim().replace(/\.md$/i, ""),
    alias: match[2] ? match[2].trim() : "",
  };
}

function bankSubscriptionLinkFromToken(token, sub) {
  const links = token && Array.isArray(token.links) ? token.links : [];
  const want = sub ? bankSubscriptionRecordPath(sub.path) : null;
  let aliased = null;
  for (const span of links) {
    const parsed = bankParseWikilinkSpan(span);
    if (!parsed || !parsed.path) continue;
    if (want && parsed.path === want) return parsed;
    if (parsed.alias === BANK_SUBSCRIPTION_ALIAS) aliased = parsed;
  }
  return aliased;
}

function bankSubscriptionFromWikilink(parsed) {
  if (!parsed || !parsed.path) return null;
  const stem = parsed.path.split("/").filter(Boolean).pop() || parsed.path;
  return {
    stem,
    path: `${parsed.path}.md`,
    title: stem,
    status: "",
    status_label: "",
    cadence: "",
    pricing: "",
    amount_cents: null,
    source: "link",
    needle: null,
    drift_cents: null,
    price_change: null,
    state: "ok",
    url: null,
  };
}

function bankPayeeNamesRecord(payee, title) {
  const left = String(payee || "").toLowerCase();
  const right = String(title || "").toLowerCase();
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function bankSubscriptionMoney(cents) {
  const text = Number.isSafeInteger(cents) ? bankFormatCents(cents) : null;
  return text ? text.replace(/^\+/, "") : null;
}

function bankSubscriptionSignedMoney(cents) {
  if (!Number.isSafeInteger(cents) || cents === 0) return null;
  const abs = bankSubscriptionMoney(cents < 0 ? -cents : cents);
  if (!abs) return null;
  return cents > 0 ? `+${abs}` : `−${abs}`;
}

function bankSubscriptionCadencePhrase(cadence) {
  if (cadence === "monthly") return "a month";
  if (cadence === "four_weekly") return "every 4 weeks";
  if (cadence === "quarterly") return "a quarter";
  if (cadence === "yearly") return "a year";
  return cadence || "";
}

function bankSubscriptionShortDate(iso) {
  const match = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!match) return null;
  const month = BANK_SUBSCRIPTION_MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return `${month} ${Number(match[3])}`;
}

function bankSubscriptionTrimTitle(title) {
  const raw = String(title || "").trim();
  if (raw.length <= BANK_SUBSCRIPTION_TITLE_CHARS) return raw;
  return `${raw.slice(0, BANK_SUBSCRIPTION_TITLE_CHARS).trimEnd()}`;
}

function bankSubscriptionInsertOffset(token, lineLength) {
  if (!token) {
    return Number.isInteger(lineLength) ? lineLength : 0;
  }
  const end = Number.isInteger(lineLength)
    ? lineLength
    : String(token.lineText || "").length;
  const candidates = [end];
  if (token.flagSpan && Number.isInteger(token.flagSpan.start)) {
    candidates.push(token.flagSpan.start);
  }
  if (token.noteMarkerSpan && Number.isInteger(token.noteMarkerSpan.start)) {
    candidates.push(token.noteMarkerSpan.start);
  }
  if (token.noteSpan && Number.isInteger(token.noteSpan.start)) {
    candidates.push(token.noteSpan.start);
  }
  if (token.bankIdSpan && Number.isInteger(token.bankIdSpan.start)) {
    candidates.push(token.bankIdSpan.start);
  }
  if (token.customIdSpan && Number.isInteger(token.customIdSpan.start)) {
    candidates.push(token.customIdSpan.start);
  }
  return Math.min(...candidates);
}

function bankSubscriptionGhostOffset(token) {
  return bankSubscriptionInsertOffset(token);
}

function bankSubscriptionTooltip(sub, rowDate) {
  if (!sub) return "";
  const parts = [];
  if (sub.title) parts.push(sub.title);
  if (sub.status_label) parts.push(sub.status_label);
  const money = bankSubscriptionMoney(sub.amount_cents);
  const cadence = bankSubscriptionCadencePhrase(sub.cadence);
  if (money && cadence) parts.push(`${money} ${cadence}`);
  else if (money) parts.push(money);
  const latest = bankSubscriptionShortDate(sub.latest);
  if (latest) {
    parts.push(`latest charge ${latest}`);
  } else {
    const charged = bankSubscriptionShortDate(rowDate);
    if (charged) parts.push(`charged ${charged}`);
  }
  return parts.join(" · ");
}

function bankSubscriptionChipBase(token, sub, extras) {
  const recordPath = sub ? bankSubscriptionRecordPath(sub.path) : null;
  return {
    kind: extras.kind,
    state: extras.state,
    label: extras.label,
    title: sub && sub.title ? sub.title : "",
    tooltip: extras.tooltip,
    ariaLabel: extras.ariaLabel,
    tone: extras.tone || "muted",
    ghost: extras.ghost === true,
    recordPath,
    stem: sub && sub.stem ? sub.stem : "",
    url: sub && sub.url ? sub.url : null,
    source: sub && sub.source ? sub.source : null,
    click: extras.click,
    span: extras.span || null,
    widgetOffset: extras.widgetOffset,
    rowPath: token && token.path ? token.path : extras.rowPath || "",
    rowLine: token && Number.isInteger(token.line) ? token.line : extras.rowLine || null,
    rowDate: token && token.date ? token.date : extras.rowDate || "",
    bankId: token && token.bankId ? token.bankId : extras.bankId || null,
    lineText: token && typeof token.lineText === "string" ? token.lineText : extras.lineText || "",
    payee: token && token.payee ? token.payee : extras.payee || "",
    cents: token && Number.isSafeInteger(token.cents) ? token.cents : extras.cents,
  };
}

function bankSubscriptionLinkedLabel(token, sub) {
  const state = sub && sub.state ? sub.state : "ok";
  if (state === "drift") {
    const drift = bankSubscriptionSignedMoney(sub.drift_cents);
    return drift ? `${BANK_SUBSCRIPTION_ALIAS} ${drift}` : BANK_SUBSCRIPTION_ALIAS;
  }
  if (state === "usage") return `${BANK_SUBSCRIPTION_ALIAS} usage`;
  if (state === "to_cancel") return `${BANK_SUBSCRIPTION_ALIAS} ✂️ still charging`;
  if (state === "after_cancel") return `${BANK_SUBSCRIPTION_ALIAS} 🚫 after cancel`;
  if (state === "ok" && sub && sub.title && !bankPayeeNamesRecord(token && token.payee, sub.title)) {
    const trimmed = bankSubscriptionTrimTitle(sub.title);
    return trimmed ? `${BANK_SUBSCRIPTION_ALIAS} ${trimmed}` : BANK_SUBSCRIPTION_ALIAS;
  }
  return BANK_SUBSCRIPTION_ALIAS;
}

function bankSubscriptionLinkedTone(sub) {
  const state = sub && sub.state ? sub.state : "ok";
  if (state === "to_cancel") return "amber";
  if (state === "after_cancel") return "warning";
  if (state === "drift" && sub && sub.price_change) return "amber";
  return "muted";
}

function bankSubscriptionLinkedClick(sub) {
  const state = sub && sub.state ? sub.state : "ok";
  if (state === "to_cancel") return "open-url";
  return "open-record";
}

function bankSubscriptionLinkedChip(token, sub, span) {
  const title = sub && sub.title ? sub.title : "subscription";
  return bankSubscriptionChipBase(token, sub, {
    kind: "linked",
    state: sub && sub.state ? sub.state : "ok",
    label: bankSubscriptionLinkedLabel(token, sub),
    tooltip: bankSubscriptionTooltip(sub, token && token.date),
    ariaLabel: `Open ${title} subscription`,
    tone: bankSubscriptionLinkedTone(sub),
    ghost: false,
    click: bankSubscriptionLinkedClick(sub),
    span: span || null,
    widgetOffset: span ? null : bankSubscriptionGhostOffset(token),
  });
}

function bankSubscriptionGhostChip(token, sub) {
  const title = sub && sub.title ? sub.title : "subscription";
  return bankSubscriptionChipBase(token, sub, {
    kind: "ghost",
    state: "ghost",
    label: BANK_SUBSCRIPTION_ALIAS,
    tooltip: bankSubscriptionTooltip(sub, token && token.date),
    ariaLabel: `Link this row to ${title}`,
    tone: "muted",
    ghost: true,
    click: "insert-link",
    span: null,
    widgetOffset: bankSubscriptionGhostOffset(token),
  });
}

function bankSubscriptionCandidateChip(token, jsonRow) {
  return bankSubscriptionChipBase(token, null, {
    kind: "candidate",
    state: "candidate",
    label: `${BANK_SUBSCRIPTION_CANDIDATE_GLYPH} subscription?`,
    tooltip: BANK_SUBSCRIPTION_CANDIDATE_TOOLTIP,
    ariaLabel: "Possible new subscription",
    tone: "muted",
    ghost: true,
    click: "candidate",
    span: null,
    widgetOffset: bankSubscriptionGhostOffset(token),
    rowPath: jsonRow && jsonRow.path ? jsonRow.path : token && token.path,
    rowLine: jsonRow && Number.isInteger(jsonRow.line) ? jsonRow.line : token && token.line,
    rowDate: jsonRow && jsonRow.date ? jsonRow.date : token && token.date,
    bankId: jsonRow && jsonRow.id ? jsonRow.id : token && token.bankId,
    payee: jsonRow && jsonRow.payee ? jsonRow.payee : token && token.payee,
    cents: jsonRow && Number.isSafeInteger(jsonRow.cents) ? jsonRow.cents : token && token.cents,
  });
}

function bankSubscriptionChipModel(token, jsonRow) {
  const sub = jsonRow && jsonRow.subscription ? jsonRow.subscription : null;
  const candidate = Boolean(jsonRow && jsonRow.subscription_candidate === true && !sub);
  const link = bankSubscriptionLinkFromToken(token, sub);
  if (link && sub) return bankSubscriptionLinkedChip(token, sub, link.span);
  if (link && !sub) {
    const inferred = bankSubscriptionFromWikilink(link);
    return inferred ? bankSubscriptionLinkedChip(token, inferred, link.span) : null;
  }
  if (sub && sub.source === "match") return bankSubscriptionGhostChip(token, sub);
  if (sub) return bankSubscriptionLinkedChip(token, sub, null);
  if (candidate) return bankSubscriptionCandidateChip(token, jsonRow);
  return null;
}

function bankSubscriptionChipForQueueRow(row) {
  if (!row) return null;
  const token = {
    kind: "row",
    path: row.path,
    line: row.line,
    date: row.date,
    payee: row.payee,
    cents: row.cents,
    bankId: typeof row.id === "string" ? String(row.id).replace(/^bank-/i, "").toLowerCase() : null,
    lineText: "",
    links: Array.isArray(row.links)
      ? row.links.map((text, index) => ({ start: index, end: index, text: String(text) }))
      : [],
  };
  return bankSubscriptionChipModel(token, row);
}

function bankJsonRowForToken(token, report) {
  if (!token || !report) return null;
  const rows = [];
  for (const day of Array.isArray(report.days) ? report.days : []) {
    for (const row of Array.isArray(day.rows) ? day.rows : []) {
      rows.push({
        ...row,
        path: row.path || day.path,
        date: row.date || day.date,
      });
    }
  }
  return bankCategoryMatchJsonRow({
    path: token.path,
    line: token.line,
    cents: token.cents,
    payee: token.payee,
    id: token.bankId,
    ackId: token.bankId,
  }, rows);
}

function bankSubscriptionChipKey(model) {
  if (!model) return "";
  return [
    model.kind,
    model.state,
    model.label,
    model.tone,
    model.recordPath || "",
    model.rowPath || "",
    String(model.rowLine || ""),
    model.ghost ? "g" : "",
  ].join("|");
}

function bankSubscriptionChipClass(model) {
  const parts = ["bob-bank-mark-chip", "bob-bank-mark-sub"];
  if (model && model.ghost) parts.push("is-ghost");
  if (model && model.tone === "amber") parts.push("is-amber");
  if (model && model.tone === "warning") parts.push("is-warning");
  if (model && model.kind === "candidate") parts.push("is-candidate");
  return parts.join(" ");
}

function buildBankSubscriptionChipElement(doc, model, options = {}) {
  if (!model) return null;
  const appended = options.appended === true;
  const node = bankMarkEl(doc, "button", {
    type: "button",
    class: `${bankSubscriptionChipClass(model)}${appended ? " is-appended" : ""}`,
    title: model.tooltip || "",
    "aria-label": model.ariaLabel || model.label,
  }, model.label);
  return node;
}

function bankSubscriptionBindChip(node, model, plugin) {
  if (!node || !model) return node;
  const activate = (event) => {
    try {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      if (plugin && typeof plugin.bankSubscriptionChipActivate === "function") {
        void plugin.bankSubscriptionChipActivate(model, event);
      }
    } catch (error) {}
  };
  if (typeof node.addEventListener === "function") {
    node.addEventListener("click", activate);
  }
  return node;
}

function bankSubscriptionAnchorPath(anchor) {
  if (!anchor || typeof anchor.getAttribute !== "function") return "";
  const raw = anchor.getAttribute("data-href") || anchor.getAttribute("href") || "";
  return String(raw).replace(/\.md$/i, "").replace(/#.*$/, "").replace(/^\.\//, "").trim();
}

function bankMarkFindSubscriptionLink(rowEl, model) {
  if (!rowEl || typeof rowEl.querySelectorAll !== "function") return null;
  let anchors = [];
  try {
    anchors = Array.from(rowEl.querySelectorAll("a.internal-link"));
  } catch (error) {
    return null;
  }
  const want = model ? bankSubscriptionRecordPath(model.recordPath) : null;
  const stem = model && model.stem ? String(model.stem) : "";
  let aliased = null;
  for (const anchor of anchors) {
    if (!anchor) continue;
    const path = bankSubscriptionAnchorPath(anchor);
    const text = String(anchor.textContent || "").trim();
    if (want && path && (path === want || (stem && path.endsWith(`/${stem}`)))) return anchor;
    if (text === BANK_SUBSCRIPTION_ALIAS) aliased = aliased || anchor;
  }
  return aliased;
}

function bankMarkWrapSubscriptionAnchor(rowEl, model, plugin) {
  try {
    const anchor = bankMarkFindSubscriptionLink(rowEl, model);
    if (!anchor || !anchor.parentNode) return false;
    const parent = anchor.parentNode;
    if (bankNodeHasClass(parent, "bob-bank-mark-host") || bankNodeHasClass(parent, "bob-bank-mark-native")) {
      return true;
    }
    const doc = rowEl.ownerDocument || (typeof document !== "undefined" ? document : null);
    const host = bankMarkEl(doc, "span", { class: "bob-bank-mark-host" });
    const native = bankMarkEl(doc, "span", { class: "bob-bank-mark-native" });
    const chip = buildBankSubscriptionChipElement(doc, model);
    if (!host || !native || !chip) return false;
    bankSubscriptionBindChip(chip, model, plugin);
    if (typeof parent.insertBefore !== "function" || typeof native.appendChild !== "function") return false;
    parent.insertBefore(host, anchor);
    native.appendChild(anchor);
    host.appendChild(native);
    host.appendChild(chip);
    return true;
  } catch (error) {
    return false;
  }
}

function bankMarkAppendSubscriptionChip(rowEl, model, plugin) {
  try {
    if (!rowEl || !model) return false;
    if (typeof rowEl.querySelector === "function" && rowEl.querySelector(".bob-bank-mark-sub.is-appended")) {
      return true;
    }
    const doc = rowEl.ownerDocument || (typeof document !== "undefined" ? document : null);
    const chip = buildBankSubscriptionChipElement(doc, model, { appended: true });
    if (!chip || typeof rowEl.appendChild !== "function") return false;
    bankSubscriptionBindChip(chip, model, plugin);
    rowEl.appendChild(chip);
    return true;
  } catch (error) {
    return false;
  }
}

function bankSubscriptionWikilink(recordPath) {
  const path = bankSubscriptionRecordPath(recordPath);
  if (!path) return null;
  return `[[${path}|${BANK_SUBSCRIPTION_ALIAS}]]`;
}

function bankSubscriptionAlreadyLinked(token, recordPath) {
  const want = bankSubscriptionRecordPath(recordPath);
  if (!want || !token) return false;
  return Boolean(bankSubscriptionLinkFromToken(token, { path: want }));
}

function bankSubscriptionLinkWritePlan(input = {}) {
  const recordPath = bankSubscriptionRecordPath(input.recordPath);
  const wikilink = bankSubscriptionWikilink(recordPath);
  if (!wikilink) {
    return { ok: false, reason: "no-record", message: "Bank: no subscription to link" };
  }
  const capture = input.capture && typeof input.capture === "object"
    ? input.capture
    : {
        path: input.currentPath,
        line: input.line,
        lineText: input.lineText,
        bankId: input.bankId,
      };
  const resolved = bankCategoryResolveForCommit(capture, input.currentPath, input.currentSource);
  if (!resolved.ok) return resolved;
  const { line, raw, token } = resolved;
  if (bankSubscriptionAlreadyLinked(token, recordPath)) {
    return { ok: true, mode: "link", line, action: "exists", edits: [], tick: false };
  }
  const fromCh = bankSubscriptionInsertOffset(token, raw.length);
  let insert = wikilink;
  if (fromCh > 0 && raw[fromCh - 1] !== " ") insert = ` ${insert}`;
  if (fromCh < raw.length && raw[fromCh] !== " ") insert = `${insert} `;
  return {
    ok: true,
    mode: "link",
    line,
    action: "insert",
    edits: [{ line, fromCh, toCh: fromCh, insert }],
    tick: false,
  };
}

function bankSubscriptionModifierClick(event) {
  if (!event) return false;
  return event.metaKey === true || event.ctrlKey === true || event.shiftKey === true;
}
