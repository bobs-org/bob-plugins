function mailCloseNormalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function mailCloseScalar(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.length ? mailCloseScalar(value[0]) : "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function mailCloseParsedFrontmatter(text) {
  try {
    const match = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(String(text || ""));
    if (!match || typeof parseYaml !== "function") return null;
    const value = parseYaml(match[1]);
    return value && typeof value === "object" ? value : null;
  } catch (_error) { return null; }
}

function mailCloseVaultFile(app, path) {
  try {
    const vault = app && app.vault;
    const normalized = mailCloseNormalizePath(path);
    const exact = vault && typeof vault.getAbstractFileByPath === "function"
      ? vault.getAbstractFileByPath(normalized) || (!/\.md$/i.test(normalized) ? vault.getAbstractFileByPath(`${normalized}.md`) : null)
      : null;
    if (exact) return exact;
    const files = vault && typeof vault.getMarkdownFiles === "function" ? vault.getMarkdownFiles() : [];
    const basename = normalized.split("/").pop().replace(/\.md$/i, "").toLowerCase();
    const matches = files.filter((file) => String(file && file.basename || "").toLowerCase() === basename);
    if (matches.length !== 1) return null;
    const metadata = app && app.metadataCache;
    if (metadata && typeof metadata.getFirstLinkpathDest === "function") {
      const resolved = metadata.getFirstLinkpathDest(normalized, "");
      if (resolved && matches.some((file) => file.path === resolved.path)) return resolved;
    }
    return matches[0];
  } catch (_error) { return null; }
}

