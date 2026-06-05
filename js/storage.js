import { SUPABASE_CONFIG } from "./supabase-config.js";

const KEY = "binroute_gh_v3";
const SESSION_KEY = "binroute_gh_session";
const API_STATE_URL = "/api/state";

const defaultState = () => ({
  users: [],
  pickups: [],
  sessionUserId: null,
});

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      for (const oldKey of ["binroute_gh_v2", "binroute_gh_v1"]) {
        const legacy = localStorage.getItem(oldKey);
        if (legacy) {
          const parsed = { ...defaultState(), ...JSON.parse(legacy), sessionUserId: loadSessionUserId() };
          const migrated = migrateState(parsed);
          saveState(migrated);
          return migrated;
        }
      }
      return { ...defaultState(), sessionUserId: loadSessionUserId() };
    }
    return migrateState({ ...defaultState(), ...JSON.parse(raw), sessionUserId: loadSessionUserId() });
  } catch {
    return { ...defaultState(), sessionUserId: loadSessionUserId() };
  }
}

export function saveState(state) {
  saveSessionUserId(state.sessionUserId);
  localStorage.setItem(KEY, JSON.stringify(publicState(state)));
}

export function loadSessionUserId() {
  return localStorage.getItem(SESSION_KEY) || null;
}

export function saveSessionUserId(userId) {
  if (userId) localStorage.setItem(SESSION_KEY, userId);
  else localStorage.removeItem(SESSION_KEY);
}

export function publicState(state) {
  return {
    users: Array.isArray(state.users) ? state.users : [],
    pickups: Array.isArray(state.pickups) ? state.pickups : [],
  };
}

export async function loadRemoteState() {
  if (hasSupabaseConfig()) return loadSupabaseState();
  const res = await fetch(API_STATE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load server data");
  return migrateState({ ...defaultState(), ...(await res.json()), sessionUserId: loadSessionUserId() });
}

export async function saveRemoteState(state) {
  if (hasSupabaseConfig()) return saveSupabaseState(state);
  const res = await fetch(API_STATE_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(publicState(state)),
  });
  if (!res.ok) throw new Error("Could not save server data");
  return migrateState({ ...defaultState(), ...(await res.json()), sessionUserId: loadSessionUserId() });
}

function hasSupabaseConfig() {
  return Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_CONFIG.anonKey,
    Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
    "Content-Type": "application/json",
  };
}

async function loadSupabaseState() {
  const url = `${SUPABASE_CONFIG.url}/rest/v1/${SUPABASE_CONFIG.stateTable}?id=eq.${encodeURIComponent(SUPABASE_CONFIG.stateId)}&select=state`;
  const res = await fetch(url, { headers: supabaseHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("Could not load Supabase data");
  const rows = await res.json();
  if (rows[0]?.state) {
    return migrateState({ ...defaultState(), ...rows[0].state, sessionUserId: loadSessionUserId() });
  }
  return saveSupabaseState(seedDemoIfEmpty(defaultState()));
}

async function saveSupabaseState(state) {
  const clean = publicState(state);
  const url = `${SUPABASE_CONFIG.url}/rest/v1/${SUPABASE_CONFIG.stateTable}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      id: SUPABASE_CONFIG.stateId,
      state: clean,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error("Could not save Supabase data");
  const rows = await res.json();
  return migrateState({ ...defaultState(), ...(rows[0]?.state || clean), sessionUserId: loadSessionUserId() });
}

export function mergeRemoteState(current, remote) {
  return migrateState({
    ...defaultState(),
    ...publicState(remote),
    sessionUserId: current.sessionUserId,
  });
}

export function uid() {
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getUser(state, id) {
  return state.users.find((u) => u.id === id);
}

export function getCollectors(state) {
  return state.users.filter((u) => u.role === "collector");
}

export function findCollectorByJoinCode(state, code) {
  const normalized = String(code || "").trim().toUpperCase().replace(/\s/g, "");
  if (!normalized) return null;
  return getCollectors(state).find((c) => c.joinCode === normalized) || null;
}

export function getResidentsForCollector(state, collectorId) {
  return state.users.filter((u) => u.role === "resident" && u.collectorId === collectorId);
}

export function generateJoinCode(state) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (getCollectors(state).some((c) => c.joinCode === code));
  return code;
}

export function migrateState(state) {
  state.users.forEach((u) => {
    if (u.role === "collector") {
      if (!u.joinCode) u.joinCode = generateJoinCode(state);
      if (!u.serviceArea) u.serviceArea = u.address || "My area";
      if (!u.momoNumber) u.momoNumber = u.phone || "";
      if (!u.momoNetwork) u.momoNetwork = "MTN MoMo";
    }
    if (u.role === "resident" && !u.collectorId) {
      const only = getCollectors(state)[0];
      if (only) u.collectorId = only.id;
    }
  });
  return state;
}

export function seedDemoIfEmpty(state) {
  if (state.users.length > 0) return migrateState(state);
  const collectorId = uid();
  const res1Id = uid();
  const res2Id = uid();
  const joinCode = "KWAME1";
  state.users = [
    {
      id: collectorId,
      role: "collector",
      name: "Kwame (Tricycle)",
      phone: "0241234567",
      address: "Osu, Accra",
      serviceArea: "Osu · Labone · Airport Residential",
      joinCode,
      momoNumber: "0241234567",
      momoNetwork: "MTN MoMo",
      lat: 5.557,
      lng: -0.182,
    },
    {
      id: uid(),
      role: "admin",
      name: "BinRoute Operator",
      phone: "0500000000",
    },
    {
      id: res1Id,
      role: "resident",
      name: "Ama Mensah",
      phone: "0559876543",
      address: "Labone, near Osu",
      collectorId,
      lat: 5.565,
      lng: -0.175,
    },
    {
      id: res2Id,
      role: "resident",
      name: "Kofi Asante",
      phone: "0201122334",
      address: "Airport Residential",
      collectorId,
      lat: 5.572,
      lng: -0.180,
    },
  ];
  state.pickups = [
    {
      id: uid(),
      residentId: res1Id,
      collectorId,
      status: "requested",
      createdAt: new Date().toISOString(),
      note: "Kitchen bin is overflowing",
    },
    {
      id: uid(),
      residentId: res2Id,
      collectorId,
      status: "priced",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      note: "",
      priceGhs: 8,
      pricedAt: new Date().toISOString(),
    },
  ];
  return state;
}
