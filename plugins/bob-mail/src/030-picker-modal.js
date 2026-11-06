class BobMailPickerModal extends Modal {
  constructor(app, plugin, snapshot) {
    super(app);
    this.plugin = plugin;
    this.snapshot = snapshot;
    this.query = "";
    this.rows = [];
    this.timer = null;
    this.generation = 0;
    this.input = null;
    this.resultsEl = null;
  }

  onOpen() {
    const content = this.contentEl;
    content.empty();
    content.createEl("h2", { text: "Link email" });
    this.input = content.createEl("input", { type: "text", placeholder: "Search Gmail" });
    this.input.setAttribute("aria-label", "Search Gmail");
    this.resultsEl = content.createEl("div", { cls: "bob-mail-picker-results" });
    this.input.addEventListener("input", () => {
      this.query = this.input.value || "";
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; void this.load(this.query); }, 300);
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && this.rows[0]) {
        event.preventDefault();
        void this.choose(this.rows[0]);
      }
    });
    this.input.focus();
    void this.load("");
  }

  onClose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.contentEl.empty();
  }

  async load(query) {
    const generation = ++this.generation;
    const args = ["gmail", "search"];
    if (String(query || "").trim()) args.push(String(query).trim());
    args.push("-f", "json");
    const result = await this.plugin.mailCall(args);
    if (generation !== this.generation || !this.resultsEl) return;
    this.rows = result && result.ok && result.document && Array.isArray(result.document.threads)
      ? result.document.threads : [];
    this.renderRows(result);
  }

  renderRows(result) {
    this.resultsEl.empty();
    if (!result || !result.ok) {
      this.resultsEl.createEl("p", { cls: "bob-mail-picker-empty", text: result && result.error || "No email results." });
      return;
    }
    if (!this.rows.length) {
      this.resultsEl.createEl("p", { cls: "bob-mail-picker-empty", text: "No matching email." });
      return;
    }
    for (const row of this.rows) {
      const button = this.resultsEl.createEl("button", { cls: "bob-mail-picker-row" });
      button.type = "button";
      const title = button.createEl("span", { cls: "bob-mail-picker-subject", text: String(row.subject || "(no subject)") });
      const details = button.createEl("span", { cls: "bob-mail-picker-details" });
      details.createEl("span", { text: String(row.who || "Unknown sender") });
      details.createEl("span", { text: mailRelativeDate(row.last_date) });
      details.createEl("span", { text: `${Number(row.messages) || 0} messages` });
      if (row.saved_note) details.createEl("span", { cls: "bob-mail-saved-chip", text: "saved" });
      button.setAttribute("aria-label", `${title.textContent} · ${row.who || "Unknown sender"}`);
      button.addEventListener("click", () => { void this.choose(row); });
    }
  }

  async choose(row) {
    const threadId = String(row && row.thread_id || "");
    if (!threadId) return;
    const result = await this.plugin.mailCall(["gmail", "save", threadId, "-f", "json"]);
    if (!result || !result.ok) return;
    const link = result.document && result.document.link;
    if (!link) {
      new Notice("Bob did not return an email link");
      return;
    }
    if (!mailInsertLinkIfCurrent(this.app, this.snapshot, link)) {
      new Notice("Email saved · editor changed, link not inserted");
      return;
    }
    this.close();
    new Notice(result.document.results && result.document.results[0] && result.document.results[0].status === "created"
      ? "Email saved and linked" : "Email linked");
  }
}
