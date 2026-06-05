import { getResidentsForCollector, getUser } from "./storage.js";

/** Resident IDs linked to this collector (their WhatsApp-group customers) */
export function residentIdsForCollector(state, collectorId) {
  return new Set(getResidentsForCollector(state, collectorId).map((r) => r.id));
}

export function pickupsForCollector(state, collectorId, filterFn) {
  const ids = residentIdsForCollector(state, collectorId);
  return state.pickups.filter((p) => ids.has(p.residentId) && (!filterFn || filterFn(p)));
}

export function getAssignedCollector(state, resident) {
  if (!resident?.collectorId) return null;
  return getUser(state, resident.collectorId);
}

export function joinLink(collector) {
  if (!collector?.joinCode) return "";
  const base = `${location.origin}${location.pathname}`;
  return `${base}?join=${collector.joinCode}`;
}

export function joinCodeFromUrl() {
  return new URLSearchParams(location.search).get("join")?.trim() || "";
}
