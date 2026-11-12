// Read-only Schema Card: Task Card idiom, report-backed layout, navigation /
// y / esc only. No write gestures and no vault bytes.
function albumSchemaCardModalBase() {
  if (typeof Modal === "function") return Modal;
  return class AlbumSchemaCardFallback {
    constructor(app) {
      this.app = app;
      const doc = typeof document !== "undefined" ? document : null;
      this.contentEl = {
        ownerDocument: doc,
        children: [],
        empty() { this.children = []; },
        addClass() {},
        setAttribute() {},
        appendChild(node) { this.children.push(node); return node; },
        querySelector(sel) {
          const walk = (nodes) => {
            for (const node of nodes || []) {
              if (node.matches?.(sel)) return node;
              const found = walk(node.children);
              if (found) return found;
            }
            return null;
          };
          return walk(this.children);
        },
        querySelectorAll(sel) {
          const found = [];
          const walk = (nodes) => {
            for (const node of nodes || []) {
              if (node.matches?.(sel)) found.push(node);
              walk(node.children);
            }
          };
          walk(this.children);
          return found;
        },
      };
      this.modalEl = this.contentEl;
      this.containerEl = this.contentEl;
      this.scope = { register() { return {}; } };
    }
    open() { this.onOpen?.(); }
    close() { this.onClose?.(); }
  };
}

function albumSchemaCardTitle(model) {
  const crumbs = (model?.crumbs || []).map((crumb) => crumb.title || crumb.stem).filter(Boolean);
  const trail = crumbs.join(" › ");
  const label = model?.schemaLabel || model?.title || "Album";
  const emoji = String(model?.emoji || "").trim();
  const head = emoji ? `${emoji} ${label}` : label;
  return trail ? `${head} · ${trail}` : head;
}

function albumSchemaCardBuildEl(model, options, doc) {
  const card = notebookCreateEl(doc, "div", "bob-album-schema-dialog bob-key-card");
  if (!card) return null;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Album schema");
  const header = notebookCreateEl(doc, "div", "bob-album-schema-dialog-header");
  const title = notebookCreateEl(doc, "h2", "bob-album-schema-dialog-title bob-key-card-title");
  notebookSetText(title, albumSchemaCardTitle(model));
  header.appendChild(title);
  const stats = notebookCreateEl(doc, "p", "bob-album-schema-dialog-stats");
  notebookSetText(stats, albumHeaderStatsText(model));
  header.appendChild(stats);
  card.appendChild(header);

  if ((model.issues || []).length) {
    const banner = notebookCreateEl(doc, "div", "bob-album-schema-dialog-lint");
    banner.setAttribute("role", "status");
    const issues = notebookCreateEl(doc, "ul", "bob-album-schema-issues");
    issues.setAttribute("aria-label", "Album schema issues");
    for (const issue of model.issues) {
      const item = albumSchemaPaintIssue(doc, issue, options);
      if (item) issues.appendChild(item);
    }
    banner.appendChild(issues);
    card.appendChild(banner);
  }

  const body = notebookCreateEl(doc, "div", "bob-album-schema-dialog-body");
  if (model.emptySchema && !model.schemaInvalid) {
    const empty = notebookCreateEl(doc, "p", "bob-album-schema-empty");
    notebookSetText(empty, albumHeaderSummaryText(model));
    body.appendChild(empty);
  } else {
    const presented = (model.fields || []).map((field) => albumHeaderPresentField(field, model));
    presented.forEach((field, index) => {
      const row = albumSchemaPaintField(doc, field, options);
      if (!row) return;
      if (index === (options?.selectedIndex || 0)) {
        const cls = `${row.getAttribute("class") || ""} is-selected`.trim();
        row.setAttribute("class", cls);
        row.setAttribute("aria-current", "true");
      }
      body.appendChild(row);
    });
    for (const pattern of model.legacy || []) {
      const chip = notebookCreateEl(doc, "span", "bob-album-schema-legacy");
      notebookSetText(chip, pattern);
      body.appendChild(chip);
    }
  }
  card.appendChild(body);

  const footer = notebookCreateEl(doc, "p", "bob-album-schema-dialog-footer bob-key-card-footer");
  notebookSetText(footer, "↑/↓ navigate   y YAML   esc close");
  card.appendChild(footer);
  return card;
}

