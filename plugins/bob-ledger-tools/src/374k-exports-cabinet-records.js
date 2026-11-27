// Test-facing exports for the album Records cabinet (bob-cli-qq records).
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      CABINET_RECORDS_KIND,
      cabinetRecordsHeadTitle,
      cabinetRecordsReportAlbum,
      cabinetRecordsGroupingSuffix,
      cabinetRecordsRegionForSource,
      cabinetRecordsSummaryFor,
      cabinetRecordsAppliesFor,
      cabinetRecordsPaintKeyFor,
      cabinetRecordsFoldsHost,
      cabinetRecordsPaintOptions,
      cabinetRecordsPaintCallout,
      cabinetRecordsClaimBody,
      cabinetRecordsReleaseBody,
      cabinetRecordsReleasePlugin,
      cabinetRecordsReveal,
      cabinetRecordsRevealGroup,
      cabinetRecordsScrollHead,
      cabinetRecordsScrollToGroup,
      cabinetRecordsRegisterProvider,
      cabinetRecordsTeardownPlugin,
      albumRecordsCabinetStandDown,
    });
  }
} catch (_) {}
