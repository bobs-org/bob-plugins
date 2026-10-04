// Dependency chips: Live Preview row element. `model` is
// `dependencyChipModel(...)`; `options` carries `{ sourcePath,
// interactive, onOpen(linktext, event, chip), onRemove(chip, event),
// onAdd(event) }`. Chips are focusable spans (Enter opens); the remove
// `×` and trailing `＋` render only when `interactive` is true (nav api
// v1 present). Never throws.
function buildDependencyChipElement(doc, model, options) {
  try {
    if (!doc || !model || typeof model !== "object") {
      return null;
    }
    const opts = options && typeof options === "object" ? options : {};
    const interactive = Boolean(opts.interactive);
    const chips = Array.isArray(model.chips) ? model.chips : [];
    const row = doc.createElement("span");
    row.setAttribute("class", "bob-dep-row");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "depends on, " + String(model.summary || ""));
    const label = doc.createElement("span");
    label.setAttribute("class", "bob-dep-label");
    label.setAttribute("aria-hidden", "true");
    label.appendChild(doc.createTextNode("⛓ depends on"));
    row.appendChild(label);
    for (const chip of chips) {
      try {
        if (!chip || typeof chip !== "object") {
          continue;
        }
        const el = doc.createElement("span");
        const state = String(chip.state || "todo");
        el.setAttribute("class", "bob-dep-chip is-" + state);
        el.setAttribute("data-state", state);
        el.setAttribute("role", "link");
        el.setAttribute("tabindex", "0");
        el.setAttribute("aria-label", String(chip.ariaLabel || chip.tooltip || chip.text || ""));
        if (chip.tooltip) {
          el.setAttribute("title", String(chip.tooltip));
          el.setAttribute("data-tooltip-position", "top");
        }
        const box = doc.createElement("span");
        box.setAttribute("class", "bob-dep-chip-box");
        box.setAttribute("data-task", state);
        box.setAttribute("aria-hidden", "true");
        box.appendChild(doc.createTextNode(String(chip.symbol || "○")));
        el.appendChild(box);
        const textEl = doc.createElement("span");
        textEl.setAttribute("class", "bob-dep-chip-text");
        textEl.appendChild(doc.createTextNode(String(chip.text || "")));
        el.appendChild(textEl);
        if (chip.noteLabel) {
          const note = doc.createElement("span");
          note.setAttribute("class", "bob-dep-chip-note");
          note.appendChild(doc.createTextNode(String(chip.noteLabel)));
          el.appendChild(note);
        }
        if (interactive && chip.blockId && state !== "done-collapsed") {
          const remove = doc.createElement("span");
          remove.setAttribute("class", "bob-dep-chip-remove");
          remove.setAttribute("role", "button");
          remove.setAttribute("tabindex", "0");
          remove.setAttribute("aria-label", "Remove dependency " + String(chip.fullText || chip.text || ""));
          remove.setAttribute("title", "Remove");
          remove.appendChild(doc.createTextNode("×"));
          try {
            if (typeof remove.addEventListener === "function") {
              remove.addEventListener("click", (event) => {
                try {
                  if (event && typeof event.stopPropagation === "function") {
                    event.stopPropagation();
                  }
                  if (event && typeof event.preventDefault === "function") {
                    event.preventDefault();
                  }
                  if (typeof opts.onRemove === "function") {
                    opts.onRemove(chip, event);
                  }
                } catch (error) {
                  // Best-effort only.
                }
              });
              remove.addEventListener("keydown", (event) => {
                try {
                  if (event && (event.key === "Enter" || event.key === " ")) {
                    if (typeof event.preventDefault === "function") {
                      event.preventDefault();
                    }
                    if (typeof opts.onRemove === "function") {
                      opts.onRemove(chip, event);
                    }
                  }
                } catch (error) {
                  // Best-effort only.
                }
              });
            }
          } catch (error) {
            // Listener-free remove still renders.
          }
          el.appendChild(remove);
        }
        try {
          if (typeof el.addEventListener === "function") {
            el.addEventListener("click", (event) => {
              try {
                if (event && event.target && event.target.classList && typeof event.target.classList.contains === "function") {
                  try {
                    if (event.target.classList.contains("bob-dep-chip-remove")) {
                      return;
                    }
                  } catch (inner) {
                    // Fall through to open.
                  }
                }
                if (typeof opts.onOpen === "function" && chip.linktext) {
                  opts.onOpen(chip.linktext, event, chip);
                }
              } catch (error) {
                // Best-effort only.
              }
            });
            el.addEventListener("keydown", (event) => {
              try {
                if (event && (event.key === "Enter" || event.key === " ")) {
                  if (typeof event.preventDefault === "function") {
                    event.preventDefault();
                  }
                  if (typeof opts.onOpen === "function" && chip.linktext) {
                    opts.onOpen(chip.linktext, event, chip);
                  }
                }
              } catch (error) {
                // Best-effort only.
              }
            });
            el.addEventListener("mouseover", (event) => {
              try {
                if (typeof opts.onHover === "function" && chip.linktext) {
                  opts.onHover(chip.linktext, event, el);
                }
              } catch (error) {
                // Best-effort only.
              }
            });
          }
        } catch (error) {
          // Listener-free chip still renders.
        }
        row.appendChild(doc.createTextNode(" "));
        row.appendChild(el);
      } catch (error) {
        continue;
      }
    }
    if (interactive) {
      try {
        row.appendChild(doc.createTextNode(" "));
        const add = doc.createElement("span");
        add.setAttribute("class", "bob-dep-add");
        add.setAttribute("role", "button");
        add.setAttribute("tabindex", "0");
        add.setAttribute("aria-label", "Edit task dependencies");
        add.setAttribute("title", "Edit task dependencies");
        add.appendChild(doc.createTextNode("＋"));
        if (typeof add.addEventListener === "function") {
          add.addEventListener("click", (event) => {
            try {
              if (event && typeof event.stopPropagation === "function") {
                event.stopPropagation();
              }
              if (typeof opts.onAdd === "function") {
                opts.onAdd(event);
              }
            } catch (error) {
              // Best-effort only.
            }
          });
          add.addEventListener("keydown", (event) => {
            try {
              if (event && (event.key === "Enter" || event.key === " ")) {
                if (typeof event.preventDefault === "function") {
                  event.preventDefault();
                }
                if (typeof opts.onAdd === "function") {
                  opts.onAdd(event);
                }
              }
            } catch (error) {
              // Best-effort only.
            }
          });
        }
        row.appendChild(add);
      } catch (error) {
        // Add button is best-effort.
      }
    }
    try {
      row.appendChild(doc.createTextNode(" "));
      const summary = doc.createElement("span");
      summary.setAttribute("class", "bob-dep-summary");
      summary.appendChild(doc.createTextNode(String(model.summary || "")));
      row.appendChild(summary);
    } catch (error) {
      // Summary is best-effort.
    }
    return row;
  } catch (error) {
    return null;
  }
}

