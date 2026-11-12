// `bob-bank` month and queue cards. The renderer consumes only versioned
// bank JSON and delegates every write to the shared bank action service.

function bankCardAppend(parent, tag, attrs = {}, text = undefined) {
  const doc = statsDocFor(parent);
  const node = statsEl(doc, tag, attrs, text);
  if (node && parent && typeof parent.appendChild === "function") parent.appendChild(node);
  return node;
}

function bankCardClear(parent) {
  try {
    if (typeof parent.empty === "function") parent.empty();
    else if (typeof parent.replaceChildren === "function") parent.replaceChildren();
    else parent.textContent = "";
  } catch (error) {
    // A detached Markdown block may reject cleanup; it can render on retry.
  }
}

function bankCardListen(node, event, listener) {
  if (!node || typeof node.addEventListener !== "function" || typeof listener !== "function") return;
  node.addEventListener(event, listener);
}

function bankCardSetData(node, name, value) {
  try {
    if (node && typeof node.setAttribute === "function") node.setAttribute(`data-${name}`, String(value));
  } catch (error) {
    // Styling metadata is cosmetic.
  }
}

function bankCardPercent(value) {
  return `${(Math.max(0, Math.min(1, Number(value) || 0)) * 100).toFixed(1)}%`;
}

function bankCardDisplayCents(cents, explicitPlus = false) {
  const value = Number.isSafeInteger(cents) ? bankFormatCents(cents) : null;
  return value && !explicitPlus ? value.replace(/^\+/, "") : value;
}

class BobLedgerToolsBankCardsMixin {
  setupBankCards() {
    this.bankCardViews = new Set();
    if (typeof this.registerMarkdownCodeBlockProcessor === "function") {
      this.registerMarkdownCodeBlockProcessor("bob-bank", (source, el, ctx) =>
        this.renderBankCard(el, ctx, source),
      );
    }
  }

  teardownBankCards() {
    if (this.bankCardViews instanceof Set) {
      for (const view of Array.from(this.bankCardViews)) this.bankCardReleaseView(view);
      this.bankCardViews.clear();
    }
  }

  bankCardReleaseView(view) {
    if (!view || view.unloaded) return;
    view.unloaded = true;
    view.paintGeneration = (view.paintGeneration || 0) + 1;
    try { if (typeof view.unsubscribe === "function") view.unsubscribe(); } catch (error) {}
    try { if (typeof view.monthUnsubscribe === "function") view.monthUnsubscribe(); } catch (error) {}
    view.unsubscribe = null;
    view.monthUnsubscribe = null;
    if (this.bankCardViews instanceof Set) this.bankCardViews.delete(view);
  }

  renderBankCard(el, ctx, source) {
    if (!el) return;
    const fence = bankCardParseFence(source);
    if (!fence.ok) {
      bankCardClear(el);
      const error = bankCardAppend(el, "div", {
        class: "bob-bank-card-error",
        role: "alert",
        "aria-label": "Invalid bob-bank options",
      });
      if (error) {
        bankCardAppend(error, "strong", {}, "This bank card needs a valid view.");
        for (const message of fence.errors) bankCardAppend(error, "div", {}, message);
      }
      return;
    }
    const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
    let month = null;
    if (fence.view === "month") {
      const frontmatter = this.bankCardFrontmatter(sourcePath);
      const validated = bankCardValidateMonthFrontmatter(sourcePath, frontmatter && frontmatter.month);
      if (!validated.ok) {
        bankCardClear(el);
        const error = bankCardAppend(el, "div", { class: "bob-bank-card-error", role: "alert" }, validated.message);
        if (error) error.setAttribute("aria-label", "Invalid bank month note");
        return;
      }
      month = validated.month;
    }
    const view = {
      el,
      sourcePath,
      kind: fence.view,
      month,
      dataKey: bankCacheKey(fence.view === "month"
        ? bankBuildArgs({ command: "report", month })
        : bankBuildArgs({ command: "list" })),
      dataState: null,
      monthState: null,
      monthPaths: [],
      monthSignature: "",
      paintGeneration: 0,
      unloaded: false,
    };
    this.bankCardViewsStore().add(view);
    const release = () => this.bankCardReleaseView(view);
    if (ctx && typeof ctx.addChild === "function") {
      let child = null;
      try {
        if (typeof MarkdownRenderChild === "function") {
          child = new MarkdownRenderChild(el);
          child.onunload = release;
        }
      } catch (error) {
        child = null;
      }
      if (!child) child = { unload: release };
      try { ctx.addChild(child); } catch (error) {}
    }
    const spec = fence.view === "month"
      ? { command: "report", month }
      : { command: "list" };
    view.unsubscribe = this.apiBankSubscribe(spec, (state) => {
      if (view.unloaded) return;
      view.dataState = state;
      if (view.kind === "queue") this.bankCardSyncQueueMonths(view);
      void this.bankCardPaint(view);
    });
    if (view.kind === "queue") this.bankCardSyncQueueMonths(view);
  }

