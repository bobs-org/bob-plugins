// Record-index presentation: group folds and date chips. Bob owns the
// stored `[!records]` bytes; this fragment never writes notes or parses YAML.
const ALBUM_RECORDS_FOLD_AFTER = 12;
const ALBUM_RECORDS_DATE_RE = /^(\d{4}-\d{2}-\d{2})/;

function albumRecordsNormalizeLabel(label) {
  return String(label || "").replace(/\s+/g, " ").trim();
}

function albumRecordsSourceAlbum(state, sourcePath) {
  return state?.report?.albumsByPath?.get(albumReportPath(sourcePath)) || null;
}

function albumRecordsShouldPaint(state, sourcePath) {
  if (!state || !state.report) return true;
  return Boolean(albumRecordsSourceAlbum(state, sourcePath));
}

function albumRecordsDefaultFolded(index, count) {
  return index > 0 && Number(count) > ALBUM_RECORDS_FOLD_AFTER;
}

function albumRecordsFoldKey(albumPath, identity) {
  return `${albumReportPath(albumPath)}\0${identity}`;
}

function albumRecordsIsFolded(folds, albumPath, identity, index, count) {
  const key = albumRecordsFoldKey(albumPath, identity);
  if (folds instanceof Map && folds.has(key)) return Boolean(folds.get(key));
  return albumRecordsDefaultFolded(index, count);
}

function albumRecordsGroupIdentity(album, label, index) {
  const wanted = albumRecordsNormalizeLabel(label);
  const groups = album && Array.isArray(album.groups) ? album.groups : [];
  const matches = groups.filter((group) => albumRecordsNormalizeLabel(group.label) === wanted);
  if (matches.length === 1 && matches[0].value) return String(matches[0].value);
  return wanted || String(index);
}

function albumRecordsChromeNode(node) {
  return notebookDomHasClass(node, "bob-records-fold")
    || notebookDomHasClass(node, "bob-records-ages")
    || notebookDomHasClass(node, "bob-records-age");
}

function albumRecordsHeadingText(li) {
  let text = "";
  const walk = (node) => {
    if (!node || albumRecordsChromeNode(node)) return;
    if (node.nodeType === 3) {
      text += typeof node.nodeValue === "string" ? node.nodeValue : String(node.textContent || "");
      return;
    }
    const tag = notebookDomTag(node);
    if (tag === "UL" || tag === "OL") return;
    for (const child of node.childNodes || []) walk(child);
  };
  for (const child of notebookLiOwnNodes(li)) walk(child);
  return text;
}

function albumRecordsParseGroupHeading(li) {
  if (!li || notebookLiOwnLink(li)) return null;
  const text = albumRecordsNormalizeLabel(albumRecordsHeadingText(li));
  const match = /^(.*)\s+·\s+(\d+)$/.exec(text);
  if (!match) return null;
  const label = albumRecordsNormalizeLabel(match[1]);
  const count = Number(match[2]);
  if (!label || !Number.isInteger(count) || count < 0) return null;
  return { label, count };
}

function albumRecordsCalendarDate(value) {
  if (typeof value !== "string") return "";
  const match = ALBUM_RECORDS_DATE_RE.exec(value.trim());
  return match ? notebookCalendarDate(match[1]) : "";
}

function albumRecordsAgeChips(frontmatter, today) {
  const data = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
  const chips = [];
  const visited = albumRecordsCalendarDate(data.visited);
  const watched = albumRecordsCalendarDate(data.watched_on);
  const visitedAge = visited ? notebookAgeChip(visited, today) : null;
  const watchedAge = watched ? notebookAgeChip(watched, today) : null;
  if (visitedAge) {
    chips.push({ kind: "visited", age: visitedAge, date: visited, title: `Visited: ${visited}` });
  }
  if (watchedAge) {
    chips.push({ kind: "watched", age: watchedAge, date: watched, title: `Watched: ${watched}` });
  }
  return chips;
}

function albumRecordFile(target, sourcePath, metadataCache, vault) {
  const name = notebookWikilinkTarget(target);
  if (!name) return null;
  let file = null;
  try { file = metadataCache?.getFirstLinkpathDest?.(name, sourcePath); } catch (_) {}
  if (!file) {
    try {
      const path = /\.md$/i.test(name) ? name : `${name}.md`;
      file = vault?.getAbstractFileByPath?.(path);
    } catch (_) {}
  }
  return file || null;
}

function albumRecordCachedFrontmatter(file, metadataCache) {
  try {
    const cache = metadataCache?.getFileCache?.(file);
    return cache && cache.frontmatter && typeof cache.frontmatter === "object" ? cache.frontmatter : {};
  } catch (_) {
    return {};
  }
}
