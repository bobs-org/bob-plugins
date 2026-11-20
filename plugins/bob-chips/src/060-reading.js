// Reading view, embeds, hover previews, and Tasks/Dataview containers.
// One Markdown post-processor for both chip kinds; no document-wide
// MutationObserver. Command chips mount through 061-reading-command.js.
// `data-bob-copy-processed` is the copy-only marker older builds (and the
// legacy bob-copy-chips plugin) also set on `run:` spans they could not
// parse, so only the kind-aware `data-bob-chip-processed` skips a span.
const COPY_CHIP_READING_PROCESSED = "data-bob-copy-processed";
const COMMAND_CHIP_READING_PROCESSED = "data-bob-chip-processed";

function copyChipReadingTagName(el) {
  try {
    const tag = (el && (el.tagName || el.nodeName)) || "";
    return String(tag).toUpperCase();
  } catch (error) {
    return "";
  }
}

function copyChipReadingHasClass(el, name) {
  try {
    if (el && el.classList && typeof el.classList.contains === "function") {
      return el.classList.contains(name);
    }
    const cls = (el && typeof el.getAttribute === "function" && el.getAttribute("class")) || "";
    return (" " + String(cls) + " ").indexOf(" " + name + " ") !== -1;
  } catch (error) {
    return false;
  }
}

