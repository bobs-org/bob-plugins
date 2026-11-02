// --- Blocked-reason marks: rendered-row DOM helpers -----------------------
// Shared by the reading-view adapter. Never throws.

class BobLedgerToolsBlockMarksReadingDomMixin {
  blockMarkReadingTag(node) {
    try {
      return String((node && (node.tagName || node.nodeName)) || "").toUpperCase();
    } catch (error) {
      return "";
    }
  }

  blockMarkReadingHasClass(node, name) {
    try {
      if (!node || !name) return false;
      if (node.classList && typeof node.classList.contains === "function") {
        return node.classList.contains(name);
      }
      const raw = typeof node.getAttribute === "function"
        ? node.getAttribute("class") || ""
        : typeof node.className === "string" ? node.className : "";
      return String(raw).split(/\s+/).indexOf(name) !== -1;
    } catch (error) {
      return false;
    }
  }

  blockMarkReadingAttr(node, name) {
    try {
      return node && typeof node.getAttribute === "function"
        ? node.getAttribute(name)
        : null;
    } catch (error) {
      return null;
    }
  }

  blockMarkReadingSetAttr(node, name, value) {
    try {
      if (node && typeof node.setAttribute === "function") {
        node.setAttribute(name, String(value));
      }
    } catch (error) {
      // Attribute writes are best-effort.
    }
  }

  blockMarkReadingRemoveAttr(node, name) {
    try {
      if (node && typeof node.removeAttribute === "function") {
        node.removeAttribute(name);
      }
    } catch (error) {
      // Attribute clears are best-effort.
    }
  }

  blockMarkReadingIsConnected(node) {
    try {
      if (!node || typeof node !== "object") return false;
      if (typeof node.isConnected === "boolean") return node.isConnected;
      return true;
    } catch (error) {
      return true;
    }
  }

  blockMarkReadingWalkElements(root, visit) {
    try {
      if (!root) return;
      const stack = [root];
      let guard = 0;
      while (stack.length > 0 && guard < 20000) {
        guard += 1;
        const node = stack.pop();
        if (!node || node.nodeType !== 1) continue;
        try {
          visit(node);
        } catch (error) {
          // Keep walking on per-node failure.
        }
        const children = node.childNodes || [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          const child = children[index];
          if (child && child.nodeType === 1) stack.push(child);
        }
      }
    } catch (error) {
      // Walk is best-effort.
    }
  }

  blockMarkReadingOwnElements(li) {
    try {
      const found = [];
      const walk = (node) => {
        const children = (node && node.childNodes) || [];
        for (const child of children) {
          if (!child || child.nodeType !== 1) continue;
          const tag = this.blockMarkReadingTag(child);
          if (tag === "UL" || tag === "OL" || tag === "LI") continue;
          found.push(child);
          walk(child);
        }
      };
      walk(li);
      return found;
    } catch (error) {
      return [];
    }
  }

  blockMarkReadingOwnCheckbox(li) {
    try {
      const kids = (li && li.childNodes) || [];
      for (const child of kids) {
        if (
          this.blockMarkReadingTag(child) === "INPUT" &&
          this.blockMarkReadingHasClass(child, "task-list-item-checkbox")
        ) {
          return child;
        }
      }
      const own = this.blockMarkReadingOwnElements(li);
      for (const node of own) {
        if (
          this.blockMarkReadingTag(node) === "INPUT" &&
          this.blockMarkReadingHasClass(node, "task-list-item-checkbox")
        ) {
          return node;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // Tasks query results are CSS-only. Source-note lis that Tasks also
  // classifies as `plugin-tasks-list-item` still take JS marks and folds.
  blockMarkReadingInTasksQuery(node) {
    try {
      let current = node;
      let guard = 0;
      while (current && guard < 200) {
        guard += 1;
        if (this.blockMarkReadingHasClass(current, "plugin-tasks-query-result")) {
          return true;
        }
        current = current.parentNode || current.parentElement || null;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // Inspect the processor root itself as well as ancestors, so a Tasks
  // query or code/pre node passed as `el` is excluded. Nested lists still
  // walk independently because each candidate is checked on its own.
  blockMarkReadingRowSkipped(li, root) {
    try {
      if (this.blockMarkReadingInTasksQuery(li)) return true;
      if (
        li === root &&
        this.blockMarkReadingHasClass(li, "plugin-tasks-list-item")
      ) {
        return true;
      }
      let current = li;
      let guard = 0;
      while (current && guard < 200) {
        guard += 1;
        const tag = this.blockMarkReadingTag(current);
        if (tag === "CODE" || tag === "PRE") return true;
        if (current === root) break;
        current = current.parentNode || current.parentElement || null;
      }
      return false;
    } catch (error) {
      return true;
    }
  }

  blockMarkReadingCandidateRows(el) {
    try {
      const rows = [];
      this.blockMarkReadingWalkElements(el, (node) => {
        if (this.blockMarkReadingTag(node) !== "LI") return;
        if (!this.blockMarkReadingHasClass(node, "task-list-item")) return;
        if (this.blockMarkReadingAttr(node, "data-task") === null) return;
        if (this.blockMarkReadingRowSkipped(node, el)) return;
        rows.push(node);
      });
      if (
        this.blockMarkReadingTag(el) === "LI" &&
        this.blockMarkReadingHasClass(el, "task-list-item") &&
        this.blockMarkReadingAttr(el, "data-task") !== null &&
        !this.blockMarkReadingRowSkipped(el, el) &&
        rows.indexOf(el) === -1
      ) {
        rows.unshift(el);
      }
      return rows;
    } catch (error) {
      return [];
    }
  }
}
