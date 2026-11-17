// Read-only Bank Period closing-balance readout (bob-cli-mg readout phase).
// bob computes every cent; this layer only decodes `balances[]`, picks the
// hero entry, and formats copy. It never adds money and never writes vault
// bytes.

const BANK_BALANCE_STATES = {
  awaiting_import: "awaiting_import",
  gap: "gap",
  none: "none",
  unverified: "unverified",
  so_far: "so_far",
  settled: "settled",
  as_of: "as_of",
};

const BANK_BALANCE_REASONS = {
  future: "future",
  pre_coverage: "pre_coverage",
  journal_unreadable: "journal_unreadable",
  journal_contradiction: "journal_contradiction",
  csv_overlap: "csv_overlap",
  no_anchor: "no_anchor",
  anchor_mismatch: "anchor_mismatch",
};

const BANK_BALANCE_WORDS = {
  awaiting_import: "not imported yet",
  gap: "not imported",
  unverified: "unverified",
};

let bankBalancesWarned = false;

function bankBalancesWarnOnce(message) {
  if (bankBalancesWarned === true) return;
  bankBalancesWarned = true;
  try {
    console.warn(message);
  } catch (error) {}
}

function bankNormalizeBalanceOpen(value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!bankJsonObject(value)) return { ok: false };
  const date = bankIsoDateOrNull(value.date);
  const cents = bankSafeCents(value.cents);
  if (!date.ok || date.value === null || !cents.ok) return { ok: false };
  return { ok: true, value: { date: date.value, cents: cents.value } };
}

function bankNormalizeBalanceCoverage(value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!bankJsonObject(value)) return { ok: false };
  const since = bankIsoDateOrNull(value.since);
  const through = bankIsoDateOrNull(value.through);
  if (!since.ok || since.value === null || !through.ok || through.value === null) return { ok: false };
  return { ok: true, value: { since: since.value, through: through.value } };
}

function bankNormalizeBalanceAnchors(value) {
  if (!bankJsonObject(value)) return null;
  const count = bankCount(value.count);
  if (count === null || value.agree !== true && value.agree !== false) return null;
  return { count, agree: value.agree === true };
}

function bankNormalizeBalanceEntry(value) {
  if (!bankJsonObject(value)) return null;
  if (bankString(value.alias) === null || bankString(value.label) === null) return null;
  if (bankString(value.kind) === null) return null;
  const state = BANK_BALANCE_STATES[value.state];
  if (!state) return null;
  if (value.reason !== null && value.reason !== undefined && !BANK_BALANCE_REASONS[value.reason]) return null;
  const cents = bankSafeCents(value.cents, { allowNull: true });
  const asOf = bankIsoDateOrNull(value.as_of);
  const wanted = bankIsoDateOrNull(value.wanted);
  if (!cents.ok || !asOf.ok || !wanted.ok || wanted.value === null) return null;
  if (value.stale !== true && value.stale !== false) return null;
  const isNumber = state === "so_far" || state === "settled" || state === "as_of";
  if (isNumber && (cents.value === null || asOf.value === null)) return null;
  if (!isNumber && cents.value !== null) return null;
  const open = bankNormalizeBalanceOpen(value.open);
  const change = bankSafeCents(value.change_cents, { allowNull: true });
  const coverage = bankNormalizeBalanceCoverage(value.coverage);
  if (!open.ok || !change.ok || !coverage.ok) return null;
  const anchors = bankNormalizeBalanceAnchors(value.anchors);
  if (!anchors) return null;
  const target = bankNormalizeNavigationLocation(value.target === undefined ? null : value.target);
  if (!target.ok) return null;
  return {
    alias: value.alias,
    label: value.label,
    kind: value.kind,
    hero: value.hero === true,
    state,
    reason: value.reason === null || value.reason === undefined ? null : value.reason,
    cents: cents.value,
    as_of: asOf.value,
    wanted: wanted.value,
    stale: value.stale === true,
    open: open.value,
    change_cents: change.value,
    coverage: coverage.value,
    anchors,
    target: target.value,
  };
}

// Strict about shape, lenient about presence: an absent key stays absent
// (older bob), a malformed value becomes null with one `console.warn` per
// session and never fails the report, badge, or charts.
function bankNormalizeBalances(value) {
  if (value === undefined) return { ok: true, present: false, value: null };
  if (value === null) return { ok: true, present: true, value: null };
  if (!Array.isArray(value)) {
    bankBalancesWarnOnce("bob bank report returned invalid balances; the closing balance is hidden.");
    return { ok: true, present: true, value: null };
  }
  const entries = [];
  for (const raw of value) {
    const entry = bankNormalizeBalanceEntry(raw);
    if (!entry) {
      bankBalancesWarnOnce("bob bank report returned invalid balances; the closing balance is hidden.");
      return { ok: true, present: true, value: null };
    }
    entries.push(entry);
  }
  return { ok: true, present: true, value: entries };
}