  bankCardViewsStore() {
    if (!(this.bankCardViews instanceof Set)) this.bankCardViews = new Set();
    return this.bankCardViews;
  }

  bankCardFrontmatter(path) {
    try {
      const vault = this.app && this.app.vault;
      const file = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(path)
        : null;
      const cacheApi = this.app && this.app.metadataCache;
      const cache = file && cacheApi && typeof cacheApi.getFileCache === "function"
        ? cacheApi.getFileCache(file)
        : cacheApi && typeof cacheApi.getCache === "function"
          ? cacheApi.getCache(path)
          : null;
      return cache && cache.frontmatter && typeof cache.frontmatter === "object"
        ? cache.frontmatter
        : null;
    } catch (error) {
      return null;
    }
  }

  bankCardMonthPaths() {
    try {
      return typeof this.apiBankMonthPaths === "function" ? this.apiBankMonthPaths() : [];
    } catch (error) {
      return [];
    }
  }

  bankCardSyncQueueMonths(view) {
    if (!view || view.unloaded || view.kind !== "queue") return;
    const paths = this.bankCardMonthPaths()
      .slice()
      .sort((left, right) => String(right.month).localeCompare(String(left.month)))
      .slice(0, 6);
    const signature = paths.map((entry) => `${entry.month}:${entry.path}`).join("|");
    if (signature === view.monthSignature) return;
    view.monthSignature = signature;
    view.monthPaths = paths;
    try { if (typeof view.monthUnsubscribe === "function") view.monthUnsubscribe(); } catch (error) {}
    view.monthUnsubscribe = null;
    view.monthState = null;
    if (paths.length === 0) return;
    const fetches = paths.map((entry) => ({ command: "report", month: entry.month }));
    view.monthUnsubscribe = this.apiBankSubscribe({ fetches }, (state) => {
      if (view.unloaded) return;
      view.monthState = state;
      void this.bankCardPaint(view);
    });
  }

  bankCardCurrentResult(view, state = view && view.dataState, key = view && view.dataKey) {
    try { return state && state.results && state.results[key] ? state.results[key] : null; } catch (error) { return null; }
  }

  async bankCardReadSource(path) {
    try {
      const vault = this.app && this.app.vault;
      const file = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(path)
        : null;
      if (!file || !vault || typeof vault.cachedRead !== "function") return null;
      const source = await vault.cachedRead(file);
      return typeof source === "string" ? source : null;
    } catch (error) {
      return null;
    }
  }

