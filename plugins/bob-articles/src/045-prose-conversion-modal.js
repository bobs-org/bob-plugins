class BobProseConversionModal extends Modal {
  constructor(app, plugin, view, context) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.context = context;
    this.plan = context.plan;
    this.confirming = false;
    this.previewTimer = null;
    this.previewGeneration = 0;
    this.statusMessage = "";
  }

  onOpen() {
    this.render();
    if (this.scope && typeof this.scope.register === "function") {
      this.scope.register([], "Escape", () => { this.close(); return false; });
      this.scope.register([], "q", (event) => {
        if (event && event.target === this.stemInput) return false;
        this.close();
        return false;
      });
      this.scope.register(["Ctrl"], "[", () => { this.close(); return false; });
      this.scope.register([], "Enter", () => { void this.confirm(); return false; });
    }
  }

  render() {
    const content = this.contentEl;
    content.empty();
    const extracting = this.context.command === "extract";
    content.createEl("h2", { text: extracting ? "Extract prose section?" : "Inline prose note?" });
    if (this.statusMessage) content.createEl("p", { cls: "bob-prose-conversion-status", text: this.statusMessage });
    if (this.plan.notice) content.createEl("p", { cls: "bob-prose-conversion-notice", text: this.plan.notice });
    if (this.plan.status === "refused") {
      const refusal = articleProseConversionRefusalText(this.plan);
      if (refusal) content.createEl("p", { cls: "bob-prose-conversion-refusal", text: refusal });
    }

    const summary = articleProseConversionSummary(this.plan);
    if (summary) content.createEl("p", { cls: "bob-prose-conversion-counts", text: summary });

    if (extracting) {
      const stem = content.createEl("label", { cls: "bob-prose-conversion-stem" });
      stem.createEl("span", { text: "New prose note name" });
      // bob-text: literal conversion note stem
      this.stemInput = stem.createEl("input", { type: "text", value: this.context.stem || "" });
      this.stemInput.addEventListener("input", () => {
        this.context.stem = this.stemInput.value;
        this.queueStemPreview();
      });
    } else {
      this.stemInput = null;
    }

    const findings = Array.isArray(this.plan.findings) ? this.plan.findings : [];
    if (findings.length) {
      const list = content.createEl("ul", { cls: "bob-prose-conversion-findings" });
      for (const finding of findings) {
        const parts = [finding.line ? `Line ${finding.line}` : "", finding.code || "", finding.message || ""]
          .filter(Boolean);
        list.createEl("li", { text: parts.join(" · ") });
      }
    }

    const host = extracting ? this.context.notePath : this.plan.focus && this.plan.focus.path;
    for (const change of Array.isArray(this.plan.changes) ? this.plan.changes : []) {
      const details = content.createEl("details", { cls: "bob-prose-conversion-change" });
      details.open = articleProseConversionSamePath(change.path, host);
      details.createEl("summary", { text: `${change.action || "update"}: ${change.path || "affected note"}` });
      details.createEl("pre", { text: change.diff || "No diff was returned." });
    }

    const buttons = content.createEl("div", { cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    this.confirmButton = buttons.createEl("button", {
      text: extracting ? "Extract" : "Inline",
      cls: "mod-cta",
    });
    this.confirmButton.disabled = this.plan.status !== "preview";
    this.confirmButton.addEventListener("click", () => { void this.confirm(); });
  }

  queueStemPreview() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    const generation = ++this.previewGeneration;
    const stem = String(this.context.stem || "").trim();
    this.previewTimer = setTimeout(async () => {
      this.previewTimer = null;
      const result = await this.plugin.articleRunProseConversion("extract", this.context.notePath, {
        line: this.context.line,
        name: stem,
      });
      if (generation !== this.previewGeneration) return;
      if (!result.ok) {
        this.plugin.articleReportProseConversionFailure(result);
        return;
      }
      this.context.plan = result.plan;
      this.plan = result.plan;
      this.statusMessage = result.plan.status === "preview" ? "" : articleProseConversionRefusalText(result.plan);
      this.render();
    }, 350);
  }

  updatePlan(plan, message = "") {
    this.plan = plan;
    this.context.plan = plan;
    this.statusMessage = message;
    this.render();
  }

  async confirm() {
    if (this.confirming || this.plan.status !== "preview") return;
    this.confirming = true;
    if (this.confirmButton) this.confirmButton.disabled = true;
    const closed = await this.plugin.articleConfirmProseConversion(this.context, this);
    if (closed) this.close();
    else {
      this.confirming = false;
      if (this.confirmButton && this.plan.status === "preview") this.confirmButton.disabled = false;
    }
  }

  onClose() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.contentEl.empty();
  }
}

function articleProseConversionSamePath(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const normalize = (path) => path.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
  return normalize(left) === normalize(right);
}