class AlbumSchemaCardModal extends albumSchemaCardModalBase() {
  constructor(app, settings = {}) {
    super(app);
    this.schemaModel = settings.model || null;
    this.schemaSourcePath = settings.sourcePath || settings.model?.path || "";
    this.schemaPlugin = settings.plugin || null;
    this.selectedIndex = 0;
  }

  schemaTargets() {
    const fields = this.schemaModel?.fields || [];
    const issues = this.schemaModel?.issues || [];
    return fields.map((field) => ({ line: field.line, fieldKey: field.key }))
      .concat(issues.map((issue) => ({ line: issue.line, issue })));
  }

  schemaJump() {
    const targets = this.schemaTargets();
    const current = targets[this.selectedIndex] || targets[0] || {};
    const line = albumHeaderYamlLine(this.schemaModel, current);
    return this.schemaPlugin?.albumHeaderJumpYaml?.(this.schemaSourcePath, line);
  }

  schemaMove(delta) {
    const targets = this.schemaTargets();
    if (!targets.length) return;
    this.selectedIndex = (this.selectedIndex + delta + targets.length) % targets.length;
    this.paintSchemaCard();
  }

  paintSchemaCard() {
    const host = this.contentEl;
    if (!host) return;
    try { host.empty?.(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
    const doc = notebookDomDoc(host) || host.ownerDocument || (typeof document !== "undefined" ? document : null);
    const card = albumSchemaCardBuildEl(this.schemaModel, {
      selectedIndex: this.selectedIndex,
      desktop: true,
      handlers: {
        jumpYaml: (line) => this.schemaPlugin?.albumHeaderJumpYaml?.(this.schemaSourcePath, line),
      },
    }, doc);
    if (card) host.appendChild(card);
    const selected = host.querySelector?.(".bob-album-schema-field.is-selected")
      || host.querySelector?.(".bob-album-schema-issue");
    try { selected?.focus?.({ preventScroll: true }); } catch (_) {}
  }

  onOpen() {
    try {
      this.modalEl?.addClass?.("bob-album-schema-modal");
      this.modalEl?.setAttribute?.("role", "dialog");
      this.modalEl?.setAttribute?.("aria-modal", "true");
      this.modalEl?.setAttribute?.("aria-label", "Album schema");
      this.contentEl?.addClass?.("bob-album-schema-dialog");
      this.contentEl?.addClass?.("bob-key-card");
    } catch (_) {}
    this.paintSchemaCard();
    const scope = this.scope;
    try {
      scope?.register?.([], "ArrowUp", () => { this.schemaMove(-1); return false; });
      scope?.register?.([], "ArrowDown", () => { this.schemaMove(1); return false; });
      scope?.register?.([], "k", () => { this.schemaMove(-1); return false; });
      scope?.register?.([], "j", () => { this.schemaMove(1); return false; });
      scope?.register?.([], "y", () => { void this.schemaJump(); return false; });
    } catch (_) {}
    try {
      this.contentEl?.addEventListener?.("keydown", (event) => {
        if (!event || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault?.(); this.schemaMove(-1); }
        else if (event.key === "ArrowDown" || event.key === "j") { event.preventDefault?.(); this.schemaMove(1); }
        else if (event.key === "y" || event.key === "Y") { event.preventDefault?.(); void this.schemaJump(); }
      });
    } catch (_) {}
  }

  onClose() {
    try { this.contentEl?.empty?.(); } catch (_) {}
    if (this.schemaPlugin && this.schemaPlugin.albumSchemaCardModal === this) {
      this.schemaPlugin.albumSchemaCardModal = null;
    }
  }
}

class BobLedgerToolsAlbumSchemaCardMixin {
  openAlbumSchemaCard(model, sourcePath) {
    if (!this.albumHeaderDesktop()) {
      return { ok: false, reason: "mobile" };
    }
    if (!model) return { ok: false, reason: "missing model" };
    try { this.albumSchemaCardModal?.close?.(); } catch (_) {}
    const modal = new AlbumSchemaCardModal(this.app, {
      model,
      sourcePath: sourcePath || model.path,
      plugin: this,
    });
    this.albumSchemaCardModal = modal;
    try { modal.open(); } catch (_) {}
    return { ok: true, modal };
  }
}