  async bankCardPaint(view) {
    if (!view || view.unloaded) return;
    const generation = (view.paintGeneration || 0) + 1;
    view.paintGeneration = generation;
    let source = null;
    let headingDates = new Set();
    if (view.kind === "month") {
      source = await this.bankCardReadSource(view.sourcePath);
      if (source !== null) {
        const scan = bankScanSource(view.sourcePath, source);
        headingDates = new Set(scan.days.map((day) => day.date));
      }
    }
    if (view.unloaded || view.paintGeneration !== generation) return;
    bankCardClear(view.el);
    const root = bankCardAppend(view.el, "section", {
      class: `bob-bank-card bob-bank-card-${view.kind}`,
      role: "region",
      "aria-label": view.kind === "month" ? "Bank month summary" : "Bank rows waiting for acknowledgment",
    });
    if (!root) return;
    const hue = this.bankCardRootHue(view.sourcePath);
    if (hue) root.setAttribute("data-root-hue", hue);
    const keyResult = this.bankCardCurrentResult(view);
    this.bankCardPaintRefreshState(root, keyResult, view, view.kind === "month"
      ? { command: "report", month: view.month }
      : { command: "list" });
    if (!keyResult || !keyResult.report) {
      this.bankCardPaintUnavailable(root, keyResult, view.kind);
      return;
    }
    if (keyResult.report.teaching_empty === true) {
      this.bankCardPaintTeaching(root);
      return;
    }
    if (view.kind === "month") {
      const model = bankCardMonthModel(keyResult.report, view.month, {
        headingDates,
        monthPaths: this.bankCardMonthPaths(),
      });
      if (model.kind === "invalid-report") {
        bankCardAppend(root, "p", { class: "bob-bank-card-error", role: "alert" }, model.message);
        return;
      }
      this.bankCardRenderMonth(root, view, model);
    } else {
      const monthReports = new Map();
      for (const entry of view.monthPaths) {
        const key = bankCacheKey(bankBuildArgs({ command: "report", month: entry.month }));
        const result = this.bankCardCurrentResult(view, view.monthState, key);
        monthReports.set(entry.month, result);
      }
      const model = bankCardQueueModel(keyResult.report, {
        monthPaths: view.monthPaths,
        monthReports,
      });
      if (model.kind === "invalid-report") {
        bankCardAppend(root, "p", { class: "bob-bank-card-error", role: "alert" }, model.message);
        return;
      }
      this.bankCardRenderQueue(root, view, model);
    }
  }

  bankCardRootHue(path) {
    const candidatePaths = [path, "bank.md"];
    for (const candidate of candidatePaths) {
      try {
        const file = this.app && this.app.vault && this.app.vault.getAbstractFileByPath(candidate);
        const cacheApi = this.app && this.app.metadataCache;
        const cache = file && cacheApi && typeof cacheApi.getFileCache === "function"
          ? cacheApi.getFileCache(file)
          : null;
        const hue = cache && cache.frontmatter && cache.frontmatter.color;
        if (BANK_CARD_HUES.includes(hue)) return hue;
      } catch (error) {}
    }
    return "magenta";
  }

  bankCardPaintRefreshState(root, result, view, options) {
    if (result && result.stale) {
      bankCardAppend(root, "div", { class: "bob-bank-card-status", role: "status" }, "Updating · last good values shown");
    }
    if (result && result.error) {
      const model = bankErrorModel(result.error);
      const line = bankCardAppend(root, "div", { class: "bob-bank-card-error", role: "status" });
      if (line) {
        bankCardAppend(line, "span", {}, `${model.title}: ${model.hint}`);
        if (model.retry) {
          const retry = bankCardAppend(line, "button", { type: "button", class: "bob-bank-retry" }, "Retry");
          bankCardListen(retry, "click", () => {
            void this.apiBankRefresh(options).then((next) => {
              if (next && next.error && !view.unloaded) new Notice(next.error.message || "Bank refresh failed");
            });
          });
        }
      }
    }
  }

  bankCardPaintUnavailable(root, result, kind) {
    if (result && result.error) {
      const model = bankErrorModel(result.error);
      bankCardAppend(root, "h2", {}, model.title);
      bankCardAppend(root, "p", {}, model.hint);
      return;
    }
    bankCardAppend(root, "p", { class: "bob-bank-loading", role: "status" },
      kind === "month" ? "Loading this month's bank report…" : "Loading rows to acknowledge…");
  }

  bankCardPaintTeaching(root) {
    const empty = bankCardAppend(root, "div", { class: "bob-bank-teaching" });
    if (!empty) return;
    bankCardAppend(empty, "h2", {}, "Start with the bank hub");
    bankCardAppend(empty, "p", {}, "Create bank.md and configure at least one account before these views can show totals.");
    bankCardAppend(empty, "code", {}, "bob bank list -f json");
  }

