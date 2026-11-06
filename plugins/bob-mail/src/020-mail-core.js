function mailHomeDir(options = {}) {
  try {
    const osModule = options.osModule === undefined ? mailOptionalModule("os") : options.osModule;
    if (osModule && typeof osModule.homedir === "function") return osModule.homedir();
  } catch (error) {
    // Fall through to HOME.
  }
  const env = options.env || (typeof process !== "undefined" ? process.env : {});
  return env && typeof env.HOME === "string" ? env.HOME : "";
}

function mailCandidatePaths(home) {
  const base = typeof home === "string" ? home.replace(/\/$/, "") : "";
  return MAIL_BOB_CANDIDATES.map((entry) => entry.startsWith("/") ? entry : base ? `${base}/${entry}` : "")
    .filter(Boolean);
}

// ledger-tools returns {path, source}; older builds may return a string.
function mailLedgerBobPath(app) {
  try {
    const ledger = app && app.plugins && app.plugins.plugins && app.plugins.plugins["bob-ledger-tools"];
    const bobPath = ledger && ledger.api && ledger.api.stats && ledger.api.stats.bobPath;
    if (typeof bobPath !== "function") return null;
    const found = bobPath();
    const path = found && typeof found === "object" ? found.path : found;
    return typeof path === "string" && path.trim() ? path.trim() : null;
  } catch (error) {
    return null;
  }
}

function mailResolveBobPath(options = {}) {
  const home = options.home !== undefined ? options.home : mailHomeDir(options);
  const ledger = options.ledgerBobPath;
  const ledgerPath = typeof ledger === "function" ? ledger() : ledger;
  const normalizedLedger = ledgerPath && typeof ledgerPath === "object" ? ledgerPath.path : ledgerPath;
  if (typeof normalizedLedger === "string" && normalizedLedger.trim()) {
    return { path: normalizedLedger.trim(), source: "ledger-tools" };
  }
  const existsSync = options.existsSync || ((candidate) => {
    try {
      const fsModule = mailOptionalModule("fs");
      return Boolean(fsModule && fsModule.existsSync(candidate));
    } catch (error) {
      return false;
    }
  });
  for (const candidate of mailCandidatePaths(home)) {
    try {
      if (existsSync(candidate)) return { path: candidate, source: "candidate" };
    } catch (error) {
      // Try the next install location.
    }
  }
  return { path: "bob", source: "path" };
}

function mailIsGmailUrl(value) {
  const text = String(value || "").trim();
  if (!text || /\s|[<>]/.test(text)) return false;
  try {
    const url = new URL(text);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname.toLowerCase() === "mail.google.com" && url.pathname.startsWith("/mail/");
  } catch (error) {
    return false;
  }
}

function mailIsOldBobError(error, stderr) {
  const detail = `${String(error && error.message || error || "")} ${String(stderr || "")}`;
  return /(?:unknown|unrecognized|unsupported) (?:sub)?command\s*[:'"`]?\s*gmail|no such command\s*[:'"`]?\s*gmail|unexpected argument.*\bgmail\b|found argument.*\bgmail\b/i.test(detail);
}

function mailErrorText(error, stderr) {
  const detail = String(stderr || error && error.stderr || error && error.message || error || "").trim();
  return detail.split(/\r?\n/).find((line) => line.trim()) || "Bob Mail command failed";
}

function mailRunBob(binary, args, options = {}) {
  return new Promise((resolve) => {
    let childProcess = options.childProcess;
    if (!childProcess) childProcess = mailOptionalModule("child_process");
    const runner = options.execFile || childProcess && childProcess.execFile;
    if (typeof runner !== "function") {
      resolve({ ok: false, oldBob: false, error: "Bob Mail is available on desktop only" });
      return;
    }
    const parentEnv = options.env || (typeof process !== "undefined" ? process.env : {});
    const env = { ...(parentEnv || {}) };
    if (options.vaultPath) env.BOB_DIR = options.vaultPath;
    runner(binary || "bob", [...args], {
      cwd: options.vaultPath || undefined,
      env,
      timeout: options.timeout || MAIL_BOB_TIMEOUT_MS,
      maxBuffer: options.maxBuffer || MAIL_BOB_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          oldBob: mailIsOldBobError(error, stderr),
          error: mailErrorText(error, stderr),
          stderr: String(stderr || ""),
        });
        return;
      }
      if (options.json === false) {
        resolve({ ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") });
        return;
      }
      try {
        const document = JSON.parse(String(stdout || ""));
        if (document && document.ok === false) {
          resolve({ ok: false, oldBob: false, error: mailErrorText(null, document.message || document.error), document });
          return;
        }
        resolve({ ok: true, document, stdout: String(stdout || "") });
      } catch (parseError) {
        resolve({ ok: false, oldBob: false, error: "Bob returned invalid JSON" });
      }
    });
  });
}

