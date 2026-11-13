// --- Gmail open hint: pure core ------------------------------------------
// Owned by bob-cli `docs/mail-link-marks.md`. Display-only availability
// predicate for the `⌘↵ Gmail` chip: this line can open an email via the
// bob-mail Cmd+Enter keymap. Reads mail note frontmatter through injected
// resolvers and never writes. Every helper is synchronous and never throws.

const GMAIL_OPEN_HINT_CLASS = "bob-gmail-open-hint";
const GMAIL_OPEN_HINT_SIDE = 1;
const GMAIL_OPEN_HINT_ARIA = "Cmd+Enter opens this email in Gmail";

function gmailOpenHintIsGmailUrl(value) {
  try {
    const text = String(value || "").trim();
    if (!text || /\s|[<>]/.test(text)) return false;
    const url = new URL(text);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname.toLowerCase() === "mail.google.com" && url.pathname.startsWith("/mail/");
  } catch (error) {
    return false;
  }
}

function gmailOpenHintIsMac() {
  try {
    if (typeof navigator !== "object" || !navigator) return false;
    const text = String(navigator.platform || navigator.userAgent || "");
    return /Mac|iPhone|iPad/.test(text);
  } catch (error) {
    return false;
  }
}

function gmailOpenHintLabel(isMac) {
  try {
    return (isMac ? "⌘↵ Gmail" : "M-↵ Gmail");
  } catch (error) {
    return "⌘↵ Gmail";
  }
}

function gmailOpenHintIsTaskRow(lineText) {
  try {
    if (typeof freshnessTaskStatus === "function") {
      return freshnessTaskStatus(String(lineText || "")) !== null;
    }
    return /^\s*(?:>\s*)*[-*+]\s+\[[^\]\r\n]\]/.test(String(lineText || ""));
  } catch (error) {
    return false;
  }
}

function gmailOpenHintIndent(lineText) {
  try {
    const indent = String(lineText || "").match(/^\s*/)[0] || "";
    return indent.replace(/\t/g, "    ").length;
  } catch (error) {
    return 0;
  }
}

