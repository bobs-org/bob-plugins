// --- Pomodoro theme pills: Reading view --------------------------------
// DOM counterpart to the Live Preview marks in
// 279-plugin-pomodoro-theme-chips.js. It wraps the name-tail components
// of column-0 `## Pomodoros` entries in pill spans. Refresh re-tints the
// recorded spans in place, so theme writes never disturb the reading DOM.

class BobLedgerToolsPomodoroThemeChipsReadingMixin {
  renderPomodoroThemePillsIn(el, ctx) {
    try {
      if (!el || !ctx) {
        return;
      }
      const sourcePath = typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!this.pomodoroThemeChipDailyPath(sourcePath)) {
        return;
      }
      if (!this.pomodoroThemeReadingRoots) {
        this.pomodoroThemeReadingRoots = new Set();
      }
      let lists = [];
      if (typeof el.querySelectorAll === "function") {
        lists = el.querySelectorAll("ul, ol");
      }
      for (const list of lists || []) {
        try {
          this.renderPomodoroThemePillsInList(list, sourcePath);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Reading pills never throw.
    }
  }

  // Wrap the trailing `— NAME` of each top-level Pomodoro row. Only
  // direct text children are touched, so nested Task Link bullets and
  // code spans keep their rendering.
  renderPomodoroThemePillsInList(list, sourcePath) {
    try {
      if (!list || list.nodeType !== 1) {
        return;
      }
      const tagOf = (node) =>
        String(node && (node.tagName || node.nodeName) || "").toUpperCase();
      if (tagOf(list.parentNode) === "LI") {
        return;
      }
      let sibling = list.previousSibling || null;
      let guard = 0;
      let sectionRoot = false;
      while (sibling && guard < 100) {
        guard += 1;
        if (sibling.nodeType === 1 && /^H[1-6]$/.test(tagOf(sibling))) {
          const words = String(sibling.textContent || "").trim().split(/\s+/);
          sectionRoot = tagOf(sibling) === "H2" && words[0] === "Pomodoros";
          break;
        }
        sibling = sibling.previousSibling || null;
      }
      if (!sectionRoot) {
        return;
      }
      for (const row of list.childNodes || []) {
        try {
          if (!row || row.nodeType !== 1 || tagOf(row) !== "LI") {
            continue;
          }
          const data = row.dataset || null;
          if (data && data.bobPomoThemeProcessed === "1") {
            continue;
          }
          if (this.pomodoroThemeWrapReadingRow(row)) {
            if (data) {
              data.bobPomoThemeProcessed = "1";
            } else if (typeof row.setAttribute === "function") {
              row.setAttribute("data-bob-pomo-theme-processed", "1");
            }
            if (typeof MarkdownRenderChild === "function") {
              try {
                const child = new MarkdownRenderChild(row);
                const record = { row, path: sourcePath, pills: [] };
                try {
                  const pills = row.querySelectorAll
                    ? row.querySelectorAll(".bob-pomo-theme")
                    : [];
                  record.pills = [...(pills || [])];
                } catch (error) {
                  record.pills = [];
                }
                this.pomodoroThemeReadingRoots.add(record);
                child.onunload = () => {
                  this.pomodoroThemeReadingRoots.delete(record);
                };
              } catch (error) {
                // The registry is best-effort.
              }
            }
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // List wrapping never throws.
    }
  }

  pomodoroThemeWrapReadingRow(row) {
    try {
      if (!row || typeof row.childNodes === "undefined") {
        return false;
      }
      const doc = row.ownerDocument || (typeof document !== "undefined" ? document : null);
      // The name tail is the trailing `— NAME` in a direct text child.
      // Nested lists hold Task Links and are never touched.
      const texts = [];
      for (const child of row.childNodes || []) {
        if (child && child.nodeType === 3) {
          texts.push(child);
        }
      }
      let wrapped = false;
      for (const textNode of texts) {
        try {
          const value = typeof textNode.nodeValue === "string" ? textNode.nodeValue : "";
          const dashAt = value.lastIndexOf("—");
          if (dashAt === -1) {
            continue;
          }
          const name = value.slice(dashAt + 1).trim();
          const components = pomodoroThemeComponentsWithOffsets(
            value.slice(dashAt + 1),
          );
          if (components.length === 0 || !name) {
            continue;
          }
          const fragment = doc.createDocumentFragment();
          fragment.appendChild(doc.createTextNode(value.slice(0, dashAt + 1) + " "));
          components.forEach((component, index) => {
            if (index > 0) {
              fragment.appendChild(doc.createTextNode(" + "));
            }
            const pill = this.buildPomodoroThemePillElement(doc, component);
            if (pill) {
              fragment.appendChild(pill);
            } else {
              fragment.appendChild(doc.createTextNode(component.raw));
            }
          });
          const tail = value.slice(dashAt + 1);
          const kept = tail.match(/[ \t]*$/)[0];
          if (kept) {
            fragment.appendChild(doc.createTextNode(kept));
          }
          row.replaceChild(fragment, textNode);
          wrapped = true;
        } catch (error) {
          continue;
        }
      }
      return wrapped;
    } catch (error) {
      return false;
    }
  }

  buildPomodoroThemePillElement(doc, component) {
    try {
      if (!doc || typeof doc.createElement !== "function" || !component) {
        return null;
      }
      const resolved = this.pomodoroThemeHueFor(component.key, component.raw);
      const hue = resolved && resolved.hue ? resolved.hue : null;
      const unconfigured = this.pomodoroThemeIsConfigured(component.key) === false;
      const muted = Boolean(
        resolved &&
          (resolved.hue_source === "exempt" ||
            resolved.hue_source === "unconfigured"),
      );
      const pill = doc.createElement("span");
      pill.setAttribute(
        "class",
        `bob-pomo-theme${muted ? " bob-pomo-theme-muted" : ""}${unconfigured ? " bob-pomo-theme-unconfigured" : ""}`,
      );
      if (hue) {
        pill.setAttribute("data-theme-hue", hue);
      }
      pill.setAttribute("data-theme-key", component.key);
      pill.setAttribute(
        "title",
        this.pomodoroThemeTooltip(component.key, component.raw),
      );
      pill.textContent = component.raw;
      return pill;
    } catch (error) {
      return null;
    }
  }

  refreshPomodoroThemeReadingPills() {
    try {
      if (!(this.pomodoroThemeReadingRoots instanceof Set)) {
        return false;
      }
      let refreshed = false;
      for (const record of Array.from(this.pomodoroThemeReadingRoots)) {
        try {
          for (const pill of record.pills || []) {
            try {
              if (!pill || !pill.isConnected) {
                continue;
              }
              const key = pill.getAttribute
                ? pill.getAttribute("data-theme-key")
                : "";
              const name = pill.textContent || key;
              const resolved = this.pomodoroThemeHueFor(key, name);
              const hue = resolved && resolved.hue ? resolved.hue : null;
              const unconfigured = this.pomodoroThemeIsConfigured(key) === false;
              const muted = Boolean(
                resolved &&
                  (resolved.hue_source === "exempt" ||
                    resolved.hue_source === "unconfigured"),
              );
              pill.setAttribute(
                "class",
                `bob-pomo-theme${muted ? " bob-pomo-theme-muted" : ""}${unconfigured ? " bob-pomo-theme-unconfigured" : ""}`,
              );
              if (hue) {
                pill.setAttribute("data-theme-hue", hue);
              } else if (pill.removeAttribute) {
                pill.removeAttribute("data-theme-hue");
              }
              if (typeof pill.setAttribute === "function") {
                pill.setAttribute(
                  "title",
                  this.pomodoroThemeTooltip(key, name),
                );
              }
              refreshed = true;
            } catch (error) {
              continue;
            }
          }
        } catch (error) {
          continue;
        }
      }
      return refreshed;
    } catch (error) {
      return false;
    }
  }
}
