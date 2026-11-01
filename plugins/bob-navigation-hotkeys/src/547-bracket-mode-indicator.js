// Bracket mode footer: always-visible `[[ s w n ]]` status-bar indicator.
// Desktop only. Pure view model plus an idempotent painter that reuses one
// DOM tree. Never throws; never changes walk behavior.
const BRACKET_MODE_FAMILIES = Object.freeze([
  Object.freeze({
    type: "s",
    letter: "s",
    name: "review walk",
    keys: "]s / [s",
    tooltip: "]] / [[ repeat the review walk (]s / [s)",
    segmentAria: "Review walk (]s / [s)",
  }),
  Object.freeze({
    type: "w",
    letter: "w",
    name: "lane walk",
    keys: "]w / [w",
    tooltip: "]] / [[ repeat the lane walk (]w / [w)",
    segmentAria: "Lane walk (]w / [w)",
  }),
  Object.freeze({
    type: "n",
    letter: "n",
    name: "links",
    keys: "]n / [n",
    tooltip: "]] / [[ open the next / previous link (]n / [n)",
    segmentAria: "Links (]n / [n)",
  }),
]);

const BRACKET_MODE_FLASH_MS = Object.freeze({
  forward: 450,
  backward: 450,
  empty: 650,
});

const BRACKET_MODE_ACTIVE_HINT = "s review \u00b7 w lanes \u00b7 n links \u2014 click a letter to switch";
const BRACKET_MODE_NONE_HINT = "s review \u00b7 w lanes \u00b7 n links \u2014 click a letter to choose";

function bracketModeFamilyFor(type) {
  for (const family of BRACKET_MODE_FAMILIES) {
    if (family.type === type) {
      return family;
    }
  }
  return null;
}

function buildBracketModeView(type) {
  let normalized = null;
  try {
    if (typeof normalizeBracketRepeatType === "function") {
      normalized = normalizeBracketRepeatType(type);
    } else {
      normalized = type === "s" || type === "w" || type === "n" ? type : null;
    }
  } catch (error) {
    normalized = type === "s" || type === "w" || type === "n" ? type : null;
  }
  if (normalized === null) {
    let emptyNotice = "";
    try {
      emptyNotice =
        typeof BRACKET_REPEAT_EMPTY_NOTICE === "string"
          ? BRACKET_REPEAT_EMPTY_NOTICE
          : "Nothing to repeat yet \u2014 press ]s, ]w, or ]n first";
    } catch (error) {
      emptyNotice = "Nothing to repeat yet \u2014 press ]s, ]w, or ]n first";
    }
    const segments = BRACKET_MODE_FAMILIES.map((family) =>
      Object.freeze({
        type: family.type,
        letter: family.letter,
        name: family.name,
        active: false,
        ariaLabel: family.segmentAria,
      }),
    );
    return Object.freeze({
      mode: "none",
      index: -1,
      ariaLabel: "Bracket repeat mode: not set",
      tooltip: `${emptyNotice}\n\n${BRACKET_MODE_NONE_HINT}`,
      segments: Object.freeze(segments),
    });
  }
  const family = bracketModeFamilyFor(normalized);
  const index = BRACKET_MODE_FAMILIES.indexOf(family);
  const segments = BRACKET_MODE_FAMILIES.map((item) =>
    Object.freeze({
      type: item.type,
      letter: item.letter,
      name: item.name,
      active: item.type === normalized,
      ariaLabel: item.segmentAria,
    }),
  );
  return Object.freeze({
    mode: normalized,
    index,
    ariaLabel: `Bracket repeat mode: ${family.name}`,
    tooltip: `${family.tooltip}\n\n${BRACKET_MODE_ACTIVE_HINT}`,
    segments: Object.freeze(segments),
  });
}

function bracketModeSetText(node, text) {
  if (!node) {
    return;
  }
  const value = text == null ? "" : String(text);
  try {
    if (typeof node.setText === "function") {
      node.setText(value);
    } else if ("textContent" in node) {
      node.textContent = value;
    }
  } catch (error) {
    // Cosmetic.
  }
}

function bracketModeSetAttr(node, name, value) {
  if (!node || !name) {
    return;
  }
  try {
    if (typeof node.setAttribute === "function") {
      node.setAttribute(name, value);
    } else if (name === "title") {
      node.title = value;
    }
  } catch (error) {
    // Cosmetic.
  }
}

function bracketModeRemoveAttr(node, name) {
  if (!node || !name) {
    return;
  }
  try {
    if (typeof node.removeAttribute === "function") {
      node.removeAttribute(name);
    }
  } catch (error) {
    // Cosmetic.
  }
}

