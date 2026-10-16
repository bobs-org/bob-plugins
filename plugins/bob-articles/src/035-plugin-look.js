BobArticlesPlugin.prototype.articleSetupLook = function articleSetupLook() {
  this.articleOutlines = this.articleOutlines || new Map();
  this.articleLookGeneration = this.articleLookGeneration || new Map();
  this.articleReadingRenderGeneration = this.articleReadingRenderGeneration || new Map();
  this.articleLookState = this.articleLookState || articleCreateLookState();
  this.articleStaleTimers = this.articleStaleTimers || new Map();

  const extension = this.articleCreateSecnoExtension();
  if (extension && typeof this.registerEditorExtension === "function") {
    this.registerEditorExtension(extension);
  }
  if (typeof this.registerMarkdownPostProcessor === "function") {
    this.registerMarkdownPostProcessor((el, ctx) => this.articleRenderReadingSecnos(el, ctx), 50);
  }
  if (typeof this.registerDomEvent === "function") {
    this.registerDomEvent(window, "compositionstart", () => this.articleSetComposing(true));
    this.registerDomEvent(window, "compositionend", () => {
      this.articleSetComposing(false);
      const view = this.articleActiveMarkdownView();
      if (view && view.file) this.articleArmStaleHintTimer(view.file.path, view);
    });
  }
  this.articleSetupStatusBar();
};

BobArticlesPlugin.prototype.articleTeardownLook = function articleTeardownLook() {
  for (const timer of (this.articleStaleTimers || new Map()).values()) clearTimeout(timer);
  if (this.articleStaleTimers) this.articleStaleTimers.clear();
  if (this.articleReadingRenderGeneration) this.articleReadingRenderGeneration.clear();
  this.articlePaintStatusBar(null);
};

BobArticlesPlugin.prototype.articleSetComposing = function articleSetComposing(composing) {
  const view = this.articleActiveMarkdownView();
  const path = view && view.file && view.file.path;
  if (!path || !this.articleLookState) return;
  if (composing) this.articleLookState.composing.add(path);
  else this.articleLookState.composing.delete(path);
};

BobArticlesPlugin.prototype.articleCreateSecnoExtension = function articleCreateSecnoExtension() {
  if (!ArticleViewPlugin || typeof ArticleViewPlugin.fromClass !== "function" || !ArticleDecoration) {
    return null;
  }
  const plugin = this;
  const SecnoPlugin = class {
    constructor(view) {
      this.decorations = plugin.articleBuildSecnoDecorations(view);
      this.generation = plugin.articleLookGenerationForView(view);
    }

    update(update) {
      const generation = plugin.articleLookGenerationForView(update.view);
      if (generation !== this.generation) {
        this.generation = generation;
        this.decorations = plugin.articleBuildSecnoDecorations(update.view);
        return;
      }
      if (update.docChanged && this.decorations && typeof this.decorations.map === "function") {
        this.decorations = this.decorations.map(update.changes);
      }
    }
  };
  const extension = ArticleViewPlugin.fromClass(SecnoPlugin, {
    decorations: (value) => value.decorations,
  });
  if (ArticlePrec && typeof ArticlePrec.high === "function") return ArticlePrec.high(extension);
  return extension;
};

BobArticlesPlugin.prototype.articleLookGenerationForView = function articleLookGenerationForView(view) {
  const path = this.articlePathForCmView(view);
  return path && this.articleLookGeneration ? (this.articleLookGeneration.get(path) || 0) : 0;
};

BobArticlesPlugin.prototype.articlePathForCmView = function articlePathForCmView(view) {
  try {
    if (ArticleEditorInfoField && view && view.state) {
      const info = view.state.field(ArticleEditorInfoField);
      if (info && info.file && info.file.path) return info.file.path;
    }
  } catch (error) {
    // Fall through to workspace matching.
  }
  try {
    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.getLeavesOfType === "function") {
      for (const leaf of workspace.getLeavesOfType("markdown")) {
        const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
        if (cm === view) return leaf.view.file && leaf.view.file.path;
      }
    }
  } catch (error) {
    // Fall through to the active view.
  }
  const active = this.articleActiveMarkdownView();
  if (active && active.editor && active.editor.cm === view && active.file) return active.file.path;
  return null;
};

