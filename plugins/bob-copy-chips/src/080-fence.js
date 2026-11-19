// Titled `bob-copy` fence cards for Live Preview and Reading view.
// One `registerMarkdownCodeBlockProcessor("bob-copy", …)` covers both: the
// payload comes from `source`, the label from the section's opening line,
// and only the header button copies. Body clicks select text.
const COPY_CHIP_FENCE_FOLD_AFTER = 8;

const copyChipFencePayloads = new WeakMap();
const copyChipFenceButtonTimers = new WeakMap();
let copyChipFenceButtonSeq = 0;

function copyChipFenceNotePayload(el, text) {
  try {
    if (el) copyChipFencePayloads.set(el, String(text === undefined || text === null ? "" : text));
  } catch (error) {
    // Payload retention is best-effort.
  }
}

function copyChipFencePayloadOf(el) {
  try {
    if (!el) return null;
    return copyChipFencePayloads.get(el) || null;
  } catch (error) {
    return null;
  }
}

// {lines, chars} for the card meta and fold. "" is 0 lines; a trailing LF
// ends the last line instead of starting a new one. Never throws.
function copyChipFenceCounts(text) {
  try {
    const body = String(text === undefined || text === null ? "" : text);
    if (body === "") return copyChipFreeze({ lines: 0, chars: 0 });
    const parts = body.split("\n");
    const lines = body.charAt(body.length - 1) === "\n" ? parts.length - 1 : parts.length;
    return copyChipFreeze({ lines, chars: body.length });
  } catch (error) {
    return copyChipFreeze({ lines: 0, chars: 0 });
  }
}

function copyChipFenceLineWord(count) {
  return count === 1 ? "1 line" : String(count) + " lines";
}

// "4 lines · 212 chars", plus "· ends with ⏎" when the payload ends with
// LF. Counts are text, never attributes. Never throws.
function copyChipFenceMetaText(text) {
  try {
    const counts = copyChipFenceCounts(text);
    let meta = copyChipFenceLineWord(counts.lines) + " · " + String(counts.chars) + " chars";
    if (String(text === undefined || text === null ? "" : text).charAt(String(text || "").length - 1) === "\n") {
      meta += " · ends with ⏎";
    }
    return meta;
  } catch (error) {
    return "";
  }
}

// The labeled title, or the generic "Copy · N lines" when the section info
// is missing (callouts, some embeds) or carries no label. Never throws.
function copyChipFenceTitleText(label, text) {
  try {
    if (typeof label === "string" && label.trim() !== "") return label;
    const counts = copyChipFenceCounts(text);
    return "Copy · " + copyChipFenceLineWord(counts.lines);
  } catch (error) {
    return "Copy";
  }
}

// The label for one rendered fence: the section's opening line through the
// fence grammar. Null section info (callouts, some embeds) means the
// generic title, with the payload untouched. Never throws.
function copyChipFenceLabelFromContext(ctx, el) {
  try {
    if (!ctx || typeof ctx.getSectionInfo !== "function") return null;
    let section = null;
    try {
      section = ctx.getSectionInfo(el);
    } catch (error) {
      return null;
    }
    if (!section || typeof section.text !== "string") return null;
    return copyChipFenceLabelFromSectionText(section.text);
  } catch (error) {
    return null;
  }
}

function copyChipFencePayloadEquals(actual, expected) {
  try {
    const left = copyChipFencePayloadFromSource(actual == null ? "" : String(actual));
    const right = copyChipFencePayloadFromSource(expected == null ? "" : String(expected));
    if (left === right) return true;
    const strip = (text) => String(text).replace(/^[ \t]+/gm, "");
    return strip(left) === strip(right);
  } catch (error) {
    return false;
  }
}

function copyChipFenceCollectLabeledPayloads(markdown) {
  const out = [];
  try {
    const lines = String(markdown == null ? "" : markdown).split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      let opening = null;
      try {
        const raw = String(lines[index] == null ? "" : lines[index]);
        const stripped = raw.replace(/^[ \t]*>[ \t]?/, "");
        opening = copyChipFenceOpeningFromLine(stripped) || copyChipFenceOpeningFromLine(raw);
      } catch (error) {
        opening = null;
      }
      if (!opening) continue;
      let parsed = null;
      try {
        parsed = copyChipParseFenceInfo(opening.info);
      } catch (error) {
        parsed = null;
      }
      if (!parsed) continue;
      let closeAt = -1;
      try {
        closeAt = copyChipScanFenceClose(lines, index, opening);
      } catch (error) {
        closeAt = -1;
      }
      const end = closeAt < 0 ? lines.length : closeAt;
      const body = [];
      for (let cursor = index + 1; cursor < end; cursor += 1) {
        body.push(String(lines[cursor] == null ? "" : lines[cursor]));
      }
      let text = "";
      try {
        text = copyChipFencePayloadFromSource(copyChipFencePayload(body));
      } catch (error) {
        text = body.join("\n");
      }
      out.push({ label: parsed.label, text, openIndex: index });
      index = end;
    }
  } catch (error) {
    return [];
  }
  return out;
}

