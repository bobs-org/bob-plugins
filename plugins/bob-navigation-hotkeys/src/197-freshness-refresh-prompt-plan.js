function planFreshnessRefreshPrompt({
  singleKeep = false,
  rottenTargets = [],
  workTargets = [],
  laneTargets = [],
} = {}) {
  const counted = (Array.isArray(rottenTargets) ? rottenTargets : [])
    .map((target) => ({ ...target, kind: "counted" }));
  const lanes = (Array.isArray(laneTargets) ? laneTargets : [])
    .map((target) => ({ ...target, kind: "lane" }));
  const keepTargets = [...counted, ...lanes];
  const showWorkField = Array.isArray(workTargets) && workTargets.length > 0;
  let kind = "none";
  if (singleKeep && keepTargets.length === 1 && !showWorkField) {
    kind = keepTargets[0].kind === "lane" ? "single-lane" : "single-rotten";
  } else if (keepTargets.length > 0) {
    kind = "batch";
  } else if (showWorkField) {
    kind = "work-only";
  }
  return Object.freeze({ kind, showWorkField, keepTargets: Object.freeze(keepTargets) });
}
