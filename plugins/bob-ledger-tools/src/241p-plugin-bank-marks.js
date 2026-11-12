// Live Preview bank-row marks, math-dollar protection, the session
// toggle, the persistent stats.bank_marks setting, and hub-property
// hiding. Decorative marks never change note bytes or Source mode.

let bankMarksRefreshEffect = null;

function ensureBankMarksRefresh() {
  try {
    if (!bankMarksRefreshEffect && StateEffect && typeof StateEffect.define === "function") {
      bankMarksRefreshEffect = StateEffect.define({});
    }
    return bankMarksRefreshEffect;
  } catch (error) {
    return null;
  }
}

let BankAmountWidget = null;
let BankChipWidget = null;
let BankIdWidget = null;
let BankHeadingWidget = null;
let BankDollarWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  BankAmountWidget = class extends WidgetType {
    constructor(model) {
      super();
      this.model = model;
      this.key = model && model.amountDisplay ? model.amountDisplay : "";
    }
    eq(other) {
      return Boolean(other) && other instanceof BankAmountWidget && other.key === this.key;
    }
    toDOM() {
      return buildBankAmountElement(typeof document !== "undefined" ? document : null, this.model)
        || (typeof document !== "undefined" && document ? document.createElement("span") : null);
    }
    ignoreEvent() { return false; }
  };
  BankChipWidget = class extends WidgetType {
    constructor(kind, text) {
      super();
      this.kind = kind;
      this.text = text;
      this.key = `${kind}:${text}`;
    }
    eq(other) {
      return Boolean(other) && other instanceof BankChipWidget && other.key === this.key;
    }
    toDOM() {
      return buildBankChipElement(typeof document !== "undefined" ? document : null, this.kind, this.text)
        || (typeof document !== "undefined" && document ? document.createElement("span") : null);
    }
    ignoreEvent() { return true; }
  };
  BankIdWidget = class extends WidgetType {
    constructor() { super(); }
    eq(other) { return Boolean(other) && other instanceof BankIdWidget; }
    toDOM() {
      return buildBankIdElement(typeof document !== "undefined" ? document : null)
        || (typeof document !== "undefined" && document ? document.createElement("span") : null);
    }
    ignoreEvent() { return true; }
  };
  BankHeadingWidget = class extends WidgetType {
    constructor(model) {
      super();
      this.model = model;
      this.key = model ? `${model.date}:${model.label}:${model.waitingLabel || ""}` : "";
    }
    eq(other) {
      return Boolean(other) && other instanceof BankHeadingWidget && other.key === this.key;
    }
    toDOM() {
      return buildBankHeadingElement(typeof document !== "undefined" ? document : null, this.model)
        || (typeof document !== "undefined" && document ? document.createElement("span") : null);
    }
    ignoreEvent() { return true; }
  };
  BankDollarWidget = class extends WidgetType {
    constructor() { super(); }
    eq(other) { return Boolean(other) && other instanceof BankDollarWidget; }
    toDOM() {
      return buildBankDollarElement(typeof document !== "undefined" ? document : null)
        || (typeof document !== "undefined" && document ? document.createElement("span") : null);
    }
    ignoreEvent() { return true; }
  };
}