function copyChipFenceLabelForPayload(markdown, payload) {
  try {
    const matches = copyChipFenceCollectLabeledPayloads(markdown).filter((entry) =>
      copyChipFencePayloadEquals(entry.text, payload),
    );
    if (matches.length === 1) return matches[0].label;
    return undefined;
  } catch (error) {
    return undefined;
  }
}

function copyChipFenceMarkdownFromPlugin(plugin, ctx) {
  try {
    const path = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : null;
    const app = plugin && plugin.app;
    if (!path || !app || !app.workspace) return null;
    const leaf = app.workspace.activeLeaf;
    const view = leaf && leaf.view;
    if (view && view.file && view.file.path === path) {
      if (view.editor && typeof view.editor.getValue === "function") {
        return String(view.editor.getValue());
      }
      if (typeof view.data === "string") return view.data;
    }
    if (app.workspace.getLeavesOfType) {
      const leaves = app.workspace.getLeavesOfType("markdown") || [];
      for (let index = 0; index < leaves.length; index += 1) {
        try {
          const candidate = leaves[index] && leaves[index].view;
          if (!candidate || !candidate.file || candidate.file.path !== path) continue;
          if (candidate.editor && typeof candidate.editor.getValue === "function") {
            return String(candidate.editor.getValue());
          }
          if (typeof candidate.data === "string") return candidate.data;
        } catch (error) {
          continue;
        }
      }
    }
  } catch (error) {
    return null;
  }
  return null;
}

