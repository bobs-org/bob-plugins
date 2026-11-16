// Read-only subscription surfaces: record header facts, charge timeline,
// album summary card, and records-index pretty labels. All values come
// from `bob bank subscriptions -f json`; this fragment never writes notes.

const BANK_SUBSCRIPTION_ALBUM_PATH = /^subscriptions\.md$/i;
const BANK_SUBSCRIPTION_RECORD_PATH = /^subscriptions\/[^/]+\.md$/i;
const BANK_SUBSCRIPTION_STATUS_ORDER = ["to_cancel", "to_decide", "active", "cancelled"];
const BANK_SUBSCRIPTION_STATUS_LABELS = {
  to_cancel: "✂️ To cancel",
  to_decide: "🤔 To decide",
  active: "💚 Active",
  cancelled: "🚫 Cancelled",
};
const BANK_SUBSCRIPTION_CADENCE_KEYS = {
  monthly: "monthly",
  Monthly: "monthly",
  "a month": "monthly",
  four_weekly: "four_weekly",
  "every 4 weeks": "four_weekly",
  "Every 4 weeks": "four_weekly",
  quarterly: "quarterly",
  Quarterly: "quarterly",
  "a quarter": "quarterly",
  yearly: "yearly",
  Yearly: "yearly",
  "a year": "yearly",
};
const BANK_SUBSCRIPTION_FINDING_FALLBACKS = {
  bank_subscription_price: "The latest charge does not match the record amount.",
  bank_subscription_to_cancel_charged: "This record is marked to cancel and still charged.",
  bank_subscription_cancelled_charge: "A charge arrived after this record was cancelled.",
  bank_subscription_match_invalid: "A Shows-up-as needle is invalid.",
  bank_subscription_category_unknown: "The category is not a bank category.",
  bank_subscription_amount_invalid: "The amount is not a valid number.",
  bank_subscription_overlap: "Two records claim the same charge.",
};