function mailActiveMarkdownView(app) {
  try {
    const workspace = app && app.workspace;
    if (workspace && typeof workspace.getActiveViewOfType === "function") {
      const view = workspace.getActiveViewOfType(MarkdownView);
      if (view && view.file && view.editor) return view;
    }
    const leaf = workspace && typeof workspace.getMostRecentLeaf === "function" ? workspace.getMostRecentLeaf() : null;
    return leaf && leaf.view && leaf.view.file && leaf.view.editor ? leaf.view : null;
  } catch (error) {
    return null;
  }
}

function mailFrontmatter(app, file) {
  try {
    return app && app.metadataCache && typeof app.metadataCache.getFileCache === "function"
      ? (app.metadataCache.getFileCache(file) || {}).frontmatter || null
      : null;
  } catch (error) {
    return null;
  }
}

function mailNormalizeType(value) {
  return String(value || "").trim().replace(/^\[\[/, "").replace(/\]\]$/, "").trim().toLowerCase();
}

function mailIsMailNote(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object") return false;
  const types = Array.isArray(frontmatter.type) ? frontmatter.type : [frontmatter.type];
  return types.some((value) => mailNormalizeType(value) === "mail") ||
    typeof frontmatter.gmail_thread_id === "string";
}

function mailCurrentNote(app, view = mailActiveMarkdownView(app)) {
  if (!view || !view.file) return null;
  const frontmatter = mailFrontmatter(app, view.file);
  if (!mailIsMailNote(frontmatter)) return null;
  return { file: view.file, frontmatter, view, editor: view.editor };
}

function mailEditorPosition(editor, which) {
  try {
    const position = editor && typeof editor.getCursor === "function" ? editor.getCursor(which) : null;
    if (position && Number.isInteger(position.line) && Number.isInteger(position.ch)) {
      return { line: position.line, ch: position.ch };
    }
  } catch (error) {
    // Invalid or unavailable cursor.
  }
  return null;
}

function mailSamePosition(left, right) {
  return Boolean(left && right && left.line === right.line && left.ch === right.ch);
}

function mailCreateEditorSnapshot(view, editor = view && view.editor) {
  if (!view || !view.file || !editor || typeof editor.getLine !== "function") return null;
  const head = mailEditorPosition(editor, "head");
  if (!head) return null;
  const anchor = mailEditorPosition(editor, "anchor") || head;
  if (head.line !== anchor.line) return null;
  const lineText = editor.getLine(head.line);
  if (typeof lineText !== "string") return null;
  return {
    view,
    filePath: view.file.path,
    editor,
    line: head.line,
    lineText,
    head,
    anchor,
    from: { line: head.line, ch: Math.min(head.ch, anchor.ch) },
    to: { line: head.line, ch: Math.max(head.ch, anchor.ch) },
  };
}

function mailViewIsCurrent(app, snapshot) {
  if (!snapshot || !snapshot.view || !snapshot.editor) return false;
  return mailActiveMarkdownView(app) === snapshot.view &&
    Boolean(snapshot.view.file && snapshot.view.file.path === snapshot.filePath) &&
    snapshot.view.editor === snapshot.editor;
}

function mailInsertLinkIfCurrent(app, snapshot, link) {
  if (!mailViewIsCurrent(app, snapshot) || !link || typeof snapshot.editor.getLine !== "function") return false;
  const editor = snapshot.editor;
  if (editor.getLine(snapshot.line) !== snapshot.lineText ||
      !mailSamePosition(mailEditorPosition(editor, "head"), snapshot.head) ||
      !mailSamePosition(mailEditorPosition(editor, "anchor"), snapshot.anchor)) return false;
  const cursor = { line: snapshot.line, ch: snapshot.from.ch + String(link).length };
  if (typeof editor.transaction === "function") {
    editor.transaction({
      changes: [{ from: snapshot.from, to: snapshot.to, text: String(link) }],
      selection: { from: cursor, to: cursor },
    });
  } else if (typeof editor.replaceRange === "function") {
    editor.replaceRange(String(link), snapshot.from, snapshot.to);
    if (typeof editor.setCursor === "function") editor.setCursor(cursor);
  } else {
    return false;
  }
  return true;
}

