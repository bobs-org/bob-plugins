// Today marks in rendered views: placement and delegated clicks
// (today-mark-v1 reading). Split from `276-plugin-today-marks-reading.js`
// to keep each fragment at or below 1000 lines. Shares the plugin scope,
// so helpers across fragments resolve. Contract: bob-cli `docs/today-marks.md`.

class BobLedgerToolsTodayMarksReadingClicksMixin {
  todayMarkSetRowPlace(li, atBody) {
    try {
      if (!li) {
        return;
      }
      if (atBody) {
        if (typeof li.setAttribute === "function") {
          li.setAttribute("data-bob-today-place", "body");
        }
        return;
      }
      if (typeof li.removeAttribute === "function") {
        li.removeAttribute("data-bob-today-place");
      } else if (li.attrs && typeof li.attrs === "object") {
        try {
          delete li.attrs["data-bob-today-place"];
        } catch (error) {
          // Attribute clear is best-effort.
        }
      }
    } catch (error) {
      // Placement stamping is best-effort.
    }
  }

  todayMarkInsertAnchor(li) {
    try {
      try {
        const place =
          li && typeof li.getAttribute === "function"
            ? li.getAttribute("data-bob-today-place")
            : null;
        if (place === "body") {
          return this.todayMarkCheckbox(li);
        }
      } catch (error) {
        // Placement read is best-effort.
      }
      const tag = this.todayMarkTaskTagAnchor(li);
      if (tag) {
        const partner = this.todayMarkNextElementSkippingWhitespace(tag);
        if (partner && this.todayMarkIsRefAnchor(partner)) {
          return partner;
        }
        return tag;
      }
      return this.todayMarkCheckbox(li);
    } catch (error) {
      return null;
    }
  }
  todayMarksBindReadingClicks(doc) {
    try {
      if (!doc) {
        return;
      }
      if (!this.todayMarksClickDocs) {
        this.todayMarksClickDocs = typeof WeakSet === "function" ? new WeakSet() : new Set();
      }
      if (this.todayMarksClickDocs.has(doc)) {
        return;
      }
      this.todayMarksClickDocs.add(doc);
      const handler = (event) => this.handleTodayMarkReadingClick(event);
      if (typeof this.registerDomEvent === "function") {
        this.registerDomEvent(doc, "click", handler, { capture: true });
        return;
      }
      if (typeof doc.addEventListener === "function") {
        doc.addEventListener("click", handler, true);
      }
    } catch (error) {
      // Click binding is best-effort.
    }
  }

  setupTodayMarksReadingClicks() {
    try {
      if (typeof document !== "undefined") {
        this.todayMarksBindReadingClicks(document);
      }
      for (const doc of this.todayMarksReadingDocuments()) {
        this.todayMarksBindReadingClicks(doc);
      }
    } catch (error) {
      // Click setup never throws.
    }
  }

  handleTodayMarkReadingClick(event) {
    try {
      if (!event) {
        return;
      }
      let node = event.target || event.srcElement || null;
      let mark = null;
      let guard = 0;
      while (node && guard < 40) {
        guard += 1;
        if (this.todayMarkHasClass(node, "bob-today-mark")) {
          mark = node;
          break;
        }
        node = node.parentNode || node.parentElement || null;
      }
      if (!mark) {
        return;
      }
      try {
        let ancestor = mark.parentNode || mark.parentElement || null;
        let depth = 0;
        while (ancestor && depth < 40) {
          depth += 1;
          if (this.todayMarkHasClass(ancestor, "cm-editor")) {
            return;
          }
          ancestor = ancestor.parentNode || ancestor.parentElement || null;
        }
      } catch (error) {
        // Ancestor scan is best-effort.
      }
      let isMac = false;
      try {
        isMac = Boolean(Platform && Platform.isMacOS);
      } catch (error) {
        isMac = false;
      }
      if (!todayMarkModifierPressed(event, isMac)) {
        return;
      }
      try {
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (typeof event.stopPropagation === "function") {
          event.stopPropagation();
        }
      } catch (error) {
        // Event cancellation is best-effort.
      }
      const key = this.todayMarkRowKey(mark);
      if (key && typeof this.goToTodayTaskLink === "function") {
        void this.goToTodayTaskLink(key);
      }
    } catch (error) {
      // Delegated clicks never throw.
    }
  }
}
