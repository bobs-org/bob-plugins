// Inline subscription picker and create sheet for the bank Category card.
// Bob owns the subscription records; every write crosses its argv JSON API.

const BANK_SUBSCRIPTION_CADENCES = ["monthly", "four_weekly", "quarterly", "yearly"];

function bankSubscriptionPickerRecord(value) {
  if (!bankJsonObject(value)) return null;
  const path = bankSubscriptionRecordPath(value.path);
  const title = bankText(value.title);
  if (!path || !title || !path.startsWith("subscriptions/")) return null;
  const match = Array.isArray(value.match)
    ? value.match.filter((needle) => typeof needle === "string" && needle.trim()).map((needle) => needle.trim())
    : [];
  const category = bankJsonObject(value.category) && bankText(value.category.key)
    ? { key: value.category.key, label: bankText(value.category.label) || value.category.key }
    : null;
  return {
    path,
    stem: bankText(value.stem) || path.split("/").pop().replace(/\.md$/i, ""),
    title,
    status: bankText(value.status) || "",
    status_label: bankText(value.status_label) || bankText(value.status) || "",
    amount_cents: Number.isSafeInteger(value.amount_cents) && value.amount_cents >= 0 ? value.amount_cents : null,
    cadence: bankText(value.cadence) || "",
    pricing: bankText(value.pricing) || "",
    match,
    category,
    monthly_cents: Number.isSafeInteger(value.monthly_cents) ? value.monthly_cents : null,
  };
}

function bankSubscriptionPickerItems(values, query, row) {
  const needle = String(query || "").trim().toLocaleLowerCase();
  const payee = String(row && row.payee || "").toLocaleLowerCase();
  const cents = row && Number.isSafeInteger(row.cents) ? Math.abs(row.cents) : null;
  const entries = (Array.isArray(values) ? values : [])
    .map(bankSubscriptionPickerRecord)
    .filter(Boolean)
    .filter((entry) => !needle || entry.title.toLocaleLowerCase().includes(needle) ||
      entry.match.some((text) => text.toLocaleLowerCase().includes(needle)))
    .map((entry, index) => {
      const matched = Boolean(payee && entry.match.some((text) => payee.includes(text.toLocaleLowerCase())));
      const amountDistance = cents !== null && entry.amount_cents !== null
        ? Math.abs(cents - entry.amount_cents)
        : Number.MAX_SAFE_INTEGER;
      return { entry, index, matched, amountDistance, cancelled: entry.status === "cancelled" };
    });
  entries.sort((left, right) => Number(right.matched) - Number(left.matched) ||
    left.amountDistance - right.amountDistance || Number(left.cancelled) - Number(right.cancelled) ||
    left.entry.title.localeCompare(right.entry.title) || left.index - right.index);
  return entries.map((item) => ({ ...item.entry, matched: item.matched, amount_distance: item.amountDistance }));
}

function bankSubscriptionCandidateProposal(report, row) {
  const path = row && typeof row.path === "string" ? row.path : "";
  const line = row && Number.isInteger(row.line) ? row.line : null;
  const finding = (Array.isArray(report && report.findings) ? report.findings : []).find((item) =>
    item && item.code === "bank_subscription_candidate" && item.path === path && Number(item.line) === line &&
    bankJsonObject(item.proposal));
  return finding ? finding.proposal : null;
}

