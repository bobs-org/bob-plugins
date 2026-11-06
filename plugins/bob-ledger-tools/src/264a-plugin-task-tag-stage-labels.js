// --- Task tag stage labels: Reading-view label plumbing --------------------
// `BobLedgerToolsTaskTagStageLabelsMixin`, installed after the task-tag
// marks mixin. Resolves the configured checklist stage for a rendered
// `#task` anchor and renders the quiet small-caps stage label beside
// the sunrise or flag. Owned by `docs/task-tag-marks.md` "Checklist
// stage labels" in bob-cli. Every method is synchronous and never
// throws; bad input yields null or false, and a glyph without its
// label still renders.
class BobLedgerToolsTaskTagStageLabelsMixin {
  taskTagStageLineTextForAnchor(anchor, ctx) {
    try {
      let lineText = "";
      try {
        const host =
          anchor && typeof anchor.closest === "function"
            ? anchor.closest("li") || anchor
            : anchor;
        const info =
          ctx && typeof ctx.getSectionInfo === "function"
            ? ctx.getSectionInfo(host)
            : null;
        if (info && typeof info.text === "string" && info.text) {
          lineText = info.text;
        }
      } catch (error) {
        lineText = "";
      }
      if (!lineText) {
        try {
          if (typeof this.taskTagSyntheticLineFromAnchor === "function") {
            lineText = this.taskTagSyntheticLineFromAnchor(anchor) || "";
          }
        } catch (error) {
          lineText = "";
        }
      }
      if (!lineText) {
        try {
          let current = anchor && anchor.parentNode;
          let guard = 0;
          while (current && guard < 100) {
            guard += 1;
            try {
              const tag = String(current.tagName || current.nodeName || "").toUpperCase();
              if (tag === "LI") {
                lineText =
                  typeof current.textContent === "string" ? current.textContent : "";
                if (!lineText) {
                  try {
                    const parts = [];
                    const stack = [current];
                    let inner = 0;
                    while (stack.length > 0 && inner < 1000) {
                      inner += 1;
                      const node = stack.pop();
                      if (!node || typeof node !== "object") {
                        continue;
                      }
                      if (node.nodeType === 1) {
                        let isTag = false;
                        try {
                          isTag = Boolean(
                            node.classList &&
                              typeof node.classList.contains === "function" &&
                              node.classList.contains("tag"),
                          );
                        } catch (error) {
                          isTag = false;
                        }
                        if (!isTag) {
                          isTag = String(node.className || "").split(/\s+/).indexOf("tag") !== -1;
                        }
                        if (isTag && typeof node.textContent === "string" && node.textContent) {
                          parts.push(node.textContent);
                        }
                      }
                      for (const child of node.childNodes || []) {
                        stack.push(child);
                      }
                    }
                    if (parts.length > 0) {
                      parts.reverse();
                      lineText = "- [ ] " + parts.join(" ");
                    }
                  } catch (error) {
                    // Tag collection is best-effort.
                  }
                }
                break;
              }
            } catch (error) {
              // Keep walking.
            }
            current = current.parentNode || null;
          }
        } catch (error) {
          // Best-effort fallback only.
        }
      }
      return typeof lineText === "string" ? lineText : "";
    } catch (error) {
      return "";
    }
  }