function bankPeriodBalanceAmount(cents) {
  if (!Number.isSafeInteger(cents)) return "";
  if (cents < 0) return `−${bankBadgeMoneyText(cents)}`;
  return bankBadgeMoneyText(cents);
}

function bankPeriodSignedMoney(cents, explicitPlus) {
  if (!Number.isSafeInteger(cents)) return "";
  if (cents < 0) return `−${bankBadgeMoneyText(cents)}`;
  return bankBadgeMoneyText(cents, explicitPlus === true);
}

function bankPeriodBalanceDayAfter(iso) {
  return bankIsoShiftDays(iso, 1);
}

function bankPeriodBalanceReasonCopy(state, reason) {
  if (state === "awaiting_import") {
    return {
      sentence: "This period is not imported yet.",
      remedy: "Import a statement covering this period to see the close.",
    };
  }
  if (state === "gap") {
    return {
      sentence: "A coverage gap hides this close.",
      remedy: "Import the missing statement to see the close.",
    };
  }
  if (reason === "pre_coverage") {
    return {
      sentence: "Bank coverage starts after this period.",
      remedy: "Import an earlier statement to see the close.",
    };
  }
  if (reason === "journal_unreadable" || reason === "journal_contradiction") {
    return {
      sentence: "The bank journal needs attention.",
      remedy: "See bob bank check.",
    };
  }
  if (reason === "csv_overlap") {
    return {
      sentence: "A mixed CSV and QFX import hides this close.",
      remedy: "Import CSV and QFX files in separate runs.",
    };
  }
  if (reason === "no_anchor") {
    return {
      sentence: "No bank-reported balance covers this period yet.",
      remedy: "Import a statement with a ledger balance.",
    };
  }
  if (reason === "anchor_mismatch") {
    return {
      sentence: "Bank-reported balances disagree.",
      remedy: "See bob bank check.",
    };
  }
  return {
    sentence: "This close is unverified.",
    remedy: "See bob bank check.",
  };
}

function bankPeriodBalanceDeltaLine(report, hero) {
  const accounts = report && Array.isArray(report.accounts) ? report.accounts : [];
  const account = accounts.find((entry) => entry && entry.alias === hero.alias) || null;
  if (!account || account.status !== "delta" || !Number.isSafeInteger(account.delta_cents)) return "";
  return `Ledger rows differ from the bank by ${bankBadgeMoneyText(account.delta_cents)} — see bob bank check`;
}

function bankPeriodBalanceTooltip(hero, report) {
  const lines = [`${hero.label} · closing balance (posted)`];
  const asOfText = bankPeriodFullDate(hero.as_of, hero.wanted) || hero.as_of;
  const wantedText = bankPeriodFullDate(hero.wanted, hero.wanted) || hero.wanted;
  if (hero.state === "settled") {
    lines.push(`${bankPeriodBalanceAmount(hero.cents)} at close ${wantedText}`);
  } else if (hero.state === "so_far") {
    lines.push(`${bankPeriodBalanceAmount(hero.cents)} so far · at the end of ${asOfText}`);
  } else if (hero.state === "as_of") {
    lines.push(`${bankPeriodBalanceAmount(hero.cents)} at the end of ${asOfText}`);
  } else {
    const copy = bankPeriodBalanceReasonCopy(hero.state, hero.reason);
    lines.push(copy.sentence);
    lines.push(copy.remedy);
    if (hero.target) {
      const targetText = bankPeriodFullDate(hero.target.date, hero.wanted) || hero.target.date;
      lines.push(`Click to open ${targetText} in the bank month note`);
    }
    return lines.join("\n");
  }
  if (hero.as_of && hero.wanted && hero.as_of < hero.wanted) {
    const next = bankPeriodBalanceDayAfter(hero.as_of);
    const nextText = (next && bankPeriodFullDate(next, hero.wanted)) || next || "";
    if (nextText) lines.push(`${nextText} – ${wantedText} not imported yet`);
  }
  if (hero.open && Number.isSafeInteger(hero.change_cents)) {
    const openText = bankPeriodFullDate(hero.open.date, hero.wanted) || hero.open.date;
    lines.push(`${bankPeriodSignedMoney(hero.change_cents, true)} since ${openText}, transfers included`);
  }
  if (hero.anchors) {
    if (hero.anchors.agree && hero.anchors.count > 1) {
      lines.push(`✓ Matches all ${hero.anchors.count} bank-reported balances`);
    } else if (hero.anchors.count === 1) {
      lines.push("From 1 bank-reported balance");
    }
    if (!hero.anchors.agree) lines.push("Bank balances disagree — see bob bank check");
  }
  const delta = bankPeriodBalanceDeltaLine(report, hero);
  if (delta) lines.push(delta);
  lines.push("Posted balance: your bank app's \"available\" balance also subtracts pending holds");
  if (hero.state === "so_far" && hero.stale === true) {
    let days = null;
    try {
      const end = new Date(`${hero.wanted}T00:00:00Z`).getTime();
      const start = new Date(`${hero.as_of}T00:00:00Z`).getTime();
      if (!Number.isNaN(end) && !Number.isNaN(start) && end >= start) {
        days = Math.round((end - start) / 86400000);
      }
    } catch (error) {
      days = null;
    }
    lines.push(days === null
      ? "This close is stale — import a current statement"
      : `Last bank balance is ${days} ${days === 1 ? "day" : "days"} old — import a current statement`);
  }
  if (hero.target) {
    const targetText = bankPeriodFullDate(hero.target.date, hero.wanted) || hero.target.date;
    lines.push(`Click to open ${targetText} in the bank month note`);
  }
  return lines.join("\n");
}

