class BobArticlesPlugin extends Plugin {
  async onload() {
    const stored = await this.loadData();
    this.settings = { ...articleDefaultSettings(), ...(stored || {}) };
    this.articleActiveSnapshot = null;
    this.articleUndoBlocked = new Set();
    this.articleFormatHistory = new Map();
    this.articleRefusalNotices = new Set();
    this.articleBobErrorNoticed = false;
    this.articleLeaveTimers = new Set();
    this.articleSaveCommand = null;

    this.addSettingTab(new BobArticlesSettingTab(this.app, this));
    this.addCommand({
      id: "format-article",
      name: "Format article",
      checkCallback: (checking) => {
        const view = this.articleActiveMarkdownView();
        if (!view || !articleHasArticleType(this.articleFrontmatter(view.file))) return false;
        if (checking) return true;
        void this.articleFormatActive(view, { save: true });
        return true;
      },
    });
    this.addCommand({
      id: "convert-to-article",
      name: "Convert note to article…",
      checkCallback: (checking) => {
        const view = this.articleActiveMarkdownView();
        if (!view || articleHasArticleType(this.articleFrontmatter(view.file))) return false;
        if (checking) return true;
        void this.articleAdoptActive(view);
        return true;
      },
    });

    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.on === "function") {
      for (const eventName of ["file-open", "active-leaf-change", "layout-change"]) {
        this.registerEvent(workspace.on(eventName, () => this.articleHandleActiveChange()));
      }
    }
    const metadataCache = this.app && this.app.metadataCache;
    if (metadataCache && typeof metadataCache.on === "function") {
      this.registerEvent(
        metadataCache.on("changed", () => this.articleRefreshViewClasses()),
      );
    }
    if (ArticleEditorView && ArticleEditorView.updateListener) {
      this.registerEditorExtension(
        ArticleEditorView.updateListener.of((update) => this.articleObserveEditorUpdate(update)),
      );
    }
    this.articleWrapSaveCommand();
    this.articleHandleActiveChange(true);
  }

  onunload() {
    if (this.articleSaveCommand && this.articleSaveCommand.command.callback === this.articleSaveCommand.wrapper) {
      this.articleSaveCommand.command.callback = this.articleSaveCommand.original;
    }
    for (const timer of this.articleLeaveTimers || []) clearTimeout(timer);
    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.getLeavesOfType === "function") {
      for (const leaf of workspace.getLeavesOfType("markdown")) {
        const element = leaf && leaf.view && leaf.view.containerEl;
        if (element && element.classList) {
          element.classList.remove("bob-article", "bob-article-serif");
        }
      }
    }
  }

  articleActiveMarkdownView() {
    const workspace = this.app && this.app.workspace;
    if (!workspace) return null;
    try {
      if (typeof workspace.getActiveViewOfType === "function") {
        const view = workspace.getActiveViewOfType(MarkdownView);
        if (view && view.file && view.editor) return view;
      }
      const leaf = typeof workspace.getMostRecentLeaf === "function" ? workspace.getMostRecentLeaf() : null;
      return leaf && leaf.view instanceof MarkdownView ? leaf.view : null;
    } catch (error) {
      return null;
    }
  }

  articleFrontmatter(file) {
    if (!file || !this.app || !this.app.metadataCache) return null;
    try {
      return this.app.metadataCache.getFileCache(file)?.frontmatter || null;
    } catch (error) {
      return null;
    }
  }

  articleSnapshot(view) {
    return view && view.file && view.editor
      ? { file: view.file, path: view.file.path, view }
      : null;
  }

  articleHandleActiveChange(initial = false) {
    const current = this.articleSnapshot(this.articleActiveMarkdownView());
    const previous = this.articleActiveSnapshot;
    if (
      !initial && previous && previous.path && (!current || previous.path !== current.path) &&
      articleHasArticleType(this.articleFrontmatter(previous.file))
    ) {
      this.articleQueueLeave(previous);
    }
    this.articleActiveSnapshot = current;
    this.articleRefreshViewClasses();
  }

  articleRefreshViewClasses() {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.getLeavesOfType !== "function") return;
    for (const leaf of workspace.getLeavesOfType("markdown")) {
      const view = leaf && leaf.view;
      const element = view && view.containerEl;
      if (!element || !element.classList) continue;
      const isArticle = view.file && articleHasArticleType(this.articleFrontmatter(view.file));
      element.classList.toggle("bob-article", Boolean(isArticle));
    }
  }

  articleWrapSaveCommand() {
    const commands = this.app && this.app.commands && this.app.commands.commands;
    const command = commands && commands["editor:save-file"];
    if (!command || typeof command.callback !== "function") return;
    const original = command.callback;
    const wrapper = async (...args) => {
      const view = this.articleActiveMarkdownView();
      try {
        if (view && this.settings.formatOnSave) await this.articleFormatView(view);
      } catch (error) {
        console.warn("Bob Articles could not format before save", error);
      }
      return original.apply(command, args);
    };
    command.callback = wrapper;
    this.articleSaveCommand = { command, original, wrapper };
  }

  articleObserveEditorUpdate(update) {
    const view = this.articleActiveMarkdownView();
    const path = view && view.file && view.file.path;
    if (!path || !update || !Array.isArray(update.transactions)) return;
    const history = this.articleFormatHistory.get(path);
    for (const transaction of update.transactions) {
      const event = String(
        (ArticleTransaction && ArticleTransaction.userEvent
          ? transaction.annotation(ArticleTransaction.userEvent)
          : "") || "",
      );
      if ((event === "undo" || event === "input.undo") && history) {
        const current = update.state.doc.toString();
        if (current === history.before) this.articleUndoBlocked.add(path);
      } else if (
        event === "paste" || event === "input.paste" ||
        event === "input" || event.startsWith("input.") || event.startsWith("delete.")
      ) {
        this.articleUndoBlocked.delete(path);
        this.articleFormatHistory.delete(path);
      }
    }
  }

  async articleFormatActive(view, options = {}) {
    await this.articleFormatView(view);
    if (options.save && view && typeof view.save === "function") {
      try { await view.save(); } catch (error) { console.warn("Bob Articles could not save the formatted note", error); }
    }
  }

  async articleFormatView(view) {
    if (!view || !view.file || !view.editor) return false;
    if (!articleHasArticleType(this.articleFrontmatter(view.file))) return false;
    const path = view.file.path;
    if (this.articleUndoBlocked.has(path)) return false;
    const sent = view.editor.getValue();
    const result = await this.articleRunPlan("format", path, sent);
    if (!result.ok) {
      this.articleReportRunFailure(result);
      return false;
    }
    const plan = result.plan;
    if (plan.status === "skipped" || plan.status === "error") {
      this.articleReportRefusal(path, plan);
      return false;
    }
    if (view.editor.getValue() !== sent) return false;
    let formatted;
    let changes;
    try {
      formatted = articleApplyEditsToText(sent, plan.edits);
      changes = articleBuildChanges(sent, plan.edits);
      if (articleApplyChangesToText(sent, changes) !== formatted) {
        throw new Error("article edits do not reproduce bob's plan");
      }
    } catch (error) {
      console.warn("Bob Articles received edits it could not apply", error);
      return false;
    }
    if (formatted !== sent && !this.articleDispatchChanges(view, sent, formatted, changes)) return false;
    if (formatted !== sent) this.articleFormatHistory.set(path, { before: sent, after: formatted });
    await this.articleApplyInbound(plan);
    if (plan.status === "changed") this.articleShowNotice(articleNoticeText(plan));
    return formatted !== sent;
  }

  articleDispatchChanges(view, before, formatted, changes) {
    const cm = view && view.editor && view.editor.cm;
    if (!cm || typeof cm.dispatch !== "function") {
      console.warn("Bob Articles needs the CodeMirror editor to apply a format safely.");
      return false;
    }
    try {
      const spec = { changes };
      if (ArticleTransaction && ArticleTransaction.userEvent) {
        spec.annotations = ArticleTransaction.userEvent.of("input");
      }
      cm.dispatch(spec);
      return view.editor.getValue() === formatted;
    } catch (error) {
      console.warn("Bob Articles could not apply the format transaction", error);
      return false;
    }
  }

  async articleAdoptActive(view) {
    if (!view || !view.file || !view.editor) return;
    const path = view.file.path;
    const sent = view.editor.getValue();
    const result = await this.articleRunPlan("adopt", path, sent);
    if (!result.ok) {
      this.articleReportRunFailure(result);
      return;
    }
    const plan = result.plan;
    if (plan.status === "skipped" || plan.status === "error") {
      this.articleReportRefusal(path, plan);
      return;
    }
    let formatted;
    let changes;
    try {
      formatted = articleApplyEditsToText(sent, plan.edits);
      changes = articleBuildChanges(sent, plan.edits);
      if (articleApplyChangesToText(sent, changes) !== formatted) throw new Error("invalid article plan edits");
    } catch (error) {
      this.articleReportRunFailure({ code: "bad-shape", message: "bob returned edits that could not be applied." });
      return;
    }
    new BobArticleAdoptModal(this.app, this, view, sent, formatted, changes, plan).open();
  }

  async articleCommitAdoption(view, sent, formatted, changes, plan) {
    if (!view || !view.editor || view.editor.getValue() !== sent) {
      this.articleShowNotice("The note changed while the preview was open. Reopen the preview to convert it.");
      return false;
    }
    if (formatted !== sent) {
      if (!this.articleDispatchChanges(view, sent, formatted, changes)) return false;
      this.articleFormatHistory.set(view.file.path, { before: sent, after: formatted });
    }
    await this.articleApplyInbound(plan);
    if (plan.status === "changed") this.articleShowNotice(articleNoticeText(plan));
    if (typeof view.save === "function") {
      try { await view.save(); } catch (error) { console.warn("Bob Articles could not save the adopted note", error); }
    }
    return true;
  }

  async articleApplyInbound(plan) {
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.process !== "function" || typeof vault.getAbstractFileByPath !== "function") return;
    const groups = new Map();
    for (const entry of plan.inbound || []) {
      if (!entry || typeof entry.path !== "string" || !Number.isInteger(entry.line) || entry.line < 1) continue;
      const group = groups.get(entry.path) || [];
      group.push(entry);
      groups.set(entry.path, group);
    }
    for (const [path, entries] of groups) {
      const file = vault.getAbstractFileByPath(path);
      if (!file) continue;
      try {
        await vault.process(file, (current) => {
          const lines = String(current).split("\n");
          let changed = false;
          for (const entry of entries) {
            const index = entry.line - 1;
            if (index >= lines.length || typeof entry.before !== "string" || typeof entry.after !== "string") continue;
            const raw = lines[index];
            const ending = raw.endsWith("\r") ? "\r" : "";
            if (raw.slice(0, raw.length - ending.length) !== entry.before) continue;
            lines[index] = entry.after + ending;
            changed = true;
          }
          return changed ? lines.join("\n") : current;
        });
      } catch (error) {
        console.warn(`Bob Articles could not update inbound links in ${path}`, error);
      }
    }
  }

  articleQueueLeave(snapshot) {
    if (!this.settings.formatOnLeave || !snapshot || !snapshot.file) return;
    const timer = setTimeout(() => {
      this.articleLeaveTimers.delete(timer);
      const active = this.articleActiveMarkdownView();
      if (active && active.file && active.file.path === snapshot.file.path) return;
      void this.articleFormatSavedFile(snapshot.file, snapshot.view);
    }, 100);
    this.articleLeaveTimers.add(timer);
  }

  async articleFormatSavedFile(file, previousView) {
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.read !== "function" || typeof vault.process !== "function") return;
    if (!articleHasArticleType(this.articleFrontmatter(file))) return;
    let sent;
    if (previousView && typeof previousView.save === "function") {
      try { await previousView.save(); } catch (error) { /* Read the saved file and keep the leave path best-effort. */ }
    }
    try { sent = await vault.read(file); } catch (error) { return; }
    const result = await this.articleRunPlan("format", file.path, sent);
    if (!result.ok) {
      this.articleReportRunFailure(result);
      return;
    }
    const plan = result.plan;
    if (plan.status === "skipped" || plan.status === "error") {
      this.articleReportRefusal(file.path, plan);
      return;
    }
    let formatted;
    try { formatted = articleApplyEditsToText(sent, plan.edits); }
    catch (error) { this.articleReportRunFailure({ code: "bad-shape", message: "bob returned invalid edits." }); return; }
    let applied = false;
    if (formatted !== sent) {
      try {
        await vault.process(file, (current) => {
          if (current !== sent) return current;
          applied = true;
          return formatted;
        });
      } catch (error) {
        applied = false;
      }
    }
    if (applied || formatted === sent) await this.articleApplyInbound(plan);
    if (plan.status === "changed" && (applied || formatted === sent)) {
      this.articleShowNotice(articleNoticeText(plan));
    }
  }

  async articleRunPlan(action, path, text) {
    const args = ["articles", action, "--stdin", path, "-f", "json"];
    const resolved = articleResolveBobPath(this.settings && this.settings.bobPath);
    const adapter = this.app && this.app.vault && this.app.vault.adapter;
    let vaultPath = "";
    try {
      vaultPath = adapter && typeof adapter.getBasePath === "function"
        ? adapter.getBasePath()
        : (adapter && adapter.basePath) || "";
    } catch (error) {
      vaultPath = (adapter && adapter.basePath) || "";
    }
    return articleSpawnBob(resolved.path, args, text, vaultPath);
  }

  articleReportRefusal(path, plan) {
    const reason = plan.reason || {};
    if (reason.code === "not-article") return;
    if (this.articleRefusalNotices.has(path)) return;
    this.articleRefusalNotices.add(path);
    this.articleShowNotice(reason.message || plan.notice || "bob skipped this article.");
  }

  articleReportRunFailure(result) {
    if (result.code === "bob-not-found" || result.code === "timeout") {
      if (this.articleBobErrorNoticed) return;
      this.articleBobErrorNoticed = true;
      this.articleShowNotice(result.message || (result.code === "timeout" ? "bob timed out." : "bob was not found."));
      return;
    }
    console.warn("Bob Articles could not read the bob plan", result.message || result.code);
  }

  articleShowNotice(message) {
    try { new Notice(String(message || ""), 3500); } catch (error) { console.warn("Bob Articles notice failed", error); }
  }
}

