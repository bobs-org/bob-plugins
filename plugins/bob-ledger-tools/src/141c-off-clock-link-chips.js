// --- Off-clock Task Link chips: pure display core -------------------------
// Mirrors the Pomodoro session clock for dedicated ledger Task Links. The
// chip is display-only: it never writes the task tag or session clock.

// One frozen item for each exact ledger row accepted by the task-link mark
// parser. `ch` lands after `]]` or the closing `~~`, before a trailing ` #`.
function offClockLinkChipLinks(lines, path, options) {
  try {
    const rows = Array.isArray(lines) ? lines : [];
    const sourcePath = String(path || "");
    if (!sourcePath || !PLAN_DAILY_PATH_RE.test(sourcePath)) return Object.freeze([]);
    const opts = options && typeof options === "object" ? options : {};
    const context = taskLinkMarkDocContext(rows, sourcePath);
    const section = planSectionRange(rows);
    if (!section) return Object.freeze([]);
    const fenced = planFencedLines(rows, section.start, section.end);
    const result = [];
    let owner = null;
    let childIndent = null;
    for (let index = section.start; index <= section.end; index += 1) {
      try {
        const line = String(rows[index] || "");
        // A fenced child does not end the entry's child range, matching the
        // ledger-row classifier; it simply cannot itself become a link.
        if (fenced.has(index)) continue;
        if (line.trim() === "") {
          owner = null;
          childIndent = null;
          continue;
        }
        if (!line.startsWith(" ") && !line.startsWith("\t")) {
          const entry = planParseEntry(line);
          owner = entry ? { open: entry.state === "open" } : null;
          childIndent = null;
          continue;
        }
        if (!todayIsSubBulletLine(line)) {
          owner = null;
          childIndent = null;
          continue;
        }
        if (!owner) continue;
        if (childIndent === null) childIndent = todayIndentLen(line);
        if (todayIndentLen(line) !== childIndent || context.inert(index)) continue;
        const bullet = todayBulletBody(line);
        if (!bullet || !taskLinkMarkLedgerBodyIsDedicated(bullet.body)) continue;
        const tokens = todayWikilinkTokens(line);
        if (!Array.isArray(tokens) || tokens.length !== 1) continue;
        const token = tokens[0];
        if (!token || token.embedded || !Number.isInteger(token.start) || !Number.isInteger(token.end)) continue;
        if (opts.openOnly && !owner.open) continue;
        let ch = token.end;
        const closingStrike = /^[ \t]*~~/.exec(line.slice(ch));
        if (closingStrike) ch += closingStrike[0].length;
        result.push(Object.freeze({
          line: index,
          ch,
          pathPart: String(token.pathPart || ""),
          blockId: String(token.blockId || ""),
          token: line.slice(token.start, token.end),
          entryOpen: owner.open,
        }));
      } catch (error) {
        continue;
      }
    }
    return Object.freeze(result);
  } catch (error) {
    return Object.freeze([]);
  }
}

function offClockLinkChipTooltip(model) {
  try {
    if (!model || typeof model !== "object") return "";
    let value = "";
    if (model.source === "off_tag") {
      value = `Off-clock · tagged ${String(model.spelling || "#off")}`;
    } else if (model.source === "note") {
      value = typeof gcalEventsFromNoteTitle === "function"
        ? gcalEventsFromNoteTitle(model.notePath)
        : `Off-clock · from ${String(model.notePath || "note").replace(/\.md$/i, "")}`;
    }
    return value.replace(/::/g, ":");
  } catch (error) {
    return "";
  }
}

function offClockLinkChipModel(fact) {
  try {
    if (!fact || fact.offClock !== true) return null;
    const source = fact.source === "off_tag" ? "off_tag" : fact.source === "note" ? "note" : null;
    if (!source) return null;
    const lineText = typeof fact.lineText === "string" ? fact.lineText : "";
    const tag = source === "off_tag" && typeof eventTaskOffClockTagRange === "function"
      ? eventTaskOffClockTagRange(lineText)
      : null;
    const spelling = tag ? lineText.slice(tag.start, tag.end) : source === "off_tag" ? "#off" : null;
    const model = {
      text: "off",
      source,
      notePath: source === "note" ? String(fact.note || "") : null,
      spelling,
      blockId: String(fact.blockId || ""),
    };
    model.tooltip = offClockLinkChipTooltip(model);
    return model;
  } catch (error) {
    return null;
  }
}

// Listener-free shared host builder. Live Preview adds its interaction in
// the widget; Reading view uses this exact same accessible element.
function buildOffClockLinkChipElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model || !model.tooltip) return null;
    const host = doc.createElement("span");
    host.setAttribute("class", "bob-off-clock-link-chip");
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", String(model.tooltip));
    host.setAttribute("data-tooltip-position", "top");
    host.setAttribute("data-clock-source", String(model.source || ""));
    host.setAttribute("data-block-id", String(model.blockId || ""));
    host.textContent = "off";
    return host;
  } catch (error) {
    return null;
  }
}

let OffClockLinkChipWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  OffClockLinkChipWidget = class extends WidgetType {
    constructor(model, sourcePath, linktext, workspace) {
      super();
      this.model = model && typeof model === "object" ? { ...model } : {};
      this.tooltip = String(this.model.tooltip || offClockLinkChipTooltip(this.model));
      this.source = String(this.model.source || "");
      this.sourcePath = String(sourcePath || "");
      this.linktext = String(linktext || "");
      this.workspace = workspace || null;
    }

    eq(other) {
      return Boolean(
        other && other instanceof OffClockLinkChipWidget &&
        other.tooltip === this.tooltip && other.source === this.source &&
        other.sourcePath === this.sourcePath && other.linktext === this.linktext &&
        other.model.blockId === this.model.blockId,
      );
    }

    toDOM(view) {
      const doc = typeof document !== "undefined" ? document : null;
      const dom = buildOffClockLinkChipElement(doc, this.model);
      if (!dom || typeof dom.addEventListener !== "function") return dom;
      dom.addEventListener("mousedown", (event) => {
        try {
          if (event && typeof event.button === "number" && event.button !== 0) return;
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          if (event && (event.metaKey || event.ctrlKey)) {
            if (this.workspace && typeof this.workspace.openLinkText === "function") {
              this.workspace.openLinkText(this.linktext, this.sourcePath, "tab");
            }
            return;
          }
          const anchor = view && typeof view.posAtDOM === "function" ? view.posAtDOM(dom) : null;
          if (typeof anchor === "number" && view && typeof view.dispatch === "function") {
            view.dispatch({ selection: { anchor } });
          }
          if (view && typeof view.focus === "function") view.focus();
        } catch (error) {
          // Read-only cursor placement and navigation are best-effort.
        }
      });
      return dom;
    }
  };
}
