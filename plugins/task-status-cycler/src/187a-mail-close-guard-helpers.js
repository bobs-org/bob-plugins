// Mail Close Card guard helpers for Task Status Cycler (split from 187 to stay under the fragment line limit).

// Top-level token helpers and additional mixin methods; shares one script scope with 187.

function cyclerMailCloseTrimLineText(value) {
  return String(value || "").trim();
}

function cyclerMailCloseConfirmedIdentities(targets) {
  const list = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    if (!target || typeof target !== "object") continue;
    const path = cyclerMailCloseNormalizePath(target.path);
    const line = Math.floor(Number(target.line));
    const after = String(target.after || " ").slice(0, 1);
    const lineText = typeof target.lineText === "string" ? target.lineText
      : (typeof target.line_text === "string" ? target.line_text : "");
    if (!path || !Number.isInteger(line) || line < 1) continue;
    list.push({ p: path, l: line, t: cyclerMailCloseTrimLineText(lineText), a: after });
  }
  list.sort((a, b) => String(a.p).localeCompare(String(b.p)) || (a.l - b.l) || String(a.a).localeCompare(String(b.a)) || String(a.t).localeCompare(String(b.t)));
  return list;
}

function cyclerMailCloseDecodeConfirmedToken(token) {
  if (typeof token !== "string" || !token) return null;
  if (token.startsWith("mc1.")) {
    try {
      const b64 = token.slice(4);
      const json = typeof Buffer !== "undefined" && typeof Buffer.from === "function"
        ? Buffer.from(b64, "base64url").toString("utf8")
        : decodeURIComponent(escape(atob(b64.replace(/-/g, "+").replace(/_/g, "/"))));
      const payload = JSON.parse(json);
      if (payload && typeof payload === "object" && Array.isArray(payload.t)) return payload;
    } catch (_error) {
      return null;
    }
    return null;
  }
  return { d: token, t: null };
}