BobArticlesPlugin.prototype.articleBuildSecnoDecorations = function articleBuildSecnoDecorations(view) {
  try {
    if (!ArticleDecoration) return null;
    const path = this.articlePathForCmView(view);
    const outline = path && this.articleOutlines ? this.articleOutlines.get(path) : null;
    const text = view && view.state && view.state.doc && typeof view.state.doc.toString === "function"
      ? view.state.doc.toString()
      : "";
    const ranges = articleSecnoDecorationRanges(text, outline, {
      savesBlocked: Boolean(path && this.articleUndoBlocked && this.articleUndoBlocked.has(path)),
    });
    if (!ranges.length) return ArticleDecoration.none;
    if (!ArticleRangeSetBuilder) return ArticleDecoration.none;
    const builder = new ArticleRangeSetBuilder();
    for (const range of ranges) {
      const spec = { class: range.stale ? "bob-secno is-stale" : "bob-secno" };
      if (range.titleAttr) spec.attributes = { title: range.titleAttr };
      builder.add(range.from, range.to, ArticleDecoration.mark(spec));
    }
    return builder.finish();
  } catch (error) {
    return ArticleDecoration && ArticleDecoration.none;
  }
};

BobArticlesPlugin.prototype.articleRefreshSecnoViews = function articleRefreshSecnoViews(path) {
  const workspace = this.app && this.app.workspace;
  if (!workspace || typeof workspace.getLeavesOfType !== "function") return;
  for (const leaf of workspace.getLeavesOfType("markdown")) {
    const view = leaf && leaf.view;
    if (!view || !view.file || view.file.path !== path) continue;
    const cm = view.editor && view.editor.cm;
    if (!cm || typeof cm.dispatch !== "function") continue;
    try { cm.dispatch({}); } catch (error) { /* A later edit still remaps. */ }
  }
};

BobArticlesPlugin.prototype.articleRefreshReadingViews = function articleRefreshReadingViews(path) {
  const workspace = this.app && this.app.workspace;
  if (!workspace || typeof workspace.getLeavesOfType !== "function") return;
  const generation = this.articleLookGeneration && this.articleLookGeneration.get(path);
  if (!generation) return;
  if (!this.articleReadingRenderGeneration) this.articleReadingRenderGeneration = new Map();
  if (this.articleReadingRenderGeneration.get(path) === generation) return;
  this.articleReadingRenderGeneration.set(path, generation);
  for (const leaf of workspace.getLeavesOfType("markdown")) {
    const view = leaf && leaf.view;
    if (!view || !view.file || view.file.path !== path) continue;
    let mode = "";
    try { mode = typeof view.getMode === "function" ? view.getMode() : ""; }
    catch (error) { mode = ""; }
    const preview = view.previewMode;
    if (mode !== "preview" || !preview || typeof preview.rerender !== "function") continue;
    try { preview.rerender(true); } catch (error) { /* Obsidian will render on the next view update. */ }
  }
};

BobArticlesPlugin.prototype.articleRememberPlan = function articleRememberPlan(path, plan, options = {}) {
  if (!path || !plan || !plan.outline) return;
  if (!this.articleOutlines) this.articleOutlines = new Map();
  if (!this.articleLookGeneration) this.articleLookGeneration = new Map();
  this.articleOutlines.set(path, articleOutlineForCurrentBuffer(plan.outline, Boolean(options.applied)));
  this.articleLookGeneration.set(path, (this.articleLookGeneration.get(path) || 0) + 1);
  this.articleRefreshSecnoViews(path);
  this.articleRefreshReadingViews(path);
};

