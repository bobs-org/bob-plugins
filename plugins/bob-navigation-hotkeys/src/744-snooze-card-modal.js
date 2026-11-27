// Snooze Card modal: time picker, ranked suggestions, consequence footer,
// snoozed actions, and shared close-key dispatch. Renders from the pure
// model (743) and the runtime controller (683/686); it adds no second
// writer. One card at a time; repeat Enter cannot commit twice.
class SnoozeCardModal extends Modal {
  constructor(app, plugin, options) {
    super(app);
    const settings = options && typeof options === "object" ? options : {};
    this.plugin = plugin || null;
    this.resolution = settings.resolution || null;
    this.facts = settings.facts && typeof settings.facts === "object" ? settings.facts : null;
    this.clock = settings.clock && typeof settings.clock === "object" ? settings.clock : null;
    this.taskTitle = String(settings.taskTitle || "task");
    this.onReturnToTaskCard = typeof settings.onReturnToTaskCard === "function" ? settings.onReturnToTaskCard : null;
    this.reviewAnchor = settings.reviewAnchor || null;
    this.mode = "timed";
    this.suggestions = Object.freeze([]);
    this.selectedIndex = -1;
    this.inputValue = "";
    this.settled = false;
    this.confirming = false;
    this.refreshTimer = null;
    this.inputEl = null;
    this.listEl = null;
    this.footerEl = null;
    this.hintEl = null;
    this.actionRowsEl = null;
    this.rowEls = [];
  }

  snoozeCardFacts() {
    try {
      if (this.plugin && typeof this.plugin.getSnoozeFactsProvider === "function") {
        const provider = this.plugin.getSnoozeFactsProvider();
        if (provider && typeof provider.cardFacts === "function") {
          return provider.cardFacts({ task: this.resolution && this.resolution.task });
        }
      }
    } catch (_) {}
    return this.facts;
  }

  snoozeCardClock() {
    if (this.clock && typeof this.clock.nowMinutes === "number") return this.clock;
    try {
      const facts = this.snoozeCardFacts();
      if (facts && Number.isInteger(facts.nowMinutes)) {
        return { date: facts.dateText, nowMinutes: facts.nowMinutes, zone: facts.zone, nowText: facts.nowText };
      }
    } catch (_) {}
    return this.clock;
  }

  snoozeCardEvents() {
    try {
      const facts = this.snoozeCardFacts();
      if (facts && Array.isArray(facts.events)) return facts.events;
    } catch (_) {}
    return [];
  }

  snoozeCardUsedTimes() {
    try {
      const facts = this.snoozeCardFacts();
      if (facts && Array.isArray(facts.usedTimesToday)) return facts.usedTimesToday;
      if (facts && facts.activeRow && Number.isInteger(facts.activeRow.minutes)) return [facts.activeRow.minutes];
    } catch (_) {}
    return [];
  }

