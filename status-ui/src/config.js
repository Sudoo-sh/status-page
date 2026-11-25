// Page settings. One place, plain values.
// STALE_AFTER_MIN: a service whose last recorded update is older than this is shown as
// "Unknown, no recent update" and the headline never says "All systems working". It is a
// page setting, not something Upptime reports. Upptime's schedule is every 5 minutes, but
// the recorded updates in this repository have been hours apart, so the setting is shown
// to visitors in the row details.
export const STALE_AFTER_MIN = 60;
// The existing page (status-page#2) calls a response over this "Slow". Kept as it is.
export const SLOW_MS = 2000;
export const REFRESH_MS = 60 * 1000;
export const DATA_URL = "./data/status.json";
