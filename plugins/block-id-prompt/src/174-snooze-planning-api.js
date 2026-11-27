// Planning-only adapter for navigation snoozes. The caller supplies Bob's
// date and ledger-tools' versioned freshness stamper; no editor or vault write
// is performed here.
function createSnoozePlanningApi(plugin) {
  return Object.freeze({
    version: 1,
    planTargetTaskUpdate(preimageContent, taskLine, options = {}) {
      if (!plugin || !options || typeof options !== "object") return null;
      const now = options.now;
      const freshDateText = options.freshDateText;
      const stampLine = options.stampLine;
      if (
        !(now instanceof Date) && typeof now !== "string" && typeof now !== "number"
      ) return null;
      if (!Number.isFinite(new Date(now).getTime())) return null;
      if (typeof freshDateText !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(freshDateText)) return null;
      if (typeof stampLine !== "function") return null;
      const planning = {
        forceNext: true,
        now: new Date(now),
        freshDateText,
        stampLine,
      };
      const newBlockId = String(options.newBlockId || "");
      if (newBlockId) {
        const lines = String(preimageContent == null ? "" : preimageContent).split("\n");
        const rawLine = lines[taskLine];
        if (typeof rawLine !== "string") return null;
        const named = taskWikilinkNamingPlanForContent(plugin, String(preimageContent || ""), {
          line: taskLine,
          rawLine,
        }, newBlockId, { ...planning, activationEligible: false });
        return named.ok ? named.plan : null;
      }
      return planTargetTaskUpdate(preimageContent, taskLine, planning);
    },
  });
}