function bracketModeToggleClass(node, name, on) {
  if (!node || !name) {
    return;
  }
  try {
    if (node.classList && typeof node.classList.add === "function") {
      if (on) {
        node.classList.add(name);
      } else if (typeof node.classList.remove === "function") {
        node.classList.remove(name);
      }
      return;
    }
    if (typeof node.addClass === "function" && on) {
      node.addClass(name);
      return;
    }
    if (typeof node.removeClass === "function" && !on) {
      node.removeClass(name);
    }
  } catch (error) {
    // Cosmetic.
  }
}

function bracketModeTooltipSetter() {
  try {
    if (
      typeof obsidian !== "undefined" &&
      obsidian &&
      typeof obsidian.setTooltip === "function"
    ) {
      return obsidian.setTooltip;
    }
  } catch (error) {
    // Fall through to globals.
  }
  try {
    if (typeof setTooltip === "function") {
      return setTooltip;
    }
  } catch (error) {
    // No global setter.
  }
  try {
    if (
      typeof window !== "undefined" &&
      window &&
      typeof window.setTooltip === "function"
    ) {
      return window.setTooltip;
    }
  } catch (error) {
    // No window setter.
  }
  return null;
}

function bracketModeApplyTooltip(node, text) {
  if (!node) {
    return;
  }
  const value = text == null ? "" : String(text);
  if (!value) {
    return;
  }
  try {
    const setter = bracketModeTooltipSetter();
    if (setter) {
      setter(node, value, { placement: "top" });
      try {
        if (typeof node.removeAttribute === "function") {
          node.removeAttribute("title");
        } else if ("title" in node) {
          node.title = "";
        }
      } catch (error) {
        // Best-effort: never hold both tooltip and title.
      }
      return;
    }
  } catch (error) {
    // Fall through to title.
  }
  bracketModeSetAttr(node, "title", value);
}

