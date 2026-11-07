class BobLedgerToolsBlockMarksMixin {
  // The index is memo-local so it follows the freshness memo's Tasks cache
  // invalidation. A cold or empty Tasks cache is represented by null.
  blockMarksIdIndex() {
    try {
      const memo = this.freshnessEnsureMemo();
      if (!memo || typeof memo !== "object") return null;
      if (Object.prototype.hasOwnProperty.call(memo, "blockMarksIdIndex")) {
        return memo.blockMarksIdIndex instanceof Map
          ? memo.blockMarksIdIndex
          : null;
      }

      const tasks = planBlockTasks(this.app);
      if (!Array.isArray(tasks) || tasks.length === 0) {
        try {
          memo.blockMarksIdIndex = null;
        } catch (error) {
          // A frozen memo can still report that this cache is unavailable.
        }
        return null;
      }

      const index = new Map();
      for (const task of tasks) {
        try {
          for (const id of blocksTaskIds(task && task.id)) {
            let rows = index.get(id);
            if (!rows) {
              rows = [];
              index.set(id, rows);
            }
            if (!rows.includes(task)) rows.push(task);
          }
        } catch (error) {
          continue;
        }
      }
      try {
        for (const [id, rows] of index) index.set(id, Object.freeze(rows));
        memo.blockMarksIdIndex = index;
      } catch (error) {
        // The returned index remains useful even if the memo is frozen.
      }
      return index;
    } catch (error) {
      return null;
    }
  }

  // One-hop context for a `#prj_is_blocked` row: the project's own open
  // prerequisite or future date, then an inherited parent-project reason.
  blockMarkProjectReason(notePath) {
    try {
      const path = String(notePath || "");
      if (!path) return null;
      const memo = this.freshnessEnsureMemo();
      const index = this.blockMarksIdIndex();
      if (!index) return null;
      const tasks = Array.isArray(memo && memo.tasks) ? memo.tasks : [];
      let byPath = memo.blockMarksProjectTasksByPath;
      if (!(byPath instanceof Map)) {
        byPath = new Map();
        try {
          memo.blockMarksProjectTasksByPath = byPath;
        } catch (error) {
          // The local map still avoids duplicate scans during this call.
        }
      }
      let projectTask = null;
      if (byPath.has(path)) {
        projectTask = byPath.get(path);
      } else {
        projectTask = tasks.find((task) =>
          planTaskPath(task) === path && planTaskBlockId(task) === "prj",
        ) || null;
        byPath.set(path, projectTask);
      }
      if (!projectTask) return null;

      const line = planTaskDescription(projectTask) || "";
      const ids = blockMarkDependsOnIds(line);
      const dependency = blockMarkDependencyFacts(ids, (id) => index.get(id) || []);
      if (dependency.state === "unknown") return null;
      if (dependency.state === "open" && dependency.dependencies.length > 0) {
        return "after " + dependency.dependencies[0];
      }

      const today = this.dateMarksToday();
      const ladder = this.blockMarkLadderForRender();
      const dateFacts = blockMarkDateFacts(line, today, ladder);
      if (dateFacts.invalidToday) return null;
      if (dateFacts.date) {
        const words = blockMarkDateWords(dateFacts.date.date, today);
        if (words) return "until " + words.short + " · " + words.relative;
      }

      const visible = blockMarkMaskInlineCode(line);
      if (/(?:^|\s)#prj_is_blocked(?![A-Za-z0-9_/-])/.test(visible)) {
        return "via a parent project";
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // `<who>` for an awaiting tooltip: the first wikilink on the line,
  // outside inline code, that resolves to a mail note (frontmatter `type`
  // `[[mail]]` or a `gmail_thread_id`) supplies its frontmatter `who`.
  // Metadata-cache lookups only; never reads disk. Returns "" when
  // unknown. Never throws.
  blockMarkMailWho(lineText, notePath) {
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (
        !metadataCache ||
        typeof metadataCache.getFirstLinkpathDest !== "function" ||
        typeof metadataCache.getFileCache !== "function"
      ) {
        return "";
      }
      const visible = blockMarkMaskInlineCode(String(lineText || ""));
      const links = /\[\[([^\[\]|#^\r\n]+)(?:[#^][^\[\]|\r\n]*)?(?:\|[^\[\]\r\n]*)?\]\]/g;
      let match = links.exec(visible);
      while (match !== null) {
        try {
          const target = String(match[1] || "").trim();
          const file = target
            ? metadataCache.getFirstLinkpathDest(target, String(notePath || ""))
            : null;
          const cache = file ? metadataCache.getFileCache(file) : null;
          const frontmatter = cache && cache.frontmatter;
          if (blockMarkIsMailFrontmatter(frontmatter)) {
            return typeof frontmatter.who === "string"
              ? frontmatter.who.trim()
              : "";
          }
        } catch (error) {
          // An unresolvable link is skipped.
        }
        match = links.exec(visible);
      }
      return "";
    } catch (error) {
      return "";
    }
  }

  // The shared model used by source-note surfaces and api.blockMarks v1.
  // The Live Preview and api.blockMarks v1 consumers share this one
  // display-only model; neither path writes source Markdown.
  blockMarkModelForLine(path, lineText) {
    try {
      if (this.blockMarksEnabled === false) return null;
      const index = this.blockMarksIdIndex();
      const ladder = this.blockMarkLadderForRender();
      let today = null;
      try {
        today = this.dateMarksToday();
      } catch (error) {
        today = null;
      }
      return blockMarkModel(String(lineText || ""), {
        today,
        ladder,
        notePath: String(path || ""),
        lookupId: index
          ? (id) => index.get(String(id || "")) || []
          : () => null,
        projectReason: (notePath) => this.blockMarkProjectReason(notePath),
        mailWho: (text, notePath) => this.blockMarkMailWho(text, notePath),
      });
    } catch (error) {
      return null;
    }
  }

  // Additive api.blockMarks v1 model. The namespace and every call are
  // synchronous, frozen where public, and never throw.
  blockMarksApi() {
    try {
      const plugin = this;
      return Object.freeze({
        version: 1,
        model: (lineText, options) => {
          try {
            const settings = options && typeof options === "object" ? options : {};
            return plugin.blockMarkModelForLine(
              String(settings.path || ""),
              String(lineText || ""),
            );
          } catch (error) {
            return null;
          }
        },
        render: (host, model, options) => {
          try {
            return plugin.blockMarkRender(host, model, options);
          } catch (error) {
            return null;
          }
        },
      });
    } catch (error) {
      return Object.freeze({ version: 1, model: () => null });
    }
  }
}