BobArticlesPlugin.prototype.articleEnsureOutline = function articleEnsureOutline(snapshot, options = {}) {
  if (!snapshot || !snapshot.file || !snapshot.view || !snapshot.view.editor) return;
  if (!articleHasArticleType(this.articleFrontmatter(snapshot.file))) return;
  const path = snapshot.file.path;
  if (!options.force && this.articleOutlines && this.articleOutlines.has(path)) {
    this.articleRefreshStatusBar(snapshot.view);
    this.articleRefreshSecnoViews(path);
    return;
  }
  void this.articleRefreshOutlineFromBuffer(path, snapshot.view.editor.getValue(), snapshot.view);
};

BobArticlesPlugin.prototype.articleRefreshOutlineFromBuffer = async function articleRefreshOutlineFromBuffer(path, text, view) {
  const result = await this.articleRunPlan("format", path, text);
  if (!result.ok || !result.plan) return;
  if (result.plan.status === "skipped" || result.plan.status === "error") return;
  this.articleRememberPlan(path, result.plan, { applied: false });
  if (view) this.articleRefreshStatusBar(view);
};

BobArticlesPlugin.prototype.articleObserveLookUpdate = function articleObserveLookUpdate(update) {
  if (!this.articleLookState || !update) return;
  const path = this.articlePathForCmView(update.view);
  const view = this.articleViewForPath(path) || this.articleActiveMarkdownView();
  const active = this.articleActiveMarkdownView();
  if (!path || !view || !view.file || !articleHasArticleType(this.articleFrontmatter(view.file))) {
    if (active && view && active.file && view.file && active.file.path === view.file.path) {
      this.articlePaintStatusBar(null);
    }
    return;
  }
  if (update.view && update.view.composing) this.articleLookState.composing.add(path);
  else this.articleLookState.composing.delete(path);
  if (update.docChanged) this.articleScheduleStaleHint(path, view);
  if (view.file.path === path) this.articleRefreshStatusBar(view);
};

BobArticlesPlugin.prototype.articleViewForPath = function articleViewForPath(path) {
  if (!path) return null;
  const workspace = this.app && this.app.workspace;
  if (workspace && typeof workspace.getLeavesOfType === "function") {
    for (const leaf of workspace.getLeavesOfType("markdown")) {
      const view = leaf && leaf.view;
      if (view && view.file && view.file.path === path && view.editor) return view;
    }
  }
  const active = this.articleActiveMarkdownView();
  return active && active.file && active.file.path === path ? active : null;
};

BobArticlesPlugin.prototype.articleScheduleStaleHint = function articleScheduleStaleHint(path, view) {
  if (!this.articleLookState) return;
  articleNoteStaleHintEdit(this.articleLookState, path);
  this.articleArmStaleHintTimer(path, view);
};

BobArticlesPlugin.prototype.articleArmStaleHintTimer = function articleArmStaleHintTimer(path, view) {
  if (!this.articleStaleTimers) this.articleStaleTimers = new Map();
  const existing = this.articleStaleTimers.get(path);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    this.articleStaleTimers.delete(path);
    void this.articleFireStaleHint(path, view);
  }, ARTICLE_STALE_HINT_MS);
  this.articleStaleTimers.set(path, timer);
};

BobArticlesPlugin.prototype.articleFireStaleHint = async function articleFireStaleHint(path, view) {
  if (!this.articleLookState) return;
  const liveView = this.articleViewForPath(path) || view;
  const composing = this.articleLookState.composing.has(path)
    || Boolean(liveView && liveView.editor && liveView.editor.cm && liveView.editor.cm.composing);
  const decision = articleNoteStaleHintTimer(this.articleLookState, path, {
    desktop: articleIsDesktopApp(),
    enabled: !(this.settings && this.settings.staleNumberHints === false),
    composing,
  });
  if (decision.action === "schedule") {
    this.articleArmStaleHintTimer(path, liveView);
    return;
  }
  if (decision.action !== "spawn") return;
  if (!liveView || !liveView.editor) {
    articleNoteStaleHintResult(this.articleLookState, path, decision.version);
    return;
  }
  const text = liveView.editor.getValue();
  const result = await this.articleRunPlan("format", path, text);
  const settled = articleNoteStaleHintResult(this.articleLookState, path, decision.version);
  if (settled.reschedule) this.articleArmStaleHintTimer(path, liveView);
  if (!settled.accept) return;
  if (!result.ok || !result.plan || result.plan.status === "skipped" || result.plan.status === "error") return;
  if (liveView.editor.getValue() !== text) return;
  this.articleRememberPlan(path, result.plan, { applied: false });
  this.articleRefreshStatusBar(liveView);
};