function articleSpawnBob(binary, args, input, vaultPath, options = {}) {
  return new Promise((resolve) => {
    let childProcess = options.childProcess;
    if (!childProcess) {
      try { childProcess = require("child_process"); } catch (error) { childProcess = null; }
    }
    if (!childProcess || typeof childProcess.spawn !== "function") {
      resolve({ ok: false, code: "bob-not-found", message: "Running bob needs the desktop app." });
      return;
    }
    let env = {};
    try { env = { ...(typeof process !== "undefined" ? process.env : {}) }; } catch (error) { env = {}; }
    if (vaultPath) env.BOB_DIR = vaultPath;
    env.NO_COLOR = "1";
    let child;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    try {
      child = childProcess.spawn(binary, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      finish({ ok: false, code: error && error.code === "ENOENT" ? "bob-not-found" : "spawn-error", message: String(error && error.message || error) });
      return;
    }
    timer = setTimeout(() => {
      try { child.kill(); } catch (error) { /* The timeout still wins. */ }
      finish({ ok: false, code: "timeout", message: "bob articles timed out after 1.5 s." });
    }, options.timeout || ARTICLE_BOB_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > ARTICLE_BOB_MAX_OUTPUT) {
        try { child.kill(); } catch (error) { /* The size error still wins. */ }
        finish({ ok: false, code: "output-too-large", message: "bob returned an oversized article plan." });
      }
    });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      finish({ ok: false, code: error && error.code === "ENOENT" ? "bob-not-found" : "spawn-error", message: String(error && error.message || error) });
    });
    child.on("close", () => {
      if (settled) return;
      const decoded = articleDecodePlan(stdout);
      if (decoded.ok) finish(decoded);
      else finish({ ...decoded, detail: stderr.split("\n")[0] || "" });
    });
    try { child.stdin.end(String(input || "")); }
    catch (error) { finish({ ok: false, code: "stdin-error", message: String(error && error.message || error) }); }
  });
}