  snoozeCardTaskFacts() {
    try {
      const facts = this.snoozeCardFacts();
      if (facts && facts.task) return facts.task;
      if (this.resolution && this.resolution.task) {
        const task = this.resolution.task;
        return { typeKey: task.type_key || task.typeKey || null, typeName: task.type_name || task.typeName || null, offClock: task.off_clock === true };
      }
    } catch (_) {}
    return null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bob-decay-card-modal");
    this.modalEl.addClass("bob-snooze-card-modal");
    if (typeof this.modalEl.setAttribute === "function") {
      this.modalEl.setAttribute("role", "dialog");
      this.modalEl.setAttribute("aria-modal", "true");
      this.modalEl.setAttribute("aria-label", "Snooze \"" + this.taskTitle + "\"");
    }
    contentEl.addClass("bob-decay-card");
    contentEl.addClass("bob-snooze-card");
    const header = contentEl.createDiv({ cls: "bob-decay-card-header" });
    const icon = header.createDiv({ cls: "bob-decay-card-icon" });
    try {
      if (typeof applyIcon === "function") applyIcon(icon, "alarm-clock");
    } catch (_) {}
    const headerText = header.createDiv({ cls: "bob-decay-card-header-text" });
    headerText.createDiv({
      cls: "bob-decay-card-title bob-key-card-title",
      text: "⏰ Snooze \"" + this.taskTitle + "\"",
    });
    const refusal = this.resolution && this.resolution.ok !== true ? this.resolution : null;
    if (refusal) {
      const detail = refusal.reason === "blocked" && this.resolution.task && this.resolution.task.blockedReason
        ? { refusal: refusal.refusal, reason: this.resolution.task.blockedReason }
        : { refusal: refusal.refusal, message: refusal.message };
      headerText.createDiv({
        cls: "bob-decay-card-subtitle",
        text: snoozeCardRefusalMessage(detail),
      });
      this.mode = "refusal";
    } else if (this.resolution && this.resolution.kind === "snoozed-row") {
      this.mode = "snoozed";
      let headerTextValue = "Snoozed";
      try {
        const facts = this.snoozeCardFacts();
        const row = (facts && facts.activeRow) || (this.resolution.row ? { hhmm: this.resolution.row.hhmm, minutes: this.resolution.row.minutes } : null);
        const display = row && row.hhmm ? String(row.hhmm).slice(0, 2) + ":" + String(row.hhmm).slice(2) : (Number.isInteger(row && row.minutes) ? snoozeCardDisplayMinutes(row.minutes) : null);
        const clock = this.snoozeCardClock();
        const inText = row && Number.isInteger(row.minutes) && clock ? snoozeCardInText(row.minutes, clock.nowMinutes) : null;
        headerTextValue = buildSnoozeCardSnoozedHeader({ display, inText, state: row && row.state, blockedReason: row && row.blockedReason });
      } catch (_) {}
      headerText.createDiv({ cls: "bob-decay-card-subtitle", text: headerTextValue });
    }
    const inputWrap = contentEl.createDiv({ cls: "bob-snooze-card-input-wrap" });
    this.inputEl = inputWrap.createEl("input", {
      cls: "bob-snooze-card-input",
      attr: {
        type: "text",
        placeholder: "15:30 or +45m",
        "aria-label": "Snooze time",
        autocomplete: "off",
        spellcheck: "false",
      },
    });
    this.inputEl.addEventListener("input", () => {
      this.inputValue = this.inputEl.value;
      this.refreshSuggestions({ preserveInput: true });
    });
    this.inputEl.addEventListener("keydown", (event) => this.handleCardKey(event));
    this.listEl = contentEl.createDiv({ cls: "bob-decay-card-rows bob-snooze-card-list", attr: { role: "listbox", "aria-label": "Snooze times" } });
    this.footerEl = contentEl.createDiv({ cls: "bob-decay-card-footer bob-key-card-footer bob-snooze-card-footer", attr: { "aria-live": "polite" } });
    this.hintEl = contentEl.createDiv({ cls: "bob-snooze-card-hint" });
    if (this.mode === "snoozed") {
      this.actionRowsEl = contentEl.createDiv({ cls: "bob-decay-card-rows bob-snooze-card-actions" });
      this.renderSnoozedActions();
    }
    contentEl.addEventListener("keydown", (event) => this.handleCardKey(event));
    this.refreshSuggestions({ preserveInput: false });
    this.startRefreshTimer();
    const win = this.snoozeCardWindow();
    if (win && typeof win.setTimeout === "function") {
      win.setTimeout(() => {
        try {
          if (this.inputEl && typeof this.inputEl.focus === "function") this.inputEl.focus();
        } catch (_) {}
      }, 0);
    }
  }

  snoozeCardWindow() {
    const modalDocument = this.containerEl && this.containerEl.ownerDocument;
    if (modalDocument && modalDocument.defaultView) return modalDocument.defaultView;
    return typeof window !== "undefined" ? window : null;
  }

