// --- Task root fields: pure root-place-mark model -------------------------
// Root marks are a rendering of an explicit task `[root:: NOTE]` field.
// This fragment parses with the shared inline-field scanner and resolves
// against the same vault link and area-hue rules as the Pomodoro home chips.

function rootMarkFieldState(line) {
  try {
    if (typeof line !== "string") return { state: "none", fields: [] };
    const fields = pomodoroThemeInlineFields(line).filter((field) => field.key === "root");
    if (fields.length === 0) return { state: "none", fields: [] };
    if (fields.length > 1) return { state: "repair", repair: "duplicate", fields };
    const field = fields[0];
    const value = typeof field.value === "string" ? field.value.trim() : "";
    if (!value || /[\[\]|#^]/u.test(value)) {
      return { state: "repair", repair: "invalid", fields };
    }
    return { state: "set", value, fields };
  } catch (error) {
    return { state: "none", fields: [] };
  }
}

function rootMarkStem(path) {
  try {
    return pomodoroHomeStem(String(path || "")).toLowerCase();
  } catch (error) {
    return String(path || "").replace(/\\.md$/i, "").split("/").pop().toLowerCase();
  }
}

// Resolve the root parent named by an existing note. This is the Pomodoro
// home resolver's `root` (R2), so root marks and chips cannot disagree: an
// area names itself; otherwise the first `root: true` project, then the
// outermost project, below the first area. No home returns null.
function rootMarkRootPath(targetPath, sourcePath, metadataCache, vault, warnings, seen) {
  try {
    const home = pomodoroHomeResolve(
      targetPath,
      sourcePath,
      metadataCache,
      vault,
      Array.isArray(warnings) ? warnings : [],
      seen instanceof Set ? seen : new Set(),
    );
    return home && typeof home.root === "string" && home.root ? home.root : null;
  } catch (error) {
    return null;
  }
}

function rootMarkLinksTarget(line, fieldStart, targetPath, sourcePath, metadataCache, vault) {
  try {
    const prefix = String(line || "").slice(0, Math.max(0, Number(fieldStart) || 0));
    const links = /\[\[([^\]]+)\]\]/gu;
    let match;
    while ((match = links.exec(prefix))) {
      const raw = String(match[1] || "").split("|")[0].split("#")[0].trim();
      if (!raw) continue;
      const file = pomodoroHomeResolveFile(raw, sourcePath, sourcePath, metadataCache, vault);
      if (file && file.path && pomodoroHomePathEqual(file.path, targetPath)) return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function rootMarkTooltip(model) {
  try {
    const safe = (value) => String(value == null ? "" : value).replace(/::/gu, ":");
    if (!model || typeof model !== "object") return "Root field needs repair";
    if (model.state === "repair") {
      const value = safe(model.raw || "root");
      if (model.repair === "duplicate") {
        return `Root field ignored · duplicate root fields · time counts under this task's own note`;
      }
      if (model.repair === "missing") {
        return `Root field ignored · no note named ${value} · time counts under this task's own note`;
      }
      if (model.repair === "ambiguous") {
        return `Root field ignored · ${value} matches more than one note · time counts under this task's own note`;
      }
      if (model.repair === "no_home") {
        return `Root field ignored · ${value} has no area or project home · time counts under this task's own note`;
      }
      return `Root field ignored · invalid note name ${value} · time counts under this task's own note`;
    }
    if (model.state === "rolls-up") {
      return `Root field names ${safe(model.targetLabel)}, which groups under ${safe(model.rootLabel)} · set root: true on ${safe(model.targetLabel)} or name ${safe(model.rootLabel)}`;
    }
    return `Root parent ${safe(model.targetLabel)} · ${safe(model.areaLabel || "unfiled")} area · time on this task counts here · Mod-click to open`;
  } catch (error) {
    return "Root field needs repair";
  }
}

// Build the render model for one task line. No field, code/prose, and bad
// inputs return null. `context` carries origin path and Obsidian resolvers.
function rootMarkModel(line, context) {
  try {
    const fieldState = rootMarkFieldState(line);
    if (fieldState.state === "none") return null;
    const field = fieldState.fields[0];
    const fieldStart = Number(field && field.start);
    const fieldEnd = Number(field && field.end);
    if (!Number.isFinite(fieldStart) || !Number.isFinite(fieldEnd) || fieldEnd <= fieldStart) return null;
    const raw = String((field && field.value) || "").trim();
    const origin = context && typeof context === "object" ? context : {};
    const sourcePath = String(origin.sourcePath || "");
    const metadataCache = origin.metadataCache || null;
    const vault = origin.vault || null;
    const common = {
      raw: raw || "root",
      fieldStart,
      fieldEnd,
      foldSpace: fieldStart > 0 && line[fieldStart - 1] === " ",
      sourcePath,
      id: null,
    };
    if (fieldState.state === "repair") {
      const model = { ...common, state: "repair", repair: fieldState.repair || "invalid", targetLabel: raw || "root" };
      model.id = JSON.stringify(["repair", model.repair, raw, fieldStart]);
      model.tooltip = rootMarkTooltip(model);
      return Object.freeze(model);
    }
    if (/[\[\]|#^]/u.test(raw) || !raw) {
      const model = { ...common, state: "repair", repair: "invalid", targetLabel: raw || "root" };
      model.id = JSON.stringify(["repair", model.repair, raw, fieldStart]);
      model.tooltip = rootMarkTooltip(model);
      return Object.freeze(model);
    }
    const targetFile = pomodoroHomeResolveFile(raw, sourcePath, sourcePath, metadataCache, vault);
    if (!targetFile || typeof targetFile.path !== "string") {
      const model = { ...common, state: "repair", repair: "missing", targetLabel: raw };
      model.id = JSON.stringify(["repair", model.repair, raw, fieldStart]);
      model.tooltip = rootMarkTooltip(model);
      return Object.freeze(model);
    }
    const targetHome = pomodoroHomeResolve(raw, sourcePath, metadataCache, vault, [], new Set());
    const rootPath = rootMarkRootPath(targetFile.path, sourcePath, metadataCache, vault, [], new Set());
    if (!targetHome || !rootPath) {
      const model = { ...common, state: "repair", repair: "no_home", targetPath: targetFile.path, targetLabel: rootMarkStem(targetFile.path) };
      model.id = JSON.stringify(["repair", model.repair, targetFile.path, fieldStart]);
      model.tooltip = rootMarkTooltip(model);
      return Object.freeze(model);
    }
    const isRoot = pomodoroHomePathEqual(rootPath, targetFile.path);
    const rootHome = pomodoroHomeResolve(rootPath, sourcePath, metadataCache, vault, [], new Set());
    const state = isRoot ? "set" : "rolls-up";
    const targetLabel = rootMarkStem(targetFile.path);
    const rootLabel = rootMarkStem(rootPath);
    const compact = isRoot && rootMarkLinksTarget(
      line,
      fieldStart,
      targetFile.path,
      sourcePath,
      metadataCache,
      vault,
    );
    const model = {
      ...common,
      state: compact ? "compact" : state,
      targetPath: targetFile.path,
      targetLabel,
      rootPath,
      rootLabel,
      areaLabel: rootHome && rootHome.area_label ? rootHome.area_label : targetHome.area_label,
      hue: rootHome && rootHome.hue ? rootHome.hue : targetHome.hue,
      compact,
    };
    model.id = JSON.stringify([model.state, model.targetPath, model.rootPath, model.hue, fieldStart]);
    model.tooltip = rootMarkTooltip(model);
    return Object.freeze(model);
  } catch (error) {
    return null;
  }
}

function buildRootMarkElement(doc, model, options) {
  try {
    if (!doc || !model || typeof doc.createElement !== "function" || typeof doc.createTextNode !== "function") return null;
    const settings = options && typeof options === "object" ? options : {};
    const span = doc.createElement("span");
    span.setAttribute("class", `bob-root-mark bob-root-mark-${model.state}`);
    span.setAttribute("data-root-state", String(model.state || "repair"));
    span.setAttribute("data-root-hue", String(model.hue || "gray"));
    span.setAttribute("data-fold-space", settings.foldSpace ? "true" : "false");
    if (model.targetPath) span.setAttribute("data-root-target", String(model.targetPath));
    if (model.sourcePath) span.setAttribute("data-root-source", String(model.sourcePath));
    if (settings.decorative) {
      span.setAttribute("aria-hidden", "true");
    } else {
      span.setAttribute("role", "img");
      span.setAttribute("tabindex", "0");
      span.setAttribute("aria-label", String(model.tooltip || rootMarkTooltip(model)));
      span.setAttribute("title", String(model.tooltip || rootMarkTooltip(model)));
    }
    const dot = doc.createElement("span");
    dot.setAttribute("class", "bob-root-mark-dot");
    dot.setAttribute("aria-hidden", "true");
    dot.appendChild(doc.createTextNode(model.state === "repair" ? "○" : "●"));
    span.appendChild(dot);
    if (model.state !== "compact") {
      const label = doc.createElement("span");
      label.setAttribute("class", "bob-root-mark-label");
      label.appendChild(doc.createTextNode(String(model.state === "repair" ? model.raw || "root" : model.targetLabel || "root")));
      span.appendChild(label);
    }
    return span;
  } catch (error) {
    return null;
  }
}

let RootMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  RootMarkWidget = class extends WidgetType {
    constructor(model, foldLength, app) {
      super();
      this.model = model;
      this.app = app || null;
      this.foldLength = Math.max(0, Math.floor(Number(foldLength) || 0));
      this.key = `${model && model.id}|${this.foldLength}`;
    }

    eq(other) {
      return Boolean(other && other instanceof RootMarkWidget && other.key === this.key);
    }

    toDOM(view) {
      const dom = buildRootMarkElement(typeof document !== "undefined" ? document : null, this.model, { foldSpace: this.foldLength > 0 });
      if (!dom) return typeof document !== "undefined" && document ? document.createElement("span") : null;
      const widget = this;
      dom.addEventListener("mousedown", (event) => {
        try {
          if (event && (event.metaKey || event.ctrlKey)) {
            if (event.preventDefault) event.preventDefault();
            const workspace = this.app && this.app.workspace;
            if (workspace && typeof workspace.openLinkText === "function") {
              workspace.openLinkText(widget.model.targetPath, widget.model.sourcePath, true);
            }
            return;
          }
          if (event && event.preventDefault) event.preventDefault();
          const anchor = view && typeof view.posAtDOM === "function" ? view.posAtDOM(dom) : null;
          if (typeof anchor === "number" && view && typeof view.dispatch === "function") {
            view.dispatch({ selection: { anchor: anchor + widget.foldLength } });
          }
          if (view && typeof view.focus === "function") view.focus();
        } catch (error) {
          // Click behavior is best-effort; the mark remains readable.
        }
      });
      return dom;
    }
  };
}
