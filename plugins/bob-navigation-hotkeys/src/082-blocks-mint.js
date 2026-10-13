// BLOCKS dependent-id minting, ported from task-status-cycler's
// `mintBlockId` and pinned by docs/task-dependencies.md §11.7 (SB1–SB9).
const BLOCKS_ID_STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "into",
  "is", "it", "its", "my", "of", "on", "or", "our", "so", "that", "the",
  "their", "this", "to", "via", "with", "your",
]);
const BLOCKS_ID_LEADING_VERBS = new Set([
  "add", "build", "check", "clean", "create", "delete", "document", "enable",
  "ensure", "finish", "fix", "implement", "improve", "investigate", "make",
  "migrate", "move", "plan", "read", "refactor", "remove", "rename", "research",
  "review", "run", "start", "stop", "support", "test", "try", "update", "use", "write",
]);
const BLOCKS_ID_INLINE_FIELD_RE = /\[[A-Za-z][A-Za-z0-9_-]*::\s*[^\]]*\]/g;

function blocksIdWords(text) {
  const words = [];
  let current = "";
  const flush = () => {
    if (current && !BLOCKS_ID_STOPWORDS.has(current)) words.push(current);
    current = "";
  };
  for (const character of String(text || "")) {
    if (/^[A-Za-z0-9]$/.test(character)) current += character.toLowerCase();
    else flush();
  }
  flush();
  return words;
}

function blocksIdPhraseSpans(body) {
  const text = String(body || "");
  const phrases = [];
  const pattern = /`([^`]+)`|"([^"]+)"|“([^”]+)”|\(([^)]+)\)|\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    let phrase = match.slice(1).find((part) => part !== undefined) || "";
    if (match[5]) {
      const alias = match[5].indexOf("|");
      if (alias !== -1) phrase = match[5].slice(alias + 1);
      else {
        const target = match[5].split("#")[0];
        phrase = target.slice(target.lastIndexOf("/") + 1);
      }
    }
    phrases.push(phrase);
  }
  return phrases;
}

function blocksIdJoin(words) {
  if (!words.length) return null;
  const joined = words.join("-");
  if (joined.length <= 32) return joined;
  const cut = joined.slice(0, 32).lastIndexOf("-");
  return cut > 0 ? joined.slice(0, cut) : null;
}

function blocksBodyAfterStatusBox(rawLine) {
  const line = String(rawLine || "");
  const match = line.match(/^[ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+\[[^\]\n]\][ \t]*/);
  if (match) return line.slice(match[0].length);
  const index = line.indexOf("] ");
  return index === -1 ? line : line.slice(index + 2);
}

function suggestDependentBlockIds(description, usedIds) {
  const used = new Set(Array.from(usedIds || []).map((id) => String(id || "")));
  const text = String(description || "");
  const prose = blocksIdWords(text);
  const candidates = [];
  for (const phrase of blocksIdPhraseSpans(text)) {
    const words = blocksIdWords(phrase);
    const joined = blocksIdJoin(words.slice(0, 4));
    if (joined) candidates.push(joined);
    if (joined) break;
  }
  const firstThree = blocksIdJoin(prose.slice(0, 3));
  if (firstThree) candidates.push(firstThree);
  if (prose.length > 1 && BLOCKS_ID_LEADING_VERBS.has(prose[0])) {
    const afterVerb = blocksIdJoin(prose.slice(1, 4));
    if (afterVerb) candidates.push(afterVerb);
  }
  const seen = new Set(candidates);
  for (const candidate of candidates) {
    if (!used.has(candidate)) return candidate;
    for (let suffix = 2; suffix <= 9; suffix += 1) {
      const suffixed = `${candidate}-${suffix}`;
      if (suffixed.length <= 64 && !used.has(suffixed) && !seen.has(suffixed)) {
        seen.add(suffixed);
        return suffixed;
      }
    }
  }
  if (!used.has("task")) return "task";
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `task-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

function blocksDependentDescription(rawLine, globalFilter = "#task") {
  const line = String(rawLine || "");
  const status = line.match(/^[ \t]*(?:>\s*)?(?:[-+*]|\d+[.)])[ \t]+\[[^\]\n]\][ \t]*/);
  let body = status ? line.slice(status[0].length) : blocksBodyAfterStatusBox(line);
  body = body.replace(/\s+\^[A-Za-z0-9-]+\s*$/, " ");
  body = body.replace(BLOCKS_ID_INLINE_FIELD_RE, " ");
  const filter = globalFilter === undefined ? "#task" : globalFilter;
  return body.split(/\s+/).filter((token) => token && (filter === "" || token !== filter)).join(" ");
}

function mintDependentBlockId(rawTaskLine, usedIds, globalFilter = "#task") {
  return suggestDependentBlockIds(blocksDependentDescription(rawTaskLine, globalFilter), usedIds);
}