function cyclerMailCloseTokenCoversTargets(token, targets, digest) {
  if (typeof token !== "string" || !token) return false;
  if (!Array.isArray(targets) || targets.length === 0) return true;
  if (digest && token === String(digest)) return true;
  const decoded = cyclerMailCloseDecodeConfirmedToken(token);
  if (!decoded || !Array.isArray(decoded.t)) return false;
  const covered = decoded.t;
  for (const target of targets) {
    if (!target || typeof target !== "object") continue;
    const path = cyclerMailCloseNormalizePath(target.path);
    const line = Math.floor(Number(target.line));
    const after = String(target.after || " ").slice(0, 1);
    const lineText = typeof target.lineText === "string" ? target.lineText
      : (typeof target.line_text === "string" ? target.line_text : "");
    const trimmed = cyclerMailCloseTrimLineText(lineText);
    let ok = false;
    for (const entry of covered) {
      if (!entry || typeof entry !== "object") continue;
      if (cyclerMailCloseNormalizePath(entry.p) !== path) continue;
      if (String(entry.a || " ").slice(0, 1) !== after) continue;
      if (Number(entry.l) === line) { ok = true; break; }
      if (cyclerMailCloseTrimLineText(entry.t) !== "" && cyclerMailCloseTrimLineText(entry.t) === trimmed) { ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
}

TaskStatusCyclerMailCloseMixin.prototype.cyclerMailCloseClickDocuments = function() {
    const docs = [];
    const seen = new Set();
    const push = (doc) => {
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      docs.push(doc);
    };
    try {
      if (typeof document !== "undefined" && document) push(document);
    } catch (_error) {}
    try {
      const workspace = this.app && this.app.workspace;
      const el = workspace && workspace.containerEl;
      const main = el && el.ownerDocument ? el.ownerDocument : null;
      if (main) push(main);
      const leaves = workspace && typeof workspace.getLeavesOfType === "function"
        ? workspace.getLeavesOfType("markdown") || []
        : [];
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view;
          const container = view && (view.containerEl || view.contentEl);
          const doc = container && container.ownerDocument ? container.ownerDocument : null;
          if (doc) push(doc);
        } catch (_error) {}
      }
    } catch (_error) {}
    return docs;
  }

TaskStatusCyclerMailCloseMixin.prototype.cyclerMailCloseLivePreviewLine = function(view, input) {
    if (!view || !input) return null;
    const candidates = [];
    try {
      const editor = view.editor;
      if (editor) {
        if (editor.cm) candidates.push(editor.cm);
        if (editor.editor && editor.editor.cm) candidates.push(editor.editor.cm);
        candidates.push(editor);
      }
      if (view.cm) candidates.push(view.cm);
    } catch (_error) {}
    for (const cm of candidates) {
      try {
        if (!cm || typeof cm.posAtDOM !== "function") continue;
        if (!cm.state || !cm.state.doc || typeof cm.state.doc.lineAt !== "function") continue;
        let pos = null;
        try {
          pos = cm.posAtDOM(input);
        } catch (_error) {
          pos = null;
        }
        if (!Number.isFinite(pos)) {
          try {
            pos = cm.posAtDOM(input, 0);
          } catch (_error) {
            pos = null;
          }
        }
        if (!Number.isFinite(pos)) continue;
        const line = cm.state.doc.lineAt(pos);
        if (line && Number.isFinite(line.number) && line.number >= 1) {
          return Math.floor(line.number) - 1;
        }
      } catch (_error) {}
    }
    return null;
  }

TaskStatusCyclerMailCloseMixin.prototype.cyclerMailCloseReadingSectionInfo = function(view, el) {
    if (!view || !el) return null;
    const attempts = [];
    try {
      if (view.previewMode && view.previewMode.renderer && typeof view.previewMode.renderer.getSectionInfo === "function") {
        attempts.push(() => view.previewMode.renderer.getSectionInfo(el));
      }
    } catch (_error) {}
    try {
      if (view.previewMode && typeof view.previewMode.getSectionInfo === "function") {
        attempts.push(() => view.previewMode.getSectionInfo(el));
      }
    } catch (_error) {}
    try {
      if (typeof view.getSectionInfo === "function") attempts.push(() => view.getSectionInfo(el));
    } catch (_error) {}
    for (const attempt of attempts) {
      try {
        const info = attempt();
        if (info && typeof info === "object") return info;
      } catch (_error) {}
    }
    return null;
  }

TaskStatusCyclerMailCloseMixin.prototype.cyclerMailCloseReadingFallbackShouldBlock = function(input, view, path) {
    try {
      const li = input && typeof input.closest === "function" ? input.closest("li.task-list-item") : null;
      if (!li) return false;
      let text = "";
      try {
        text = String((li.textContent !== undefined ? li.textContent : li.innerText) || "");
      } catch (_error) {
        text = "";
      }
      const links = [];
      try {
        const re = /\[\[([^\]]+)\]\]/g;
        let match;
        while ((match = re.exec(text))) {
          const target = String(match[1].split("|")[0].split("#")[0] || "").trim();
          if (target && !links.includes(target)) links.push(target);
        }
      } catch (_error) {}
      if (links.length === 0) return false;
      const app = this.app;
      for (const link of links) {
        try {
          if (cyclerMailCloseWarmIsMail(app, path, link) === true) return true;
        } catch (_error) {}
      }
      return false;
    } catch (_error) {
      return false;
    }
  }

TaskStatusCyclerMailCloseMixin.prototype.cyclerMailCloseViewForInput = function(input) {
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.getLeavesOfType === "function") {
        for (const leaf of workspace.getLeavesOfType("markdown") || []) {
          try {
            const view = leaf && leaf.view;
            const container = view && (view.containerEl || view.contentEl);
            if (view && container && typeof container.contains === "function" && container.contains(input)) {
              return view;
            }
          } catch (_error) {}
        }
      }
      if (workspace && typeof workspace.iterateAllLeaves === "function") {
        let found = null;
        try {
          workspace.iterateAllLeaves((leaf) => {
            if (found) return;
            try {
              const view = leaf && leaf.view;
              const container = view && (view.containerEl || view.contentEl);
              if (view && container && typeof container.contains === "function" && container.contains(input)) {
                found = view;
              }
            } catch (_error) {}
          });
        } catch (_error) {}
        if (found) return found;
      }
    } catch (_error) {}
    return this.cyclerMailCloseActiveMarkdownView();
  }