  taskTagStageConfig() {
    try {
      if (typeof this.freshnessConfigSnapshot === "function") {
        const snapshot = this.freshnessConfigSnapshot();
        return snapshot && snapshot.config ? snapshot.config : null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  taskTagStageDocFor(container, anchor) {
    try {
      if (container && container.ownerDocument) {
        return container.ownerDocument;
      }
      if (anchor && anchor.ownerDocument) {
        return anchor.ownerDocument;
      }
      if (typeof document !== "undefined" && document) {
        return document;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  annotateChecklistStageLabel(anchor, checklistRun, ctx, container) {
    try {
      if (!anchor || !checklistRun) {
        return false;
      }
      if (typeof checklistStageLabelForLine !== "function") {
        return false;
      }
      const config = this.taskTagStageConfig();
      const lineText = this.taskTagStageLineTextForAnchor(anchor, ctx);
      if (!lineText) {
        return false;
      }
      const stageInfo = checklistStageLabelForLine(lineText, config);
      if (
        !stageInfo ||
        stageInfo.kind !== checklistRun.kind ||
        typeof stageInfo.stage !== "string" ||
        !stageInfo.stage
      ) {
        return false;
      }
      let stageAnchor = null;
      try {
        stageAnchor =
          typeof checklistStageAnchorForRun === "function"
            ? checklistStageAnchorForRun(anchor, checklistRun, stageInfo.stage)
            : null;
      } catch (error) {
        stageAnchor = null;
      }
      if (!stageAnchor) {
        return false;
      }
      try {
        checklistAddClass(stageAnchor, CHECKLIST_TASK_HIDDEN_CLASS);
      } catch (error) {
        // Hiding is best-effort.
      }
      let tooltip = null;
      let aria = null;
      try {
        tooltip =
          typeof checklistStageLabelTooltip === "function"
            ? checklistStageLabelTooltip(stageInfo.stage, stageInfo.kind, config)
            : null;
        aria =
          typeof checklistStageLabelAria === "function"
            ? checklistStageLabelAria(stageInfo.stage, stageInfo.kind, config)
            : null;
      } catch (error) {
        tooltip = null;
        aria = null;
      }
      try {
        if (typeof anchor.setAttribute === "function") {
          if (aria) {
            anchor.setAttribute("aria-label", aria);
          }
          if (tooltip) {
            anchor.setAttribute("title", tooltip);
          }
        } else {
          if (aria) {
            anchor["aria-label"] = aria;
          }
          if (tooltip) {
            anchor.title = tooltip;
          }
        }
      } catch (error) {
        // Tooltip update is best-effort.
      }
      const doc = this.taskTagStageDocFor(container, anchor);
      if (!doc || typeof doc.createElement !== "function") {
        return true;
      }
      try {
        const parent = stageAnchor.parentNode || anchor.parentNode || null;
        if (!parent) {
          return true;
        }
        const kids = parent.childNodes || [];
        let existing = null;
        try {
          for (const kid of kids) {
            if (!kid || typeof kid !== "object" || kid.nodeType !== 1) {
              continue;
            }
            let classes = "";
            try {
              classes =
                typeof kid.className === "string"
                  ? kid.className
                  : typeof kid.getAttribute === "function"
                    ? kid.getAttribute("class") || ""
                    : "";
            } catch (error) {
              classes = "";
            }
            if (
              typeof classes === "string" &&
              classes.split(/\s+/).indexOf(CHECKLIST_STAGE_LABEL_CLASS) !== -1
            ) {
              existing = kid;
              break;
            }
          }
        } catch (error) {
          existing = null;
        }
        const wanted = String(stageInfo.stage).toLowerCase();
        if (existing) {
          try {
            const currentText =
              typeof existing.textContent === "string" ? existing.textContent : "";
            if (currentText !== wanted) {
              existing.textContent = wanted;
            }
          } catch (error) {
            // Text update is best-effort.
          }
          return true;
        }
        const label =
          typeof checklistStageLabelElement === "function"
            ? checklistStageLabelElement(doc, wanted)
            : null;
        if (!label) {
          return true;
        }
        try {
          if (typeof parent.insertBefore === "function") {
            parent.insertBefore(label, stageAnchor.nextSibling || null);
            try {
              label.parentNode = parent;
            } catch (error) {
              // Parent link is best-effort for fake DOM.
            }
          } else if (typeof parent.appendChild === "function") {
            parent.appendChild(label);
          }
        } catch (error) {
          // Insertion is best-effort; the hidden anchor still preserves copy.
        }
      } catch (error) {
        // Label insertion is best-effort.
      }
      return true;
    } catch (error) {
      return false;
    }
  }
}