// True when the code element must stay plain code: inside pre, a, an
// internal link, or an existing chip. Never throws.
function copyChipReadingShouldSkip(codeEl, root) {
  try {
    if (!codeEl) return true;
    try {
      if (codeEl.getAttribute && codeEl.getAttribute(COMMAND_CHIP_READING_PROCESSED) === "1") {
        return true;
      }
    } catch (error) {
      // Processed marker is best-effort.
    }
    let node = codeEl;
    let guard = 0;
    while (node && node !== root && guard < 50) {
      guard += 1;
      const tag = copyChipReadingTagName(node);
      if (tag === "PRE" || tag === "A" || tag === "BUTTON") return true;
      if (copyChipReadingHasClass(node, "bob-copy-chip")) return true;
      if (copyChipReadingHasClass(node, "bob-run-chip")) return true;
      if (copyChipReadingHasClass(node, "internal-link")) return true;
      // Code inside these hosts is rendered by another widget.
      if (
        copyChipReadingHasClass(node, "bob-dep-chip") ||
        copyChipReadingHasClass(node, "bob-task-link-mark")
      ) {
        return true;
      }
      try {
        node = node.parentElement || node.parentNode || null;
      } catch (error) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return true;
  }
}

function copyChipReadingMarkProcessed(el) {
  try {
    if (el && typeof el.setAttribute === "function") {
      el.setAttribute(COPY_CHIP_READING_PROCESSED, "1");
      el.setAttribute(COMMAND_CHIP_READING_PROCESSED, "1");
    }
  } catch (error) {
    // Marker is best-effort.
  }
}

// Renderer-normalized textContent goes straight to the grammar; CommonMark
// normalization already happened in the renderer, so never normalize twice.
// Table cells still carry an escaped pipe from source, so unescape `\|`
// when the code sits inside a rendered table.
function copyChipReadingInTable(codeEl) {
  try {
    let node = codeEl;
    let guard = 0;
    while (node && guard < 50) {
      guard += 1;
      try {
        const tag = String((node && (node.tagName || node.nodeName)) || "").toUpperCase();
        if (tag === "TABLE") return true;
      } catch (error) {
        // Tag check is best-effort.
      }
      try {
        node = node.parentElement || node.parentNode || null;
      } catch (error) {
        return false;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

function copyChipReadingChipForCode(codeEl) {
  try {
    if (!codeEl) return null;
    let text = null;
    try {
      text = codeEl.textContent;
    } catch (error) {
      return null;
    }
    if (typeof text !== "string") return null;
    try {
      if (copyChipReadingInTable(codeEl)) {
        text = String(text).replace(/\\\|/g, "|");
      }
      return copyChipParseContent(text);
    } catch (error) {
      return null;
    }
  } catch (error) {
    return null;
  }
}

// Both kinds from one code element, copy first like chipScanLine: frozen
// `{ kind, label, text, table }` or null.
function chipReadingChipForCode(codeEl) {
  try {
    if (!codeEl) return null;
    let text = codeEl.textContent;
    if (typeof text !== "string") return null;
    const table = copyChipReadingInTable(codeEl);
    if (table) text = text.replace(/\\\|/g, "|");
    let kind = "copy";
    let parsed = copyChipParseContent(text);
    if (!parsed) {
      kind = "run";
      parsed = runChipParseContent(text);
    }
    if (!parsed) return null;
    return copyChipFreeze({ kind, label: parsed.label, text: parsed.text, table });
  } catch (error) {
    return null;
  }
}

function copyChipReadingAttachCopy(button, payload) {
  try {
    if (!button || typeof button.addEventListener !== "function") return;
    const onActivate = (event) => {
      try {
        if (event && event.defaultPrevented) return;
        copyChipWrite(payload).then((result) => {
          try {
            if (result && result.ok) copyChipShowFeedback(button, "success");
            else copyChipFail(button, (result && result.reason) || "copy failed");
          } catch (error) {
            // Feedback is best-effort.
          }
        });
      } catch (error) {
        // Activation never throws.
      }
    };
    button.addEventListener("click", onActivate);
  } catch (error) {
    // Listener wiring is best-effort.
  }
}

function copyChipReadingReplaceCode(plugin, codeEl, root, ctx, known) {
  try {
    if (!known && copyChipReadingShouldSkip(codeEl, root)) {
      copyChipReadingMarkProcessed(codeEl);
      return false;
    }
    const parsed = known || copyChipReadingChipForCode(codeEl);
    if (!parsed) {
      copyChipReadingMarkProcessed(codeEl);
      return false;
    }
    const ownerDoc =
      (codeEl && codeEl.ownerDocument) ||
      (root && root.ownerDocument) ||
      (typeof document !== "undefined" ? document : null);
    if (!ownerDoc) return false;
    const button = copyChipBuildInline(ownerDoc, parsed, { interactive: true });
    if (!button) return false;
    copyChipReadingMarkProcessed(button);
    copyChipReadingAttachCopy(button, parsed.text);
    try {
      const parent = codeEl.parentNode || codeEl.parentElement || null;
      if (parent && typeof parent.replaceChild === "function") {
        parent.replaceChild(button, codeEl);
        copyChipReadingMarkProcessed(codeEl);
      } else {
        copyChipReadingMarkProcessed(codeEl);
        return false;
      }
    } catch (error) {
      try {
        copyChipReadingMarkProcessed(codeEl);
      } catch (ignore) {
        // Marker is best-effort.
      }
      return false;
    }
    // Scope the button lifecycle to the render child when available so
    // embeds and hover previews dispose their timers and listeners.
    try {
      if (
        CopyChipsMarkdownRenderChild &&
        ctx &&
        typeof ctx.addChild === "function"
      ) {
        const child = new CopyChipsMarkdownRenderChild(root);
        try {
          if (typeof child.register === "function") {
            child.register(() => copyChipClearFeedback(button));
          }
          if (typeof child.unload === "function") {
            const originalUnload = child.unload.bind(child);
            child.unload = () => {
              try {
                copyChipClearFeedback(button);
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
        plugin.register(() => copyChipClearFeedback(button));
      }
    } catch (error) {
      // Lifecycle scoping is best-effort.
    }
    return true;
  } catch (error) {
    return false;
  }
}

function copyChipReadingRender(plugin, el, ctx) {
  try {
    if (!el) return;
    const codes = [];
    try {
      if (copyChipReadingTagName(el) === "CODE") codes.push(el);
      if (el.querySelectorAll && typeof el.querySelectorAll === "function") {
        const found = el.querySelectorAll("code");
        const list = found && typeof found.length === "number" ? found : [];
        for (let index = 0; index < list.length; index += 1) {
          try {
            if (list[index] !== el) codes.push(list[index]);
          } catch (error) {
            continue;
          }
        }
      } else if (el.getElementsByTagName && typeof el.getElementsByTagName === "function") {
        const found = el.getElementsByTagName("code");
        for (let index = 0; index < found.length; index += 1) {
          try {
            if (found[index] !== el) codes.push(found[index]);
          } catch (error) {
            continue;
          }
        }
      }
    } catch (error) {
      return;
    }
    // Parse the whole snapshot first (replacement mutates the live DOM), so
    // command chips know how many equal spans this pass rendered. Repeat
    // processing is idempotent: processed nodes skip.
    const items = [];
    let render = null;
    for (const codeEl of codes.slice()) {
      try {
        if (copyChipReadingShouldSkip(codeEl, el)) {
          copyChipReadingMarkProcessed(codeEl);
          continue;
        }
        const parsed = chipReadingChipForCode(codeEl);
        if (!parsed) {
          copyChipReadingMarkProcessed(codeEl);
          continue;
        }
        if (parsed.kind === "run") {
          // An embed, hover preview, or query block below `el` is another
          // render with its own source; its own pass owns the span.
          if (commandChipReadingInNestedRender(codeEl, el)) continue;
          render = render || commandChipReadingRenderState(plugin, el, ctx);
          commandChipReadingCount(render, parsed);
        }
        items.push([codeEl, parsed]);
      } catch (error) {
        continue;
      }
    }
    for (const [codeEl, parsed] of items) {
      try {
        if (parsed.kind === "run") commandChipReadingReplaceCode(plugin, codeEl, el, parsed, render);
        else copyChipReadingReplaceCode(plugin, codeEl, el, ctx, parsed);
      } catch (error) {
        continue;
      }
    }
    if (render) commandChipReadingFinish(render);
  } catch (error) {
    // Reading rendering never throws.
  }
}

function copyChipSetupReading(plugin) {
  try {
    if (!plugin || typeof plugin.registerMarkdownPostProcessor !== "function") return false;
    if (plugin.copyChipReadingSetupDone === true) return true;
    plugin.copyChipReadingSetupDone = true;
    try {
      plugin.registerMarkdownPostProcessor((el, ctx) => copyChipReadingRender(plugin, el, ctx));
    } catch (error) {
      return false;
    }
    try {
      if (typeof plugin.register === "function") {
        plugin.register(() => {
          plugin.copyChipReadingSetupDone = false;
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