function mailCreatePasteSnapshot(view, editor, rawText) {
  const pasted = String(rawText || "");
  const token = pasted.trim();
  if (pasted !== token || !mailIsGmailUrl(token) || /\s/.test(token)) return null;
  const base = mailCreateEditorSnapshot(view, editor);
  if (!base) return null;
  const start = base.from.ch;
  const end = base.to.ch;
  const expectedLine = base.lineText.slice(0, start) + token + base.lineText.slice(end);
  return {
    view: base.view,
    filePath: base.filePath,
    editor: base.editor,
    line: base.line,
    expectedLine,
    start,
    end: start + token.length,
    url: token,
  };
}

function mailPasteRangeIsCurrent(app, snapshot) {
  if (!mailViewIsCurrent(app, snapshot)) return false;
  const editor = snapshot.editor;
  return typeof editor.getLine === "function" && editor.getLine(snapshot.line) === snapshot.expectedLine &&
    snapshot.expectedLine.slice(snapshot.start, snapshot.end) === snapshot.url;
}

function mailReplacePasteRangeIfCurrent(app, snapshot, link) {
  if (!mailPasteRangeIsCurrent(app, snapshot) || !link) return false;
  const editor = snapshot.editor;
  const from = { line: snapshot.line, ch: snapshot.start };
  const to = { line: snapshot.line, ch: snapshot.end };
  if (typeof editor.transaction === "function") {
    const cursor = { line: snapshot.line, ch: snapshot.start + String(link).length };
    editor.transaction({ changes: [{ from, to, text: String(link) }], selection: { from: cursor, to: cursor } });
  } else if (typeof editor.replaceRange === "function") {
    editor.replaceRange(String(link), from, to);
  } else {
    return false;
  }
  return true;
}

function mailLinkUnderCursor(app, view = mailActiveMarkdownView(app)) {
  if (!view || !view.file || !view.editor || typeof view.editor.getLine !== "function") return null;
  const cursor = mailEditorPosition(view.editor, "head");
  if (!cursor) return null;
  const line = view.editor.getLine(cursor.line) || "";
  const pattern = /\[\[(mail\/[^\]#|]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let match;
  while ((match = pattern.exec(line))) {
    if (cursor.ch < match.index || cursor.ch > match.index + match[0].length) continue;
    try {
      const target = app.metadataCache.getFirstLinkpathDest(match[1], view.file.path);
      const frontmatter = target && mailFrontmatter(app, target);
      if (target && mailIsMailNote(frontmatter)) return { file: target, frontmatter, view, editor: view.editor };
    } catch (error) {
      return null;
    }
  }
  return null;
}

function mailEmailContext(app) {
  const view = mailActiveMarkdownView(app);
  return mailCurrentNote(app, view) || mailLinkUnderCursor(app, view);
}

function mailGmailUrlFor(context) {
  const url = context && context.frontmatter && context.frontmatter.gmail_url;
  return mailIsGmailUrl(url) ? String(url) : null;
}

function mailEmailLabel(context) {
  const frontmatter = context && context.frontmatter || {};
  return String(frontmatter.title || context && context.file && context.file.basename || "Email")
    .replace(/[\]|\r\n]/g, " ").trim();
}

function mailFindCardMessageId(markdown, cursorLine) {
  const lines = String(markdown || "").split(/\r?\n/);
  if (!Number.isInteger(cursorLine) || cursorLine < 0 || cursorLine >= lines.length) return null;
  const starts = [];
  for (let line = 0; line < lines.length; line += 1) {
    if (/^\s*>\s*\[!mail(?:[+-])?\]/.test(lines[line])) starts.push(line);
  }
  let start = -1;
  for (const line of starts) if (line <= cursorLine) start = line;
  if (start < 0) return null;
  const next = starts.find((line) => line > start);
  const end = next === undefined ? lines.length : next;
  if (cursorLine >= end) return null;
  for (let line = start; line < end; line += 1) {
    const match = lines[line].match(/^\s*\^m-([a-f0-9]+)\s*$/i);
    if (match) return cursorLine <= line ? match[1].toLowerCase() : null;
  }
  return null;
}

function mailTaskLink(context, blockId) {
  if (!context || !context.file || !context.file.path) return null;
  const target = context.file.path.replace(/\.md$/i, "") + (blockId ? `#^m-${blockId}` : "");
  const label = mailEmailLabel(context);
  return `[[${target}|${label}]]`;
}

function mailRelativeDate(rawDate, now = Date.now()) {
  if (!rawDate) return "date unknown";
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return String(rawDate);
  const days = Math.max(0, Math.floor((now - date.getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function mailVaultPath(app) {
  try {
    const adapter = app && app.vault && app.vault.adapter;
    if (adapter && typeof adapter.getBasePath === "function") return adapter.getBasePath();
    return adapter && typeof adapter.basePath === "string" ? adapter.basePath : "";
  } catch (error) {
    return "";
  }
}
