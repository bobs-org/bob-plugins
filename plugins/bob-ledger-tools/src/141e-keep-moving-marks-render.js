// --- Keep-moving marks: shared tooltip, DOM host, and Live Preview widget --
// The host builder is listener-free so Reading view and the parity harness
// can use the exact same accessible markup.

function keepMovingMarkTooltip(model) {
  try {
    const safe = model && typeof model === "object" ? model : {};
    const rows = Array.isArray(safe.rows) ? safe.rows : [];
    const count = Number.isInteger(safe.count) ? safe.count : rows.length;
    const project = String(safe.projectStem || "project");
    const lines = [
      "Closing this offers " + count + " task" + (count === 1 ? "" : "s") +
        " to keep " + project + " moving",
      "It's the last " + project + " task planned today",
    ];
    for (const row of rows.slice(0, 3)) {
      let title = String(row && (row.title || row.text) || "").trim();
      if (typeof dependencyCleanTaskText === "function") title = dependencyCleanTaskText(title);
      if (title.length > 48) title = title.slice(0, 47) + "…";
      const lane = String(row && row.lane || "");
      lines.push("• " + title + " · " + lane);
    }
    if (count > 3) lines.push("+" + (count - 3) + " more");
    lines.push("ready in " + project + " · not dependents");
    const folded = safe.folded && typeof safe.folded === "object" ? safe.folded : {};
    const foldParts = [];
    if (Number(folded.blocked) > 0) foldParts.push(Number(folded.blocked) + " blocked");
    if (Number(folded.scheduled) > 0) foldParts.push(Number(folded.scheduled) + " scheduled later");
    if (Number(folded.hidden) > 0) foldParts.push(Number(folded.hidden) + " hidden");
    if (foldParts.length) lines.push("not offered  " + foldParts.join(" · "));
    return lines.join("\n").replace(/::/g, ":");
  } catch (error) {
    return "Closing this offers 0 tasks to keep the project moving";
  }
}

function buildKeepMovingMarkElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model) return null;
    const count = Number(model.count);
    const blockId = String(model.blockId || "");
    const project = String(model.projectPath || "");
    if (!Number.isInteger(count) || count < 1 || !blockId || !project) return null;
    const host = doc.createElement("span");
    host.setAttribute(
      "class",
      "bob-keep-moving-mark" + (model.tick ? " bob-keep-moving-mark-tick" : ""),
    );
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", keepMovingMarkTooltip(model));
    host.setAttribute("data-tooltip-position", "top");
    host.setAttribute("data-count", String(count));
    host.setAttribute("data-block-id", blockId);
    host.setAttribute("data-project", project);
    const glyph = doc.createElement("span");
    glyph.setAttribute("class", "bob-keep-moving-mark-glyph");
    glyph.setAttribute("aria-hidden", "true");
    host.appendChild(glyph);
    if (typeof doc.createTextNode === "function") {
      host.appendChild(doc.createTextNode(String(count)));
    } else {
      const text = doc.createElement("span");
      text.textContent = String(count);
      host.appendChild(text);
    }
    return host;
  } catch (error) {
    return null;
  }
}

let KeepMovingMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  KeepMovingMarkWidget = class extends WidgetType {
    constructor(model, sourcePath, workspace) {
      super();
      this.model = model && typeof model === "object" ? { ...model } : {};
      this.sourcePath = String(sourcePath || "");
      this.workspace = workspace || null;
      this.tooltip = keepMovingMarkTooltip(this.model);
      this.linktext = String(
        this.model.projectLinktext ||
        String(this.model.projectPath || "").replace(/\.md$/i, ""),
      );
    }

    eq(other) {
      return Boolean(other) &&
        other instanceof KeepMovingMarkWidget &&
        String(other.model.blockId || "") === String(this.model.blockId || "") &&
        Number(other.model.count) === Number(this.model.count) &&
        other.tooltip === this.tooltip &&
        String(other.model.projectPath || "") === String(this.model.projectPath || "") &&
        other.sourcePath === this.sourcePath;
    }

    toDOM(view) {
      const doc = typeof document !== "undefined" ? document : null;
      const dom = buildKeepMovingMarkElement(doc, this.model);
      if (!dom || typeof dom.addEventListener !== "function") return dom;
      dom.addEventListener("mousedown", (event) => {
        try {
          if (event && typeof event.button === "number" && event.button !== 0) return;
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          if (event && (event.metaKey || event.ctrlKey)) {
            const workspace = this.workspace || null;
            if (workspace && typeof workspace.openLinkText === "function") {
              workspace.openLinkText(this.linktext, this.sourcePath, "tab");
            }
            return;
          }
          const anchor = view && typeof view.posAtDOM === "function" ? view.posAtDOM(dom) : null;
          if (typeof anchor === "number" && view && typeof view.dispatch === "function") {
            view.dispatch({ selection: { anchor } });
          }
          if (view && typeof view.focus === "function") view.focus();
        } catch (error) {
          // The mark is read-only; caret placement and navigation are best-effort.
        }
      });
      if (this.model.tick) {
        try {
          const schedule = typeof window !== "undefined" && typeof window.setTimeout === "function"
            ? window.setTimeout.bind(window)
            : setTimeout;
          schedule(() => {
            try {
              if (dom.classList && typeof dom.classList.remove === "function") {
                dom.classList.remove("bob-keep-moving-mark-tick");
              } else if (typeof dom.setAttribute === "function") {
                dom.setAttribute("class", "bob-keep-moving-mark");
              }
            } catch (error) {
              // Tick cleanup is cosmetic.
            }
          }, 400);
        } catch (error) {
          // The CSS animation still runs if no timer host is available.
        }
      }
      return dom;
    }
  };
}
