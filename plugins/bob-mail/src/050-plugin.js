function mailDefaultSettings() {
  return { pasteToLink: true, undoSeconds: MAIL_COMPOSE_DEFAULT_UNDO_SECONDS };
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
    new Setting(containerEl)
      .setName("Undo seconds")
      .setDesc("Countdown before a confirmed send runs, with an Undo button. 0 sends at once.")
      .addText((text) => text
        .setPlaceholder("5")
        .setValue(String(mailComposeUndoSeconds(this.plugin.settings)))
        .onChange(async (value) => {
          this.plugin.settings.undoSeconds = mailComposeUndoSeconds({ undoSeconds: value });
          await this.plugin.saveData(this.plugin.settings);
        }));
  }
}

class BobMailPlugin extends Plugin {
  async onload() {
    this.settings = { ...mailDefaultSettings(), ...((await this.loadData()) || {}) };
    this.mailOldBobNoticed = false;
    this.mailPasteTimers = new Set();
    this.mailSendActive = false;
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
        if (context && mailGmailUrlFor(context)) {
          if (checking) return true;
          this.mailOpenGmail(context);
          return true;
        }
        if (checking) return this.mailHasTaskLinkHopShape();
        void this.mailOpenGmailAtCursor();
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
        if (context) {
          if (checking) return true;
          void this.mailOpenTaskPrompt(context);
          return true;
        }
        if (checking) return this.mailHasTaskLinkHopShape();
        void this.mailOpenTaskPromptAsync();
        return true;
      },
    });
    this.addCommand({
      id: "new-email",
      name: "Bob Mail: New email",
      checkCallback: (checking) => {
        if (checking) return true;
        new BobMailNewModal(this.app, this).open();
        return true;
      },
    });
    this.addCommand({
      id: "reply",
      name: "Bob Mail: Reply",
      checkCallback: (checking) => {
        const context = mailCurrentNote(this.app);
        if (!context) return false;
        if (checking) return true;
        void this.mailAddReply(false);
        return true;
      },
    });
    this.addCommand({
      id: "reply-all",
      name: "Bob Mail: Reply all",
      checkCallback: (checking) => {
        const context = mailCurrentNote(this.app);
        if (!context) return false;
        if (checking) return true;
        void this.mailAddReply(true);
        return true;
      },
    });
    this.addCommand({
      id: "save-draft",
      name: "Bob Mail: Save draft",
      checkCallback: (checking) => {
        const context = mailCurrentNote(this.app);
        if (!context) return false;
        if (checking) return true;
        void this.mailSaveDraft();
        return true;
      },
    });
    this.addCommand({
      id: "send",
      name: "Bob Mail: Send",
      checkCallback: (checking) => {
        const context = mailCurrentNote(this.app);
        if (!context) return false;
        if (checking) return true;
        void this.mailPreviewSend();
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
    this.mailGmailOpenKeymap = 0;
    this.mailVimMappingsRegistered = false;
    try {
      this.api = Object.freeze({
        mailOpen: Object.freeze({
          version: 1,
          openAtCursor: async (view) => this.mailOpenGmailAtCursor(view),
        }),
      });
    } catch (error) {
      this.api = null;
    }
    if (workspace && typeof workspace.onLayoutReady === "function") {
      workspace.onLayoutReady(() => {
        this.mailUpdateGmailOpenAvailability();
        if (this.registerMailVimMappings()) {
          this.mailUpdateGmailOpenAvailability();
          return;
        }
        const ref = workspace.on("active-leaf-change", () => {
          if (this.registerMailVimMappings()) {
            workspace.offref(ref);
          }
          this.mailUpdateGmailOpenAvailability();
        });
        this.registerEvent(ref);
      });
    }
  }

  mailNavigationDispatcherAvailable() {
    try {
      const holder = this.app && this.app.plugins && this.app.plugins.plugins;
      return Boolean(holder && holder["bob-navigation-hotkeys"]);
    } catch (error) {
      return false;
    }
  }

  mailUpdateGmailOpenAvailability() {
    try {
      if (this.mailVimMappingsRegistered === true || this.mailNavigationDispatcherAvailable()) {
        this.mailGmailOpenKeymap = 1;
        return true;
      }
      return this.mailGmailOpenKeymap === 1;
    } catch (error) {
      return false;
    }
  }

  mailHasTaskLinkHopShape() {
    try {
      const view = mailActiveMarkdownView(this.app);
      if (!view || !view.editor || typeof view.editor.getLine !== "function") return false;
      const cursor = mailEditorPosition(view.editor, "head");
      if (!cursor) return false;
      const lineText = view.editor.getLine(cursor.line);
      if (typeof lineText !== "string") return false;
      return mailTaskLinkHopTarget(lineText) !== null;
    } catch (error) {
      return false;
    }
  }

  async mailOpenGmailAtCursor(view) {
    try {
      const target = view && view.file && view.editor ? view : mailActiveMarkdownView(this.app);
      if (!target || !target.editor) return false;
      const context = await mailEmailContextAsync(this.app, target);
      if (!context || !mailGmailUrlFor(context)) return false;
      return this.mailOpenGmail(context);
    } catch (error) {
      return false;
    }
  }

  async mailOpenTaskPromptAsync(view) {
    try {
      const target = view && view.file && view.editor ? view : mailActiveMarkdownView(this.app);
      const context = await mailEmailContextAsync(this.app, target);
      if (!context) return false;
      return await this.mailOpenTaskPrompt(context);
    } catch (error) {
      return false;
    }
  }

  registerMailVimMappings() {
    if (this.mailVimMappingsRegistered) {
      return true;
    }
    try {
      const vim = window.CodeMirrorAdapter && window.CodeMirrorAdapter.Vim;
      if (!vim) {
        return false;
      }
      vim.defineAction("bobMailOpenGmail", () => this.handleMailVimOpenGmail());
      for (const key of ["<M-CR>", "<M-Enter>"]) {
        vim.mapCommand(key, "action", "bobMailOpenGmail", {}, {
          context: "normal",
        });
      }
      this.mailVimMappingsRegistered = true;
      this.mailGmailOpenKeymap = 1;
      return true;
    } catch (error) {
      return false;
    }
  }

  async handleMailVimOpenGmail() {
    try {
      const view = mailActiveMarkdownView(this.app);
      if (!view || !view.editor) return;
      const context = await mailEmailContextAsync(this.app, view);
      if (!context || !mailGmailUrlFor(context)) return;
      this.mailOpenGmail(context);
    } catch (error) {
      // Silent no-op: the chip's absence already said so.
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
    const message = result && result.error || "Bob Mail command failed";
    const hint = mailComposeErrorHint(result);
    new Notice(hint ? `${message}\n${hint}` : message);
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

  async mailSaveAllMarkdown() {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.iterateAllLeaves !== "function") return true;
    const views = [];
    try {
      workspace.iterateAllLeaves((leaf) => {
        if (leaf && leaf.view instanceof MarkdownView && leaf.view.file) views.push(leaf.view);
      });
    } catch (error) {
      return true;
    }
    for (const view of views) {
      try {
        if (typeof view.save === "function") await view.save();
      } catch (error) {
        return false;
      }
    }
    return true;
  }

  async mailOpenNoteAtCursor(notePath, cursor) {
    const path = String(notePath || "");
    if (!path) return false;
    try {
      const vault = this.app && this.app.vault;
      const file = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(path)
        : null;
      if (!file) {
        new Notice(`Email note is not in the vault: ${path}`);
        return false;
      }
      const workspace = this.app && this.app.workspace;
      const leaf = (workspace && typeof workspace.getLeaf === "function" && workspace.getLeaf(false))
        || (workspace && workspace.activeLeaf)
        || null;
      if (!leaf || typeof leaf.openFile !== "function") return false;
      await leaf.openFile(file);
      const line = cursor && Number.isInteger(cursor.line) ? cursor.line : 0;
      const ch = cursor && Number.isInteger(cursor.column) ? cursor.column : 0;
      const view = mailActiveMarkdownView(this.app) || (leaf.view && leaf.view.editor ? leaf.view : null);
      const editor = view && view.editor;
      if (editor && typeof editor.setCursor === "function") {
        editor.setCursor({ line, ch });
        if (typeof editor.focus === "function") editor.focus();
      }
      return true;
    } catch (error) {
      new Notice("Could not open the email note");
      return false;
    }
  }

  async mailCreateCompose(to, subject) {
    const result = await this.mailCall(mailNewComposeArgs({ to, subject }));
    if (!result || !result.ok) return false;
    const placed = mailNoteCursorPayload(result.document);
    if (!placed) {
      new Notice("Bob did not return the new email note");
      return false;
    }
    await this.mailOpenNoteAtCursor(placed.note, { line: placed.line, column: placed.column });
    return true;
  }

  async mailAddReply(replyAll) {
    const notePath = mailComposeNotePath(mailCurrentNote(this.app));
    if (!notePath) return false;
    await this.mailSaveAllMarkdown();
    const result = await this.mailCall(mailReplyComposeArgs(notePath, replyAll));
    if (!result || !result.ok) return false;
    const placed = mailNoteCursorPayload(result.document);
    if (!placed) {
      new Notice("Bob did not return the reply section");
      return false;
    }
    await this.mailOpenNoteAtCursor(placed.note, { line: placed.line, column: placed.column });
    return true;
  }

  async mailSaveDraft() {
    const notePath = mailComposeNotePath(mailCurrentNote(this.app));
    if (!notePath) return false;
    await this.mailSaveAllMarkdown();
    const result = await this.mailCall(mailDraftComposeArgs(notePath));
    if (!result || !result.ok) return false;
    const payload = mailPreviewPayload(result.document);
    new Notice(payload ? `Draft saved · ${payload.digest.slice(0, 12)}…` : "Draft saved");
    return true;
  }

  async mailPreviewSend() {
    const notePath = mailComposeNotePath(mailCurrentNote(this.app));
    if (!notePath) return false;
    await this.mailSaveAllMarkdown();
    const result = await this.mailCall(mailSendPreviewArgs(notePath));
    if (!result || !result.ok) return false;
    const final = mailFinalSendPayload(result.document);
    if (final && final.status === "already_sent") {
      new Notice("Already sent; local state reconciled.");
      return true;
    }
    const payload = mailPreviewPayload(result.document);
    if (!payload) {
      new Notice("Bob did not return a send preview");
      return false;
    }
    new BobMailSendModal(this.app, this, payload).open();
    return true;
  }

  // Holds the single send slot, offers Undo for `undoSeconds`, then sends
  // with the digest bound to the preview the modal rendered.
  async mailSendWithUndo(payload) {
    if (!payload || !payload.note || !payload.digest) return false;
    if (!mailTryBeginSend(this)) {
      new Notice("A send is already running");
      return false;
    }
    const seconds = mailComposeUndoSeconds(this.settings);
    let undo = null;
    let ticker = null;
    let remaining = seconds;
    const stopTicker = () => {
      if (ticker !== null) {
        try {
          clearInterval(ticker);
        } catch (error) {
          // The countdown already settled.
        }
        ticker = null;
      }
    };
    const notice = new Notice(
      mailUndoCountdownLabel(remaining),
      Math.max(1000, seconds * 1000 + 5000),
    );
    const hideNotice = () => {
      try {
        if (notice && typeof notice.hide === "function") notice.hide();
      } catch (error) {
        // The success or failure notice below carries the outcome.
      }
    };
    try {
      try {
        const container = notice && notice.noticeEl;
        if (container && typeof container.createEl === "function") {
          const button = container.createEl("button", { text: "Undo" });
          button.addEventListener("click", () => {
            if (undo) undo.cancel();
          });
        }
      } catch (error) {
        // The notice text still names the countdown without a button host.
      }
      if (seconds > 1 && typeof setInterval === "function") {
        ticker = setInterval(() => {
          remaining -= 1;
          try {
            if (typeof notice.setMessage === "function") notice.setMessage(mailUndoCountdownLabel(remaining));
          } catch (error) {
            // The countdown label is best effort.
          }
          if (remaining <= 0) stopTicker();
        }, 1000);
      }
      const proceed = await new Promise((resolve) => {
        undo = mailCreateSendUndo({
          seconds,
          onFire: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      stopTicker();
      if (!proceed) {
        hideNotice();
        new Notice("Send cancelled — the Gmail draft is kept");
        return false;
      }
      hideNotice();
      return await this.mailExecuteConfirmedSend(payload.note, payload.digest);
    } finally {
      stopTicker();
      mailEndSend(this);
    }
  }

  // Runs `bob gmail send -c <digest>` with the digest the modal rendered.
  // The slot is owned by mailSendWithUndo; a digest mismatch re-previews
  // instead of sending.
  async mailExecuteConfirmedSend(notePath, digest) {
    const result = await this.mailCall(mailSendConfirmArgs(notePath, digest));
    if (result && result.ok) {
      const final = mailFinalSendPayload(result.document);
      const status = final && final.status;
      if (status === "sent") {
        new Notice(`Sent${final.threadId ? ` in thread ${final.threadId}` : ""}`);
        return true;
      }
      if (status === "already_sent") {
        new Notice("Already sent; local state reconciled.");
        return true;
      }
      if (status === "recovered_to_draft") {
        new Notice("The prior send was not accepted; review a fresh preview before sending again.");
        return false;
      }
      new Notice(`Send status: ${status || "unknown"}`);
      return false;
    }
    if (mailIsDigestMismatch(result)) {
      new Notice("Email changed — review the new preview");
      const preview = await this.mailCall(mailSendPreviewArgs(notePath));
      if (preview && preview.ok) {
        const payload = mailPreviewPayload(preview.document);
        if (payload) {
          new BobMailSendModal(this.app, this, payload).open();
          return false;
        }
      }
      return false;
    }
    return false;
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
