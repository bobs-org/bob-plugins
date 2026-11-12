// Reading-view bank-row and day-heading marks, plus math unwrap that
// stays on when decorative marks are off. Source positions drive the
// wrap; repeated processing restores then reapplies.

class BobLedgerToolsBankMarksReadingMixin {
  renderBankMarksIn(el, ctx) {
    try {
      if (!el) return false;
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      const month = bankMonthFromPath(sourcePath);
      bankRestoreMarkHosts(el);
      this.bankMarkProtectReadingMath(el, ctx, sourcePath);
      if (!month || !this.bankMarksEnabled()) return false;
      const source = this.bankMarkReadingSource(ctx, sourcePath);
      if (typeof source !== "string") return false;
      const tokens = bankTokenizeSource(sourcePath, source);
      if (!tokens.month) return false;
      const catalogs = this.bankMarkCatalogs();
      const report = this.bankMarkReportForMonth(month.key);
      this.bankMarkDecorateReadingHeadings(el, ctx, tokens, report);
      this.bankMarkDecorateReadingRows(el, ctx, tokens, catalogs);
      return true;
    } catch (error) {
      return false;
    }
  }

  bankMarkReadingSource(ctx, sourcePath) {
    try {
      if (this.bankMarkSourceCache instanceof Map) {
        const cached = this.bankMarkSourceCache.get(sourcePath);
        if (typeof cached === "string") return cached;
      }
    } catch (error) {}
    try {
      const workspace = this.app && this.app.workspace;
      const leaves = workspace && typeof workspace.getLeavesOfType === "function"
        ? workspace.getLeavesOfType("markdown") || []
        : [];
      for (const leaf of leaves) {
        const view = leaf && leaf.view;
        if (!view || !view.file || view.file.path !== sourcePath) continue;
        const editor = view.editor;
        if (editor && typeof editor.getValue === "function") return editor.getValue();
        if (typeof view.getViewData === "function") {
          const data = view.getViewData();
          if (typeof data === "string") return data;
        }
        if (view.data && typeof view.data === "string") return view.data;
      }
    } catch (error) {}
    try {
      const vault = this.app && this.app.vault;
      const file = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(sourcePath)
        : { path: sourcePath };
      if (vault && typeof vault.read === "function" && file) {
        const pending = vault.read(file);
        if (typeof pending === "string") return pending;
      }
    } catch (error) {}
    return ctx && typeof ctx.source === "string" ? ctx.source : null;
  }

  bankMarkReadingLine(el, ctx) {
    try {
      if (ctx && typeof ctx.getSectionInfo === "function") {
        const info = ctx.getSectionInfo(el);
        if (info && Number.isInteger(info.lineStart)) return info.lineStart + 1;
      }
    } catch (error) {}
    return null;
  }

  bankMarkProtectReadingMath(el, ctx, sourcePath) {
    try {
      const source = this.bankMarkReadingSource(ctx, sourcePath);
      if (typeof source !== "string") return 0;
      return bankProtectMathInElement(el, sourcePath, source);
    } catch (error) {
      return 0;
    }
  }

  bankMarkDecorateReadingHeadings(root, ctx, tokens, report) {
    const headings = this.bankMarkHeadingElements(root);
    for (const headingEl of headings) {
      try {
        const line = this.bankMarkReadingLine(headingEl, ctx);
        const token = tokens.headings.find((entry) => entry.line === line)
          || tokens.headings.find((entry) => headingEl.textContent && headingEl.textContent.indexOf(entry.heading) >= 0);
        if (!token) continue;
        const model = bankHeadingPresentation(token, bankReportDayFor(report, token.date));
        if (!model) continue;
        if (typeof headingEl.querySelector === "function" && headingEl.querySelector(".bob-bank-mark-heading")) continue;
        const widget = buildBankHeadingElement(headingEl.ownerDocument, model);
        if (widget && typeof headingEl.appendChild === "function") headingEl.appendChild(widget);
      } catch (error) {}
    }
  }

  bankMarkHeadingElements(root) {
    try {
      if (root && typeof root.querySelectorAll === "function") {
        return Array.from(root.querySelectorAll("h2"));
      }
    } catch (error) {}
    const found = [];
    const visit = (node) => {
      if (!node) return;
      const tag = String(node.tagName || node.nodeName || "").toUpperCase();
      if (tag === "H2") found.push(node);
      for (const child of node.childNodes || []) visit(child);
    };
    visit(root);
    return found;
  }

  bankMarkRowElements(root) {
    try {
      if (root && typeof root.querySelectorAll === "function") {
        return Array.from(root.querySelectorAll("li"));
      }
    } catch (error) {}
    const found = [];
    const visit = (node) => {
      if (!node) return;
      const tag = String(node.tagName || node.nodeName || "").toUpperCase();
      if (tag === "LI") found.push(node);
      for (const child of node.childNodes || []) visit(child);
    };
    visit(root);
    return found;
  }