  bankCardAccounts(parent, accounts, options = {}) {
    const section = bankCardAppend(parent, "div", { class: "bob-bank-accounts", "aria-label": "Account status" });
    if (!section) return;
    bankCardAppend(section, "span", { class: "bob-bank-section-label" }, "Accounts");
    for (const account of Array.isArray(accounts) ? accounts : []) {
      const card = bankCardAppend(section, "div", { class: "bob-bank-account" });
      if (!card) continue;
      const label = account.label || account.alias || "Account";
      const status = account.status || "status unavailable";
      bankCardAppend(card, "span", { class: "bob-bank-account-name" }, label);
      bankCardAppend(card, "span", { class: `bob-bank-account-state bob-bank-state-${String(status).replace(/[^a-z0-9_-]/gi, "-")}` }, status);
      if (account.hint) bankCardAppend(card, "span", { class: "bob-bank-account-hint" }, account.hint);
      if (options.lastImport && account.last_import) {
        bankCardAppend(card, "span", { class: "bob-bank-account-import" }, `Last import ${account.last_import}`);
      } else if (options.lastImport) {
        bankCardAppend(card, "span", { class: "bob-bank-account-import" }, "No import yet");
      }
    }
  }

  bankCardMoney(parent, label, cents, options = {}) {
    const metric = bankCardAppend(parent, "div", { class: `bob-bank-metric${options.tone ? ` bob-bank-metric-${options.tone}` : ""}` });
    if (!metric) return;
    bankCardAppend(metric, "span", { class: "bob-bank-metric-label" }, label);
    const value = bankCardDisplayCents(cents, options.explicitPlus === true);
    bankCardAppend(metric, "strong", { class: "bob-bank-money" }, value || "—");
  }

  bankCardButton(parent, label, text, handler, options = {}) {
    const button = bankCardAppend(parent, "button", {
      type: "button",
      class: options.class || "bob-bank-button",
      "aria-label": label,
      title: options.title,
    }, text);
    if (button) {
      if (options.disabled) button.disabled = true;
      bankCardListen(button, "click", (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (!options.disabled && typeof handler === "function") void handler(event);
      });
    }
    return button;
  }

  bankCardRenderMonth(root, view, model) {
    const header = bankCardAppend(root, "header", { class: "bob-bank-card-header" });
    bankCardAppend(header, "h2", {}, model.title);
    if (model.soFar) bankCardAppend(header, "span", { class: "bob-bank-so-far" }, "so far");
    this.bankCardAccounts(root, model.accounts);
    const totals = bankCardAppend(root, "div", { class: "bob-bank-summary", "aria-label": "Month totals" });
    this.bankCardMoney(totals, "Out", model.totals.out_cents);
    this.bankCardMoney(totals, "In", model.totals.in_cents, { tone: "in", explicitPlus: true });
    this.bankCardMoney(totals, "Net", model.totals.net_cents, { tone: "net", explicitPlus: true });
    const counts = bankCardAppend(root, "div", { class: "bob-bank-counts" });
    const waitingText = `${model.waiting} waiting`;
    this.bankCardButton(counts, `Jump to first waiting bank row (${model.waiting})`, waitingText, () =>
      model.firstWaiting ? this.bankCardNavigateRow(model.firstWaiting) : false,
    { class: "bob-bank-pill bob-bank-waiting", disabled: !model.firstWaiting || model.waiting === 0 });
    bankCardAppend(counts, "span", { class: "bob-bank-pill bob-bank-flagged" }, `${model.flagged} flagged`);
    const categories = bankCardAppend(root, "section", { class: "bob-bank-breakdown", "aria-label": "Out by category" });
    bankCardAppend(categories, "h3", {}, "Out by category");
    for (const entry of model.breakdown) {
      const row = bankCardAppend(categories, "div", { class: "bob-bank-category" });
      bankCardAppend(row, "span", { class: "bob-bank-category-name" }, `${entry.emoji ? `${entry.emoji} ` : ""}${entry.label}`);
      const track = bankCardAppend(row, "span", {
        class: "bob-bank-category-track",
        role: "img",
        "aria-label": `${entry.label}: ${bankCardPercent(entry.share)} of Out`,
      });
      if (track) {
        const fill = bankCardAppend(track, "span", { class: "bob-bank-category-fill" });
        if (fill && fill.style) fill.style.width = bankCardPercent(entry.share);
      }
      bankCardAppend(row, "span", { class: "bob-bank-money" }, bankCardDisplayCents(entry.out_cents) || "—");
      bankCardAppend(row, "span", { class: "bob-bank-share" }, bankCardPercent(entry.share));
    }
    const extras = bankCardAppend(root, "div", { class: "bob-bank-extra-totals" });
    bankCardAppend(extras, "span", {}, `Unclassified: ${bankCardDisplayCents(model.totals.unclassified_out_cents) || "—"} out · ${bankCardDisplayCents(model.totals.unclassified_in_cents, true) || "—"} in`);
    if (model.totals.cash_out_cents > 0) {
      bankCardAppend(extras, "span", { class: "bob-bank-cash-note" }, `Cash out ${bankCardDisplayCents(model.totals.cash_out_cents)} · destination unknown`);
    }
    if (model.empty) {
      bankCardAppend(root, "p", { class: "bob-bank-empty-month" }, "Nothing posted in this month yet. Add a day heading, then type a checked row such as - [x] $13.71 Shop.");
    }
    this.bankCardRenderHeat(root, view, model);
    this.bankCardRenderMonthFooter(root, view, model);
  }