BobArticlesPlugin.prototype.articleRenderReadingSecnos = function articleRenderReadingSecnos(el, ctx) {
  if (!el || !ctx || !this.articleOutlines) return;
  const path = ctx.sourcePath;
  if (!path) return;
  const outline = this.articleOutlines.get(path);
  if (!outline) return;
  let headings = [];
  try {
    headings = typeof el.querySelectorAll === "function" ? el.querySelectorAll("h1, h2, h3, h4, h5, h6") : [];
  } catch (error) {
    headings = [];
  }
  for (const heading of headings) {
    let info = null;
    try {
      info = typeof ctx.getSectionInfo === "function"
        ? (ctx.getSectionInfo(heading) || ctx.getSectionInfo(el))
        : null;
    } catch (error) {
      info = null;
    }
    if (!info || !Number.isInteger(info.lineStart)) continue;
    const line = info.lineStart + 1;
    const section = articleSectionAtLine(outline, line);
    if (!section || section.line !== line) continue;
    articleWrapHeadingElement(heading, section, undefined, {
      savesBlocked: Boolean(this.articleUndoBlocked && this.articleUndoBlocked.has(path)),
    });
  }
};

BobArticlesPlugin.prototype.articleSetupStatusBar = function articleSetupStatusBar() {
  if (typeof this.addStatusBarItem !== "function") return;
  const el = this.addStatusBarItem();
  if (!el) return;
  this.articleStatusEl = el;
  if (typeof el.addClass === "function") el.addClass("bob-article-status");
  else if (el.classList && typeof el.classList.add === "function") el.classList.add("bob-article-status");
  this.articlePaintStatusBar(null);
};

BobArticlesPlugin.prototype.articleRefreshStatusBar = function articleRefreshStatusBar(view) {
  if (!view || !view.file || !articleHasArticleType(this.articleFrontmatter(view.file))) {
    this.articlePaintStatusBar(null);
    return;
  }
  const outline = this.articleOutlines ? this.articleOutlines.get(view.file.path) : null;
  let line = 1;
  try {
    if (view.editor && typeof view.editor.getCursor === "function") {
      const cursor = view.editor.getCursor();
      line = (cursor && Number.isInteger(cursor.line) ? cursor.line : 0) + 1;
    } else if (view.editor && view.editor.cm && view.editor.cm.state) {
      const head = view.editor.cm.state.selection.main.head;
      line = view.editor.cm.state.doc.lineAt(head).number;
    }
  } catch (error) {
    line = 1;
  }
  this.articlePaintStatusBar(articleStatusBarModel(outline, line));
};

BobArticlesPlugin.prototype.articlePaintStatusBar = function articlePaintStatusBar(model) {
  const el = this.articleStatusEl;
  if (!el) return;
  const hide = !model;
  if (typeof el.toggleClass === "function") {
    el.toggleClass("bob-article-status-hidden", hide);
  } else if (el.classList && typeof el.classList.toggle === "function") {
    el.classList.toggle("bob-article-status-hidden", hide);
  }
  const text = hide ? "" : model.text;
  if (typeof el.setText === "function") el.setText(text);
  else el.textContent = text;
  const title = hide ? "" : (model.title || "");
  if (typeof el.setAttribute === "function") {
    if (title) el.setAttribute("aria-label", title);
    else el.removeAttribute("aria-label");
  }
  el.title = title;
};
