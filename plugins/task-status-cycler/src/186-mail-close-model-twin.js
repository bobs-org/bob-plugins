// Bob Navigation Hotkeys twin of bob-cli's Mail Close Card model.
// Pure helpers are shared with the vector harness; vault access is injected.
function mailCloseStripInlineCode(text) {
  return String(text || "").replace(/`+[^`]*`+/g, "");
}

function mailCloseLineLinks(line) {
  const text = mailCloseStripInlineCode(line);
  const links = [];
  const re = /(!?)\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = re.exec(text))) {
    if (match[1] === "!") continue;
    const target = String(match[2].split("|")[0].split("#")[0] || "").trim();
    if (target) links.push(target);
  }
  return links;
}

function mailCloseLinkOnlyBullet(line) {
  const text = mailCloseStripInlineCode(line).trim();
  if (/~~/.test(text) || /!\[\[/.test(text)) return null;
  const match = /^(?:[-+*]|\d+[.)])[ \t]+(.*)$/.exec(text);
  if (!match) return null;
  const body = match[1].trim();
  const link = /^\[\[([^\]]+)\]\]$/.exec(body);
  if (!link) return null;
  const target = String(link[1].split("|")[0].split("#")[0] || "").trim();
  return target || null;
}

function mailCloseTaskLinks(line, children, resolve, isMail) {
  const result = [];
  const push = (target) => {
    let resolved = null;
    try { resolved = typeof resolve === "function" ? resolve(target) : null; } catch (_error) {}
    const path = typeof resolved === "string" ? resolved : resolved && resolved.path;
    let mail = false;
    try { mail = typeof isMail === "function" && isMail(path, resolved) === true; } catch (_error) {}
    if (mail && path && !result.includes(path)) result.push(path);
  };
  for (const target of mailCloseLineLinks(line)) push(target);
  const childRows = (Array.isArray(children) ? children : []).map((child) => String(child || ""));
  const indents = childRows.map((child) => {
    const match = /^(\s*)\S/.exec(child);
    return match ? match[1].replace(/\t/g, "    ").length : Infinity;
  }).filter(Number.isFinite);
  const directIndent = indents.length ? Math.min(...indents) : Infinity;
  for (const child of childRows) {
    const match = /^(\s*)/.exec(child);
    const indent = match ? match[1].replace(/\t/g, "    ").length : 0;
    if (indent !== directIndent) continue;
    const target = mailCloseLinkOnlyBullet(child);
    if (target) push(target);
  }
  return result;
}

function mailCloseFrontmatterIsMail(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object") return false;
  const type = frontmatter.type;
  return type === "[[mail]]" || (typeof frontmatter.gmail_thread_id === "string" && frontmatter.gmail_thread_id.trim() !== "");
}

function mailClosePredicate(input = {}) {
  const line = String(input.line || "");
  if (!/^\s*(?:[-+*]|\d+[.)])\s+\[[ /?*]\]/.test(line) || !/(?:^|\s)#task(?:\s|$)/.test(line)) {
    return { gmail_task: false, notes: [] };
  }
  const notes = mailCloseTaskLinks(line, input.children, input.resolve, (path, resolved) => {
    if (typeof input.isMail === "function") return input.isMail(path, resolved) === true;
    if (resolved && resolved.frontmatter) return mailCloseFrontmatterIsMail(resolved.frontmatter);
    const fronts = input.notes || {};
    return mailCloseFrontmatterIsMail(fronts[path]);
  });
  return { gmail_task: notes.length > 0, notes };
}

function mailCloseStatusName(status) {
  switch (String(status || "")) {
    case " ": return "Ready";
    case "*": return "Next";
    case "/": return "In Progress";
    case "?": return "Blocked";
    case "x": case "X": return "Done";
    case "-": return "Cancelled";
    default: return "Task";
  }
}

function mailCloseVerb(after) {
  return after === "x" || after === "X" ? "complete" : after === "-" ? "cancel" : null;
}

function mailCloseNormalizeWho(who) {
  return String(who || "").split(/\r?\n/)[0].trim().replace(/::/g, ":").trim();
}

function mailCloseTaskText(line) {
  const text = String(line || "");
  const close = text.indexOf("]");
  const afterBox = close >= 0 ? text.slice(close + 1).trim() : text.trim();
  return afterBox.split(/\s+/).filter((token) => token !== "#task").join(" ");
}

function mailCloseDate(raw) {
  if (!raw) return null;
  const text = String(raw);
  const normalized = /^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d+)?)?)?$/.test(text) ? `${text}Z` : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mailCloseFormatAge(sinceRaw, nowRaw) {
  const since = mailCloseDate(sinceRaw);
  const now = mailCloseDate(nowRaw);
  if (!since || !now) return null;
  const seconds = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function mailCloseFormatShortDate(raw) {
  const date = mailCloseDate(raw);
  if (!date) return null;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[date.getUTCDay()]}, ${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function mailCloseTurnLine(mail, now) {
  const who = mailCloseNormalizeWho(mail.who);
  if (mail.turn === "yours") {
    const age = mailCloseFormatAge(mail.turn_since, now);
    if (!age) return null;
    return who ? `↩ ${who} · ${age} — waiting on your reply` : `↩ ${age} — waiting on your reply`;
  }
  if (mail.turn === "theirs") {
    const date = mailCloseFormatShortDate(mail.turn_since);
    if (date) return who ? `✈ You wrote ${date} — waiting on ${who}` : `✈ You wrote ${date}`;
    return who ? `✈ Waiting on ${who}` : null;
  }
  return null;
}

function mailCloseChosenMail(mails) {
  const list = Array.isArray(mails) ? mails : [];
  return list.find((mail) => mail && mail.turn === "yours") || list[0] || null;
}

function mailCloseRowLabel(mail, fallback) {
  const title = String(mail.title || "").trim();
  const who = mailCloseNormalizeWho(mail.who);
  const base = title ? `✉️ ${title}` : String(fallback || "").trim();
  if (!base) return who ? `✉️ ${who}` : "✉️ Email task";
  return who ? `${base} · ${who}` : base;
}

function mailCloseByteCompare(left, right) {
  return Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
}

function mailCloseMailListCompare(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const result = mailCloseByteCompare(a[index], b[index]);
    if (result !== 0) return result;
  }
  return a.length - b.length;
}

function mailCloseDigest(targets) {
  const rows = (Array.isArray(targets) ? targets : []).map((target) => {
    const mails = Array.isArray(target.mails) ? target.mails.map((mail) => String(mail.note || "")) : [];
    return { path: String(target.path || ""), line: Math.max(0, Math.floor(Number(target.line) || 0)), before: String(target.before || " ").slice(0, 1), after: String(target.after || " ").slice(0, 1), mails };
  });
  rows.sort((a, b) => mailCloseByteCompare(a.path, b.path) || a.line - b.line || mailCloseByteCompare(a.before, b.before) || mailCloseByteCompare(a.after, b.after) || mailCloseMailListCompare(a.mails, b.mails));
  const canonical = rows.map((row) => `${row.path}:${row.line}:${row.before}:${row.after}:${row.mails.join(",")}`).join("\n");
  return require("crypto").createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12);
}

function buildMailCloseCopy(targets, options = {}) {
  const list = Array.isArray(targets) ? targets : [];
  const now = String(options.now || new Date().toISOString());
  const other = options.other_open_linkers || {};
  const verbs = list.map((target) => mailCloseVerb(target.after)).filter(Boolean);
  const complete = verbs.filter((verb) => verb === "complete").length;
  const cancel = verbs.length - complete;
  const mixed = complete > 0 && cancel > 0;
  const verb = mixed ? "close" : cancel > 0 ? "cancel" : "complete";
  const title = list.length === 1
    ? (verb === "cancel" ? "Cancel this email task?" : "Complete this email task?")
    : mixed ? `Close ${list.length} tasks?` : verb === "cancel" ? `Cancel ${list.length} tasks?` : `Complete ${list.length} tasks?`;
  const distinctNotes = [...new Set(list.flatMap((target) => (target.mails || []).map((mail) => String(mail.note || ""))))].sort(mailCloseByteCompare);
  const subtitle = list.length === 1
    ? `${list[0].path} · ${mailCloseStatusName(list[0].before)} → ${mailCloseStatusName(list[0].after)}`
    : `${list.length} tasks · ${distinctNotes.length} wired to email`;
  const rows = list.slice(0, 5).map((target) => {
    const mail = mailCloseChosenMail(target.mails);
    const fallback = String(target.task_text || mailCloseTaskText(target.line_text || "")).trim();
    return {
      path: target.path,
      line: target.line,
      label: mail ? mailCloseRowLabel(mail, fallback) : fallback,
      turn_line: mail ? mailCloseTurnLine(mail, now) : null,
      note: mail ? String(mail.note || "") : "",
    };
  });
  const more = Math.max(0, list.length - rows.length);
  const orphaned = distinctNotes.filter((note) => !(Number(other[note]) > 0));
  const allMails = list.flatMap((target) => target.mails || []);
  const yours = orphaned.flatMap((note) => allMails.filter((mail) => mail.note === note && mail.turn === "yours"));
  const theirs = orphaned.flatMap((note) => allMails.filter((mail) => mail.note === note && mail.turn === "theirs"));
  const tone = yours.length ? "warning" : "calm";
  let consequence;
  if (!orphaned.length) consequence = distinctNotes.length > 1 ? "Another open task still watches these threads." : "Another open task still watches this thread.";
  else if (yours.length) {
    if (orphaned.length > 1) consequence = `${orphaned.length} threads are waiting on your reply, and nothing reopens these tasks until they write again.`;
    else {
      const who = mailCloseNormalizeWho(yours[0].who);
      consequence = who ? `${who} is waiting on your reply, and nothing reopens this task until they write again.` : "They are waiting on your reply, and nothing reopens this task until they write again.";
    }
  } else if (theirs.length) {
    if (orphaned.length > 1) consequence = "A reply reopens them.";
    else {
      const who = mailCloseNormalizeWho(theirs[0].who);
      consequence = who ? `A reply from ${who} reopens it.` : "A reply reopens it.";
    }
  } else consequence = orphaned.length > 1 ? "Bob stops watching these threads." : "Bob stops watching this thread.";
  if (options.archive === true && orphaned.length) consequence += orphaned.length > 1 ? " Bob's archive-on-close can then clear them from your Gmail inbox." : " Bob's archive-on-close can then clear it from your Gmail inbox.";
  return { title, subtitle, tone, verb, rows, more, consequence, digest: mailCloseDigest(list) };
}

function mailCloseVectorPredicate(vector) {
  if (vector.task_hidden === true) return { gmail_task: false, notes: [] };
  const links = vector.link_to_path || {};
  const result = mailClosePredicate({
    line: vector.line,
    children: vector.children,
    notes: vector.notes,
    resolve: (target) => {
      const path = links[target] || (() => {
        const basename = String(target || "").split("/").pop().replace(/\.md$/i, "").toLowerCase();
        const matches = (Array.isArray(vector.vault_files) ? vector.vault_files : []).filter((file) => String(file).split("/").pop().replace(/\.md$/i, "").toLowerCase() === basename);
        return matches.length === 1 ? matches[0] : null;
      })();
      if (!path) return null;
      return { path, frontmatter: vector.notes && vector.notes[path] };
    },
    isMail: (_path, file) => mailCloseFrontmatterIsMail(file && file.frontmatter),
  });
  return result;
}