function bankSubscriptionAmountInput(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return "";
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function bankSubscriptionCreateStageInit(row, proposal, categories) {
  const source = bankJsonObject(proposal) ? proposal : {};
  const proposalMatches = Array.isArray(source.match)
    ? source.match.filter((value) => typeof value === "string" && value.trim())
    : [];
  const proposedCategory = typeof source.category === "string" ? source.category : "";
  const categoryKeys = new Set((Array.isArray(categories) ? categories : [])
    .filter((entry) => entry && typeof entry.key === "string")
    .map((entry) => entry.key));
  const rowCategory = row && typeof row.category === "string" ? row.category : "";
  const amountCents = Number.isSafeInteger(source.amount_cents) && source.amount_cents >= 0
    ? source.amount_cents
    : row && Number.isSafeInteger(row.cents) ? Math.abs(row.cents) : null;
  return {
    title: typeof source.title === "string" && source.title.trim()
      ? source.title.trim()
      : String(row && row.payee || ""),
    status: "to_decide",
    amount: bankSubscriptionAmountInput(amountCents),
    cadence: BANK_SUBSCRIPTION_CADENCES.includes(source.cadence) ? source.cadence : "monthly",
    match: proposalMatches.length ? proposalMatches[0].trim()
      : bankJsonObject(proposal) ? "" : String(row && row.payee || ""),
    category: categoryKeys.has(rowCategory) ? rowCategory
      : categoryKeys.has(proposedCategory) ? proposedCategory : "",
    focus: "title",
    error: "",
    applying: false,
  };
}

function bankSubscriptionCreateArgs(fields = {}) {
  const title = typeof fields.title === "string" ? fields.title.trim() : "";
  const amountText = typeof fields.amount === "string" ? fields.amount.trim() : String(fields.amount || "");
  const amountMatch = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(amountText);
  const cadence = typeof fields.cadence === "string" ? fields.cadence : "";
  const match = typeof fields.match === "string" ? fields.match.trim() : "";
  const category = typeof fields.category === "string" ? fields.category.trim() : "";
  if (!title) return { ok: false, code: "invalid-title", message: "Add a subscription title." };
  if (!amountMatch) return { ok: false, code: "invalid-amount", message: "Enter an amount with up to two decimal places." };
  const cents = Number(amountMatch[1]) * 100 + Number((amountMatch[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    return { ok: false, code: "invalid-amount", message: "Enter an amount greater than zero." };
  }
  if (!BANK_SUBSCRIPTION_CADENCES.includes(cadence)) {
    return { ok: false, code: "invalid-cadence", message: "Choose a subscription cadence." };
  }
  if (/[\r\n]/.test(title + amountText + match + category)) {
    return { ok: false, code: "invalid-field", message: "Subscription fields cannot contain line breaks." };
  }
  const args = ["records", "new", "subscription", title,
    "-s", "status=to_decide", "-s", `amount=${amountText}`, "-s", `cadence=${cadence}`];
  if (match) args.push("-s", `match=${match}`);
  if (category) args.push("-s", `category=${category}`);
  args.push("-f", "json");
  return { ok: true, args, amount_cents: cents };
}

function bankCategorySubscriptionWritePlan(input = {}) {
  const recordPath = bankSubscriptionRecordPath(input.recordPath);
  if (!recordPath || !recordPath.startsWith("subscriptions/") || recordPath.includes("..")) {
    return { ok: false, reason: "no-record", message: "Bank: no subscription to link" };
  }
  const base = bankCategoryWritePlan({ ...input, allowLinkOnly: true });
  if (!base.ok) return base;
  const resolved = bankCategoryResolveForCommit(input.capture, input.currentPath, input.currentSource);
  if (!resolved.ok) return resolved;
  const updated = bankCategoryApplyLineEdits(resolved.raw, base);
  if (typeof updated !== "string") {
    return { ok: false, reason: "bad-edit", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  const sourceLines = String(input.currentSource).replace(/^\uFEFF/, "").split("\n");
  sourceLines[resolved.line - 1] = updated;
  const updatedSource = sourceLines.join("\n");
  const current = bankCategoryCurrentToken(input.currentPath, updatedSource, resolved.line);
  if (!current || !current.token) {
    return { ok: false, reason: "not-a-row", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  const subscriptionLinks = (Array.isArray(current.token.links) ? current.token.links : [])
    .map(bankParseWikilinkSpan)
    .filter((link) => link && link.path.startsWith("subscriptions/"));
  if (subscriptionLinks.length > 1) {
    return { ok: false, reason: "multiple-subscriptions", message: "Bank: row has multiple subscription links" };
  }
  let linkedLine = updated;
  if (subscriptionLinks.length === 1) {
    const currentPath = bankSubscriptionRecordPath(subscriptionLinks[0].path);
    if (currentPath !== recordPath) {
      const link = bankSubscriptionWikilink(recordPath);
      linkedLine = bankCategoryApplyLineEdits(updated, {
        ok: true,
        edits: [{
          fromCh: subscriptionLinks[0].span.start,
          toCh: subscriptionLinks[0].span.end,
          insert: link,
        }],
      });
    }
  } else {
    const linkPlan = bankSubscriptionLinkWritePlan({
      currentPath: input.currentPath,
      currentSource: updatedSource,
      capture: bankCategoryCapture({ path: input.currentPath, line: resolved.line, lineText: updated }),
      recordPath,
    });
    if (!linkPlan.ok) return linkPlan;
    if (linkPlan.action !== "exists") linkedLine = bankCategoryApplyLineEdits(updated, linkPlan);
  }
  if (typeof linkedLine !== "string") {
    return { ok: false, reason: "bad-link-edit", message: BANK_CATEGORY_WRITE_REFUSAL };
  }
  if (linkedLine === resolved.raw) return { ...base, action: "noop", subscriptionPath: recordPath };
  return {
    ...base,
    action: "subscription-link",
    subscriptionPath: recordPath,
    edits: [{ line: resolved.line, fromCh: 0, toCh: resolved.raw.length, insert: linkedLine }],
  };
}

function bankSubscriptionContextLine(subscription) {
  if (!bankJsonObject(subscription)) return "";
  const parts = ["🔁", bankText(subscription.title)];
  const status = bankText(subscription.status_label) || bankText(subscription.status);
  if (status) parts.push(status);
  const amount = Number.isSafeInteger(subscription.amount_cents)
    ? String(bankFormatCents(subscription.amount_cents) || "").replace(/^\+/, "") : null;
  const cadence = bankSubscriptionCadencePhrase(subscription.cadence);
  if (amount) parts.push(`${amount} ${cadence}`.trim());
  if (subscription.state === "drift" && Number.isSafeInteger(subscription.drift_cents)) {
    const drift = bankSubscriptionSignedMoney(subscription.drift_cents);
    if (drift) parts.push(`${drift} vs record`);
  }
  return parts.filter(Boolean).join(" · ");
}

function bankSubscriptionPickerStatus(item) {
  const amount = Number.isSafeInteger(item && item.amount_cents)
    ? String(bankFormatCents(item.amount_cents) || "").replace(/^\+/, "") : "amount unknown";
  const cadence = bankSubscriptionCadencePhrase(item && item.cadence);
  return [item && (item.status_label || item.status), amount && `${amount} ${cadence}`.trim()]
    .filter(Boolean).join(" · ");
}

(function installBankSubscriptionLinkerStage() {
  if (typeof BankCategoryCardModal !== "function") return;
  const proto = BankCategoryCardModal.prototype;

  proto.shouldPassSubscriptionStageKey = function shouldPassSubscriptionStageKey(event) {
    if (!event || (!this.subscriptionPicker && !this.subscriptionCreateStage)) return false;
    const target = event.target;
    const input = Boolean(target && typeof target.closest === "function" && target.closest("input,select,textarea"));
    if (!input) return false;
    const key = typeof event.key === "string" ? event.key : "";
    if (key === "Escape" || key === "Enter") return false;
    if (key === "ArrowUp" || key === "ArrowDown") {
      return Boolean(this.subscriptionCreateStage && target.tagName === "SELECT");
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    return key.length === 1 || ["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"].includes(key);
  };

  proto.openSubscriptionPicker = async function openSubscriptionPicker() {
    if (this.closed || this.busy || this.waitingRefresh || this.summary || this.newStage) return false;
    this.didInteract = true;
    this.subscriptionPickerMessage = "";
    this.subscriptionPicker = { query: "", items: [], selected: 0, loading: true, error: "", album: null };
    this.subscriptionCreateStage = null;
    this.paint();
    try { this.contentEl?.focus?.(); } catch (_) {}
    const plugin = this.pluginRef;
    let result = null;
    try {
      result = plugin && typeof plugin.apiBankRefresh === "function"
        ? await plugin.apiBankRefresh({ command: "subscriptions" })
        : { error: { message: "Subscription report is unavailable." } };
    } catch (error) {
      result = { error: { message: error && error.message ? String(error.message) : "Subscription report failed." } };
    }
    const picker = this.subscriptionPicker;
    if (!picker || this.closed) return false;
    const report = result && result.report;
    picker.loading = false;
    picker.album = report && report.album ? report.album : null;
    picker.error = result && result.error && result.error.message ? String(result.error.message) : "";
    this.subscriptionReport = report || null;
    this.subscriptionProposal = bankSubscriptionCandidateProposal(report, this.cardRow());
    this.refreshSubscriptionPickerItems();
    this.paint();
    try {
      const input = this.contentEl?.querySelector?.("input[data-bank-subscription-query]");
      input?.focus?.();
    } catch (_) {}
    return true;
  };

  proto.refreshSubscriptionPickerItems = function refreshSubscriptionPickerItems() {
    const picker = this.subscriptionPicker;
    if (!picker) return [];
    const values = this.subscriptionReport && Array.isArray(this.subscriptionReport.subscriptions)
      ? this.subscriptionReport.subscriptions : [];
    picker.items = bankSubscriptionPickerItems(values, picker.query, this.cardRow());
    if (picker.items.length === 0) picker.selected = 0;
    else picker.selected = Math.max(0, Math.min(picker.selected || 0, picker.items.length - 1));
    return picker.items;
  };

  proto.closeSubscriptionPicker = function closeSubscriptionPicker() {
    if (!this.subscriptionPicker) return false;
    this.subscriptionPicker = null;
    this.subscriptionCreateStage = null;
    this.didInteract = true;
    this.paint();
    try { this.contentEl?.focus?.(); } catch (_) {}
    return true;
  };

  proto.openSubscriptionCreateStage = function openSubscriptionCreateStage() {
    const picker = this.subscriptionPicker;
    if (!picker || this.busy || this.closed) return false;
    if (picker.album === null) {
      this.subscriptionPickerMessage = "Create the Subscriptions album before adding records.";
      this.paint();
      return false;
    }
    this.subscriptionPickerMessage = "";
    this.subscriptionCreateStage = bankSubscriptionCreateStageInit(
      this.cardRow(), this.subscriptionProposal, this.categories,
    );
    this.paint();
    try { this.contentEl?.querySelector?.('input[data-bank-sub-field="title"]')?.focus?.(); } catch (_) {}
    return true;
  };

  proto.closeSubscriptionCreateStage = function closeSubscriptionCreateStage() {
    if (!this.subscriptionCreateStage) return false;
    this.subscriptionCreateStage = null;
    this.paint();
    try { this.contentEl?.querySelector?.("input[data-bank-subscription-query]")?.focus?.(); } catch (_) {}
    return true;
  };

  proto.moveSubscriptionPicker = function moveSubscriptionPicker(direction) {
    const picker = this.subscriptionPicker;
    if (!picker || !picker.items.length) return false;
    const delta = direction === "back" ? -1 : 1;
    picker.selected = (picker.selected + delta + picker.items.length) % picker.items.length;
    this.didInteract = true;
    this.paint();
    try { this.contentEl?.querySelector?.("input[data-bank-subscription-query]")?.focus?.(); } catch (_) {}
    return true;
  };

  proto.setSubscriptionPickerQuery = function setSubscriptionPickerQuery(value) {
    if (!this.subscriptionPicker) return false;
    const input = this.contentEl?.querySelector?.("input[data-bank-subscription-query]");
    const selection = input && Number.isInteger(input.selectionStart) ? input.selectionStart : String(value || "").length;
    this.subscriptionPicker.query = String(value || "");
    this.subscriptionPicker.selected = 0;
    this.refreshSubscriptionPickerItems();
    this.paint();
    try {
      const next = this.contentEl?.querySelector?.("input[data-bank-subscription-query]");
      next?.focus?.();
      next?.setSelectionRange?.(selection, selection);
    } catch (_) {}
    return true;
  };

  proto.chooseSubscriptionRecord = async function chooseSubscriptionRecord(record) {
    if (!record || !record.path || this.busy || !this.subscriptionPicker) return false;
    const row = this.cardRow();
    const categoryKey = row && typeof row.category === "string" && row.category
      ? row.category
      : record.category && record.category.key ? record.category.key : null;
    return this.choose(categoryKey, "pick", { subscriptionPath: record.path, title: record.title });
  };

  proto.routeSubscriptionPickerKey = async function routeSubscriptionPickerKey(event) {
    if (!this.subscriptionPicker || !event) return false;
    const key = bankCategoryUiEventKey(event);
    if (key === "Escape" || key === "Ctrl+[") {
      bankCategoryUiConsume(event);
      this.closeSubscriptionPicker();
      return true;
    }
    if (this.busy) {
      bankCategoryUiConsume(event);
      return true;
    }
    if (key === "ArrowDown" || key === "Ctrl+N") {
      bankCategoryUiConsume(event);
      this.moveSubscriptionPicker("forward");
      return true;
    }
    if (key === "ArrowUp" || key === "Ctrl+P") {
      bankCategoryUiConsume(event);
      this.moveSubscriptionPicker("back");
      return true;
    }
    if (key === "Enter") {
      bankCategoryUiConsume(event);
      if (bankCategoryChordShouldSwallow(this.chord, "Enter") || event.repeat === true) return true;
      const picker = this.subscriptionPicker;
      const item = picker && picker.items[picker.selected];
      if (item) await this.chooseSubscriptionRecord(item);
      return true;
    }
    if (key === "+") {
      bankCategoryUiConsume(event);
      this.openSubscriptionCreateStage();
      return true;
    }
    const target = event.target;
    const inQuery = Boolean(target && typeof target.closest === "function" &&
      target.closest("input[data-bank-subscription-query]"));
    if (inQuery) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      bankCategoryUiConsume(event);
      return true;
    }
    if (key.length === 1) {
      bankCategoryUiConsume(event);
      this.setSubscriptionPickerQuery(`${this.subscriptionPicker.query}${key}`);
      return true;
    }
    if (key === "Backspace") {
      bankCategoryUiConsume(event);
      this.setSubscriptionPickerQuery(this.subscriptionPicker.query.slice(0, -1));
      return true;
    }
    return false;
  };

  proto.routeSubscriptionCreateKey = async function routeSubscriptionCreateKey(event) {
    if (!this.subscriptionCreateStage || !event) return false;
    const key = bankCategoryUiEventKey(event);
    if (this.busy || this.subscriptionCreateStage.applying) {
      bankCategoryUiConsume(event);
      return true;
    }
    if (key === "Escape" || key === "Ctrl+[") {
      bankCategoryUiConsume(event);
      this.closeSubscriptionCreateStage();
      return true;
    }
    if (key === "Enter" || key === "Ctrl+Enter") {
      bankCategoryUiConsume(event);
      if ((key === "Ctrl+Enter" && bankCategoryLockActive(this.lock, Date.now())) ||
          bankCategoryChordShouldSwallow(this.chord, "Enter") || event.repeat === true) return true;
      await this.applySubscriptionCreateStage();
      return true;
    }
    if (key === "Tab") {
      return false;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      bankCategoryUiConsume(event);
      return true;
    }
    return false;
  };

  proto.onSubscriptionStageClick = function onSubscriptionStageClick(event) {
    const target = event && event.target;
    if (!target || typeof target.closest !== "function") return false;
    const newButton = target.closest("button[data-bank-subscription-new]");
    if (newButton && !newButton.disabled) {
      bankCategoryUiConsume(event);
      this.openSubscriptionCreateStage();
      return true;
    }
    const create = target.closest("button[data-bank-subscription-submit]");
    if (create && !create.disabled) {
      bankCategoryUiConsume(event);
      void this.applySubscriptionCreateStage();
      return true;
    }
    const record = target.closest("button[data-subscription-path]");
    if (record && !record.disabled) {
      bankCategoryUiConsume(event);
      const path = record.getAttribute("data-subscription-path");
      const item = this.subscriptionPicker?.items?.find((entry) => entry.path === path);
      if (item) void this.chooseSubscriptionRecord(item);
      return true;
    }
    return false;
  };

  proto.applySubscriptionCreateStage = async function applySubscriptionCreateStage() {
    const stage = this.subscriptionCreateStage;
    if (!stage || this.busy || this.closed || stage.applying) return false;
    const built = bankSubscriptionCreateArgs(stage);
    if (!built.ok) {
      stage.error = built.message;
      this.paint();
      return false;
    }
    stage.applying = true;
    stage.error = "";
    this.busy = true;
    this.paint();
    const plugin = this.pluginRef;
    let result = null;
    try {
      result = plugin && typeof plugin.apiBankCreateSubscription === "function"
        ? await plugin.apiBankCreateSubscription(stage)
        : { ok: false, message: "Subscription creation is unavailable." };
    } catch (error) {
      result = { ok: false, message: error && error.message ? String(error.message) : "Subscription creation failed." };
    }
    if (!result || result.ok !== true || !result.report || !result.report.path) {
      if (!this.closed && this.subscriptionCreateStage) {
        this.subscriptionCreateStage.applying = false;
        this.subscriptionCreateStage.error = result && result.message
          ? String(result.message) : "Subscription could not be created.";
        this.busy = false;
        this.paint();
      }
      return false;
    }
    const path = result.report.path;
    const title = stage.title.trim();
    const row = this.cardRow();
    const categoryKey = row && typeof row.category === "string" && row.category
      ? row.category
      : stage.category || null;
    this.subscriptionCreateStage = null;
    this.busy = false;
    if (this.closed) {
      const completed = plugin && typeof plugin.bankCategoryCommitSubscriptionDetached === "function"
        ? await plugin.bankCategoryCommitSubscriptionDetached(this, categoryKey, path, title)
        : false;
      if (!completed) new Notice(`Bank: created ${title}; the row could not be linked`);
      return completed;
    }
    await this.choose(categoryKey, "pick", { subscriptionPath: path, title });
    return true;
  };

  proto.paintSubscriptionContext = function paintSubscriptionContext(root) {
    if (this.subscriptionContext) {
      const text = bankSubscriptionContextLine(this.subscriptionContext);
      if (text) bankCategoryUiAppend(root, "div", "bob-bank-subscription-context", text, { role: "status" });
    } else if (this.subscriptionCandidate === true) {
      bankCategoryUiAppend(root, "div", "bob-bank-subscription-context is-candidate",
        "⟳ Possible subscription · / to link", { role: "status" });
    }
  };

  proto.paintSubscriptionPicker = function paintSubscriptionPicker(root) {
    const picker = this.subscriptionPicker;
    if (!picker) return;
    bankCategoryUiAppend(root, "h3", "bob-bank-category-group", "Link subscription");
    const query = bankCategoryUiAppend(root, "input", "bob-bank-subscription-query", null, {
      type: "search", "data-bank-subscription-query": "true", "aria-label": "Search subscriptions",
      placeholder: "Search by title or statement text", value: picker.query,
    });
    if (query) {
      query.value = picker.query;
      query.addEventListener?.("input", () => this.setSubscriptionPickerQuery(query.value));
    }
    if (picker.loading) {
      bankCategoryUiAppend(root, "p", "bob-bank-category-hint", "Loading subscriptions…", { role: "status" });
    } else if (picker.error) {
      bankCategoryUiAppend(root, "p", "bob-bank-category-hint", picker.error, { role: "status" });
    } else if (!picker.album) {
      bankCategoryUiAppend(root, "p", "bob-bank-category-hint",
        "No Subscriptions album yet. Create it with bob albums create bank subscriptions.", { role: "status" });
    } else if (picker.items.length === 0) {
      bankCategoryUiAppend(root, "p", "bob-bank-category-hint", "No matching subscriptions.", { role: "status" });
    }
    const list = bankCategoryUiAppend(root, "div", "bob-bank-subscription-options", null, {
      role: "listbox", "aria-label": "Subscriptions",
    });
    for (let index = 0; index < picker.items.length; index += 1) {
      const item = picker.items[index];
      const button = bankCategoryUiAppend(list, "button",
        `bob-bank-subscription-option${index === picker.selected ? " is-highlighted" : ""}`,
        null, {
          type: "button", role: "option", "aria-selected": index === picker.selected ? "true" : "false",
          "data-subscription-path": item.path,
        });
      if (!button) continue;
      button.disabled = this.busy;
      bankCategoryUiAppend(button, "span", "bob-bank-subscription-option-title", `🔁 ${item.title}`);
      const detail = bankSubscriptionPickerStatus(item);
      if (detail) bankCategoryUiAppend(button, "span", "bob-bank-subscription-option-detail", detail);
      if (item.matched) bankCategoryUiAppend(button, "span", "bob-bank-subscription-option-match", "matches row");
    }
    const create = bankCategoryUiAppend(root, "button", "bob-bank-subscription-create",
      "+ New subscription…", { type: "button", "data-bank-subscription-new": "true" });
    if (create) create.disabled = this.busy || picker.loading || !picker.album;
    if (this.subscriptionPickerMessage) {
      bankCategoryUiAppend(root, "p", "bob-bank-category-hint", this.subscriptionPickerMessage, { role: "status" });
    }
    bankCategoryUiAppend(root, "p", "bob-bank-category-keys",
      "↑↓ / Ctrl+N/P move · ↵ link · Esc back");
  };

  proto.paintSubscriptionCreateStage = function paintSubscriptionCreateStage(root) {
    const stage = this.subscriptionCreateStage;
    if (!stage) return;
    bankCategoryUiAppend(root, "h3", "bob-bank-category-group", "New subscription");
    const form = bankCategoryUiAppend(root, "div", "bob-bank-subscription-form", null, { role: "group" });
    const textField = (label, name, value, type = "text") => {
      const row = bankCategoryUiAppend(form, "label", "bob-bank-subscription-field");
      bankCategoryUiAppend(row, "span", "bob-bank-category-stage-caption", label);
      const input = bankCategoryUiAppend(row, "input", "bob-bank-category-stage-input", null, {
        type, "data-bank-sub-field": name, "aria-label": label,
      });
      if (input) {
        input.value = value || "";
        input.addEventListener?.("input", () => {
          if (!this.subscriptionCreateStage) return;
          this.subscriptionCreateStage[name] = input.value;
          this.subscriptionCreateStage.error = "";
          const button = this.contentEl?.querySelector?.("button[data-bank-subscription-submit]");
          if (button) button.disabled = this.busy || !bankSubscriptionCreateArgs(this.subscriptionCreateStage).ok;
        });
        input.addEventListener?.("focus", () => {
          if (this.subscriptionCreateStage) this.subscriptionCreateStage.focus = name;
        });
      }
      return input;
    };
    textField("Title", "title", stage.title);
    bankCategoryUiAppend(form, "div", "bob-bank-subscription-field",
      "🤔 To decide", { "aria-label": "Status" });
    textField("Amount", "amount", stage.amount, "text");
    const cadenceRow = bankCategoryUiAppend(form, "label", "bob-bank-subscription-field");
    bankCategoryUiAppend(cadenceRow, "span", "bob-bank-category-stage-caption", "Cadence");
    const cadence = bankCategoryUiAppend(cadenceRow, "select", "bob-bank-category-stage-input", null, {
      "data-bank-sub-field": "cadence", "aria-label": "Cadence",
    });
    for (const value of BANK_SUBSCRIPTION_CADENCES) {
      const option = bankCategoryUiAppend(cadence, "option", "", value.replace("_", " "), { value });
      if (option) option.selected = value === stage.cadence;
    }
    cadence?.addEventListener?.("change", () => {
      if (!this.subscriptionCreateStage) return;
      this.subscriptionCreateStage.cadence = cadence.value;
      this.subscriptionCreateStage.error = "";
      const button = this.contentEl?.querySelector?.("button[data-bank-subscription-submit]");
      if (button) button.disabled = this.busy || !bankSubscriptionCreateArgs(this.subscriptionCreateStage).ok;
    });
    textField("Shows up as", "match", stage.match);
    const categories = bankCategoryVisible(this.categories || []);
    const selectedHidden = stage.category && !categories.some((entry) => entry.key === stage.category);
    const categoryRow = bankCategoryUiAppend(form, "label", "bob-bank-subscription-field");
    bankCategoryUiAppend(categoryRow, "span", "bob-bank-category-stage-caption", "Category");
    const category = bankCategoryUiAppend(categoryRow, "select", "bob-bank-category-stage-input", null, {
      "data-bank-sub-field": "category", "aria-label": "Category",
    });
    const empty = bankCategoryUiAppend(category, "option", "", "No category", { value: "" });
    if (empty) empty.selected = !stage.category;
    if (selectedHidden) {
      const hidden = bankCategoryUiAppend(category, "option", "", `${stage.category} (hidden)`, { value: stage.category });
      if (hidden) hidden.selected = true;
    }
    for (const entry of categories) {
      const option = bankCategoryUiAppend(category, "option", "", bankCategoryTileLabel(entry), { value: entry.key });
      if (option) option.selected = entry.key === stage.category;
    }
    category?.addEventListener?.("change", () => {
      if (!this.subscriptionCreateStage) return;
      this.subscriptionCreateStage.category = category.value;
      this.subscriptionCreateStage.error = "";
    });
    if (stage.error) bankCategoryUiAppend(root, "p", "bob-bank-category-hint", stage.error, { role: "alert" });
    const create = bankCategoryUiAppend(root, "button", "bob-bank-subscription-create",
      stage.applying ? "Creating subscription…" : "Create and link", {
        type: "button", "data-bank-subscription-submit": "true",
      });
    if (create) create.disabled = stage.applying || this.busy || !bankSubscriptionCreateArgs(stage).ok;
    bankCategoryUiAppend(root, "p", "bob-bank-category-keys", "↵ create and link · Esc back");
  };

  proto.routeSubscriptionStageKey = async function routeSubscriptionStageKey(event) {
    if (this.subscriptionCreateStage) return this.routeSubscriptionCreateKey(event);
    if (this.subscriptionPicker) return this.routeSubscriptionPickerKey(event);
    return false;
  };
})();

if (typeof BobLedgerToolsBankCategoryMixin === "function") {
  BobLedgerToolsBankCategoryMixin.prototype.bankCategoryCommitSubscriptionDetached = async function bankCategoryCommitSubscriptionDetached(modal, categoryKey, recordPath, title) {
    const editor = modal && modal.editor;
    if (!editor || typeof editor.getValue !== "function") return false;
    const currentPath = this.bankActiveFilePath();
    const currentSource = editor.getValue();
    const plan = bankCategorySubscriptionWritePlan({
      mode: modal.mode,
      capture: modal.context && modal.context.capture,
      currentPath,
      currentSource,
      categoryKey,
      recordPath,
      allowLinkOnly: true,
    });
    if (!plan.ok || !this.bankCategoryApplyEdits(editor, plan)) {
      new Notice(`Bank: created ${title}; ${plan.message || "the row could not be linked"}`);
      return false;
    }
    await this.bankCategorySaveNote(modal);
    new Notice(`Bank: linked to ${title}`);
    return true;
  };
}

if (typeof BobLedgerToolsBankMarksMixin === "function") {
  BobLedgerToolsBankMarksMixin.prototype.bankSubscriptionCandidateActivate = function bankSubscriptionCandidateActivate(model) {
    if (!model || !model.rowPath || !Number.isInteger(model.rowLine)) return false;
    void (async () => {
      const opened = await this.bankOpenMonthPathAtLine(model.rowPath, model.rowLine, 0);
      if (!opened || this.bankActiveFilePath() !== model.rowPath) {
        new Notice("Bank: could not open the candidate row");
        return;
      }
      const editor = this.bankActiveEditor();
      if (!editor || typeof editor.setCursor !== "function") {
        new Notice("Bank: the candidate row is no longer open");
        return;
      }
      editor.setCursor({ line: model.rowLine - 1, ch: 0 });
      const view = { file: { path: model.rowPath }, editor };
      if (!this.bankCategoryOpenAtCursor(editor, view, "set", false)) {
        new Notice("Bank: could not open the Category card for this row");
        return;
      }
      const modal = this.bankCategoryModal;
      if (!modal || typeof modal.openSubscriptionPicker !== "function") {
        new Notice("Bank: subscription picker is unavailable");
        return;
      }
      await modal.openSubscriptionPicker();
    })().catch(() => new Notice("Bank: could not open the subscription picker"));
    return true;
  };
}

try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      bankSubscriptionPickerRecord,
      bankSubscriptionPickerItems,
      bankSubscriptionCandidateProposal,
      bankSubscriptionCreateStageInit,
      bankSubscriptionCreateArgs,
      bankCategorySubscriptionWritePlan,
      bankSubscriptionContextLine,
      bankSubscriptionPickerStatus,
    });
  }
} catch (_) {}
