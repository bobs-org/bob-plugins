// Test-facing exports for the calendar and record nav-groups providers.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      NAV_GROUPS_WEEK_NOTE_RE,
      NAV_GROUPS_ALL_TIME_PATH,
      NAV_GROUPS_NONE_YEAR,
      NAV_GROUPS_NONE_ALL,
      NAV_GROUPS_API_VERSION,
      navGroupsRecordResolve,
      navGroupsRecordStop,
      navGroupsNormalizePath,
      navGroupsTarget,
      navGroupsWeekNoteIsoYear,
      navGroupsPathYear,
      navGroupsPathInBounds,
      navGroupsAdoptedIsoYearsFromFiles,
      navGroupsIsPreAdoption,
      navGroupsDayLandingLabel,
      navGroupsCalendarResolve,
      navGroupsRequestError,
      navGroupsPathIsPreAdoptionWith,
      navGroupsPreAdoptionMessageForPath,
      BobLedgerToolsNavGroupsMixin,
    });
  }
} catch (_) {}
