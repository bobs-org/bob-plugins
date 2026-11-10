// Linked notebook headers: pure ancestry and child models.
// Bob remains the source of truth; this fragment never writes note bytes
// and never turns `breadcrumb` display labels into link targets.

const NOTEBOOK_HEADER_MAX_HOPS = 8;
const NOTEBOOK_HEADER_MAX_CRUMBS = 5;

function notebookHeaderReportPath(value) {
  try {
    if (typeof notebookReportPath === "function") {
      return notebookReportPath(value);
    }
  } catch (error) {
    // Fall through to the local normalizer.
  }
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string"
      ? value.path
      : "";
  return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function notebookHeaderStem(path) {
  const normalized = notebookHeaderReportPath(path);
  const name = normalized.split("/").pop() || "";
  return name.replace(/\.md$/i, "");
}

function notebookHeaderLookup(report, stemOrPath) {
  if (!report || typeof stemOrPath !== "string") {
    return null;
  }
  const raw = stemOrPath.trim();
  if (!raw) {
    return null;
  }
  const asPath = notebookHeaderReportPath(raw);
  if (report.notebooksByPath instanceof Map && asPath) {
    const byPath = report.notebooksByPath.get(asPath);
    if (byPath) {
      return byPath;
    }
    if (!/\.md$/i.test(asPath)) {
      const withExt = report.notebooksByPath.get(`${asPath}.md`);
      if (withExt) {
        return withExt;
      }
    }
  }
  const stem = notebookHeaderStem(raw.replace(/\.md$/i, ""));
  if (report.notebooksByStem instanceof Map && stem) {
    const byStem = report.notebooksByStem.get(stem);
    if (byStem) {
      return byStem;
    }
    const lower = stem.toLowerCase();
    for (const [key, entry] of report.notebooksByStem) {
      if (String(key).toLowerCase() === lower) {
        return entry;
      }
    }
  }
  return null;
}

function notebookHeaderEntryForPath(report, sourcePath) {
  if (!report || !sourcePath) {
    return null;
  }
  const path = notebookHeaderReportPath(sourcePath);
  if (!path) {
    return null;
  }
  if (report.notebooksByPath instanceof Map) {
    const direct = report.notebooksByPath.get(path);
    if (direct) {
      return direct;
    }
  }
  return notebookHeaderLookup(report, notebookHeaderStem(path));
}

function notebookHeaderNotebookAncestors(report, sourcePath) {
  const chain = [];
  const seen = new Set();
  let broken = false;
  let cyclic = false;
  if (!report) {
    return { chain, broken: true, cyclic: false, truncated: false };
  }
  let current = notebookHeaderEntryForPath(report, sourcePath);
  if (!current) {
    return { chain, broken: true, cyclic: false, truncated: false };
  }
  let guard = 0;
  while (current && guard < NOTEBOOK_HEADER_MAX_HOPS) {
    const key = notebookHeaderReportPath(current.path || current.stem || "");
    const stemKey = String(current.stem || key).toLowerCase();
    if (stemKey && seen.has(stemKey)) {
      cyclic = true;
      break;
    }
    if (stemKey) {
      seen.add(stemKey);
    }
    const parentStem = typeof current.parent === "string" ? current.parent.trim() : "";
    const parentKind = typeof current.parent_kind === "string" ? current.parent_kind : "";
    if (!parentStem) {
      break;
    }
    if (parentKind && parentKind !== "notebook") {
      break;
    }
    const parent = notebookHeaderLookup(report, parentStem);
    if (!parent) {
      broken = true;
      break;
    }
    chain.unshift(parent);
    current = parent;
    guard += 1;
  }
  const truncated = guard >= NOTEBOOK_HEADER_MAX_HOPS;
  return { chain, broken, cyclic, truncated };
}

function notebookHeaderCollapse(segments, max) {
  const list = Array.isArray(segments) ? segments.slice() : [];
  const cap = Number.isInteger(max) && max > 0 ? max : NOTEBOOK_HEADER_MAX_CRUMBS;
  if (list.length <= cap) {
    return list;
  }
  return [
    list[0],
    { ellipsis: true, path: "", stem: "", title: "…", kind: "ellipsis" },
    ...list.slice(-(cap - 2)),
  ];
}

function notebookHeaderChildEntries(report, entry) {
  if (!report || !entry || !Array.isArray(entry.children)) {
    return [];
  }
  const found = [];
  for (const stem of entry.children) {
    const child = notebookHeaderLookup(report, stem);
    if (child) {
      found.push(child);
    }
  }
  found.sort((left, right) => {
    const leftTitle = String(left.title || left.stem || "");
    const rightTitle = String(right.title || right.stem || "");
    const byTitle = leftTitle.toLowerCase().localeCompare(rightTitle.toLowerCase());
    if (byTitle !== 0) {
      return byTitle;
    }
    return notebookHeaderReportPath(left.path).localeCompare(notebookHeaderReportPath(right.path));
  });
  return found;
}

function notebookHeaderNoteTitle(path, metadataCache, vault) {
  const stem = notebookHeaderStem(path);
  try {
    const file = typeof notebookResolveLinkFile === "function"
      ? notebookResolveLinkFile(path || stem, path, metadataCache, vault)
      : null;
    const cache = file && metadataCache && typeof metadataCache.getFileCache === "function"
      ? metadataCache.getFileCache(file)
      : null;
    const heading = cache && Array.isArray(cache.headings)
      ? cache.headings.find((row) => row && row.level === 1 && row.heading)
      : null;
    if (heading && heading.heading) {
      return String(heading.heading).trim() || stem;
    }
    const aliases = cache && cache.frontmatter && cache.frontmatter.aliases;
    if (typeof aliases === "string" && aliases.trim()) {
      return aliases.trim();
    }
    if (Array.isArray(aliases) && aliases.length > 0 && typeof aliases[0] === "string") {
      return aliases[0].trim() || stem;
    }
  } catch (error) {
    // Title lookup is best-effort.
  }
  return stem;
}

function notebookHeaderOwnerAncestors(self, options = {}) {
  const owner = typeof self.owner === "string" ? self.owner.trim() : "";
  const root = typeof self.root === "string" ? self.root.trim() : "";
  const report = options.report || null;
  const metadataCache = options.metadataCache || null;
  const vault = options.vault || null;
  const sourcePath = options.sourcePath || (self && self.path) || "";
  const fallbackFromReport = () => {
    const chain = [];
    if (root && (!owner || root.toLowerCase() !== owner.toLowerCase())) {
      chain.push({
        stem: root,
        path: /\.md$/i.test(root) ? root : `${root}.md`,
        title: root,
        kind: "root",
        missing: false,
      });
    }
    if (owner) {
      const ownerEntry = report ? notebookHeaderLookup(report, owner) : null;
      chain.push({
        stem: owner,
        path: ownerEntry && ownerEntry.path
          ? ownerEntry.path
          : (/\.md$/i.test(owner) ? owner : `${owner}.md`),
        title: ownerEntry && ownerEntry.title ? ownerEntry.title : owner,
        kind: "owner",
        missing: false,
      });
    }
    return { chain, broken: false, cyclic: false, truncated: false };
  };
  if (!owner && !root) {
    return { chain: [], broken: false, cyclic: false, truncated: false };
  }
  if (typeof pomodoroHomeResolve === "function" && metadataCache) {
    try {
      const resolved = pomodoroHomeResolve(
        owner || root,
        sourcePath || owner || root,
        metadataCache,
        vault,
        [],
        new Set(),
      );
      if (resolved && Array.isArray(resolved.chain) && resolved.chain.length > 0) {
        // Resolve walks owner → … → root parent. Reverse so the breadcrumb
        // reads root-first and keeps every intermediate project.
        const ordered = resolved.chain.slice().reverse();
        let start = 0;
        if (root) {
          const rootKey = notebookHeaderStem(root).toLowerCase();
          const at = ordered.findIndex((path) => notebookHeaderStem(path).toLowerCase() === rootKey);
          if (at >= 0) {
            start = at;
          }
        }
        const slice = ordered.slice(start);
        const crumbs = [];
        for (const rawPath of slice) {
          const path = notebookHeaderReportPath(rawPath);
          const stem = notebookHeaderStem(path);
          const stemKey = stem.toLowerCase();
          const isOwner = owner && stemKey === notebookHeaderStem(owner).toLowerCase();
          const isRoot = root && stemKey === notebookHeaderStem(root).toLowerCase();
          crumbs.push({
            stem,
            path,
            title: notebookHeaderNoteTitle(path, metadataCache, vault),
            kind: isRoot ? "root" : isOwner ? "owner" : "ancestor",
            missing: false,
          });
        }
        if (crumbs.length > 0) {
          return { chain: crumbs, broken: false, cyclic: false, truncated: false };
        }
      }
    } catch (error) {
      // Fall through to the report-identity fallback.
    }
  }
  return fallbackFromReport();
}

function notebookHeaderCrumbs(report, sourcePath, options = {}) {
  const self = notebookHeaderEntryForPath(report, sourcePath);
  if (!self) {
    return null;
  }
  const { chain, broken, cyclic, truncated } = notebookHeaderNotebookAncestors(report, sourcePath);
  const ownerWalk = notebookHeaderOwnerAncestors(self, {
    ...options,
    report,
    sourcePath,
  });
  const crumbs = ownerWalk.chain.slice();
  for (const ancestor of chain) {
    crumbs.push({
      stem: ancestor.stem,
      path: ancestor.path,
      title: ancestor.title || ancestor.stem,
      kind: "notebook",
      missing: false,
    });
  }
  crumbs.push({
    stem: self.stem,
    path: self.path,
    title: self.title || self.stem,
    kind: "self",
    missing: false,
  });
  const collapsed = notebookHeaderCollapse(crumbs, NOTEBOOK_HEADER_MAX_CRUMBS);
  return {
    self,
    crumbs: collapsed,
    fullLength: crumbs.length,
    truncated: truncated || ownerWalk.truncated || collapsed.length !== crumbs.length,
    broken: broken || ownerWalk.broken,
    cyclic: cyclic || ownerWalk.cyclic,
  };
}

function notebookHeaderModel(report, sourcePath, options = {}) {
  const headed = notebookHeaderCrumbs(report, sourcePath, options);
  if (!headed) {
    return null;
  }
  const children = notebookHeaderChildEntries(report, headed.self);
  return { ...headed, children };
}

function notebookHeaderSignature(model, options = {}) {
  if (!model) {
    return "none";
  }
  try {
    const crumbs = (model.crumbs || []).map((crumb) =>
      crumb.ellipsis
        ? "…"
        : `${crumb.kind || ""}:${crumb.path || crumb.stem || ""}:${crumb.title || ""}:${crumb.missing ? "m" : ""}`,
    ).join(">");
    const kids = (model.children || []).map((child) =>
      `${child.path || child.stem || ""}:${child.title || ""}`,
    ).join(",");
    const hue = options && options.hue ? String(options.hue) : "";
    const chips = options && options.chipsEnabled === false ? "0" : "1";
    const flags = `${model.broken ? "b" : ""}${model.cyclic ? "c" : ""}${model.truncated ? "t" : ""}`;
    return `${crumbs}|${kids}|${hue}|${chips}|${flags}`;
  } catch (error) {
    return "header";
  }
}

function notebookHeaderReadingSurface(el) {
  if (!el) {
    return el;
  }
  try {
    if (typeof el.closest === "function") {
      const embed = el.closest(".markdown-embed, .internal-embed");
      if (embed) {
        try {
          if (typeof embed.querySelector === "function") {
            return embed.querySelector(".markdown-embed-content")
              || embed.querySelector(".markdown-preview-view")
              || embed;
          }
        } catch (error) {
          return embed;
        }
        return embed;
      }
      const sizer = el.closest(".markdown-preview-sizer");
      if (sizer) {
        return sizer;
      }
      const preview = el.closest(".markdown-preview-view");
      if (preview) {
        return preview;
      }
    }
  } catch (error) {
    // Fall through to el.
  }
  return el;
}
