// --- Pomodoro home chips: Reading view -----------------------------------
// DOM counterpart to the Live Preview widget in 273. It reads the rendered
// Pomodoro row and its direct Task Link bullets, then appends a read-only chip.

class BobLedgerToolsPomodoroHomeChipsReadingMixin {
  pomodoroHomeReadingLinkFromRow(row) {
    try {
      if (!row || typeof row.querySelectorAll !== "function") {
        return null;
      }
      const links = [];
      const nodes = row.querySelectorAll("a.internal-link, .internal-embed");
      for (const node of nodes || []) {
        try {
          if (!node || node.nodeType !== 1) {
            continue;
          }
          let owner = node.parentNode || null;
          let guard = 0;
          while (owner && owner !== row && guard < 100) {
            guard += 1;
            if (String(owner.tagName || owner.nodeName || "").toUpperCase() === "LI") {
              break;
            }
            owner = owner.parentNode || null;
          }
          if (owner !== row) {
            continue;
          }
          const getAttr = typeof node.getAttribute === "function"
            ? (name) => node.getAttribute(name)
            : () => null;
          const raw = String(
            getAttr("data-href") || getAttr("href") || getAttr("src") || getAttr("data-src") || "",
          ).trim();
          const unaliased = raw.split("|")[0];
          const marker = unaliased.indexOf("#^");
          if (marker < 0 || unaliased.indexOf("#") !== marker) {
            continue;
          }
          const target = unaliased.slice(0, marker).replace(/\.md$/i, "");
          const blockId = unaliased.slice(marker + 2).trim();
          if (!blockId || !PLAN_BLOCK_ID_RE.test(blockId)) {
            continue;
          }
          links.push({ node, target, blockId });
        } catch (error) {
          continue;
        }
      }
      if (links.length !== 1) {
        return null;
      }
      const linkNode = links[0].node;
      const outsideText = (node) => {
        if (!node || node === linkNode) {
          return "";
        }
        if (node.nodeType === 3) {
          return typeof node.nodeValue === "string" ? node.nodeValue : "";
        }
        if (node.nodeType !== 1) {
          return "";
        }
        const tag = String(node.tagName || node.nodeName || "").toUpperCase();
        if (tag === "UL" || tag === "OL" || tag === "INPUT") {
          return "";
        }
        let text = "";
        for (const child of node.childNodes || []) {
          text += outsideText(child);
        }
        return text;
      };
      let residual = "";
      for (const child of row.childNodes || []) {
        residual += outsideText(child);
      }
      if (!/^[\s\u{1F345}\uFE0F]*$/u.test(residual)) {
        return null;
      }
      return {
        target: links[0].target,
        blockId: links[0].blockId,
      };
    } catch (error) {
      return null;
    }
  }

  // A Dataview inline field Reading view rendered from `[t:: 25m]` or
  // `[off:: 60m]`, put back as source text; null for any other node.
  pomodoroHomeReadingInlineField(node) {
    try {
      const classes = String(
        typeof node.getAttribute === "function" ? node.getAttribute("class") || "" : "",
      ).split(/\s+/);
      if (!classes.includes("dataview") || !classes.includes("inline-field")) {
        return null;
      }
      let key = "";
      let value = null;
      const stack = Array.from(node.childNodes || []);
      let guard = 0;
      while (stack.length > 0 && guard < 200) {
        guard += 1;
        const current = stack.shift();
        if (!current || current.nodeType !== 1) {
          continue;
        }
        const getAttr = typeof current.getAttribute === "function"
          ? (name) => current.getAttribute(name)
          : () => null;
        key = key || String(getAttr("data-dv-norm-key") || getAttr("data-dv-key") || "").toLowerCase();
        const own = String(getAttr("class") || "").split(/\s+/);
        if (value === null && (own.includes("inline-field-value") || own.includes("inline-field-standalone-value"))) {
          value = String(current.textContent || "").trim();
        }
        stack.push(...Array.from(current.childNodes || []));
      }
      return (key === "t" || key === "off") && value ? `[${key}:: ${value}]` : null;
    } catch (error) {
      return null;
    }
  }