  startRefreshTimer() {
    this.stopRefreshTimer();
    const win = this.snoozeCardWindow();
    const schedule = win && typeof win.setInterval === "function" ? win.setInterval.bind(win) : setInterval;
    try {
      this.refreshTimer = schedule(() => {
        if (this.settled) return;
        const authored = this.inputEl ? this.inputEl.value : this.inputValue;
        this.refreshSuggestions({ preserveInput: true, authored });
        this.refreshFooter();
      }, 30000);
    } catch (_) {
      this.refreshTimer = null;
    }
  }

  stopRefreshTimer() {
    if (this.refreshTimer === null || this.refreshTimer === undefined) return;
    try {
      const win = this.snoozeCardWindow();
      if (win && typeof win.clearInterval === "function") win.clearInterval(this.refreshTimer);
      else clearInterval(this.refreshTimer);
    } catch (_) {}
    this.refreshTimer = null;
  }

  refreshSuggestions(options) {
    const opts = options && typeof options === "object" ? options : {};
    const clock = this.snoozeCardClock();
    if (!clock) {
      this.suggestions = Object.freeze([]);
      this.selectedIndex = -1;
      this.renderSuggestions();
      this.refreshFooter();
      return;
    }
    let ranked = [];
    try {
      ranked = rankSnoozeSuggestions({
        events: this.snoozeCardEvents(),
        nowMinutes: clock.nowMinutes,
        date: clock.date,
        zone: clock.zone,
        usedTimesToday: this.snoozeCardUsedTimes(),
      }) || [];
    } catch (_) {
      ranked = [];
    }
    const authored = typeof opts.authored === "string" ? opts.authored : (this.inputEl ? this.inputEl.value : this.inputValue);
    if (opts.preserveInput === true && this.inputEl && typeof opts.authored === "string" && this.inputEl.value !== authored) {
      this.inputEl.value = authored;
    }
    this.inputValue = this.inputEl ? this.inputEl.value : String(authored || "");
    const typed = this.inputValue.trim();
    this.suggestions = ranked;
    if (typed === "") {
      this.selectedIndex = ranked.length > 0 ? 0 : -1;
    } else {
      const match = ranked.findIndex((item) => item && (item.input === typed || item.display === typed || item.label === typed));
      this.selectedIndex = match >= 0 ? match : -1;
    }
    this.renderSuggestions();
    this.refreshFooter();
  }