class BobLedgerToolsBankMarksMixin {
  setupBankMarks() {
    try {
      if (typeof this.bankMarksSessionEnabled !== "boolean") this.bankMarksSessionEnabled = true;
      this.bankMarksConfigLastEnabled = this.bankMarksConfigEnabled();
      this.applyMarkGateClass("bob-bank-marks", this.bankMarksEnabled());
      this.registerMarkGatePopoutSync("bob-bank-marks", () => this.bankMarksEnabled());
      if (typeof this.addCommand === "function") {
        this.addCommand({
          id: "toggle-bank-marks",
          name: "Toggle bank marks",
          callback: () => this.toggleBankMarks(),
        });
      }
      const extension = this.createBankMarkExtension();
      if (extension && typeof this.registerEditorExtension === "function") {
        this.registerEditorExtension(extension);
      }
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor((el, ctx) => this.renderBankMarksIn(el, ctx), 40);
      }
      this.bankMarkWireEvents();
      this.bankMarkSyncHubProperty();
    } catch (error) {}
  }

  bankMarksConfigEnabled() {
    try {
      return statsReadConfigValue("bank_marks") !== false;
    } catch (error) {
      return true;
    }
  }

  bankMarksEnabled() {
    if (typeof this.bankMarksConfigLastEnabled !== "boolean") {
      this.bankMarksConfigLastEnabled = this.bankMarksConfigEnabled();
    }
    return this.bankMarksSessionEnabled !== false && this.bankMarksConfigLastEnabled !== false;
  }

  bankMarksAvailable() {
    try {
      return Boolean(
        ViewPlugin && Decoration && WidgetType && StateEffect &&
        typeof StateEffect.define === "function" && RangeSetBuilder &&
        editorInfoField && editorLivePreviewField && BankDollarWidget,
      );
    } catch (error) {
      return false;
    }
  }

  createBankMarkExtension() {
    try {
      if (!this.bankMarksAvailable()) return null;
      if (!ViewPlugin || typeof ViewPlugin.fromClass !== "function" || !Prec || typeof Prec.highest !== "function") {
        return null;
      }
      const plugin = this;
      class BankMarkViewPlugin {
        constructor(view) {
          this.view = view;
          this.decorations = plugin.buildBankMarkDecorations(view);
        }
        update(update) {
          try {
            if (plugin.bankMarkShouldRebuild(update)) {
              this.decorations = plugin.buildBankMarkDecorations(update.view);
            }
          } catch (error) {}
          this.view = update && update.view ? update.view : this.view;
        }
      }
      return Prec.highest(ViewPlugin.fromClass(BankMarkViewPlugin, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  bankMarkShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") return false;
      if (update.docChanged || update.viewportChanged || update.selectionSet) return true;
      const refresh = ensureBankMarksRefresh();
      const transactions = update.transactions || [];
      for (const transaction of transactions) {
        const effects = transaction && transaction.effects;
        const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
        for (const effect of list) {
          if (refresh && effect && (effect === refresh || (typeof effect.is === "function" && effect.is(refresh)))) {
            return true;
          }
        }
      }
      if (editorLivePreviewField && update.startState && update.state) {
        try {
          if (update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField)) {
            return true;
          }
        } catch (error) {}
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  bankMarkSourcePath(view) {
    try {
      const info = editorInfoField && view && view.state ? view.state.field(editorInfoField, false) : null;
      return info && info.file && info.file.path ? info.file.path : "";
    } catch (error) {
      return "";
    }
  }

  bankMarkLivePreview(view) {
    try {
      return Boolean(editorLivePreviewField && view && view.state && view.state.field(editorLivePreviewField));
    } catch (error) {
      return false;
    }
  }

  bankMarkCatalogs() {
    try {
      const cached = this.bankLastGoodReport && this.bankLastGoodReport(bankCacheKey(bankBuildArgs({ command: "report" })));
      if (cached) return cached;
    } catch (error) {}
    try {
      if (this.bankMarkReport && this.bankMarkReport.categories) return this.bankMarkReport;
    } catch (error) {}
    return { categories: [], accounts: [] };
  }

  bankMarkReportForMonth(month) {
    try {
      if (this.bankMarkReports instanceof Map && month && this.bankMarkReports.has(month)) {
        return this.bankMarkReports.get(month);
      }
    } catch (error) {}
    return this.bankMarkReport || null;
  }

  buildBankMarkDecorations(view) {
    try {
      if (!view || !view.state || !RangeSetBuilder || !Decoration) {
        return Decoration.none;
      }
      if (!this.bankMarkLivePreview(view)) {
        return Decoration.none;
      }
      const path = this.bankMarkSourcePath(view);
      const month = bankMonthFromPath(path);
      if (!month) {
        return Decoration.none;
      }
      const doc = view.state.doc;
      const source = typeof doc.sliceString === "function" ? doc.sliceString(0) : String(doc);
      const tokens = bankTokenizeSource(path, source);
      const builder = new RangeSetBuilder();
      const selection = view.state.selection && view.state.selection.ranges ? view.state.selection.ranges : [];
      let tree = null;
      try { tree = typeof syntaxTree === "function" ? syntaxTree(view.state) : null; } catch (error) { tree = null; }
      const ranges = view.visibleRanges || [{ from: 0, to: doc.length }];
      const decorate = this.bankMarksEnabled();
      const catalogs = this.bankMarkCatalogs();
      const report = this.bankMarkReportForMonth(month.key);
      const adds = [];
      const inCode = (pos) => {
        try { return Boolean(tree && freshnessMarkPosInCode(tree, pos)); } catch (error) { return false; }
      };
      for (const row of tokens.rows) {
        const line = doc.line(row.line);
        if (!line) continue;
        if (ranges.every((range) => line.to < range.from || line.from > range.to)) continue;
        if (inCode(line.from + row.amount.start)) continue;
        const cursor = bankLineHasCursor(line.from, line.to, selection);
        if (decorate && !cursor && BankAmountWidget) {
          const model = bankRowPresentation(row, catalogs);
          if (model) {
            adds.push({
              from: line.from + row.amount.start,
              to: line.from + row.amount.end,
              spec: Decoration.replace({ widget: new BankAmountWidget(model) }),
            });
            if (row.category && row.category.span && BankChipWidget) {
              adds.push({
                from: line.from + row.category.span.start,
                to: line.from + row.category.span.end,
                spec: Decoration.replace({ widget: new BankChipWidget("cat", model.categoryLabel) }),
              });
            }
            if (row.account && row.account.span && BankChipWidget) {
              adds.push({
                from: line.from + row.account.span.start,
                to: line.from + row.account.span.end,
                spec: Decoration.replace({ widget: new BankChipWidget("acct", model.accountLabel) }),
              });
            }
            if (row.flagSpan && BankChipWidget) {
              adds.push({
                from: line.from + row.flagSpan.start,
                to: line.from + row.flagSpan.end,
                spec: Decoration.replace({ widget: new BankChipWidget("flag", "⚑") }),
              });
            }
            if (row.bankIdSpan && BankIdWidget) {
              adds.push({
                from: line.from + row.bankIdSpan.start,
                to: line.from + row.bankIdSpan.end,
                spec: Decoration.replace({ widget: new BankIdWidget() }),
              });
            }
            if (Decoration.line) {
              const hue = typeof this.bankCardRootHue === "function" ? this.bankCardRootHue(path) : "magenta";
              const classes = row.acknowledged ? "bob-bank-mark-acked" : "bob-bank-mark-waiting";
              adds.push({
                from: line.from,
                to: line.from,
                spec: Decoration.line({ class: classes, attributes: { "data-root-hue": hue } }),
              });
            }
          }
        } else if (BankDollarWidget) {
          for (const offset of row.dollars) {
            adds.push({
              from: line.from + offset,
              to: line.from + offset + 1,
              spec: Decoration.replace({ widget: new BankDollarWidget() }),
            });
          }
        }
      }
      if (decorate && BankHeadingWidget) {
        for (const heading of tokens.headings) {
          const line = doc.line(heading.line);
          if (!line) continue;
          if (inCode(line.from)) continue;
          if (bankLineHasCursor(line.from, line.to, selection)) continue;
          const model = bankHeadingPresentation(heading, bankReportDayFor(report, heading.date));
          if (!model) continue;
          adds.push({
            from: line.to,
            to: line.to,
            spec: Decoration.widget({ widget: new BankHeadingWidget(model), side: 1 }),
          });
        }
      }
      adds.sort((left, right) => left.from - right.from || left.to - right.to);
      for (const add of adds) {
        try { builder.add(add.from, add.to, add.spec); } catch (error) {}
      }
      return builder.finish();
    } catch (error) {
      try { return Decoration.none; } catch (inner) { return null; }
    }
  }

  bankMarkWireEvents() {
    try {
      if (this.bankMarkEventsWired) return;
      this.bankMarkEventsWired = true;
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(workspace.on("active-leaf-change", () => {
          this.bankMarkSyncHubProperty();
          this.bankMarkWatchActiveMonth();
        }));
        this.registerEvent(workspace.on("file-open", () => {
          this.bankMarkSyncHubProperty();
          this.bankMarkWatchActiveMonth();
        }));
        this.registerEvent(workspace.on("layout-change", () => this.bankMarkSyncHubProperty()));
      }
      const timers = this.bankTimerApi ? this.bankTimerApi() : null;
      if (timers && typeof timers.setInterval === "function") {
        this.bankMarksConfigTimer = timers.setInterval(() => this.bankMarksCheckConfig(), 60 * 1000);
        if (typeof this.registerInterval === "function") this.registerInterval(this.bankMarksConfigTimer);
      }
      this.bankMarkEnsureMonthSubscription();
      this.bankMarkWatchActiveMonth();
    } catch (error) {}
  }

  bankMarkWatchActiveMonth() {
    try {
      const path = this.bankMarkActivePath();
      const month = bankMonthFromPath(path);
      if (!month || typeof this.apiBankSubscribe !== "function") return;
      if (this.bankMarkMonthKey === month.key && this.bankMarkMonthUnsubscribe) return;
      if (typeof this.bankMarkMonthUnsubscribe === "function") this.bankMarkMonthUnsubscribe();
      this.bankMarkMonthKey = month.key;
      this.bankMarkReports = this.bankMarkReports instanceof Map ? this.bankMarkReports : new Map();
      this.bankMarkMonthUnsubscribe = this.apiBankSubscribe({ command: "report", month: month.key }, (state) => {
        try {
          const report = state && state.report ? state.report : null;
          this.bankMarkReport = report;
          if (report && report.period && report.period.key) this.bankMarkReports.set(report.period.key, report);
          this.refreshBankMarks();
        } catch (error) {}
      });
    } catch (error) {}
  }

  bankMarksCheckConfig() {
    try {
      const enabled = this.bankMarksConfigEnabled();
      if (enabled === this.bankMarksConfigLastEnabled) return false;
      this.bankMarksConfigLastEnabled = enabled;
      this.applyMarkGateClass("bob-bank-marks", this.bankMarksEnabled());
      this.refreshBankMarks();
      return true;
    } catch (error) {
      return false;
    }
  }

  bankMarkEnsureMonthSubscription() {
    try {
      if (this.bankMarkUnsubscribe) return;
      if (typeof this.apiBankSubscribe !== "function") return;
      this.bankMarkReports = this.bankMarkReports instanceof Map ? this.bankMarkReports : new Map();
      this.bankMarkUnsubscribe = this.apiBankSubscribe({ command: "report" }, (state) => {
        try {
          const report = state && state.report ? state.report : null;
          this.bankMarkReport = report;
          if (report && report.period && report.period.key) this.bankMarkReports.set(report.period.key, report);
          this.refreshBankMarks();
        } catch (error) {}
      });
    } catch (error) {}
  }

  bankMarkActivePath() {
    try {
      const workspace = this.app && this.app.workspace;
      const view = workspace && (workspace.getActiveViewOfType
        ? workspace.getActiveViewOfType(MarkdownView)
        : workspace.activeLeaf && workspace.activeLeaf.view);
      return view && view.file && view.file.path ? view.file.path : "";
    } catch (error) {
      return "";
    }
  }

  bankMarkSyncHubProperty() {
    try {
      const docs = typeof this.markGateDocuments === "function" ? this.markGateDocuments() : [typeof document !== "undefined" ? document : null];
      const active = bankIsHubPath(this.bankMarkActivePath());
      for (const doc of Array.isArray(docs) ? docs : []) {
        try {
          const body = doc && doc.body;
          if (!body || !body.classList) continue;
          if (active) body.classList.add("bob-bank-hub-note");
          else body.classList.remove("bob-bank-hub-note");
        } catch (error) {}
      }
      const workspace = this.app && this.app.workspace;
      const leaves = workspace && typeof workspace.getLeavesOfType === "function"
        ? workspace.getLeavesOfType("markdown") || []
        : [];
      for (const leaf of leaves) {
        try {
          const file = leaf && leaf.view && leaf.view.file;
          const hub = bankIsHubPath(file && file.path);
          const containers = [
            leaf && leaf.view && leaf.view.containerEl,
            leaf && leaf.view && leaf.view.contentEl,
            leaf && leaf.containerEl,
          ];
          for (const el of containers) {
            if (!el || !el.classList) continue;
            if (hub) el.classList.add("bob-bank-hub-note");
            else el.classList.remove("bob-bank-hub-note");
          }
        } catch (error) {}
      }
    } catch (error) {}
  }

  refreshBankMarks() {
    try {
      const workspace = this.app && this.app.workspace;
      const leaves = workspace && typeof workspace.getLeavesOfType === "function"
        ? workspace.getLeavesOfType("markdown") || []
        : [];
      const refresh = ensureBankMarksRefresh();
      for (const leaf of leaves) {
        try {
          const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
          if (refresh && cm && typeof cm.dispatch === "function") cm.dispatch({ effects: refresh.of(null) });
          const container = leaf && leaf.view && leaf.view.containerEl;
          const file = leaf && leaf.view && leaf.view.file;
          if (container) this.renderBankMarksIn(container, { sourcePath: file && file.path ? file.path : "" });
        } catch (error) {}
      }
      this.bankMarkSyncHubProperty();
    } catch (error) {}
  }

  toggleBankMarks() {
    try {
      this.bankMarksSessionEnabled = !this.bankMarksEnabled();
      this.applyMarkGateClass("bob-bank-marks", this.bankMarksEnabled());
      this.refreshBankMarks();
      try { new Notice(this.bankMarksEnabled() ? "Bank marks on" : "Bank marks off"); } catch (error) {}
      return this.bankMarksEnabled();
    } catch (error) {
      return Boolean(this.bankMarksEnabled());
    }
  }

  teardownBankMarks() {
    try {
      this.bankMarksSessionEnabled = false;
      if (typeof this.bankMarkUnsubscribe === "function") this.bankMarkUnsubscribe();
      this.bankMarkUnsubscribe = null;
      if (typeof this.bankMarkMonthUnsubscribe === "function") this.bankMarkMonthUnsubscribe();
      this.bankMarkMonthUnsubscribe = null;
      this.bankMarkReport = null;
      if (this.bankMarkReports instanceof Map) this.bankMarkReports.clear();
      const docs = typeof this.markGateDocuments === "function" ? this.markGateDocuments() : [];
      for (const doc of Array.isArray(docs) ? docs : []) {
        try {
          const root = doc && (doc.body || doc.documentElement);
          bankRestoreMarkHosts(root);
          if (root && root.classList) root.classList.remove("bob-bank-hub-note");
        } catch (error) {}
      }
      try {
        const workspace = this.app && this.app.workspace;
        const leaves = workspace && typeof workspace.getLeavesOfType === "function"
          ? workspace.getLeavesOfType("markdown") || []
          : [];
        for (const leaf of leaves) {
          const containers = [
            leaf && leaf.view && leaf.view.containerEl,
            leaf && leaf.view && leaf.view.contentEl,
            leaf && leaf.containerEl,
          ];
          for (const el of containers) {
            if (el && el.classList && typeof el.classList.remove === "function") {
              el.classList.remove("bob-bank-hub-note");
            }
          }
        }
      } catch (error) {}
      this.applyMarkGateClass("bob-bank-marks", false);
    } catch (error) {}
  }
}