function bankSubscriptionNotePath(value) {
  const path = typeof bankNormalizePath === "function"
    ? bankNormalizePath(value)
    : String((value && value.path) || value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  return path.replace(/\\/g, "/");
}

function bankSubscriptionIsAlbumPath(fileOrPath) {
  return BANK_SUBSCRIPTION_ALBUM_PATH.test(bankSubscriptionNotePath(fileOrPath));
}

function bankSubscriptionIsRecordPath(fileOrPath) {
  return BANK_SUBSCRIPTION_RECORD_PATH.test(bankSubscriptionNotePath(fileOrPath));
}

function bankSubscriptionIsAlbumSource(sourcePath, album) {
  if (bankSubscriptionIsAlbumPath(sourcePath) || bankSubscriptionIsAlbumPath(album && album.path)) {
    return true;
  }
  const noun = album && (album.noun || (album.record && album.record.noun));
  return String(noun || "").toLowerCase() === "subscription";
}

function bankSubscriptionEntries(report) {
  return report && Array.isArray(report.subscriptions) ? report.subscriptions : [];
}

function bankSubscriptionEntryByPath(report, path) {
  const want = bankSubscriptionNotePath(path);
  if (!want) return null;
  const wantStem = want.replace(/\.md$/i, "");
  for (const entry of bankSubscriptionEntries(report)) {
    const have = bankSubscriptionNotePath(entry && entry.path);
    if (!have) continue;
    if (have === want || have.replace(/\.md$/i, "") === wantStem) return entry;
  }
  return null;
}

function bankSubscriptionAmountPhrase(cents, cadence) {
  const money = typeof bankSubscriptionMoney === "function" ? bankSubscriptionMoney(cents) : null;
  const phrase = typeof bankSubscriptionCadencePhrase === "function"
    ? bankSubscriptionCadencePhrase(BANK_SUBSCRIPTION_CADENCE_KEYS[cadence] || cadence)
    : "";
  if (money && phrase) return `${money} ${phrase}`;
  return money || phrase || "";
}

function bankSubscriptionYearlyFromMonthly(monthlyCents) {
  if (!Number.isSafeInteger(monthlyCents)) return "";
  const yearly = monthlyCents * 12;
  if (!Number.isSafeInteger(yearly)) return "";
  const money = typeof bankSubscriptionMoney === "function" ? bankSubscriptionMoney(yearly) : null;
  return money ? `≈ ${money} a year` : "";
}

function bankSubscriptionTimelineAmber(bucket, priceChange, chargedFallback) {
  if (!bucket) return false;
  const since = priceChange && typeof priceChange.since === "string" ? priceChange.since : "";
  if (since && bucket.start && bucket.due && since >= bucket.start && since <= bucket.due) {
    return true;
  }
  return chargedFallback === true && bucket.state === "charged";
}

function bankSubscriptionTimelineDots(entry) {
  const buckets = entry && Array.isArray(entry.timeline) ? entry.timeline : [];
  const change = entry && entry.price_change ? entry.price_change : null;
  const since = change && typeof change.since === "string" ? change.since : "";
  const matched = Boolean(since && buckets.some((bucket) => (
    bucket && bucket.start && bucket.due && since >= bucket.start && since <= bucket.due
  )));
  let latestCharged = -1;
  if (!matched && change) {
    for (let index = buckets.length - 1; index >= 0; index -= 1) {
      if (buckets[index] && buckets[index].state === "charged") {
        latestCharged = index;
        break;
      }
    }
  }
  return buckets.map((bucket, index) => {
    const state = bucket && typeof bucket.state === "string" ? bucket.state : "";
    const kind = state === "charged" ? "charged"
      : state === "missed" ? "missed"
        : "faint";
    const start = bucket && bucket.start ? bucket.start : "";
    const due = bucket && bucket.due ? bucket.due : "";
    const startLabel = typeof bankSubscriptionShortDate === "function"
      ? bankSubscriptionShortDate(start) : start;
    const dueLabel = typeof bankSubscriptionShortDate === "function"
      ? bankSubscriptionShortDate(due) : due;
    const range = startLabel && dueLabel ? `${startLabel}–${dueLabel}` : (startLabel || dueLabel || "");
    const amber = bankSubscriptionTimelineAmber(bucket, change, index === latestCharged);
    return {
      state,
      kind,
      amber,
      start,
      due,
      title: [state || "bucket", range].filter(Boolean).join(" "),
    };
  });
}

function bankSubscriptionFindingFallback(code) {
  const key = String(code || "");
  if (BANK_SUBSCRIPTION_FINDING_FALLBACKS[key]) return BANK_SUBSCRIPTION_FINDING_FALLBACKS[key];
  return key ? "bob bank check reported a finding for this record." : "";
}

function bankSubscriptionFindingSentence(report, path) {
  const want = bankSubscriptionNotePath(path);
  const findings = report && Array.isArray(report.findings) ? report.findings : [];
  const hit = findings.find((finding) => (
    finding && bankSubscriptionNotePath(finding.path) === want && finding.message
  ));
  if (hit && hit.message) return String(hit.message);
  const entry = bankSubscriptionEntryByPath(report, path);
  const codes = entry && Array.isArray(entry.findings) ? entry.findings : [];
  return bankSubscriptionFindingFallback(codes[0]);
}

function bankSubscriptionHeaderModel(report, path) {
  if (!report) return { kind: "loading" };
  if (report.teaching_empty === true) return { kind: "teaching-empty" };
  if (report.command && report.command !== "subscriptions") return { kind: "invalid" };
  const entry = bankSubscriptionEntryByPath(report, path);
  if (!entry) return { kind: "missing" };
  const facts = [];
  const amount = bankSubscriptionAmountPhrase(entry.amount_cents, entry.cadence);
  if (amount) facts.push(amount);
  const yearly = bankSubscriptionYearlyFromMonthly(entry.monthly_cents);
  if (yearly) facts.push(yearly);
  const lastIso = entry.charges && entry.charges.latest && entry.charges.latest.date;
  const last = typeof bankSubscriptionShortDate === "function"
    ? bankSubscriptionShortDate(lastIso) : null;
  if (last) facts.push(`last ${last}`);
  const next = typeof bankSubscriptionShortDate === "function"
    ? bankSubscriptionShortDate(entry.next_expected) : null;
  if (next) facts.push(`next ≈ ${next}`);
  return {
    kind: "header",
    path: entry.path,
    title: entry.title || "",
    facts,
    factsText: facts.join(" · "),
    timeline: bankSubscriptionTimelineDots(entry),
    finding: bankSubscriptionFindingSentence(report, path),
  };
}

function bankSubscriptionStatusLabel(key, report) {
  for (const entry of bankSubscriptionEntries(report)) {
    if (entry && entry.status === key && entry.status_label) return entry.status_label;
  }
  return BANK_SUBSCRIPTION_STATUS_LABELS[key] || key;
}

function bankSubscriptionAlbumCardModel(report) {
  if (!report) return { kind: "loading" };
  if (report.teaching_empty === true) {
    return {
      kind: "teaching-empty",
      command: "subscriptions",
      teach: "Create a subscriptions album with bob albums create, then capture records as Name @subscriptions/.",
      commandHint: "bob albums create",
    };
  }
  if (report.command && report.command !== "subscriptions") {
    return { kind: "invalid", message: "bob bank subscriptions did not return this album." };
  }
  const totals = report.totals && typeof report.totals === "object" ? report.totals : {};
  const byStatus = totals.by_status && typeof totals.by_status === "object" ? totals.by_status : {};
  const statuses = BANK_SUBSCRIPTION_STATUS_ORDER.map((key) => {
    const item = byStatus[key] && typeof byStatus[key] === "object" ? byStatus[key] : {};
    return {
      key,
      count: Number.isInteger(item.count) ? item.count : 0,
      monthly_cents: Number.isSafeInteger(item.monthly_cents) ? item.monthly_cents : 0,
      label: bankSubscriptionStatusLabel(key, report),
    };
  }).filter((item) => item.count > 0);
  const ranked = bankSubscriptionEntries(report)
    .filter((entry) => (
      entry
      && entry.status !== "cancelled"
      && Number.isSafeInteger(entry.monthly_cents)
      && entry.monthly_cents > 0
    ))
    .slice()
    .sort((left, right) => (
      right.monthly_cents - left.monthly_cents
      || String(left.title || "").localeCompare(String(right.title || ""))
    ))
    .slice(0, 5);
  const max = ranked[0] ? ranked[0].monthly_cents : 0;
  const bars = ranked.map((entry) => ({
    title: entry.title || entry.stem || "",
    path: entry.path || "",
    monthly_cents: entry.monthly_cents,
    amount: typeof bankSubscriptionMoney === "function"
      ? bankSubscriptionMoney(entry.monthly_cents) : "",
    share: max > 0 ? entry.monthly_cents / max : 0,
  }));
  const findingsCount = Array.isArray(report.findings) ? report.findings.length : 0;
  return {
    kind: "card",
    monthly: typeof bankSubscriptionMoney === "function"
      ? bankSubscriptionMoney(totals.monthly_cents) : "",
    yearly: typeof bankSubscriptionMoney === "function"
      ? bankSubscriptionMoney(totals.yearly_cents) : "",
    monthly_cents: Number.isSafeInteger(totals.monthly_cents) ? totals.monthly_cents : 0,
    yearly_cents: Number.isSafeInteger(totals.yearly_cents) ? totals.yearly_cents : 0,
    estimateNote: "an estimate of commitments, not bank spend",
    statuses,
    bars,
    findingsCount,
    hiddenCancelled: Number.isInteger(report.hidden_cancelled) ? report.hidden_cancelled : 0,
  };
}

function bankSubscriptionCategoryMap(report) {
  const map = new Map();
  for (const entry of bankSubscriptionEntries(report)) {
    const category = entry && entry.category;
    if (!category || typeof category !== "object" || !category.key) continue;
    const key = String(category.key).toLowerCase();
    if (map.has(key)) continue;
    map.set(key, {
      key: category.key,
      emoji: category.emoji || "",
      label: category.label || category.key,
    });
  }
  return map;
}

function bankSubscriptionPrettyHeading(label, report) {
  const raw = typeof albumRecordsNormalizeLabel === "function"
    ? albumRecordsNormalizeLabel(label) : String(label || "").trim();
  if (!raw) return null;
  const hit = bankSubscriptionCategoryMap(report).get(raw.toLowerCase());
  if (!hit) return null;
  const pretty = [hit.emoji, hit.label].filter(Boolean).join(" ").trim();
  if (!pretty) return null;
  return { original: raw, pretty, emoji: hit.emoji, label: hit.label };
}

function bankSubscriptionParseAmountCents(text) {
  const raw = String(text || "").trim();
  const match = /^(?:\$)?(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return null;
  const dollars = Number(match[1]);
  const fraction = match[2] ? match[2].padEnd(2, "0") : "00";
  const cents = dollars * 100 + Number(fraction);
  return Number.isSafeInteger(cents) ? cents : null;
}

function bankSubscriptionPrettyFacets(facetText) {
  const raw = typeof albumRecordsNormalizeLabel === "function"
    ? albumRecordsNormalizeLabel(facetText) : String(facetText || "").trim();
  const trimmed = raw.replace(/^—\s*/, "");
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+·\s+/);
  let amountIndex = -1;
  let cadenceIndex = -1;
  let cadenceKey = "";
  let cents = null;
  for (let index = 0; index < parts.length; index += 1) {
    if (amountIndex < 0) {
      const parsed = bankSubscriptionParseAmountCents(parts[index]);
      if (parsed != null) {
        amountIndex = index;
        cents = parsed;
      }
    }
    const key = BANK_SUBSCRIPTION_CADENCE_KEYS[parts[index]];
    if (key) {
      cadenceIndex = index;
      cadenceKey = key;
    }
  }
  if (amountIndex < 0 || cadenceIndex < 0 || cents == null) return null;
  const pretty = bankSubscriptionAmountPhrase(cents, cadenceKey);
  if (!pretty) return null;
  const rest = parts.filter((_, index) => index !== amountIndex && index !== cadenceIndex);
  return { pretty, rest, cents, cadence: cadenceKey };
}

function bankSubscriptionIndexRowModel(entry, facetText) {
  const facets = bankSubscriptionPrettyFacets(facetText);
  const next = entry && typeof bankSubscriptionShortDate === "function"
    ? bankSubscriptionShortDate(entry.next_expected) : null;
  return {
    amountText: facets ? facets.pretty : "",
    rest: facets && Array.isArray(facets.rest) ? facets.rest : [],
    nextText: next ? `next ≈ ${next}` : "",
    nextDate: entry && entry.next_expected ? entry.next_expected : "",
  };
}

function bankSubscriptionHeaderSignature(model) {
  if (!model || model.kind !== "header") return model && model.kind ? model.kind : "";
  try {
    return JSON.stringify({
      facts: model.factsText,
      finding: model.finding || "",
      timeline: (model.timeline || []).map((dot) => [dot.state, dot.amber]),
    });
  } catch (_) {
    return model.factsText || "";
  }
}