function bankPeriodBalanceAria(hero, today) {
  const words = BANK_BALANCE_WORDS[hero.state];
  if (words) {
    const sentence = `${hero.label} closing balance ${words}.`;
    if (!hero.target) return sentence;
    const targetText = bankPeriodFullDate(hero.target.date, hero.wanted) || hero.target.date;
    return `${sentence} Opens ${targetText} in the bank month note.`;
  }
  const asOfText = bankPeriodFullDate(hero.as_of, hero.wanted) || hero.as_of;
  const amount = bankPeriodBalanceAmount(hero.cents);
  const stale = hero.state === "so_far" && hero.stale === true ? ", stale" : "";
  const scope = hero.state === "settled" ? "at close" : hero.state === "so_far" ? "so far" : "as of";
  const asOf = hero.as_of === today ? "today" : asOfText;
  const sentence = `${hero.label} closing balance ${amount}, ${scope} ${asOf}${stale}.`;
  if (!hero.target) return sentence;
  const targetText = bankPeriodFullDate(hero.target.date, hero.wanted) || hero.target.date;
  return `${sentence} Opens ${targetText} in the bank month note.`;
}

function bankPeriodBalanceModel(report, ctx) {
  const context = ctx && typeof ctx === "object" ? ctx : {};
  const balances = report && Array.isArray(report.balances) ? report.balances : null;
  if (!balances) return null;
  const hero = balances.find((entry) => entry && entry.hero === true) || null;
  if (!hero || hero.state === "none") return null;
  const today = typeof context.today === "string" ? context.today : "";
  const model = {
    state: hero.state,
    reason: hero.reason,
    alias: hero.alias,
    label: hero.label,
    kind: hero.kind,
    cents: hero.cents,
    asOf: hero.as_of,
    wanted: hero.wanted,
    stale: hero.stale === true,
    negative: Number.isSafeInteger(hero.cents) && hero.cents < 0,
    words: BANK_BALANCE_WORDS[hero.state] || "",
    amountText: bankPeriodBalanceAmount(hero.cents),
    asOfText: "",
    target: hero.target,
    tooltip: "",
    aria: "",
  };
  if (model.state === "as_of" || model.state === "so_far") {
    model.asOfText = hero.as_of === today ? "today" : (bankPeriodFullDate(hero.as_of, hero.wanted) || hero.as_of);
  }
  model.tooltip = bankPeriodBalanceTooltip(hero, report);
  model.aria = bankPeriodBalanceAria(hero, today);
  return model;
}

function bankPeriodBuildBalance(doc, balance, handlers = {}) {
  if (!balance) return null;
  const node = statsEl(doc, "span", {
    class: "bob-bank-period-balance",
    title: balance.tooltip || null,
    role: balance.target ? "link" : null,
    tabindex: balance.target ? "0" : null,
    "aria-label": balance.target ? balance.aria : null,
    "data-state": balance.state || null,
    "data-negative": balance.negative === true ? "true" : null,
  });
  if (!node) return null;
  const hide = balance.target ? "true" : null;
  const label = statsEl(doc, "span", { class: "bob-bank-period-balance-label", "aria-hidden": hide }, "BALANCE");
  if (label) node.appendChild(label);
  if (balance.words) {
    const words = statsEl(doc, "span", { class: "bob-bank-period-balance-words", "aria-hidden": hide }, balance.words);
    if (words) node.appendChild(words);
  } else {
    const amount = statsEl(doc, "span", {
      class: "bob-bank-period-balance-amount",
      "aria-hidden": hide,
      "data-negative": balance.negative === true ? "true" : null,
    }, balance.amountText || "");
    if (amount) node.appendChild(amount);
    if (balance.asOfText) {
      const asOf = statsEl(doc, "span", {
        class: "bob-bank-period-balance-asof",
        "aria-hidden": hide,
        "data-stale": balance.state === "so_far" && balance.stale === true ? "true" : null,
      }, `· as of ${balance.asOfText}`);
      if (asOf) node.appendChild(asOf);
    }
  }
  if (balance.target && handlers && typeof handlers.openBalance === "function") {
    const target = balance.target;
    bankPeriodActivate(node, (newLeaf) => handlers.openBalance(target, newLeaf));
  }
  return node;
}
