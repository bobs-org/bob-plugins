function planFreshnessRefreshPrompt({
  singleKeep = false,
  rottenTargets = [],
  laneTargets = [],
} = {}) {
  const counted = (Array.isArray(rottenTargets) ? rottenTargets : [])
    .map((target) => ({ ...target, kind: "counted" }));
  const lanes = (Array.isArray(laneTargets) ? laneTargets : [])
    .map((target) => ({ ...target, kind: "lane" }));
  const keepTargets = [...counted, ...lanes];
  const showWorkField = false;
  let kind = "none";
  if (singleKeep && keepTargets.length === 1) {
    kind = keepTargets[0].kind === "lane" ? "single-lane" : "single-rotten";
  } else if (keepTargets.length > 0) {
    kind = "batch";
  }
  return Object.freeze({ kind, showWorkField, keepTargets: Object.freeze(keepTargets) });
}
