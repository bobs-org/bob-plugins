function mailDefaultSettings() {
  return { pasteToLink: true };
}

class BobMailSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Bob Mail" });
    new Setting(containerEl)
      .setName("Paste Gmail links as email links")
      .setDesc("Save a pasted Gmail URL and replace it with a link to its mail note.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.pasteToLink !== false)
        .onChange(async (value) => {
          this.plugin.settings.pasteToLink = Boolean(value);
          await this.plugin.saveData(this.plugin.settings);
        }));
  }
}

class BobMailPlugin extends Plugin {
  async onload() {
    this.settings = { ...mailDefaultSettings(), ...((await this.loadData()) || {}) };
    this.mailOldBobNoticed = false;
    this.mailPasteTimers = new Set();
    this.addSettingTab(new BobMailSettingTab(this.app, this));
    this.addCommand({
      id: "link-email",
      name: "Bob Mail: Link email…",
      checkCallback: (checking) => {
        const view = mailActiveMarkdownView(this.app);
        if (!view) return false;
        if (checking) return true;
        const snapshot = mailCreateEditorSnapshot(view);
        if (!snapshot) return false;
        new BobMailPickerModal(this.app, this, snapshot).open();
        return true;
      },
    });
    this.addCommand({
      id: "open-in-gmail",
      name: "Bob Mail: Open in Gmail",
      checkCallback: (checking) => {
        const context = mailEmailContext(this.app);
        if (!context || !mailGmailUrlFor(context)) return false;
        if (checking) return true;
        this.mailOpenGmail(context);
        return true;
      },
    });
    this.addCommand({
      id: "refresh-this-email",
      name: "Bob Mail: Refresh this email",
      checkCallback: (checking) => {
        const context = mailCurrentNote(this.app);
        if (!context) return false;
        if (checking) return true;
        void this.mailRefresh(context);
        return true;
      },
    });
    this.addCommand({
      id: "task-from-this-email",
      name: "Bob Mail: Task from this email",
      checkCallback: (checking) => {
        const context = mailEmailContext(this.app);
        if (!context) return false;
        if (checking) return true;
        void this.mailOpenTaskPrompt(context);
        return true;
      },
    });
    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.on === "function") {
      this.registerEvent(workspace.on("editor-paste", (event, editor, view) => {
        if (this.settings.pasteToLink === false) return;
        this.mailObservePaste(event, editor, view);
      }));
    }
  }

  onunload() {
    for (const timer of this.mailPasteTimers || []) clearTimeout(timer);
    if (this.mailPasteTimers) this.mailPasteTimers.clear();
  }

  mailBobResolution() {
    const ledger = mailLedgerBobPath(this.app);
    return mailResolveBobPath({ ledgerBobPath: ledger });
  }

  async mailCall(args, options = {}) {
    const result = await mailRunBob(this.mailBobResolution().path, args, {
      vaultPath: mailVaultPath(this.app),
      json: options.json !== false,
      execFile: options.execFile,
    });
    if (!result.ok) this.mailReportError(result);
    return result;
  }

  mailReportError(result) {
    if (result && result.oldBob) {
      if (!this.mailOldBobNoticed) {
        this.mailOldBobNoticed = true;
        new Notice("Update bob to use Bob Mail");
      }
      return;
    }
    new Notice(result && result.error || "Bob Mail command failed");
  }

  mailOpenGmail(context) {
    const url = mailGmailUrlFor(context);
    if (!url) return false;
    try {
      if (typeof openExternal === "function") openExternal(url);
      else if (typeof window !== "undefined" && typeof window.open === "function") window.open(url, "_blank");
      return true;
    } catch (error) {
      new Notice("Could not open Gmail");
      return false;
    }
  }

  async mailRefresh(context) {
    const result = await this.mailCall(["gmail", "save", context.file.path, "-f", "json"]);
    if (!result || !result.ok) return false;
    const row = result.document && result.document.results && result.document.results[0] || {};
    const added = Number(row.added_count) || 0;
    new Notice(added ? `Email refreshed · ${added} new message${added === 1 ? "" : "s"}` : "Email is up to date");
    return true;
  }

  async mailOpenTaskPrompt(context) {
    let text = "";
    const view = mailActiveMarkdownView(this.app);
    let blockId = null;
    if (view && view.file && view.file.path === context.file.path && view.editor) {
      const cursor = mailEditorPosition(view.editor, "head");
      if (cursor && typeof view.editor.getValue === "function") {
        blockId = mailFindCardMessageId(view.editor.getValue(), cursor.line);
      }
    } else if (this.app.vault && typeof this.app.vault.cachedRead === "function") {
      try {
        const markdown = await this.app.vault.cachedRead(context.file);
        blockId = mailFindCardMessageId(markdown, -1);
      } catch (error) {
        blockId = null;
      }
    }
    const frontmatter = context.frontmatter || {};
    const subject = String(frontmatter.title || context.file.basename || "email").trim();
    text = `Follow up: ${subject}`;
    const link = mailTaskLink(context, blockId);
    if (!link) return false;
    new BobMailTaskModal(this.app, this, context, text, link).open();
    return true;
  }

  async mailCaptureTask(text, link) {
    const result = await this.mailCall(["capture", "--", `${text} ${link}`], { json: false });
    if (!result || !result.ok) return false;
    new Notice("Task captured from email");
    return true;
  }

  mailObservePaste(event, editor, view) {
    let clipboard = null;
    try {
      clipboard = event && event.clipboardData;
      const raw = clipboard && typeof clipboard.getData === "function" ? clipboard.getData("text/plain") : "";
      const targetView = view || mailActiveMarkdownView(this.app);
      const snapshot = mailCreatePasteSnapshot(targetView, editor, raw);
      if (!snapshot) return;
      const timer = setTimeout(() => {
        this.mailPasteTimers.delete(timer);
        void this.mailFinishPaste(snapshot);
      }, 0);
      this.mailPasteTimers.add(timer);
    } catch (error) {
      // Leave the user's paste untouched when the editor event is incomplete.
    }
  }

  async mailFinishPaste(snapshot) {
    if (!mailPasteRangeIsCurrent(this.app, snapshot)) return false;
    const result = await this.mailCall(["gmail", "save", snapshot.url, "-f", "json"]);
    if (!result || !result.ok) return false;
    const link = result.document && result.document.link;
    if (!link || !mailReplacePasteRangeIfCurrent(this.app, snapshot, link)) return false;
    new Notice("Email saved and linked");
    return true;
  }
}