  bankCardRenderHeat(root, view, model) {
    const section = bankCardAppend(root, "section", { class: "bob-bank-heat-section", "aria-label": "Daily Out heat strip" });
    bankCardAppend(section, "h3", {}, "Daily Out");
    const grid = bankCardAppend(section, "div", { class: "bob-bank-heat-grid", role: "group", "aria-label": "Monday-first days of the month" });
    for (const label of model.heat.weekdays) bankCardAppend(grid, "span", { class: "bob-bank-weekday", "aria-hidden": "true" }, label.slice(0, 1));
    for (let index = 0; index < model.heat.leading; index += 1) bankCardAppend(grid, "span", { class: "bob-bank-heat-pad", "aria-hidden": "true" });
    for (const day of model.days) {
      const title = `${day.date} · Out ${bankCardDisplayCents(day.outCents) || "—"}${day.waiting ? ` · ${day.waiting} waiting` : ""}`;
      const button = this.bankCardButton(grid,
        day.hasHeading ? `Open ${day.heading || day.date}` : `${day.date}; no day heading in this note`,
        String(day.day),
        () => this.bankCardNavigateDay(view.sourcePath, day.date),
        { class: `bob-bank-heat-day bob-bank-heat-${day.bucket}${day.today ? " is-today" : ""}${day.waiting ? " has-waiting" : ""}`, disabled: !day.hasHeading, title },
      );
      if (button) {
        bankCardSetData(button, "heat", day.bucket);
        bankCardSetData(button, "date", day.date);
        if (day.waiting) bankCardAppend(button, "span", { class: "bob-bank-heat-waiting", "aria-hidden": "true" }, "•");
      }
    }
  }

  bankCardRenderMonthFooter(root, view, model) {
    const footer = bankCardAppend(root, "footer", { class: "bob-bank-card-footer" });
    const paths = model.monthPaths
      .filter((entry) => entry && entry.month && entry.month !== model.month)
      .slice()
      .sort((left, right) => left.month.localeCompare(right.month));
    const previous = paths.filter((entry) => entry.month < model.month).slice(-1)[0] || null;
    const next = paths.find((entry) => entry.month > model.month) || null;
    if (previous) this.bankCardOpenNoteLink(footer, `← ${previous.month}`, previous.path, view.sourcePath);
    else bankCardAppend(footer, "span", { class: "bob-bank-footer-muted" }, "No earlier month");
    if (this.bankCardHasHub()) this.bankCardOpenNoteLink(footer, "Bank hub", "bank.md", view.sourcePath);
    else bankCardAppend(footer, "span", { class: "bob-bank-footer-muted" }, "Bank hub missing");
    if (next) this.bankCardOpenNoteLink(footer, `${next.month} →`, next.path, view.sourcePath);
    else bankCardAppend(footer, "span", { class: "bob-bank-footer-muted" }, "No later month");
  }