function copyChipFenceLabelForRender(plugin, ctx, el, payload) {
  try {
    if (ctx && typeof ctx.getSectionInfo === "function") {
      let section = null;
      try {
        section = ctx.getSectionInfo(el);
      } catch (error) {
        section = null;
      }
      if (section && typeof section.text === "string") {
        const matches = copyChipFenceCollectLabeledPayloads(section.text).filter((entry) =>
          copyChipFencePayloadEquals(entry.text, payload),
        );
        if (matches.length === 1) return matches[0].label;
      }
    }
    const markdown = copyChipFenceMarkdownFromPlugin(plugin, ctx);
    if (typeof markdown === "string") {
      const matched = copyChipFenceLabelForPayload(markdown, payload);
      if (matched !== undefined) return matched;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function copyChipFenceMakeEl(doc, tag, className) {
  try {
    if (!doc || typeof doc.createElement !== "function") return null;
    const el = doc.createElement(tag);
    try {
      if (className) el.setAttribute("class", className);
    } catch (error) {
      // Class setup is best-effort on fake nodes.
    }
    return el;
  } catch (error) {
    return null;
  }
}

function copyChipFenceClearButtonTimer(button) {
  try {
    const record = copyChipFenceButtonTimers.get(button);
    if (record && record.handle) {
      try {
        const doc = (button && button.ownerDocument) || (typeof document !== "undefined" ? document : null);
        copyChipTimerHost(doc).clear(record.handle);
      } catch (error) {
        // Timer cancellation is best-effort.
      }
    }
    copyChipFenceButtonTimers.delete(button);
  } catch (error) {
    // Clearing never throws.
  }
}

// Swap the button face for one dwell, then restore "Copy". A fixed
// min-width in CSS keeps the header from reflowing. Never throws.
function copyChipFenceFlashButton(button, face, dwellMs) {
  try {
    if (!button) return;
    const doc = (button && button.ownerDocument) || (typeof document !== "undefined" ? document : null);
    copyChipFenceButtonSeq += 1;
    const token = copyChipFenceButtonSeq;
    copyChipFenceClearButtonTimer(button);
    try {
      button.textContent = face;
    } catch (error) {
      // Face swap is best-effort.
    }
    let handle = null;
    try {
      handle = copyChipTimerHost(doc).set(() => {
        try {
          const current = copyChipFenceButtonTimers.get(button);
          if (!current || current.token !== token) return;
          copyChipFenceButtonTimers.delete(button);
          try {
            button.textContent = "Copy";
          } catch (error) {
            // Restore is best-effort.
          }
        } catch (error) {
          // Expiry never throws.
        }
      }, dwellMs);
    } catch (error) {
      handle = null;
    }
    copyChipFenceButtonTimers.set(button, { token, handle });
  } catch (error) {
    // Button feedback never throws.
  }
}

// Builds the card. `chip` is {label, text}. Payload travels through
// textContent and the payload WeakMap only — never attributes, innerHTML,
// or the accessible name. Interactive children are real <button> elements
// unless `options.interactive === false` (inert author preview). Never
// registers clipboard gestures by itself; returns the card or null.
function copyChipBuildFence(doc, chip, options) {
  try {
    if (!doc || typeof doc.createElement !== "function") return null;
    if (!chip || typeof chip !== "object") return null;
    if (typeof chip.text !== "string") return null;
    const label = chip.label === undefined ? null : chip.label;
    if (label !== null && label !== undefined && typeof label !== "string") return null;
    const opts = options && typeof options === "object" ? options : {};
    const interactive = opts.interactive !== false;
    const text = chip.text;
    const counts = copyChipFenceCounts(text);

    const card = copyChipFenceMakeEl(doc, "div", "bob-copy-fence");
    if (!card) return null;

    const header = copyChipFenceMakeEl(doc, "div", "bob-copy-fence-header");
    if (!header) return null;
    let glyph = null;
    try {
      glyph = doc.createElement("span");
      glyph.setAttribute("class", "bob-copy-chip-glyph");
      copyChipPaintGlyph(glyph, "copy");
      header.appendChild(glyph);
    } catch (error) {
      glyph = null;
    }
    const title = copyChipFenceMakeEl(doc, "span", "bob-copy-fence-title");
    if (!title) return null;
    try {
      title.textContent = copyChipFenceTitleText(label, text);
    } catch (error) {
      // Title text is best-effort.
    }
    header.appendChild(title);
    const meta = copyChipFenceMakeEl(doc, "span", "bob-copy-fence-meta");
    if (!meta) return null;
    try {
      meta.textContent = copyChipFenceMetaText(text);
    } catch (error) {
      // Meta text is best-effort.
    }
    header.appendChild(meta);
    const button = copyChipFenceMakeEl(
      doc,
      interactive ? "button" : "span",
      "bob-copy-fence-copy",
    );
    if (!button) return null;
    try {
      if (interactive && typeof button.setAttribute === "function") button.setAttribute("type", "button");
    } catch (error) {
      // Type setup is best-effort.
    }
    try {
      if (!interactive && typeof button.setAttribute === "function") {
        button.setAttribute("aria-hidden", "true");
      }
    } catch (error) {
      // Preview inertness is best-effort.
    }
    try {
      button.textContent = "Copy";
    } catch (error) {
      // Face text is best-effort.
    }
    header.appendChild(button);
    card.appendChild(header);

    const body = copyChipFenceMakeEl(doc, "div", "bob-copy-fence-body");
    if (!body) return null;
    try {
      body.textContent = text;
    } catch (error) {
      // Body text is best-effort.
    }
    const folded = interactive && counts.lines > COPY_CHIP_FENCE_FOLD_AFTER;
    if (folded) {
      try {
        body.classList.add("is-folded");
      } catch (error) {
        // Fold state is best-effort.
      }
    }
    card.appendChild(body);

    if (folded) {
      const toggle = copyChipFenceMakeEl(doc, "button", "bob-copy-fence-toggle");
      if (toggle) {
        try {
          if (typeof toggle.setAttribute === "function") toggle.setAttribute("type", "button");
        } catch (error) {
          // Type setup is best-effort.
        }
        const showAll = "Show all " + copyChipFenceLineWord(counts.lines);
        try {
          toggle.textContent = showAll;
        } catch (error) {
          // Toggle text is best-effort.
        }
        try {
          if (typeof toggle.addEventListener === "function") {
            toggle.addEventListener("click", () => {
              try {
                let isFolded = false;
                try {
                  isFolded = body.classList.contains("is-folded");
                } catch (error) {
                  isFolded = false;
                }
                if (isFolded) {
                  try {
                    body.classList.remove("is-folded");
                  } catch (error) {
                    // Unfold is best-effort.
                  }
                  try {
                    toggle.textContent = "Show less";
                  } catch (error) {
                    // Toggle text is best-effort.
                  }
                } else {
                  try {
                    body.classList.add("is-folded");
                  } catch (error) {
                    // Fold is best-effort.
                  }
                  try {
                    toggle.textContent = showAll;
                  } catch (error) {
                    // Toggle text is best-effort.
                  }
                }
              } catch (error) {
                // Toggling never throws.
              }
            });
          }
        } catch (error) {
          // Toggle wiring is best-effort.
        }
        card.appendChild(toggle);
      }
    }

    try {
      copyChipFenceNotePayload(card, text);
    } catch (error) {
      // Payload retention is best-effort.
    }
    return card;
  } catch (error) {
    return null;
  }
}

// The fence card matching a block chip's payload. Several cards sharing one
// payload stay ambiguous: no guessing. Never throws.
function copyChipFindFenceInView(view, chip) {
  try {
    if (!view || !view.dom || typeof view.dom.querySelectorAll !== "function") return null;
    if (!chip || typeof chip.text !== "string") return null;
    let list = null;
    try {
      list = view.dom.querySelectorAll(".bob-copy-fence");
    } catch (error) {
      return null;
    }
    if (!list || typeof list.length !== "number") return null;
    const matches = [];
    for (let index = 0; index < list.length; index += 1) {
      try {
        const el = list[index];
        if (copyChipFencePayloadOf(el) !== chip.text) continue;
        matches.push(el);
      } catch (error) {
        continue;
      }
    }
    if (matches.length === 1) return matches[0];
    return null;
  } catch (error) {
    return null;
  }
}

function copyChipFenceWireCopy(plugin, card, button, payload) {
  try {
    if (!button || typeof button.addEventListener !== "function") return;
    button.addEventListener("click", () => {
      try {
        copyChipWrite(payload).then((result) => {
          try {
            if (result && result.ok) {
              copyChipShowFeedback(card, "success");
              copyChipFenceFlashButton(button, "Copied ✓", COPY_CHIP_SUCCESS_MS);
            } else {
              copyChipFail(card, (result && result.reason) || "copy failed");
              copyChipFenceFlashButton(button, "Copy failed", COPY_CHIP_FAILURE_MS);
            }
          } catch (error) {
            // Feedback is best-effort.
          }
        });
      } catch (error) {
        // Activation never throws.
      }
    });
  } catch (error) {
    // Wiring is best-effort.
  }
}

// One processor render: payload from `source`, label from the section
// opening, then the card replaces the code block. Body clicks select text;
// only the button copies. Never throws and never writes the vault.
function copyChipRenderFence(plugin, source, el, ctx) {
  try {
    if (!el) return;
    const ownerDoc =
      (el && el.ownerDocument) ||
      (typeof document !== "undefined" ? document : null);
    if (!ownerDoc || typeof ownerDoc.createElement !== "function") return;
    const payload = copyChipFencePayloadFromSource(source);
    const label = copyChipFenceLabelForRender(plugin, ctx, el, payload);
    const card = copyChipBuildFence(ownerDoc, { label, text: payload });
    if (!card) return;
    try {
      if (typeof el.empty === "function") el.empty();
      else el.textContent = "";
    } catch (error) {
      try {
        el.textContent = "";
      } catch (ignore) {
        return;
      }
    }
    try {
      el.appendChild(card);
    } catch (error) {
      return;
    }
    let button = null;
    try {
      if (typeof card.querySelector === "function") {
        button = card.querySelector(".bob-copy-fence-copy");
      }
    } catch (error) {
      button = null;
    }
    copyChipFenceWireCopy(plugin, card, button, payload);
    // Scope timers to the render child when available so embeds and hover
    // previews dispose their button faces and feedback.
    try {
      const cleanup = () => {
        try {
          copyChipFenceClearButtonTimer(button);
        } catch (error) {
          // Timer cleanup is best-effort.
        }
        try {
          copyChipClearFeedback(card);
        } catch (error) {
          // Feedback cleanup is best-effort.
        }
      };
      if (
        CopyChipsMarkdownRenderChild &&
        ctx &&
        typeof ctx.addChild === "function"
      ) {
        const child = new CopyChipsMarkdownRenderChild(el);
        try {
          if (typeof child.register === "function") child.register(cleanup);
          if (typeof child.unload === "function") {
            const originalUnload = child.unload.bind(child);
            child.unload = () => {
              try {
                cleanup();
              } catch (error) {
                // Cleanup is best-effort.
              }
              return originalUnload();
            };
          }
        } catch (error) {
          // Child wiring is best-effort.
        }
        try {
          ctx.addChild(child);
        } catch (error) {
          // Render-child registration is best-effort.
        }
      } else if (plugin && typeof plugin.register === "function") {
        plugin.register(cleanup);
      }
    } catch (error) {
      // Lifecycle scoping is best-effort.
    }
  } catch (error) {
    // Fence rendering never throws.
  }
}

function copyChipSetupFence(plugin) {
  try {
    if (!plugin || typeof plugin.registerMarkdownCodeBlockProcessor !== "function") return false;
    if (plugin.copyChipFenceSetupDone === true) return true;
    plugin.copyChipFenceSetupDone = true;
    try {
      plugin.registerMarkdownCodeBlockProcessor("bob-copy", (source, el, ctx) =>
        copyChipRenderFence(plugin, source, el, ctx),
      );
    } catch (error) {
      return false;
    }
    try {
      if (typeof plugin.register === "function") {
        plugin.register(() => {
          plugin.copyChipFenceSetupDone = false;
        });
      }
    } catch (error) {
      // Unload cleanup is best-effort.
    }
    return true;
  } catch (error) {
    return false;
  }
}
