function articleDefaultSettings() {
  return { formatOnSave: true, formatOnLeave: true, bobPath: "" };
}

class BobArticleAdoptModal extends Modal {
  constructor(app, plugin, view, sent, formatted, changes, plan) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.sent = sent;
    this.formatted = formatted;
    this.changes = changes;
    this.plan = plan;
  }

  onOpen() {
    const content = this.contentEl;
    content.empty();
    content.createEl("h2", { text: "Convert note to article?" });
    content.createEl("p", { text: this.plan.notice || "Adopted as an article" });

    const diff = content.createEl("div", { cls: "bob-articles-adopt-diff" });
    for (const item of articleEditPreviewLines(this.sent, this.plan.edits)) {
      diff.createEl("div", {
        cls: `bob-articles-diff-${item.kind}`,
        text: item.kind === "remove" ? `− ${item.text}` : item.kind === "add" ? `+ ${item.text}` : item.text,
      });
    }

    const replaced = Array.isArray(this.plan.replaced) ? this.plan.replaced : [];
    const numbers = content.createEl("p", { cls: "bob-articles-replaced" });
    numbers.createEl("strong", { text: "Numbers replaced: " });
    numbers.appendText(
      replaced.length
        ? replaced.map((item) => `${item.token} → ${item.number}`).join(", ")
        : "none",
    );

    const buttons = content.createEl("div", { cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const convert = buttons.createEl("button", { text: "Convert", cls: "mod-cta" });
    convert.addEventListener("click", async () => {
      convert.disabled = true;
      const committed = await this.plugin.articleCommitAdoption(
        this.view,
        this.sent,
        this.formatted,
        this.changes,
        this.plan,
      );
      if (committed) this.close();
      else convert.disabled = false;
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class BobArticlesSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Bob Articles" });
    new Setting(containerEl)
      .setName("Format on save")
      .setDesc("Ask bob to format an article before saving it.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.formatOnSave)
        .onChange(async (value) => {
          this.plugin.settings.formatOnSave = value;
          await this.plugin.saveData(this.plugin.settings);
        }));
    new Setting(containerEl)
      .setName("Format when leaving the note")
      .setDesc("Format the saved article after it stops being active.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.formatOnLeave)
        .onChange(async (value) => {
          this.plugin.settings.formatOnLeave = value;
          await this.plugin.saveData(this.plugin.settings);
        }));
    new Setting(containerEl)
      .setName("bob path")
      .setDesc("Leave blank to find bob in its usual install locations or on PATH.")
      .addText((text) => text
        .setPlaceholder("Auto")
        .setValue(this.plugin.settings.bobPath)
        .onChange(async (value) => {
          this.plugin.settings.bobPath = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));
  }
}