// First `mail/...` wikilink target on one line, ignoring embedded links and
// inline code. Strips a trailing `.md`. Reuses the mail-link-marks tokenizer
// when present so both surfaces share one lookup rule. Never throws.
function gmailOpenHintFirstMailPath(lineText) {
  try {
    const text = String(lineText || "");
    if (text.indexOf("[[") === -1) return null;
    if (typeof mailLinkMarkTokens === "function") {
      const tokens = mailLinkMarkTokens(text);
      for (const token of tokens) {
        try {
          const part = String(token && token.pathPart || "").trim();
          if (part.startsWith("mail/")) return part;
        } catch (error) {
          continue;
        }
      }
      return null;
    }
    const visible = typeof blockMarkMaskInlineCode === "function"
      ? blockMarkMaskInlineCode(text)
      : text;
    const pattern = /\[\[(mail\/[^\]#|]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    let match = pattern.exec(visible);
    while (match !== null) {
      try {
        const start = match.index;
        if (start > 0 && text[start - 1] === "!") {
          match = pattern.exec(visible);
          continue;
        }
        let target = String(match[1] || "").trim();
        if (/\.md$/i.test(target)) target = target.slice(0, -3);
        if (target) return target;
      } catch (error) {
        // One bad token never breaks the scan.
      }
      match = pattern.exec(visible);
    }
    return null;
  } catch (error) {
    return null;
  }
}

// A plain bullet whose only content is one wikilink. Returns its target path
// (before `|`, `#`, `^`) or null. Checkbox rows never qualify. Never throws.
function gmailOpenHintLinkOnlyTarget(lineText) {
  try {
    const text = String(lineText || "");
    if (gmailOpenHintIsTaskRow(text)) return null;
    const match = text.match(/^\s*[-*+]\s*(\[\[[^\]]+\]\])\s*$/);
    if (!match) return null;
    const inner = match[1].slice(2, -2);
    const target = inner.split(/[|#^]/)[0].trim().replace(/\.md$/i, "");
    return target || null;
  } catch (error) {
    return null;
  }
}

function gmailOpenHintIsMailFrontmatter(frontmatter) {
  try {
    if (typeof blockMarkIsMailFrontmatter === "function") {
      return blockMarkIsMailFrontmatter(frontmatter);
    }
    if (!frontmatter || typeof frontmatter !== "object") return false;
    if (typeof frontmatter.gmail_thread_id === "string") return true;
    const types = Array.isArray(frontmatter.type) ? frontmatter.type : [frontmatter.type];
    return types.some((value) => String(value || "").trim().replace(/^\[\[/, "").replace(/\]\]$/, "").trim().toLowerCase() === "mail");
  } catch (error) {
    return false;
  }
}

function gmailOpenHintResolveMail(pathPart, sourcePath, resolvers) {
  try {
    if (!pathPart || typeof pathPart !== "string" || !pathPart.startsWith("mail/")) return null;
    const hooks = resolvers && typeof resolvers === "object" ? resolvers : {};
    const getDest = hooks.getDest;
    const getFrontmatter = hooks.getFrontmatter;
    if (typeof getDest !== "function" || typeof getFrontmatter !== "function") return null;
    const file = getDest(pathPart, String(sourcePath || ""));
    if (!file) return null;
    const frontmatter = getFrontmatter(file);
    if (!gmailOpenHintIsMailFrontmatter(frontmatter)) return null;
    if (!gmailOpenHintIsGmailUrl(frontmatter && frontmatter.gmail_url)) return null;
    return { file, frontmatter };
  } catch (error) {
    return null;
  }
}

function gmailOpenHintLineResolves(lineText, sourcePath, resolvers) {
  try {
    const target = gmailOpenHintFirstMailPath(lineText);
    if (!target) return null;
    return gmailOpenHintResolveMail(target, sourcePath, resolvers);
  } catch (error) {
    return null;
  }
}

// Direct link-only child hop: the cursor line is a checkbox task row with no
// mail link of its own, and one of its direct link-only child bullets
// resolves to a mail note. First such child wins. Never throws.
function gmailOpenHintChildResolves(lines, line, sourcePath, resolvers) {
  try {
    if (!Array.isArray(lines) || !Number.isInteger(line) || line < 0 || line >= lines.length) return null;
    const parentText = String(lines[line] || "");
    if (!gmailOpenHintIsTaskRow(parentText)) return null;
    if (gmailOpenHintFirstMailPath(parentText) !== null) return null;
    const parentIndent = gmailOpenHintIndent(parentText);
    const candidates = [];
    for (let index = line + 1; index < lines.length; index += 1) {
      const text = String(lines[index] || "");
      if (!text.trim()) continue;
      const indent = gmailOpenHintIndent(text);
      if (indent <= parentIndent) break;
      if (!/^\s*[-*+]/.test(text)) continue;
      candidates.push({ text, indent });
    }
    if (candidates.length === 0) return null;
    let directIndent = null;
    for (const candidate of candidates) {
      if (directIndent === null || candidate.indent < directIndent) directIndent = candidate.indent;
    }
    for (const candidate of candidates) {
      if (candidate.indent !== directIndent) continue;
      const target = gmailOpenHintLinkOnlyTarget(candidate.text);
      if (!target || !target.startsWith("mail/")) continue;
      const resolved = gmailOpenHintResolveMail(target, sourcePath, resolvers);
      if (!resolved) continue;
      return resolved;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// A link-only Task Link hop row (decision `tasklink_hop_scope = link_only`):
// a plain bullet whose sole content is one `[[note#^id]]` wikilink. Checkbox
// rows, embeds (`![[...]]`), struck links (`~~...~~`), and multi-link rows
// never qualify. Returns `{ path, blockId }` or null. Never throws.
function gmailOpenHintTaskLinkHopTarget(lineText) {
  try {
    const text = String(lineText || "");
    if (gmailOpenHintIsTaskRow(text)) return null;
    if (text.indexOf("[[") === -1 || text.indexOf("#^") === -1) return null;
    const match = text.match(/^\s*[-*+]\s*(\[\[[^\]]+\]\])\s*$/);
    if (!match) return null;
    const raw = match[1];
    const start = text.indexOf(raw);
    if (start > 0 && text[start - 1] === "!") return null;
    if (/~~/.test(text)) return null;
    const inner = raw.slice(2, -2);
    const targetPart = String(inner.split("|")[0] || "").trim();
    const hop = targetPart.match(/^(.*)#\^([A-Za-z0-9-]+)$/);
    if (!hop) return null;
    const path = String(hop[1] || "").trim().replace(/\.md$/i, "");
    const blockId = hop[2];
    if (!blockId) return null;
    if (path.startsWith("mail/")) return null;
    return { path, blockId };
  } catch (error) {
    return null;
  }
}

function gmailOpenHintFindBlockLineIndex(targetLines, blockId) {
  try {
    if (!Array.isArray(targetLines)) return null;
    const id = String(blockId || "");
    if (!id) return null;
    for (let index = 0; index < targetLines.length; index += 1) {
      if (String(targetLines[index] || "").includes("^" + id)) return index;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Exactly one Task Link hop (no recursion): the cursor row is a link-only
// `[[note#^id]]` bullet whose target task row is a Gmail Task row — either
// its own line carries a `[[mail/…]]` link or a direct link-only child bullet
// does. Target line text comes from the injected sync resolvers
// (`getTargetLine(path, blockId)` or `getTargetLines(path)`), so the
// decoration build stays synchronous; without a sync line source the hop
// stays silent. Never throws.
function gmailOpenHintTaskLinkHopResolves(lineText, sourcePath, resolvers) {
  try {
    const hop = gmailOpenHintTaskLinkHopTarget(lineText);
    if (!hop) return null;
    const hooks = resolvers && typeof resolvers === "object" ? resolvers : {};
    const getDest = hooks.getDest;
    if (typeof getDest !== "function") return null;
    let targetPath = null;
    try {
      if (hop.path) {
        const file = getDest(hop.path, String(sourcePath || ""));
        if (!file || typeof file.path !== "string") return null;
        targetPath = file.path;
      } else {
        targetPath = String(sourcePath || "");
      }
    } catch (error) {
      return null;
    }
    if (!targetPath) return null;
    let targetLines = null;
    let targetLineText = null;
    let targetLineIndex = null;
    try {
      if (typeof hooks.getTargetLines === "function") {
        const found = hooks.getTargetLines(targetPath);
        if (Array.isArray(found)) targetLines = found;
      }
      if (typeof hooks.getTargetLine === "function") {
        const found = hooks.getTargetLine(targetPath, hop.blockId);
        if (typeof found === "string" && found) targetLineText = found;
      }
      if (targetLineText === null && targetLines) {
        const index = gmailOpenHintFindBlockLineIndex(targetLines, hop.blockId);
        if (index !== null) {
          targetLineIndex = index;
          targetLineText = String(targetLines[index] || "");
        }
      } else if (targetLines && targetLineText !== null) {
        const index = gmailOpenHintFindBlockLineIndex(targetLines, hop.blockId);
        if (index !== null) targetLineIndex = index;
      }
      if (targetLineText === null) return null;
    } catch (error) {
      return null;
    }
    if (!targetLineText.includes("^" + hop.blockId)) return null;
    const direct = gmailOpenHintFirstMailPath(targetLineText);
    if (direct) {
      const resolved = gmailOpenHintResolveMail(direct, targetPath, resolvers);
      if (resolved) return resolved;
    }
    if (targetLines && targetLineIndex !== null) {
      const child = gmailOpenHintChildResolves(targetLines, targetLineIndex, targetPath, resolvers);
      if (child) return child;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// One shared availability predicate: line-borne mail link (any line), the
// Gmail Task child hop, or the link-only Task Link hop to a Gmail Task row.
// Never the whole-note fallback. Never throws.
function gmailOpenHintCanOpen(lineText, lines, line, sourcePath, resolvers) {
  try {
    if (typeof lineText !== "string") return false;
    if (gmailOpenHintLineResolves(lineText, sourcePath, resolvers)) return true;
    if (Array.isArray(lines) && Number.isInteger(line)) {
      if (gmailOpenHintChildResolves(lines, line, sourcePath, resolvers)) return true;
      if (gmailOpenHintTaskLinkHopResolves(lineText, sourcePath, resolvers)) return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function buildGmailOpenHintElement(doc, label) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !label) {
      return null;
    }
    const host = doc.createElement("span");
    host.setAttribute("class", GMAIL_OPEN_HINT_CLASS);
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", GMAIL_OPEN_HINT_ARIA);
    host.setAttribute("data-tooltip-position", "top");
    host.textContent = String(label);
    return host;
  } catch (error) {
    return null;
  }
}

let GmailOpenHintWidget = null;
if (typeof WidgetType === "function") {
  GmailOpenHintWidget = class extends WidgetType {
    constructor(label) {
      super();
      this.label = String(label || "");
      this.key = this.label;
    }

    eq(other) {
      return Boolean(other && other instanceof GmailOpenHintWidget && other.key === this.key);
    }

    toDOM() {
      const doc = typeof document !== "undefined" ? document : null;
      const dom = buildGmailOpenHintElement(doc, this.label);
      if (dom) return dom;
      try {
        return doc && typeof doc.createElement === "function" ? doc.createElement("span") : null;
      } catch (error) {
        return null;
      }
    }
  };
}
