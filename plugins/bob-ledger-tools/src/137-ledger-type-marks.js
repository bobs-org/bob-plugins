// --- Ledger type-agreement marks: pure mark-core ----------------------------
// Owned by D11 in plan:202610/task_types.md. Prefixes a live Task Link
// with `#TYPE` when the linked task disagrees with its Pomodoro, or
// quietly when the entry has two or more type components. Never throws.

function ledgerTypeMarkLinks(content) {
  try {
    const found = [];
    todayEachOpenEntry(content, (entry) => {
      try {
        const range = entry.range;
        if (!range || range.length === 0) {
          return;
        }
        const childIndent = todayIndentLen(entry.lines[range[0]]);
        for (const sub of range) {
          try {
            if (todayIndentLen(entry.lines[sub]) !== childIndent) {
              continue;
            }
            const bullet = todayBulletBody(entry.lines[sub]);
            if (!bullet) {
              continue;
            }
            const match = progressMarkMatchFromBody(bullet.body);
            if (!match) {
              continue;
            }
            found.push(
              Object.freeze({
                line: sub,
                ch: bullet.bodyStart + match.prefix + match.token.start,
                target: match.token.pathPart,
                blockId: match.token.blockId,
                entryName: entry.entryName,
              }),
            );
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        // One entry never breaks the scan.
      }
    });
    return Object.freeze(found);
  } catch (error) {
    return Object.freeze([]);
  }
}

function ledgerTypeMarkKind(taskKey, entryName, sources) {
  try {
    if (!taskKey) {
      return null;
    }
    const agrees =
      typeof typeAgrees === "function"
        ? typeAgrees(taskKey, entryName, sources)
        : true;
    const components =
      typeof typeComponents === "function"
        ? typeComponents(entryName, sources)
        : [];
    const typeCount = components.filter((item) => item && item.isType).length;
    if (!agrees) {
      return "disagree";
    }
    if (typeCount >= 2) {
      return "composite";
    }
    return null;
  } catch (error) {
    return null;
  }
}

function buildLedgerTypeMarkElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    const spec = model && typeof model === "object" ? model : {};
    const typeName =
      typeof spec.type === "string" && spec.type ? spec.type : "";
    if (!typeName) {
      return null;
    }
    const span = doc.createElement("span");
    let classes = "bob-ledger-type-mark";
    if (spec.kind === "disagree") {
      classes += " is-disagree";
    } else if (spec.kind === "composite") {
      classes += " is-composite";
    }
    span.setAttribute("class", classes);
    span.setAttribute("role", "img");
    span.setAttribute("data-bob-type", typeName);
    if (typeof spec.hue === "string" && spec.hue) {
      span.setAttribute("data-bob-type-hue", spec.hue);
    }
    const tooltip =
      spec.kind === "disagree"
        ? ledgerTypeDisagreeTooltip(typeName, spec.entryName)
        : typeName;
    if (tooltip) {
      span.setAttribute("aria-label", tooltip);
      span.setAttribute("title", tooltip);
      span.setAttribute("data-tooltip-position", "top");
    }
    return span;
  } catch (error) {
    return null;
  }
}

let LedgerTypeMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  LedgerTypeMarkWidget = class extends WidgetType {
    constructor(model) {
      super();
      this.model = model && typeof model === "object" ? model : {};
      this.key = [
        this.model.type || "",
        this.model.hue || "",
        this.model.kind || "",
        this.model.entryName || "",
      ].join("|");
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof LedgerTypeMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildLedgerTypeMarkElement(
        typeof document !== "undefined" ? document : null,
        this.model,
      );
      if (!dom) {
        return typeof document !== "undefined" && document
          ? document.createElement("span")
          : null;
      }
      try {
        dom.addEventListener("mousedown", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
            let anchor = null;
            try {
              anchor =
                view && typeof view.posAtDOM === "function"
                  ? view.posAtDOM(dom)
                  : null;
            } catch (error) {
              anchor = null;
            }
            if (typeof anchor === "number") {
              view.dispatch({ selection: { anchor } });
            }
            if (view && typeof view.focus === "function") {
              view.focus();
            }
          } catch (error) {
            // Cursor placement is best-effort.
          }
        });
      } catch (error) {
        // A listener-free mark still renders.
      }
      return dom;
    }
  };
}