  bankMarkDecorateReadingRows(root, ctx, tokens, catalogs) {
    const rows = this.bankMarkRowElements(root);
    for (const rowEl of rows) {
      try {
        const line = this.bankMarkReadingLine(rowEl, ctx);
        let token = tokens.rows.find((entry) => entry.line === line);
        if (!token) {
          const text = String(rowEl.textContent || "");
          token = tokens.rows.find((entry) => entry.payee && text.includes(entry.payee) && entry.amount && text.includes(entry.amount.text.replace(/\*/g, "")));
        }
        if (!token) continue;
        const model = bankRowPresentation(token, catalogs);
        if (!model) continue;
        if (rowEl.classList && typeof rowEl.classList.add === "function") {
          rowEl.classList.add(token.acknowledged ? "bob-bank-mark-acked" : "bob-bank-mark-waiting");
        } else if (typeof rowEl.setAttribute === "function") {
          const prev = rowEl.getAttribute("class") || "";
          rowEl.setAttribute("class", `${prev} ${token.acknowledged ? "bob-bank-mark-acked" : "bob-bank-mark-waiting"}`.trim());
        }
        this.bankMarkWrapReadingSpan(rowEl, token.lineText, token.amount, (doc) => buildBankAmountElement(doc, model));
        if (token.category && token.category.span) {
          this.bankMarkWrapReadingSpan(rowEl, token.lineText, token.category.span, (doc) => buildBankChipElement(doc, "cat", model.categoryLabel));
        }
        if (token.account && token.account.span) {
          this.bankMarkWrapReadingSpan(rowEl, token.lineText, token.account.span, (doc) => buildBankChipElement(doc, "acct", model.accountLabel));
        }
        if (token.flagSpan) {
          this.bankMarkWrapReadingSpan(rowEl, token.lineText, token.flagSpan, (doc) => buildBankChipElement(doc, "flag", "⚑"));
        }
        if (token.bankIdSpan) {
          this.bankMarkWrapReadingSpan(rowEl, token.lineText, token.bankIdSpan, (doc) => buildBankIdElement(doc));
        }
      } catch (error) {}
    }
  }

  bankMarkOwnText(row) {
    try {
      const doc = row && row.ownerDocument;
      if (!doc || typeof doc.createTreeWalker !== "function") return String(row && row.textContent || "");
      const walker = doc.createTreeWalker(row, 4);
      let output = "";
      let node = null;
      while ((node = walker.nextNode())) {
        let owner = node.parentNode;
        let nested = false;
        while (owner && owner !== row) {
          const tag = String(owner.tagName || owner.nodeName || "").toUpperCase();
          if (tag === "LI" && owner !== row) { nested = true; break; }
          if (tag === "UL" || tag === "OL") { nested = true; break; }
          owner = owner.parentNode;
        }
        if (nested) continue;
        output += String(node.nodeValue || "");
      }
      return output;
    } catch (error) {
      return String(row && row.textContent || "");
    }
  }

  bankMarkWrapReadingSpan(row, lineText, span, build) {
    try {
      if (!row || !span || typeof build !== "function") return false;
      const doc = row.ownerDocument;
      if (!doc || typeof doc.createTreeWalker !== "function") return false;
      const needles = [span.text, String(span.text || "").replace(/\*\*/g, "")].filter(Boolean);
      const walker = doc.createTreeWalker(row, 4);
      let node = null;
      while ((node = walker.nextNode())) {
        const value = String(node.nodeValue || "");
        let index = -1;
        let needle = "";
        for (const candidate of needles) {
          index = value.indexOf(candidate);
          if (index >= 0) { needle = candidate; break; }
        }
        if (index < 0) continue;
        const parent = node.parentNode;
        if (!parent) continue;
        if (bankNodeHasClass(parent, "bob-bank-mark-host") || bankNodeHasClass(parent, "bob-bank-mark-native")) {
          return false;
        }
        const host = doc.createElement("span");
        host.setAttribute("class", "bob-bank-mark-host");
        const native = doc.createElement("span");
        native.setAttribute("class", "bob-bank-mark-native");
        native.appendChild(doc.createTextNode(value.slice(index, index + needle.length)));
        const mark = build(doc);
        if (!mark) return false;
        host.appendChild(native);
        host.appendChild(mark);
        if (index > 0) parent.insertBefore(doc.createTextNode(value.slice(0, index)), node);
        parent.insertBefore(host, node);
        if (index + needle.length < value.length) {
          parent.insertBefore(doc.createTextNode(value.slice(index + needle.length)), node);
        }
        parent.removeChild(node);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }
}