function bracketModeCreateChild(parent, tag, className) {
  if (!parent) {
    return null;
  }
  const options = className ? { cls: className } : {};
  if (tag === "span") {
    try {
      if (typeof parent.createSpan === "function") {
        return parent.createSpan(options);
      }
    } catch (error) {
      // Fall through to createEl.
    }
  }
  try {
    if (typeof parent.createEl === "function") {
      return parent.createEl(tag, options);
    }
  } catch (error) {
    // Fall through to DOM.
  }
  try {
    const doc =
      parent.ownerDocument ||
      (typeof document !== "undefined" ? document : null);
    if (doc && typeof doc.createElement === "function") {
      const node = doc.createElement(tag);
      if (className) {
        if (typeof node.className === "string") {
          node.className = className;
        } else if (node.classList && typeof node.classList.add === "function") {
          for (const cls of String(className).split(/\s+/)) {
            if (cls) {
              node.classList.add(cls);
            }
          }
        }
      }
      if (typeof parent.appendChild === "function") {
        parent.appendChild(node);
      }
      return node;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function bracketModeIsDesktop() {
  try {
    let bundled = null;
    try {
      bundled =
        typeof obsidian !== "undefined" && obsidian && obsidian.Platform
          ? obsidian.Platform
          : null;
    } catch (error) {
      bundled = null;
    }
    let ambient = null;
    try {
      ambient = typeof Platform !== "undefined" ? Platform : null;
    } catch (error) {
      ambient = null;
    }
    for (const platform of [bundled, ambient]) {
      if (!platform) {
        continue;
      }
      if (platform.isDesktopApp === false) {
        return false;
      }
      if (platform.isMobile === true) {
        return false;
      }
    }
    return true;
  } catch (error) {
    return true;
  }
}

function bracketModeNextFrame(callback) {
  try {
    if (typeof requestAnimationFrame === "function") {
      return {
        kind: "raf",
        id: requestAnimationFrame(callback),
      };
    }
  } catch (error) {
    // Fall through to timeout.
  }
  try {
    if (
      typeof window !== "undefined" &&
      window &&
      typeof window.requestAnimationFrame === "function"
    ) {
      return {
        kind: "raf",
        id: window.requestAnimationFrame(callback),
      };
    }
  } catch (error) {
    // Fall through to timeout.
  }
  return { kind: "timeout", id: setTimeout(callback, 0) };
}

function bracketModeCancelFrame(handle) {
  if (!handle) {
    return;
  }
  const id = handle && typeof handle === "object" && "id" in handle ? handle.id : handle;
  const kind = handle && typeof handle === "object" ? handle.kind : null;
  if (kind === "raf" || kind === null || kind === undefined) {
    try {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(id);
      }
    } catch (error) {
      // Best-effort.
    }
    try {
      if (
        typeof window !== "undefined" &&
        window &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(id);
      }
    } catch (error) {
      // Best-effort.
    }
  }
  try {
    clearTimeout(id);
  } catch (error) {
    // Best-effort.
  }
}

function ensureBracketModeDom(el) {
  if (!el) {
    return null;
  }
  try {
    if (
      el._bobBracketModeParts &&
      el._bobBracketModeParts.back &&
      el._bobBracketModeParts.track &&
      el._bobBracketModeParts.thumb &&
      Array.isArray(el._bobBracketModeParts.segments) &&
      el._bobBracketModeParts.segments.length === 3 &&
      el._bobBracketModeParts.forward
    ) {
      return el._bobBracketModeParts;
    }
  } catch (error) {
    // Rebuild below.
  }
  try {
    if (typeof el.empty === "function") {
      el.empty();
    } else if ("textContent" in el) {
      el.textContent = "";
    }
  } catch (error) {
    // Rebuild below.
  }
  const back = bracketModeCreateChild(el, "span", "bob-bracket-mode-key is-backward");
  const track = bracketModeCreateChild(el, "span", "bob-bracket-mode-track");
  if (!back || !track) {
    return null;
  }
  bracketModeSetText(back, "[[");
  bracketModeSetAttr(back, "aria-hidden", "true");
  const thumb = bracketModeCreateChild(track, "span", "bob-bracket-mode-thumb");
  if (!thumb) {
    return null;
  }
  bracketModeSetAttr(thumb, "aria-hidden", "true");
  const segments = [];
  for (const family of BRACKET_MODE_FAMILIES) {
    const button = bracketModeCreateChild(track, "button", "bob-bracket-mode-seg");
    if (!button) {
      return null;
    }
    bracketModeSetAttr(button, "type", "button");
    bracketModeSetAttr(button, "data-bracket-type", family.type);
    bracketModeSetText(button, family.letter);
    bracketModeSetAttr(button, "aria-pressed", "false");
    bracketModeSetAttr(button, "aria-label", family.segmentAria);
    segments.push(button);
  }
  const forward = bracketModeCreateChild(el, "span", "bob-bracket-mode-key is-forward");
  if (!forward) {
    return null;
  }
  bracketModeSetText(forward, "]]");
  bracketModeSetAttr(forward, "aria-hidden", "true");
  const parts = { back, track, thumb, segments, forward };
  try {
    el._bobBracketModeParts = parts;
  } catch (error) {
    // Cache is best-effort.
  }
  return parts;
}

function paintBracketModeIndicator(el, parts, view, previousMode) {
  if (!el || !parts || !view) {
    return parts || null;
  }
  const safe = view && typeof view === "object" ? view : null;
  if (!safe || (safe.mode !== "s" && safe.mode !== "w" && safe.mode !== "n" && safe.mode !== "none")) {
    return parts;
  }
  if (safe.mode === previousMode && el._bobBracketModePaintKey === safe.mode) {
    return parts;
  }
  if (safe.mode === previousMode && previousMode !== undefined && el._bobBracketModePaintKey === undefined) {
    return parts;
  }
  const resolvedParts = parts && parts.track ? parts : ensureBracketModeDom(el);
  if (!resolvedParts) {
    return null;
  }
  try {
    bracketModeSetAttr(el, "data-bracket-mode", safe.mode);
  } catch (error) {
    // Cosmetic.
  }
  try {
    const value = String(safe.index);
    if (el.style && typeof el.style.setProperty === "function") {
      el.style.setProperty("--bob-bracket-index", value);
    } else {
      throw new Error("no setProperty");
    }
  } catch (error) {
    try {
      bracketModeSetAttr(el, "style", `--bob-bracket-index: ${safe.index}`);
    } catch (ignored) {
      // Cosmetic.
    }
  }
  try {
    bracketModeSetAttr(el, "role", "group");
  } catch (error) {
    // Cosmetic.
  }
  try {
    bracketModeSetAttr(el, "aria-label", safe.ariaLabel || "");
  } catch (error) {
    // Cosmetic.
  }
  bracketModeApplyTooltip(el, safe.tooltip || "");
  const segments = Array.isArray(resolvedParts.segments) ? resolvedParts.segments : [];
  for (let index = 0; index < segments.length; index += 1) {
    const node = segments[index];
    const expected = Array.isArray(safe.segments) ? safe.segments[index] : null;
    if (!node || !expected) {
      continue;
    }
    const active = expected.active === true;
    bracketModeToggleClass(node, "is-active", active);
    bracketModeSetAttr(node, "aria-pressed", active ? "true" : "false");
    bracketModeSetAttr(node, "aria-label", expected.ariaLabel || "");
  }
  const fresh =
    previousMode === undefined ||
    previousMode === null ||
    (previousMode === "none" && safe.mode !== "none");
  try {
    if (fresh) {
      bracketModeToggleClass(el, "is-instant", true);
      try {
        bracketModeCancelFrame(el._bobBracketModeInstantFrame);
      } catch (error) {
        // Replace below.
      }
      const frame = bracketModeNextFrame(() => {
        try {
          bracketModeToggleClass(el, "is-instant", false);
        } catch (error) {
          // Cosmetic.
        }
        try {
          el._bobBracketModeInstantFrame = null;
        } catch (error) {
          // Cache is best-effort.
        }
      });
      try {
        el._bobBracketModeInstantFrame = frame;
      } catch (error) {
        // Cache is best-effort.
      }
    } else {
      try {
        bracketModeCancelFrame(el._bobBracketModeInstantFrame);
      } catch (error) {
        // Best-effort.
      }
      try {
        el._bobBracketModeInstantFrame = null;
      } catch (error) {
        // Cache is best-effort.
      }
      bracketModeToggleClass(el, "is-instant", false);
    }
  } catch (error) {
    // Instant handling never blocks the paint.
  }
  try {
    el._bobBracketModePaintKey = safe.mode;
  } catch (error) {
    // Cache is best-effort.
  }
  return resolvedParts;
}

class BobNavigationHotkeysBracketModeIndicatorMixin {
  setupBracketModeIndicator() {
    try {
      if (this.bracketModeEl) {
        return;
      }
      if (!bracketModeIsDesktop()) {
        return;
      }
      if (typeof this.addStatusBarItem !== "function") {
        return;
      }
      let el = null;
      try {
        el = this.addStatusBarItem();
      } catch (error) {
        return;
      }
      if (!el) {
        return;
      }
      this.bracketModeEl = el;
      this.bracketModeParts = null;
      this.bracketModePaintKey = undefined;
      this.bracketModeFlashTimer = null;
      this.bracketModeInstantFrame = null;
      try {
        if (typeof el.addClass === "function") {
          el.addClass("bob-bracket-mode");
        } else if (el.classList && typeof el.classList.add === "function") {
          el.classList.add("bob-bracket-mode");
        } else if (typeof el.className === "string") {
          el.className = `${el.className} bob-bracket-mode`.trim();
        }
      } catch (error) {
        // Cosmetic.
      }
      try {
        bracketModeSetAttr(el, "role", "group");
      } catch (error) {
        // Cosmetic.
      }
      let parts = null;
      try {
        parts = ensureBracketModeDom(el);
      } catch (error) {
        parts = null;
      }
      this.bracketModeParts = parts;
      try {
        const segments = (parts && parts.segments) || [];
        for (const node of segments) {
          let type = null;
          try {
            if (node && typeof node.getAttribute === "function") {
              type = node.getAttribute("data-bracket-type");
            } else if (node && node.attrs) {
              type = node.attrs["data-bracket-type"] || null;
            }
          } catch (error) {
            type = null;
          }
          if (!type) {
            const index = segments.indexOf(node);
            const family = BRACKET_MODE_FAMILIES[index];
            type = family ? family.type : null;
          }
          const captured = type;
          const onClick = () => {
            try {
              this.selectBracketModeFromIndicator(captured);
            } catch (error) {
              // Clicks never throw.
            }
          };
          const onMousedown = (event) => {
            try {
              if (event && typeof event.preventDefault === "function") {
                event.preventDefault();
              }
            } catch (error) {
              // Best-effort.
            }
          };
          try {
            if (typeof this.registerDomEvent === "function") {
              this.registerDomEvent(node, "click", onClick);
              this.registerDomEvent(node, "mousedown", onMousedown);
            } else if (node && typeof node.addEventListener === "function") {
              node.addEventListener("click", onClick);
              node.addEventListener("mousedown", onMousedown);
            } else if (node) {
              const key = `__bobBracketModeClick_${captured}`;
              try {
                node[key] = onClick;
              } catch (error) {
                // Test fakes without listeners still select via direct calls.
              }
            }
          } catch (error) {
            // One bad button never blocks the rest.
          }
        }
      } catch (error) {
        // Listeners are best-effort.
      }
      try {
        this.readBracketRepeatType();
      } catch (error) {
        // Storage read never blocks the mount.
      }
      try {
        this.refreshBracketModeIndicator();
      } catch (error) {
        // Paint never blocks the mount.
      }
    } catch (error) {
      // The indicator never blocks startup.
    }
  }

  refreshBracketModeIndicator() {
    try {
      const el = this.bracketModeEl;
      if (!el) {
        return;
      }
      let current = null;
      try {
        current = this.bracketRepeatType;
      } catch (error) {
        current = null;
      }
      const view = buildBracketModeView(current);
      const previous = this.bracketModePaintKey;
      if (view.mode === previous && this.bracketModeParts) {
        return;
      }
      let parts = this.bracketModeParts;
      if (!parts) {
        try {
          parts = ensureBracketModeDom(el);
        } catch (error) {
          parts = null;
        }
        this.bracketModeParts = parts;
      }
      if (!parts) {
        return;
      }
      let painted = null;
      try {
        painted = paintBracketModeIndicator(el, parts, view, previous);
      } catch (error) {
        return;
      }
      if (painted) {
        this.bracketModeParts = painted;
      }
      try {
        this.bracketModeInstantFrame = el._bobBracketModeInstantFrame || null;
      } catch (error) {
        // Cache is best-effort.
      }
      this.bracketModePaintKey = view.mode;
    } catch (error) {
      // Refresh never throws.
    }
  }

  flashBracketModeIndicator(kind) {
    try {
      const el = this.bracketModeEl;
      if (!el) {
        return;
      }
      const normalized = kind === "forward" || kind === "backward" || kind === "empty" ? kind : null;
      if (!normalized) {
        return;
      }
      const ms =
        normalized === "empty"
          ? BRACKET_MODE_FLASH_MS.empty
          : normalized === "backward"
            ? BRACKET_MODE_FLASH_MS.backward
            : BRACKET_MODE_FLASH_MS.forward;
      try {
        if (this.bracketModeFlashTimer) {
          clearTimeout(this.bracketModeFlashTimer);
          this.bracketModeFlashTimer = null;
        }
      } catch (error) {
        this.bracketModeFlashTimer = null;
      }
      try {
        bracketModeRemoveAttr(el, "data-bracket-flash");
      } catch (error) {
        // Best-effort.
      }
      try {
        void el.offsetWidth;
      } catch (error) {
        // Reflow is best-effort (headless fakes lack layout).
      }
      try {
        bracketModeSetAttr(el, "data-bracket-flash", normalized);
      } catch (error) {
        return;
      }
      try {
        this.bracketModeFlashTimer = setTimeout(() => {
          try {
            bracketModeRemoveAttr(el, "data-bracket-flash");
          } catch (error) {
            // Best-effort.
          }
          try {
            this.bracketModeFlashTimer = null;
          } catch (error) {
            // Best-effort.
          }
        }, ms);
      } catch (error) {
        this.bracketModeFlashTimer = null;
      }
    } catch (error) {
      // Flash never throws.
    }
  }

  selectBracketModeFromIndicator(type) {
    try {
      let normalized = null;
      try {
        if (typeof normalizeBracketRepeatType === "function") {
          normalized = normalizeBracketRepeatType(type);
        } else {
          normalized = type === "s" || type === "w" || type === "n" ? type : null;
        }
      } catch (error) {
        normalized = null;
      }
      if (!normalized) {
        return;
      }
      try {
        if (this.bracketRepeatType === normalized) {
          return;
        }
      } catch (error) {
        // Fall through to remember.
      }
      try {
        this.rememberBracketRepeatType(normalized);
      } catch (error) {
        // Selection never throws.
      }
    } catch (error) {
      // Selection never throws.
    }
  }

  teardownBracketModeIndicator() {
    try {
      if (this.bracketModeFlashTimer) {
        try {
          clearTimeout(this.bracketModeFlashTimer);
        } catch (error) {
          // Best-effort.
        }
        this.bracketModeFlashTimer = null;
      }
    } catch (error) {
      // Best-effort.
    }
    try {
      let frame = null;
      try {
        frame = this.bracketModeInstantFrame;
      } catch (error) {
        frame = null;
      }
      if (!frame) {
        try {
          frame = this.bracketModeEl && this.bracketModeEl._bobBracketModeInstantFrame;
        } catch (error) {
          frame = null;
        }
      }
      if (frame) {
        bracketModeCancelFrame(frame);
      }
      this.bracketModeInstantFrame = null;
      try {
        if (this.bracketModeEl) {
          this.bracketModeEl._bobBracketModeInstantFrame = null;
        }
      } catch (error) {
        // Cache is best-effort.
      }
    } catch (error) {
      // Best-effort.
    }
  }
}