  renderSuggestions() {
    if (!this.listEl) return;
    this.listEl.empty();
    this.rowEls = this.suggestions.map((item, index) => {
      const rowEl = this.listEl.createDiv({
        cls: "bob-decay-card-row bob-key-card-row" + (index === this.selectedIndex ? " is-selected" : ""),
      });
      rowEl.setAttribute("role", "option");
      rowEl.setAttribute("aria-selected", index === this.selectedIndex ? "true" : "false");
      rowEl.setAttribute("aria-label", item.label);
      if (index === this.selectedIndex) rowEl.setAttribute("tabindex", "0");
      rowEl.createDiv({ cls: "bob-decay-card-key bob-key-card-key", text: item.group === "event" ? "◷" : item.group === "quick" ? "+" : "·" });
      const body = rowEl.createDiv({ cls: "bob-decay-card-body" });
      body.createDiv({ cls: "bob-decay-card-label", text: item.label });
      rowEl.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectedIndex = index;
        if (this.inputEl) {
          this.inputEl.value = item.input;
          this.inputValue = item.input;
        }
        this.renderSuggestions();
        this.refreshFooter();
        void this.confirmSelection();
      });
      return rowEl;
    });
  }

  renderSnoozedActions() {
    if (!this.actionRowsEl) return;
    this.actionRowsEl.empty();
    const blocked = this.resolution && this.resolution.task && (this.resolution.task.blocked === true || this.resolution.task.status === "?");
    const rows = [
      { id: "wake-now", label: "Wake now", detail: blocked ? "Unavailable while Blocked" : "Run bob snooze wake now", available: !blocked, key: "w" },
      { id: "unsnooze", label: "Unsnooze", detail: "Remove the row without changing the lane", available: true, key: "u" },
    ];
    for (const row of rows) {
      const rowEl = this.actionRowsEl.createDiv({
        cls: "bob-decay-card-row bob-key-card-row" + (row.available ? "" : " is-unavailable"),
      });
      rowEl.setAttribute("role", "button");
      rowEl.setAttribute("aria-label", row.available ? row.label + ": " + row.detail : row.label + " unavailable: " + row.detail);
      if (row.available) rowEl.setAttribute("tabindex", "0");
      else rowEl.setAttribute("aria-disabled", "true");
      rowEl.createDiv({ cls: "bob-decay-card-key bob-key-card-key", text: row.key });
      const body = rowEl.createDiv({ cls: "bob-decay-card-body" });
      body.createDiv({ cls: "bob-decay-card-label", text: row.label });
      body.createDiv({ cls: "bob-decay-card-detail", text: row.detail });
      if (row.available) {
        rowEl.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.confirmSnoozedAction(row.id);
        });
        rowEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            void this.confirmSnoozedAction(row.id);
          }
        });
      }
    }
  }

  currentValidTime() {
    const typed = (this.inputEl ? this.inputEl.value : this.inputValue).trim();
    const clock = this.snoozeCardClock();
    if (!clock) return { ok: false, refusal: "invalid" };
    if (typed !== "") {
      try {
        const parsed = snoozeParseWhen(typed, clock);
        if (parsed && parsed.ok === true) return parsed;
        return parsed || { ok: false, refusal: "invalid" };
      } catch (_) {
        return { ok: false, refusal: "invalid" };
      }
    }
    const selected = this.selectedIndex >= 0 ? this.suggestions[this.selectedIndex] : null;
    if (selected) {
      try {
        const parsed = snoozeParseWhen(selected.input, clock);
        if (parsed && parsed.ok === true) return parsed;
      } catch (_) {}
    }
    return { ok: false, refusal: "invalid" };
  }

  refreshFooter() {
    if (!this.footerEl) return;
    if (this.mode === "refusal") {
      this.footerEl.setText("Snooze unavailable — Esc to close");
      if (this.hintEl) this.hintEl.setText("");
      return;
    }
    const valid = this.currentValidTime();
    if (valid.ok !== true) {
      const message = snoozeCardInputMessage(valid);
      this.footerEl.setText("Enter a same-day time to snooze");
      if (this.hintEl) this.hintEl.setText(message || "");
      return;
    }
    if (this.hintEl) this.hintEl.setText("");
    let footerText = "at " + valid.value.hhmm.slice(0, 2) + ":" + valid.value.hhmm.slice(2);
    try {
      const facts = this.snoozeCardFacts();
      const taskFacts = this.snoozeCardTaskFacts();
      const clock = this.snoozeCardClock();
      const inText = clock ? snoozeCardInText(valid.value.minutes, clock.nowMinutes) : null;
      const departure = this.resolution && this.resolution.sourcePomodoro ? this.resolution.sourcePomodoro : null;
      const destination = (facts && facts.destination && facts.destination.name) || (taskFacts && (taskFacts.typeName || taskFacts.typeKey)) || null;
      const counts = facts && facts.counts ? facts.counts : null;
      footerText = buildSnoozeCardFooter({
        departure,
        destination,
        display: valid.value.hhmm.slice(0, 2) + ":" + valid.value.hhmm.slice(2),
        inText,
        nowCount: counts ? counts.count : null,
        nowCap: counts ? counts.cap : null,
        afterCount: null,
        afterCap: null,
        overCap: counts ? counts.over === true : false,
      }) || footerText;
    } catch (_) {}
    this.footerEl.setText(footerText);
  }

  handleCardKey(event) {
    if (!event || this.settled) return;
    const inInput = event.target === this.inputEl;
    const intent = resolveSnoozeCardKey(
      { kind: "snooze-card", inputActive: false },
      { ...event, inTextInput: false, target: inInput ? { tagName: "INPUT" } : event.target, inputActive: false },
    );
    if (!intent) {
      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        void this.confirmSelection();
      }
      return;
    }
    if (intent.type === "close-card") {
      event.preventDefault();
      event.stopPropagation();
      this.cancelCard();
      return;
    }
    if (intent.type === "ignored") return;
    if (intent.type === "move-selection") {
      event.preventDefault();
      event.stopPropagation();
      if (this.suggestions.length === 0) return;
      const delta = intent.direction === "previous" ? -1 : 1;
      const next = ((this.selectedIndex < 0 ? 0 : this.selectedIndex) + delta + this.suggestions.length) % this.suggestions.length;
      this.selectedIndex = next;
      this.renderSuggestions();
      this.refreshFooter();
      return;
    }
    if (intent.type === "complete-selection") {
      event.preventDefault();
      event.stopPropagation();
      const selected = this.selectedIndex >= 0 ? this.suggestions[this.selectedIndex] : this.suggestions[0];
      if (selected && this.inputEl) {
        this.inputEl.value = selected.input;
        this.inputValue = selected.input;
        this.refreshSuggestions({ preserveInput: true });
      }
      return;
    }
    if (intent.type === "confirm") {
      event.preventDefault();
      event.stopPropagation();
      void this.confirmSelection();
    }
  }

  cancelCard() {
    if (this.settled) return;
    this.settled = true;
    this.stopRefreshTimer();
    try {
      this.close();
    } catch (_) {}
    if (this.onReturnToTaskCard) {
      try {
        this.onReturnToTaskCard({ cancelled: true });
      } catch (_) {}
    }
  }

  async confirmSelection() {
    if (this.settled || this.confirming) return;
    if (this.mode === "refusal") return;
    const valid = this.currentValidTime();
    if (valid.ok !== true) {
      this.refreshFooter();
      return;
    }
    this.confirming = true;
    try {
      const outcome = await this.plugin.runSnoozeCommit(this.resolution, {
        action: "add",
        when: valid.value.hhmm,
        advanceReview: this.reviewAnchor ? { anchor: this.reviewAnchor } : undefined,
      });
      if (!outcome || outcome.ok !== true) {
        new Notice((outcome && outcome.message) || "Snooze cannot be made here");
        this.confirming = false;
        return;
      }
      this.settled = true;
      this.stopRefreshTimer();
      try {
        this.close();
      } catch (_) {}
      new Notice("⏰ Snoozed until " + valid.value.hhmm.slice(0, 2) + ":" + valid.value.hhmm.slice(2));
    } catch (error) {
      new Notice("Snooze cannot be made here");
      this.confirming = false;
    }
  }

  async confirmSnoozedAction(actionId) {
    if (this.settled || this.confirming) return;
    if (actionId === "unsnooze") {
      this.confirming = true;
      try {
        const outcome = await this.plugin.runSnoozeCommit(this.resolution, {
          action: "drop",
          advanceReview: this.reviewAnchor ? { anchor: this.reviewAnchor } : undefined,
        });
        if (!outcome || outcome.ok !== true) {
          new Notice((outcome && outcome.message) || "Unsnooze cannot be made here");
          this.confirming = false;
          return;
        }
        this.settled = true;
        this.stopRefreshTimer();
        try {
          this.close();
        } catch (_) {}
        new Notice("Unsnoozed — lane unchanged");
      } catch (_) {
        new Notice("Unsnooze cannot be made here");
        this.confirming = false;
      }
      return;
    }
    if (actionId === "wake-now") {
      this.confirming = true;
      try {
        const outcome = await this.plugin.wakeSnoozeNow(this.resolution, {});
        if (!outcome || outcome.ok !== true) {
          new Notice((outcome && outcome.message) || "Nothing woke; the row stays snoozed");
          this.confirming = false;
          return;
        }
        this.settled = true;
        this.stopRefreshTimer();
        try {
          this.close();
        } catch (_) {}
      } catch (_) {
        new Notice("Nothing woke; the row stays snoozed");
        this.confirming = false;
      }
    }
  }

  onClose() {
    this.settled = true;
    this.stopRefreshTimer();
    this.inputEl = null;
    this.listEl = null;
    this.footerEl = null;
    this.hintEl = null;
    this.actionRowsEl = null;
    this.rowEls = [];
  }
}
