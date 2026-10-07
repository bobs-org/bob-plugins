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
  progressMarkReadingContext(li, el) {
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
      // Tight lists render inline content directly in the row; a
      // wrapped anchor belongs to richer content, never a bare link.
      try {
        if (anchor.parentNode !== li) {
          return null;
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
          if (tag === "S" || tag === "DEL" || tag === "STRIKE") {
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
      try {
        const children = (li && li.childNodes) || [];
        let seenAnchor = false;
        let beforeText = "";
        let afterText = "";
        for (const child of children) {
          try {
            if (child === anchor) {
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
              return null;
            }
          } catch (error) {
            return null;
          }
        }
        if (!seenAnchor) {
          return null;
        }
        if (!/^[\s\u{1F345}\uFE0F]*$/u.test(beforeText)) {
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
        if (/^[xX-]$/.test(entryTask)) {
          return null;
        }
        // The entry's top-level list lives under a `## Pomodoros`
        // heading: the nearest preceding heading sibling names it.
        let sibling = topList.previousSibling || null;
        let guard = 0;
        let pomodoros = false;
        let decided = false;
        while (sibling && guard < 100) {
          guard += 1;
          try {
            if (!sibling) {
              break;
            }
            if (sibling.nodeType === 3) {
              sibling = sibling.previousSibling || null;
              continue;
            }
            if (sibling.nodeType !== 1) {
              sibling = sibling.previousSibling || null;
              continue;
            }
            const tag = tagOf(sibling);
            if (/^H[1-6]$/.test(tag)) {
              const text =
                typeof sibling.textContent === "string"
                  ? sibling.textContent
                  : "";
              pomodoros =
                tag === "H2" &&
                text.trim().split(/\s+/)[0] === "Pomodoros";
              decided = true;
              break;
            }
            sibling = sibling.previousSibling || null;
          } catch (error) {
            break;
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
