// Record title recognizer: a legacy H1 equal to the card title, and a
// classified first-body (or immediately following) walk line. requireHeading
// is false so a walk line may start the owned range. Never classifies a
// bare line; walk must already be current or stale from the whole source.
function recordSheetTitleWalkLineMatches(line, walk) {
  if (!walk || typeof recordWalkParseLinkRun !== "function" || typeof recordWalkIsWalkLine !== "function") {
    return false;
  }
  const albumStem = String(walk.album?.stem || recordSheetStemOf(walk.albumPath) || "");
  const links = recordWalkParseLinkRun(line, albumStem);
  if (!recordWalkIsWalkLine(links)) return false;
  const written = Array.isArray(walk.writtenLinks) ? walk.writtenLinks : [];
  if (!written.length || links.length !== written.length) return false;
  const normalize = (value) => String(value || "").replace(/\.md$/i, "");
  const label = (value) => (typeof recordWalkDisplayLabel === "function"
    ? recordWalkDisplayLabel(value) : String(value || ""));
  return links.every((link, index) => normalize(link.target) === normalize(written[index].target)
    && label(link.label) === label(written[index].label));
}

function recordSheetTitleRecognizer({ path, title, walk, sourceText } = {}) {
  const never = typeof propertyCardNeverTitleRecognizer === "function"
    ? propertyCardNeverTitleRecognizer("record")
    : Object.freeze({
      key: "never:record",
      requireHeading: true,
      heading: () => false,
      follower: () => false,
    });
  const want = typeof propertyCardCleanInlineText === "function"
    ? propertyCardCleanInlineText(title) : String(title || "").trim();
  const hasWalk = typeof recordWalkHasRail === "function" && recordWalkHasRail(walk);
  if (!want && !hasWalk) return never;
  let walkLine = "";
  if (hasWalk && typeof sourceText === "string" && Number.isInteger(walk.lineIndex)) {
    const lines = sourceText.split(/\r?\n/);
    walkLine = String(lines[walk.lineIndex] || "").trim();
  }
  const key = `record:${recordSheetPath(path)}:${want}:${walk && walk.lineState ? walk.lineState : ""}:${walkLine}`;
  return Object.freeze({
    key,
    requireHeading: false,
    heading: (cleaned) => Boolean(want) && (typeof propertyCardCleanInlineText === "function"
      ? propertyCardCleanInlineText(cleaned) : String(cleaned || "").trim()) === want,
    follower: (trimmedLine) => {
      if (!hasWalk) return false;
      const line = String(trimmedLine || "").trim();
      if (!line) return false;
      if (walkLine && line === walkLine) return true;
      return recordSheetTitleWalkLineMatches(line, walk);
    },
  });
}