  pomodoroHomeReadingEntry(li, dailyPath) {
    try {
      if (!li || li.nodeType !== 1 || !this.pomodoroHomeChipDailyPath(dailyPath)) {
        return null;
      }
      const tagOf = (node) => String(node && (node.tagName || node.nodeName) || "").toUpperCase();
      const list = li.parentNode || null;
      if (tagOf(list) !== "UL" && tagOf(list) !== "OL") {
        return null;
      }
      const topList = list;
      if (tagOf(topList.parentNode) === "LI") {
        return null;
      }
      let sibling = topList.previousSibling || null;
      let headingFound = false;
      let guard = 0;
      while (sibling && guard < 100) {
        guard += 1;
        if (sibling.nodeType === 1 && /^H[1-6]$/.test(tagOf(sibling))) {
          const text = String(sibling.textContent || "").trim().split(/\s+/)[0];
          headingFound = tagOf(sibling) === "H2" && text === "Pomodoros";
          break;
        }
        sibling = sibling.previousSibling || null;
      }
      if (!headingFound) {
        return null;
      }
      const statusRaw = typeof li.getAttribute === "function" ? li.getAttribute("data-task") : null;
      const status = typeof statusRaw === "string" ? statusRaw : " ";
      if (/^[xX-]$/.test(status)) {
        if (status === "-") {
          return null;
        }
      }
      let ownText = "";
      let listElement = null;
      const sourceText = (node) => {
        if (!node) {
          return "";
        }
        if (node.nodeType === 3) {
          return typeof node.nodeValue === "string" ? node.nodeValue : "";
        }
        if (node.nodeType !== 1) {
          return "";
        }
        const tag = tagOf(node);
        const classes = String(
          typeof node.getAttribute === "function" ? node.getAttribute("class") || "" : "",
        ).split(/\s+/);
        if (
          tag === "UL" ||
          tag === "OL" ||
          tag === "INPUT" ||
          classes.includes("bob-pomodoro-home-chip") ||
          (typeof node.getAttribute === "function" && node.getAttribute("aria-hidden") === "true")
        ) {
          return "";
        }
        const field = this.pomodoroHomeReadingInlineField(node);
        if (field) {
          return field;
        }
        return Array.from(node.childNodes || []).map(sourceText).join("");
      };
      for (const child of li.childNodes || []) {
        const tag = tagOf(child);
        if (tag === "UL" || tag === "OL") {
          if (!listElement) {
            listElement = child;
          }
          continue;
        }
        ownText += sourceText(child);
      }
      const parsed = planParseEntry(`- [${status}] ${ownText.trim()}`);
      if (!parsed || parsed.state === "cancelled") {
        return null;
      }
      const leading = planLeadingRange(parsed.body);
      if (leading.length === null) {
        return null;
      }
      const name = planParseNameTail(parsed.body.slice(leading.length)) || "";
      const links = [];
      if (listElement) {
        for (const row of listElement.children || []) {
          if (tagOf(row) !== "LI") {
            continue;
          }
          const link = this.pomodoroHomeReadingLinkFromRow(row);
          if (link) {
            links.push(link);
          }
        }
      }
      // The row is rebuilt from rendered text, so only an explicit `[off::]`
      // marks it off the clock (see pomodoroHomeLineClock).
      const clock = pomodoroHomeLineClock(
        `- [${status}] ${ownText.trim()}`,
        leading.timeRange,
        { stampedOnly: true },
      );
      return {
        entry: {
          status: parsed.state,
          name,
          minutes: clock.minutes,
          offClock: clock.offClock,
          links,
        },
        listElement,
      };
    } catch (error) {
      return null;
    }
  }

  renderPomodoroHomeReadingRecord(record) {
    try {
      const row = record && record.el;
      if (!row || !row.isConnected) {
        if (record && this.pomodoroHomeChipReadingWidgets) {
          this.pomodoroHomeChipReadingWidgets.delete(record);
        }
        return false;
      }
      if (!this.pomodoroHomeChipsEnabled) {
        if (record.chip && record.chip.parentNode) {
          record.chip.parentNode.removeChild(record.chip);
        }
        record.chip = null;
        return true;
      }
      const context = this.pomodoroHomeReadingEntry(row, record.path);
      if (!context) {
        if (record.chip && record.chip.parentNode) {
          record.chip.parentNode.removeChild(record.chip);
        }
        record.chip = null;
        return false;
      }
      const model = this.pomodoroHomeChipModelForEntry(context.entry, record.path);
      if (!model || !model.chip) {
        if (record.chip && record.chip.parentNode) {
          record.chip.parentNode.removeChild(record.chip);
        }
        record.chip = null;
        return true;
      }
      const doc = row.ownerDocument || (typeof document !== "undefined" ? document : null);
      const chip = buildPomodoroHomeChipElement(doc, model);
      if (!chip) {
        return false;
      }
      if (record.chip && record.chip.parentNode) {
        record.chip.parentNode.removeChild(record.chip);
      }
      try {
        if (context.listElement && context.listElement.parentNode === row) {
          row.insertBefore(chip, context.listElement);
        } else {
          row.appendChild(chip);
        }
      } catch (error) {
        return false;
      }
      record.chip = chip;
      return true;
    } catch (error) {
      return false;
    }
  }

  renderPomodoroHomeChipsIn(el, ctx) {
    try {
      if (!this.pomodoroHomeChipsEnabled || !el || !ctx) {
        return;
      }
      const sourcePath = typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!this.pomodoroHomeChipDailyPath(sourcePath)) {
        return;
      }
      let rows = [];
      if (typeof el.querySelectorAll === "function") {
        rows = el.querySelectorAll("li");
      }
      for (const row of rows || []) {
        try {
          if (!row || row.nodeType !== 1) {
            continue;
          }
          const data = row.dataset || null;
          if (data && data.bobPomodoroHomeProcessed === "1") {
            continue;
          }
          const context = this.pomodoroHomeReadingEntry(row, sourcePath);
          if (!context) {
            continue;
          }
          const record = { el: row, path: sourcePath, chip: null };
          this.pomodoroHomeChipReadingWidgets.add(record);
          if (data) {
            data.bobPomodoroHomeProcessed = "1";
          } else if (typeof row.setAttribute === "function") {
            row.setAttribute("data-bob-pomodoro-home-processed", "1");
          }
          this.renderPomodoroHomeReadingRecord(record);
          let child = null;
          try {
            if (typeof MarkdownRenderChild === "function") {
              child = new MarkdownRenderChild(row);
              child.onunload = () => {
                if (record.chip && record.chip.parentNode) {
                  record.chip.parentNode.removeChild(record.chip);
                }
                this.pomodoroHomeChipReadingWidgets.delete(record);
              };
            }
          } catch (error) {
            child = null;
          }
          if (child && typeof ctx.addChild === "function") {
            ctx.addChild(child);
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Reading-view chips are best-effort.
    }
  }

  refreshPomodoroHomeReadingChips() {
    try {
      if (!this.pomodoroHomeChipReadingWidgets) {
        return false;
      }
      let refreshed = false;
      for (const record of Array.from(this.pomodoroHomeChipReadingWidgets)) {
        if (this.renderPomodoroHomeReadingRecord(record)) {
          refreshed = true;
        }
      }
      return refreshed;
    } catch (error) {
      return false;
    }
  }
}
