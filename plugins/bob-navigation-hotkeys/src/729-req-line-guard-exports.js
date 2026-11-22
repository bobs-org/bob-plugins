// Requirement-line guard helpers, exported for unit tests.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      NAV_REQ_LANE_COPY,
      NAV_REQ_CARRIED_COPY,
      navReqInfoAtLine,
      navReqRefuseCopy,
      navReqIsCarried,
    });
  }
} catch (_error) {}