  bankCardRenderQueue(root, view, model) {
    this.bankCardAccounts(root, model.accounts, { lastImport: true });
    if (model.empty) {
      bankCardAppend(root, "p", { class: "bob-bank-empty-queue", role: "status" }, "Nothing to acknowledge");
    }
    for (const day of model.days) {
      const group = bankCardAppend(root, "section", { class: "bob-bank-queue-day" });
      const header = bankCardAppend(group, "header", { class: "bob-bank-queue-day-header" });
      this.bankCardButton(header, `Open bank rows for ${day.date}`, day.heading || day.date,
        () => this.bankCardNavigateDay(day.path, day.date),
        { class: "bob-bank-day-link" },
      );
      const ackButton = this.bankCardButton(header,
        `Acknowledge ${day.ids.length} displayed imported rows for ${day.date}`,
        day.ids.length ? `Acknowledge ${day.ids.length} imported` : "No imported rows to acknowledge",
        () => this.bankCardAckSnapshot(day),
        { class: "bob-bank-ack-day", disabled: day.ids.length === 0 },
      );
      if (day.idLess > 0) {
        bankCardAppend(group, "p", { class: "bob-bank-idless-note" }, `${day.idLess} typed ${day.idLess === 1 ? "row needs" : "rows need"} its individual checkbox.`);
      }
      if (ackButton) bankCardSetData(ackButton, "ack-ids", day.ids.join(" "));
      for (const row of day.rows) this.bankCardRenderQueueRow(group, view, row);
    }
    this.bankCardRenderQueueFooter(root, view, model);
  }

  bankCardRenderQueueRow(parent, view, row) {
    const line = bankCardAppend(parent, "div", { class: "bob-bank-queue-row" });
    const label = bankCardAppend(line, "label", { class: "bob-bank-queue-row-label" });
    const checkbox = bankCardAppend(label, "input", {
      type: "checkbox",
      "aria-label": `Acknowledge ${row.payee} on ${row.date}`,
    });
    const cents = bankFormatCents(row.cents) || "—";
    bankCardAppend(label, "span", { class: "bob-bank-money" }, cents);
    bankCardAppend(label, "span", { class: "bob-bank-queue-payee" }, row.payee);
    if (row.category) bankCardAppend(label, "span", { class: "bob-bank-queue-category" }, row.category);
    const jump = this.bankCardButton(line, `Open ${row.payee} on ${row.date}`, `Line ${row.line}`,
      () => this.bankCardNavigateRow(row), { class: "bob-bank-row-link" });
    bankCardListen(checkbox, "change", async () => {
      if (!checkbox.checked || view.unloaded) return;
      checkbox.disabled = true;
      let result = null;
      try {
        if (row.id) {
          result = await this.apiBank().ackIds([row.id], { label: row.date });
        } else {
          result = await this.bankCardToggleIdLessRow(row);
        }
      } catch (error) {
        result = { ok: false };
      }
      if (!result || result.ok !== true) {
        checkbox.checked = false;
        checkbox.disabled = false;
        if (result && result.reason === "stale-snapshot") new Notice("Bank row changed. Refresh the queue and try again.");
      }
    });
    if (jump) bankCardSetData(jump, "line", row.line);
  }

  bankCardRenderQueueFooter(root, view, model) {
    const footer = bankCardAppend(root, "footer", { class: "bob-bank-card-footer bob-bank-queue-footer" });
    bankCardAppend(footer, "p", { class: "bob-bank-import-command" }, "Weekly import: bob bank import ~/Downloads/*.qfx");
    const months = bankCardAppend(footer, "div", { class: "bob-bank-recent-months", "aria-label": "Recent bank months" });
    bankCardAppend(months, "span", { class: "bob-bank-section-label" }, "Recent months");
    for (const entry of model.recentMonths) {
      const out = entry.outCents === null
        ? entry.error ? "Out unavailable" : "Out loading"
        : `Out ${bankCardDisplayCents(entry.outCents) || "—"}${entry.stale ? " · updating" : ""}`;
      const link = this.bankCardOpenNoteLink(months, `${entry.month} · ${out}`, entry.path, view.sourcePath);
      if (link && entry.error) link.setAttribute("title", bankErrorModel(entry.error).hint);
    }
    if (model.recentMonths.length === 0) bankCardAppend(months, "span", { class: "bob-bank-footer-muted" }, "No bank month notes yet");
  }