function mailCloseResolvedLinkFile(app, linkpath, sourcePath) {
  try {
    const link = String(linkpath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    const basename = link.split("/").pop().replace(/\.md$/i, "").toLowerCase();
    const files = app && app.vault && typeof app.vault.getMarkdownFiles === "function" ? app.vault.getMarkdownFiles() : [];
    if (!link.includes("/") && files.filter((file) => String(file.basename || "").toLowerCase() === basename).length > 1) return null;
    const metadata = app && app.metadataCache;
    const resolved = metadata && typeof metadata.getFirstLinkpathDest === "function"
      ? metadata.getFirstLinkpathDest(linkpath, sourcePath)
      : null;
    return resolved || mailCloseVaultFile(app, linkpath);
  } catch (_error) { return null; }
}

async function mailCloseReadFile(app, file) {
  try {
    const vault = app && app.vault;
    if (!vault || !file) return "";
    if (typeof vault.cachedRead === "function") return String((await vault.cachedRead(file)) || "");
    if (typeof vault.read === "function") return String((await vault.read(file)) || "");
  } catch (_error) {}
  return "";
}

async function mailCloseFrontmatterForFile(app, file) {
  try {
    const metadata = app && app.metadataCache;
    const cache = metadata && typeof metadata.getFileCache === "function" ? metadata.getFileCache(file) : null;
    if (cache && cache.frontmatter && typeof cache.frontmatter === "object") return cache.frontmatter;
  } catch (_error) {}
  return mailCloseParsedFrontmatter(await mailCloseReadFile(app, file));
}

async function mailCloseFactsForPath(app, notePath) {
  const file = mailCloseVaultFile(app, notePath);
  if (!file) return null;
  const frontmatter = await mailCloseFrontmatterForFile(app, file);
  if (!mailCloseFrontmatterIsMail(frontmatter)) return null;
  const content = await mailCloseReadFile(app, file);
  return {
    note: mailCloseNormalizePath(file.path),
    title: mailCloseScalar(frontmatter.title),
    who: mailCloseScalar(frontmatter.who),
    turn: ["yours", "theirs"].includes(mailCloseScalar(frontmatter.turn)) ? mailCloseScalar(frontmatter.turn) : null,
    turn_since: mailCloseScalar(frontmatter.turn_since) || null,
    gmail_url: mailCloseScalar(frontmatter.gmail_url),
    frontmatter,
    content,
  };
}

function mailCloseChildrenAt(lines, taskIndex, contexts = null) {
  const task = String(lines[taskIndex] || "");
  const taskIndent = (/^\s*/.exec(task) || [""])[0].replace(/\t/g, "    ").length;
  const children = [];
  for (let index = taskIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    const context = Array.isArray(contexts) ? contexts[index] : null;
    if (context && (context.inFence || context.inFrontmatter)) continue;
    if (!line.trim()) continue;
    const indent = (/^\s*/.exec(line) || [""])[0].replace(/\t/g, "    ").length;
    if (indent <= taskIndent) break;
    children.push(line);
  }
  return children;
}

async function mailCloseClassifyTargets(app, targets) {
  const output = [];
  for (const source of Array.isArray(targets) ? targets : []) {
    if (!source || typeof source !== "object") continue;
    const path = mailCloseNormalizePath(source.path);
    const line = Math.floor(Number(source.line));
    const before = String(source.before || " ").slice(0, 1);
    const after = String(source.after || " ").slice(0, 1);
    if (!path || !Number.isInteger(line) || line < 1 || ![" ", "*", "/", "?"].includes(before) || !["x", "X", "-"].includes(after)) continue;
    const file = mailCloseVaultFile(app, path);
    if (!file) continue;
    const content = await mailCloseReadFile(app, file);
    const lines = content.split(/\r?\n/);
    const liveLineText = String(lines[line - 1] || "");
    if (typeof source.lineText === "string" && source.lineText !== liveLineText) continue;
    const lineText = liveLineText;
    const status = typeof getObsidianTaskCheckboxStatus === "function" ? getObsidianTaskCheckboxStatus(lineText) : null;
    const contexts = getMarkdownLineContexts(content);
    if (status !== before || !isObsidianTaskAtLine(content, line - 1, contexts, lines)) continue;
    const children = mailCloseChildrenAt(lines, line - 1, contexts);
    const resolvedLinks = new Map();
    const possibleLinks = new Set(mailCloseLineLinks(lineText));
    for (const child of children) {
      const link = mailCloseLinkOnlyBullet(child);
      if (link) possibleLinks.add(link);
    }
    const frontmatterByPath = {};
    for (const link of possibleLinks) {
      const linkedFile = mailCloseResolvedLinkFile(app, link, file.path);
      if (!linkedFile) continue;
      const linkedPath = mailCloseNormalizePath(linkedFile.path);
      const frontmatter = await mailCloseFrontmatterForFile(app, linkedFile);
      resolvedLinks.set(link, { path: linkedPath, frontmatter });
      if (frontmatter) frontmatterByPath[linkedPath] = frontmatter;
    }
    const predicate = mailClosePredicate({
      line: lineText,
      children,
      resolve: (link) => resolvedLinks.get(link) || null,
      notes: frontmatterByPath,
      isMail: (_path, resolved) => mailCloseFrontmatterIsMail(resolved && resolved.frontmatter),
    });
    const mails = [];
    for (const notePath of predicate.notes) {
      const facts = await mailCloseFactsForPath(app, notePath);
      if (facts) mails.push(facts);
    }
    if (!mails.length) continue;
    output.push({ path, line, before, after, line_text: lineText, task_text: mailCloseTaskText(lineText), mails, gmail_task: true });
  }
  return output;
}

async function mailCloseOtherOpenLinkers(app, targets) {
  const excluded = new Set((targets || []).map((target) => `${target.path}\u0000${target.line}`));
  const mailPaths = new Set((targets || []).flatMap((target) => target.mails.map((mail) => mail.note)));
  const sourcesByMail = new Map([...mailPaths].map((path) => [path, new Set()]));
  for (const target of targets || []) {
    for (const mail of target.mails || []) sourcesByMail.get(mail.note)?.add(target.path);
  }
  try {
    const resolved = app && app.metadataCache && app.metadataCache.resolvedLinks || {};
    for (const [source, destinations] of Object.entries(resolved)) {
      for (const mailPath of mailPaths) if (destinations && Number(destinations[mailPath]) > 0) sourcesByMail.get(mailPath).add(source);
    }
  } catch (_error) {}
  const counts = {};
  for (const mailPath of mailPaths) {
    let count = 0;
    for (const sourcePath of sourcesByMail.get(mailPath) || []) {
      const file = mailCloseVaultFile(app, sourcePath);
      if (!file) continue;
      const content = await mailCloseReadFile(app, file);
      const lines = content.split(/\r?\n/);
      const contexts = getMarkdownLineContexts(content);
      for (let index = 0; index < lines.length; index += 1) {
        const row = String(lines[index] || "");
        const context = contexts[index] || {};
        if (context.inFrontmatter || context.inFence || !/^\s*(?:[-+*]|\d+[.)])\s+\[([ /?*])\]/.test(row) || !/(?:^|\s)#task(?:\s|$)/.test(row)) continue;
        if (excluded.has(`${mailCloseNormalizePath(file.path)}\u0000${index + 1}`)) continue;
        const predicate = mailClosePredicate({
          line: row,
          children: mailCloseChildrenAt(lines, index, contexts),
          resolve: (link) => {
            const linked = mailCloseResolvedLinkFile(app, link, file.path);
            const path = linked ? mailCloseNormalizePath(linked.path) : null;
            return path ? { path, frontmatter: mailPaths.has(path) ? { type: "[[mail]]" } : null } : null;
          },
          isMail: (path) => mailPaths.has(path),
        });
        if (predicate.notes.includes(mailPath)) count += 1;
      }
    }
    counts[mailPath] = count;
  }
  return counts;
}

function mailCloseArchiveOn(app) {
  try {
    const fs = requireOptionalNodeModule("fs");
    if (!fs || typeof fs.readFileSync !== "function" || typeof parseYaml !== "function") return false;
    const configPath = getBulletPropertyConfigPath({});
    const config = parseYaml(fs.readFileSync(configPath, "utf8"));
    return Boolean(config && config.gmail && config.gmail.sync && config.gmail.sync.archive === true);
  } catch (_error) { return false; }
}

function mailCloseTargetsFromCancelPlan(path, content, plan) {
  const lines = String(content || "").split(/\r?\n/);
  const output = [];
  for (const entry of Array.isArray(plan && plan.cancelled) ? plan.cancelled : []) {
    const index = Math.floor(Number(entry && entry.originalLine));
    const lineText = lines[index];
    if (typeof lineText !== "string") continue;
    const before = getObsidianTaskCheckboxStatus(lineText);
    if (![" ", "*", "/", "?"].includes(before)) continue;
    output.push({ path, line: index + 1, lineText, before, after: "-" });
  }
  return output;
}

function mailCloseTargetsFromCloseIdentities(cancelled, completed, sourceWrites) {
  const output = [];
  for (const [rows, after] of [[cancelled, "-"], [completed, "x"]]) {
    for (const identity of Array.isArray(rows) ? rows : []) {
      const path = mailCloseNormalizePath(identity && identity.path);
      const write = sourceWrites instanceof Map ? sourceWrites.get(path) : null;
      if (!path || !write || typeof write.original !== "string") continue;
      const lines = write.original.split(/\r?\n/);
      let index = Number.isInteger(identity.line) ? identity.line : -1;
      if (index < 0 || index >= lines.length) {
        const blockId = normalizeBulletPropertyValue(identity.blockId || "");
        if (blockId) index = findTaskLineByTrailingBlockId(lines, blockId);
      }
      if (!Number.isInteger(index) || index < 0 || index >= lines.length) continue;
      const lineText = String(lines[index] || "");
      const before = getObsidianTaskCheckboxStatus(lineText);
      if (![" ", "*", "/", "?"].includes(before)) continue;
      output.push({ path, line: index + 1, lineText, before, after });
    }
  }
  return output;
}

async function mailCloseTargetsDefinitelyHaveNoMailLinks(app, targets) {
  const vault = app && app.vault;
  const canReadVault = vault &&
    (typeof vault.cachedRead === "function" || typeof vault.read === "function") &&
    (typeof vault.getAbstractFileByPath === "function" || typeof vault.getMarkdownFiles === "function");
  // Headless callers and unit harnesses without a readable vault cannot hold
  // Gmail Task notes. A real Obsidian vault must be inspected before allowing
  // a close while the v1 API is unavailable.
  if (!canReadVault) return true;
  for (const source of Array.isArray(targets) ? targets : []) {
    const path = mailCloseNormalizePath(source && source.path);
    const line = Math.floor(Number(source && source.line));
    const file = path && mailCloseVaultFile(app, path);
    if (!file || !Number.isInteger(line) || line < 1) return false;
    let content;
    try {
      content = typeof vault.cachedRead === "function"
        ? String((await vault.cachedRead(file)) || "")
        : String((await vault.read(file)) || "");
    } catch (_error) { return false; }
    const lines = content.split(/\r?\n/);
    const liveLine = lines[line - 1];
    if (typeof liveLine !== "string" || (typeof source.lineText === "string" && source.lineText !== liveLine)) return false;
    const contexts = getMarkdownLineContexts(content);
    if (!isObsidianTaskAtLine(content, line - 1, contexts, lines)) return false;
    const links = new Set(mailCloseLineLinks(liveLine));
    for (const child of mailCloseChildrenAt(lines, line - 1, contexts)) {
      const link = mailCloseLinkOnlyBullet(child);
      if (link) links.add(link);
    }
    // Any linked note could be the mail record. Keep the close blocked until
    // the API can classify those links and present the confirmation card.
    if (links.size > 0) return false;
  }
  return true;
}

async function confirmMailCloseForPlugin(plugin, targets, options = {}) {
  const walk = plugin && plugin.reviewLanding
    ? { seq: plugin.reviewGestureSeq, epoch: plugin.reviewLandingEpoch }
    : null;
  const releaseKeptWalk = () => {
    if (!walk || !plugin || typeof plugin.settleReviewWalkLock !== "function") return;
    if (plugin.reviewGestureSeq !== walk.seq || plugin.reviewLandingEpoch !== walk.epoch) return;
    try { plugin.settleReviewWalkLock(false); } catch (_error) {}
  };
  const api = plugin && plugin.api && plugin.api.mailCloseGuard;
  if (!api || Number(api.version) < 1 || typeof api.confirm !== "function") {
    // The owner plugin should always expose v1 in Obsidian. Keep vault-backed
    // closes fail-closed if that contract is broken; test and headless callers
    // with no vault cannot contain a Gmail Task to guard.
    if (await mailCloseTargetsDefinitelyHaveNoMailLinks(plugin && plugin.app, targets)) {
      return { confirmed: true, guarded: false, token: null };
    }
    releaseKeptWalk();
    return { confirmed: false, guarded: true, token: null };
  }
  try {
    const result = await api.confirm(targets, options);
    if (!result || result.confirmed !== true) releaseKeptWalk();
    return result;
  } catch (_error) {
    releaseKeptWalk();
    return { confirmed: false, guarded: true, token: null };
  }
}

async function confirmMailCloseForApp(app, targets, options = {}) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins || {};
    return await confirmMailCloseForPlugin(plugins["bob-navigation-hotkeys"], targets, options);
  } catch (_error) { return { confirmed: false, guarded: true, token: null }; }
}

