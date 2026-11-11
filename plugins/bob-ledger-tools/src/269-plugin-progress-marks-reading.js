// --- Task Link In Progress marks: Reading view ------------------------------
// `BobLedgerToolsProgressMarksReadingMixin` (see `310-install-methods.js`).
// The Reading-view half of the bob-cli-56 `progress-marks` phase, split from
// `268-plugin-progress-marks.js` so each fragment stays at or under 1000
// lines (mirroring the 270/280 model/render split). Synchronous throughout;
// never throws.
class BobLedgerToolsProgressMarksReadingMixin {
  // The reading-view context of `li`, or null: the first
  // `a.internal-link` owned directly by this row must be a bare
  // `target#^blockId` link (alias allowed, embed and struck rows
  // excluded), the row's own content must be exactly that link plus
  // an optional 🍅 prefix and an optional trailing `#` move-only
  // marker, and the row must hang directly off an open top-level
  // Pomodoro entry under a `## Pomodoros` heading. Source-line
  // mapping (via `ctx.getSectionInfo`) cannot serve full-note
  // reading views, which carry no section info, so the row's
  // ancestors carry the D3 rules instead. Never throws.
  progressMarkReadingContext(li, el, options = {}) {
    try {
      if (!li || li.nodeType !== 1) {
        return null;
      }
      const tagOf = (node) => {
        try {
          return String(node.tagName || node.nodeName || "").toUpperCase();
        } catch (error) {
          return "";
        }
      };
      if (tagOf(li) !== "LI") {
        return null;
      }
      // The first internal link owned directly by this row (never a
      // nested row's link).
      let anchor = null;
      try {
        const found =
          typeof li.querySelectorAll === "function"
            ? li.querySelectorAll("a.internal-link")
            : [];
        const list = typeof found.length === "number" ? found : [];
        for (const candidate of list) {
          try {
            if (!candidate || candidate.nodeType !== 1) {
              continue;
            }
            let owner = candidate.parentNode || null;
            let guard = 0;
            while (
              owner &&
              owner !== li &&
              owner !== el &&
              guard < 100
            ) {
              guard += 1;
              if (tagOf(owner) === "LI") {
                break;
              }
              owner = owner.parentNode || null;
            }
            if (owner === li) {
              anchor = candidate;
              break;
            }
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        return null;
      }
      if (!anchor) {
        return null;
      }
      const includeStruck = Boolean(options && options.includeStruck);
      const ledgerMarkClass = (node) => {
        try {
          return String(
            typeof node.getAttribute === "function"
              ? node.getAttribute("class") || ""
              : node.className || "",
          )
            .split(/\s+/)
            .some((name) =>
              [
                "bob-task-link-mark",
                "bob-progress-mark",
                "bob-unblocked-glyph",
                "bob-frees-mark",
                "bob-keep-moving-mark",
                "bob-off-clock-link-chip",
                "bob-event-link-time",
                "bob-today-mark",
                "list-bullet",
                "list-collapse-indicator",
                "collapse-icon",
              ].includes(name),
            );
        } catch (error) {
          return false;
        }
      };
      const tomatoOrSpace = (value) => /^[\s\u{1F345}\uFE0F]*$/u.test(value);
      let linkContainer = anchor;
      let scanRoot = li;
      // Reading view wraps optional Markdown strike-through in a del/s
      // element, and a loose list item's content in one `<p>`. Task
      // link mark filtering also examines struck ledger rows, while
      // progress marks keep their original exclusion.
      try {
        if (anchor.parentNode !== li) {
          let wrapper = anchor.parentNode || null;
          const wrapperTag = tagOf(wrapper);
          const wrapperChildren = (wrapper && wrapper.childNodes) || [];
          if (
            includeStruck &&
            ["S", "DEL", "STRIKE"].includes(wrapperTag) &&
            wrapperChildren.length === 1 &&
            wrapperChildren[0] === anchor
          ) {
            linkContainer = wrapper;
            wrapper = wrapper.parentNode || null;
          }
          if (tagOf(wrapper) === "P" && wrapper.parentNode === li) {
            for (const child of (li && li.childNodes) || []) {
              if (child === wrapper) {
                continue;
              }
              const nodeType = child && child.nodeType;
              if (nodeType === 3) {
                const value =
                  typeof child.nodeValue === "string"
                    ? child.nodeValue
                    : typeof child.textContent === "string"
                      ? child.textContent
                      : "";
                if (!tomatoOrSpace(value)) {
                  return null;
                }
                continue;
              }
              if (nodeType === 1 && ledgerMarkClass(child)) {
                continue;
              }
              if (nodeType === 1) {
                return null;
              }
            }
            scanRoot = wrapper;
          } else if (wrapper && wrapper !== li) {
            return null;
          }
        }
      } catch (error) {
        return null;
      }
      // Struck rows are excluded (the transclusion already shows its
      // own checkbox, and embeds never render as `a.internal-link`).
      try {
        let current = anchor.parentNode || null;
        let guard = 0;
        while (current && current !== li && guard < 100) {
          guard += 1;
          const tag = tagOf(current);
          if (!includeStruck && (tag === "S" || tag === "DEL" || tag === "STRIKE")) {
            return null;
          }
          current = current.parentNode || null;
        }
      } catch (error) {
        return null;
      }
      const getAttr =
        anchor && typeof anchor.getAttribute === "function"
          ? (name) => anchor.getAttribute(name)
          : () => null;
      const href = String(getAttr("data-href") || getAttr("href") || "");
      const pipe = href.indexOf("|");
      const raw = (pipe === -1 ? href : href.slice(0, pipe)).trim();
      const caret = raw.indexOf("#^");
      if (caret === -1) {
        return null;
      }
      const rawPath = raw.slice(0, caret).trim();
      const blockId = raw.slice(caret + 2).trim();
      if (!blockId || !PLAN_BLOCK_ID_RE.test(blockId)) {
        return null;
      }
      if (
        rawPath.includes("#") ||
        rawPath.includes("^") ||
        todayIsUriScheme(rawPath)
      ) {
        return null;
      }
      let target = rawPath;
      if (/\.md$/i.test(target)) {
        target = target.slice(0, -3);
      }
      // The row's own content is exactly the link: an optional 🍅
      // prefix, then the anchor, then an optional trailing `#`.
      // Display-only ledger mark hosts (rings, ◐, 🔓, 🔑, today)
      // sit beside the link and must not disqualify it.
      try {
        const children = (scanRoot && scanRoot.childNodes) || [];
        let seenAnchor = false;
        let beforeText = "";
        let afterText = "";
        for (const child of children) {
          try {
            if (child === linkContainer) {
              seenAnchor = true;
              continue;
            }
            const nodeType = child && child.nodeType;
            if (nodeType === 3) {
              const value =
                typeof child.nodeValue === "string"
                  ? child.nodeValue
                  : typeof child.textContent === "string"
                    ? child.textContent
                    : "";
              if (!seenAnchor) {
                beforeText += value;
              } else {
                afterText += value;
              }
              continue;
            }
            // Any element sibling (a rendered checkbox, a second
            // link, formatting) means the body is not exactly one
            // link. The anchor itself already continued above.
            if (nodeType === 1) {
              if (ledgerMarkClass(child)) {
                continue;
              }
              return null;
            }
          } catch (error) {
            return null;
          }
        }
        if (!seenAnchor) {
          return null;
        }
        if (!tomatoOrSpace(beforeText)) {
          return null;
        }
        if (!/^[\s]*#?[\s]*$/.test(afterText)) {
          return null;
        }
      } catch (error) {
        return null;
      }
      // The row hangs directly off an open top-level Pomodoro
      // entry: `li` > list > entry `li` > top-level list (whose
      // parent is not an `li`, so deeper nesting is excluded).
      let parentList = null;
      let entryLi = null;
      try {
        parentList = li.parentNode || null;
        if (tagOf(parentList) !== "UL" && tagOf(parentList) !== "OL") {
          return null;
        }
        entryLi = parentList.parentNode || null;
        if (tagOf(entryLi) !== "LI") {
          return null;
        }
        const topList = entryLi.parentNode || null;
        if (tagOf(topList) !== "UL" && tagOf(topList) !== "OL") {
          return null;
        }
        if (tagOf(topList.parentNode) === "LI") {
          return null;
        }
        const entryTask =
          entryLi && typeof entryLi.getAttribute === "function"
            ? entryLi.getAttribute("data-task")
            : null;
        // Pomodoro entries are task lines; open means anything but
        // completed or cancelled (the `planParseEntry` open test).
        if (typeof entryTask !== "string") {
          return null;
        }
        if (/^[xX-]$/.test(entryTask) && !(options && options.includeClosedEntry)) {
          return null;
        }
        // The entry's top-level list lives under a `## Pomodoros`
        // heading. Reading view may wrap that heading (and the list)
        // in `div.el-h2` / `div.el-ul`, so walk previous siblings and
        // look through one wrapper, then climb to the list's parent.
        const headingFrom = (node) => {
          const nodeTag = tagOf(node);
          if (/^H[1-6]$/.test(nodeTag)) {
            return node;
          }
          if (node && typeof node.querySelector === "function") {
            try {
              const found = node.querySelector("h1, h2, h3, h4, h5, h6");
              if (found) {
                return found;
              }
            } catch (error) {
              // Fall through to a child walk.
            }
          }
          for (const child of (node && node.childNodes) || []) {
            if (child && child.nodeType === 1 && /^H[1-6]$/.test(tagOf(child))) {
              return child;
            }
          }
          return null;
        };
        let start = topList;
        let pomodoros = false;
        let decided = false;
        let climb = 0;
        while (start && !decided && climb < 20) {
          climb += 1;
          let sibling = start.previousSibling || null;
          let guard = 0;
          while (sibling && guard < 100) {
            guard += 1;
            try {
              if (sibling.nodeType !== 1) {
                sibling = sibling.previousSibling || null;
                continue;
              }
              const heading = headingFrom(sibling);
              if (heading) {
                const headingTag = tagOf(heading);
                const text =
                  typeof heading.textContent === "string"
                    ? heading.textContent
                    : "";
                pomodoros =
                  headingTag === "H2" &&
                  text.trim().split(/\s+/)[0] === "Pomodoros";
                decided = true;
                break;
              }
              sibling = sibling.previousSibling || null;
            } catch (error) {
              break;
            }
          }
          if (!decided) {
            const parent = start.parentNode || null;
            if (
              !parent ||
              tagOf(parent) === "LI" ||
              tagOf(parent) === "BODY" ||
              tagOf(parent) === "HTML"
            ) {
              break;
            }
            start = parent;
          }
        }
        if (!decided || !pomodoros) {
          return null;
        }
      } catch (error) {
        return null;
      }
      return { anchor, target, blockId };
    } catch (error) {
      return null;
    }
  }

  renderProgressMarksIn(el, ctx) {
    try {
      if (!this.progressMarksEnabled) {
        return;
      }
      if (!el || !ctx) {
        return;
      }
      const sourcePath =
        typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!sourcePath) {
        return;
      }
      let dailyPath = null;
      try {
        dailyPath = this.currentTodayDailyPath(new Date());
      } catch (error) {
        dailyPath = null;
      }
      if (!dailyPath || !sameVaultPath(sourcePath, dailyPath)) {
        return;
      }
      let items = [];
      try {
        if (typeof el.querySelectorAll === "function") {
          const found = el.querySelectorAll("li");
          items = typeof found.length === "number" ? found : [];
        } else if (Array.isArray(el.children)) {
          items = el.children;
        }
      } catch (error) {
        return;
      }
      const docNode =
        (el.ownerDocument && el.ownerDocument) ||
        (typeof document !== "undefined" ? document : null);
      if (!docNode) {
        return;
      }
      for (const li of items) {
        try {
          if (!li || li.nodeType !== 1) {
            continue;
          }
          if (li.dataset && li.dataset.bobProgressProcessed === "1") {
            continue;
          }
          const context = this.progressMarkReadingContext(li, el);
          if (!context) {
            continue;
          }
          const status = this.progressMarkStatusFor(
            context.target,
            context.blockId,
            dailyPath,
            null,
          );
          if (status !== "/") {
            continue;
          }
          const mark = buildProgressMarkElement(docNode, context.blockId);
          if (!mark) {
            continue;
          }
          try {
            li.insertBefore(mark, context.anchor);
          } catch (error) {
            continue;
          }
          try {
            if (li.dataset) {
              li.dataset.bobProgressProcessed = "1";
            } else if (typeof li.setAttribute === "function") {
              li.setAttribute("data-bob-progress-processed", "1");
            }
          } catch (error) {
            // Dedup flag is best-effort.
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Reading-view marks never throw.
    }
  }
}