  bankCardHasHub() {
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.getAbstractFileByPath === "function" && vault.getAbstractFileByPath("bank.md")) return true;
      return this.bankCardMonthPaths().some((entry) => entry.path === "bank.md");
    } catch (error) {
      return false;
    }
  }

  bankCardOpenNoteLink(parent, label, path, sourcePath) {
    const note = String(path || "").replace(/\.md$/i, "");
    const link = bankCardAppend(parent, "a", {
      class: "bob-bank-note-link",
      href: `#${encodeURIComponent(note)}`,
      "aria-label": label,
    }, label);
    bankCardListen(link, "click", (event) => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      const workspace = this.app && this.app.workspace;
      try {
        if (workspace && typeof workspace.openLinkText === "function") {
          void workspace.openLinkText(note, sourcePath || "", false);
          return;
        }
        const file = this.app && this.app.vault && this.app.vault.getAbstractFileByPath(path);
        const leaf = workspace && typeof workspace.getLeaf === "function" ? workspace.getLeaf(false) : null;
        if (file && leaf && typeof leaf.openFile === "function") void leaf.openFile(file);
      } catch (error) {
        new Notice("Bank note could not be opened.");
      }
    });
    return link;
  }

  async bankCardNavigateDay(path, date) {
    const month = bankMonthFromPath(path);
    const source = month ? await this.bankCardReadSource(path) : null;
    const heading = source === null ? null : bankLocateDayHeading(source, month, date);
    if (!heading) {
      new Notice("Bank day heading is missing. Refresh the note before navigating.");
      return false;
    }
    return this.bankOpenMonthPathAtLine(path, heading.line);
  }

  async bankCardCurrentRow(path, row) {
    const source = await this.bankCardReadSource(path);
    const month = bankMonthFromPath(path);
    if (source === null || !month) return null;
    const heading = bankLocateDayHeading(source, month, row.date);
    const current = bankRecognizeRow(path, source, row.line);
    if (!heading || !current || current.date !== row.date || current.acknowledged || current.cents !== row.cents) return null;
    if (row.id) {
      const expected = bankNormalizeAckId(row.id);
      if (!expected || current.ackId !== expected) return null;
    } else if (current.ackId) {
      return null;
    }
    return { source, current };
  }

  async bankCardNavigateRow(row) {
    const current = await this.bankCardCurrentRow(row.path, row);
    if (!current) {
      new Notice("Bank row changed or moved. Refresh the card before navigating.");
      return false;
    }
    return this.bankOpenMonthPathAtLine(row.path, current.current.line);
  }

  async bankCardAckSnapshot(day) {
    const ids = bankCardDedupeIds(day && day.ids);
    if (!ids.length) return { ok: false, reason: "empty-selection" };
    return this.apiBank().ackIds(ids, { label: day.date, idLess: day.idLess });
  }

  async bankCardToggleIdLessRow(row) {
    const current = await this.bankCardCurrentRow(row.path, row);
    if (!current) return { ok: false, reason: "stale-snapshot" };
    const opened = await this.bankOpenMonthPathAtLine(row.path, current.current.line);
    if (!opened || this.bankActiveFilePath() !== row.path) return { ok: false, reason: "open-failed" };
    const editor = this.bankActiveEditor();
    if (!editor || typeof editor.getLine !== "function") return { ok: false, reason: "editor-unavailable" };
    const expected = current.current.spans && current.current.spans.line && current.current.spans.line.text;
    if (editor.getLine(current.current.line - 1) !== expected) return { ok: false, reason: "stale-snapshot" };
    return this.apiBank().toggleIdLessRowAtCursor(editor, expected);
  }
}