function createMailCloseGuardApi(plugin) {
  const classify = async (targets) => {
    try {
      const rows = await mailCloseClassifyTargets(plugin && plugin.app, targets);
      return rows.map((row) => Object.freeze({
        path: row.path,
        line: row.line,
        before: row.before,
        after: row.after,
        line_text: row.line_text,
        task_text: row.task_text,
        mails: Object.freeze(row.mails.map((mail) => Object.freeze({
          note: mail.note,
          title: mail.title,
          who: mail.who,
          turn: mail.turn,
          turn_since: mail.turn_since,
          gmail_url: mail.gmail_url,
        }))),
      }));
    }
    catch (_error) { return []; }
  };
  return Object.freeze({
    version: 1,
    classify,
    async confirm(targets, options = {}) {
      try {
        const app = plugin && plugin.app;
        const guarded = await mailCloseClassifyTargets(app, targets);
        if (guarded.length === 0) return { confirmed: true, guarded: false, token: null };
        const other = await mailCloseOtherOpenLinkers(app, guarded);
        const copyTargets = guarded.map((target) => ({ ...target, mails: target.mails.map((mail) => ({ ...mail })) }));
        const model = buildMailCloseCopy(copyTargets, { now: new Date().toISOString(), other_open_linkers: other, archive: mailCloseArchiveOn(app) });
        for (const row of model.rows) {
          const target = guarded.find((entry) => entry.path === row.path && entry.line === row.line);
          const mail = target && mailCloseChosenMail(target.mails);
          if (mail) {
            row.gmail_url = mail.gmail_url;
            row.mail_title = String(mail.title || "").trim() || row.label;
          }
        }
        const token = model.digest;
        const passed = options && options.context && options.context.mailCloseConfirmed;
        if (typeof passed === "string" && passed === token) return { confirmed: true, guarded: true, token };
        return await new Promise((resolve) => {
          let modal;
          const finish = (confirmed) => {
            resolve({ confirmed, guarded: true, token: confirmed ? token : null });
          };
          try {
            modal = new MailCloseCardModal(app, {
              model,
              onConfirm: () => finish(true),
              onKeep: () => {
                const label = model.rows && model.rows[0] && (model.rows[0].mail_title || model.rows[0].label) || "email task";
                new Notice(`✉ Kept open · ${label}`, 4000);
                finish(false);
              },
              openingKeys: options.openingKeys,
            });
            modal.open();
          } catch (_error) { finish(false); }
        });
      } catch (_error) { return { confirmed: false, guarded: true, token: null }; }
    },
  });
}
