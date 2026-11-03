// Decay-card hotfix helpers. Sibling fragment so src/700-exports.js stays
// under the 1000-line cap.
Object.assign(module.exports.helpers, {
  FRESHNESS_DECAY_PRIORITY_LOAD_ERRORS,
  freezeFreshnessDecayPrioritySnapshot,
  loadFreshnessDecayPrioritySnapshot,
  buildFreshnessDecayCardFooter,
  formatFreshnessDecayRottenLogBody,
  appendFreshnessDecayRottenLogEntry,
});
