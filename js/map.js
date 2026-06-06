import { CONFIG } from "./config.js";

let mapInstance = null;

export function destroyMap() {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
}

export function initMap(containerId, { lat, lng, draggable = false, onMove }) {
  destroyMap();
  const el = document.getElementById(containerId);
  if (!el || typeof L === "undefined") return null;

  const center = lat != null ? [lat, lng] : [CONFIG.defaultCenter.lat, CONFIG.defaultCenter.lng];
  mapInstance = L.map(containerId).setView(center, CONFIG.defaultCenter.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19,
  }).addTo(mapInstance);

  const marker = L.marker(center, { draggable }).addTo(mapInstance);

  if (draggable && onMove) {
    marker.on("dragend", () => {
      const { lat: la, lng: ln } = marker.getLatLng();
      onMove(la, ln);
    });

    mapInstance.on("click", (e) => {
      marker.setLatLng(e.latlng);
      onMove(e.latlng.lat, e.latlng.lng);
    });
  }

  setTimeout(() => mapInstance.invalidateSize(), 200);
  return { map: mapInstance, marker };
}

export function setMarkerPosition(marker, lat, lng) {
  if (marker) marker.setLatLng([lat, lng]);
  if (mapInstance) mapInstance.setView([lat, lng], mapInstance.getZoom());
}

export async function geocodeAddress(query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Enter a landmark or address");
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "gh");
  url.searchParams.set("q", q);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Location search failed");
  const [match] = await res.json();
  if (!match) throw new Error("No matching location found");
  return {
    lat: Number(match.lat),
    lng: Number(match.lon),
    label: match.display_name,
  };
}

export function initCollectorMap(containerId, pickups, users) {
  destroyMap();
  const el = document.getElementById(containerId);
  if (!el || typeof L === "undefined") return null;

  mapInstance = L.map(containerId).setView(
    [CONFIG.defaultCenter.lat, CONFIG.defaultCenter.lng],
    CONFIG.defaultCenter.zoom
  );

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19,
  }).addTo(mapInstance);

  const bounds = [];
  pickups.forEach((p) => {
    const resident = users.find((u) => u.id === p.residentId);
    if (!resident?.lat) return;
    const color =
      p.status === "requested" ? "#f4b400" : p.status === "collected" ? "#12875a" : "#5c5c5c";
    L.circleMarker([resident.lat, resident.lng], {
      radius: 10,
      fillColor: color,
      color: "#fff",
      weight: 2,
      fillOpacity: 0.9,
    })
      .addTo(mapInstance)
      .bindPopup(`<strong>${resident.name}</strong><br>${resident.address}<br>${p.status}`);
    bounds.push([resident.lat, resident.lng]);
  });

  if (bounds.length) mapInstance.fitBounds(bounds, { padding: [30, 30] });
  setTimeout(() => mapInstance.invalidateSize(), 200);
  return mapInstance;
}

export function openDirections(lat, lng) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function initTrackingMap(containerId, collector, resident, pickup) {
  destroyMap();
  const el = document.getElementById(containerId);
  if (!el || typeof L === "undefined" || !resident?.lat || !resident?.lng) return null;

  const start = [
    Number(collector?.lat ?? CONFIG.defaultCenter.lat),
    Number(collector?.lng ?? CONFIG.defaultCenter.lng),
  ];
  const end = [Number(resident.lat), Number(resident.lng)];
  mapInstance = L.map(containerId).setView(end, CONFIG.defaultCenter.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19,
  }).addTo(mapInstance);

  L.polyline([start, end], { color: "#12875a", weight: 4, opacity: 0.75 }).addTo(mapInstance);
  L.marker(end).addTo(mapInstance).bindPopup("Pickup location");

  const statusProgress = {
    requested: 0,
    accepted: 0.2,
    en_route: 0.55,
    arrived: 1,
    priced: 1,
    payment_pending: 1,
    paid: 1,
  };
  const progress = statusProgress[pickup?.status] ?? 0;
  const rider = [
    start[0] + (end[0] - start[0]) * progress,
    start[1] + (end[1] - start[1]) * progress,
  ];
  L.circleMarker(rider, {
    radius: 10,
    fillColor: "#0d5c3d",
    color: "#fff",
    weight: 2,
    fillOpacity: 0.95,
  }).addTo(mapInstance).bindPopup("Collector position estimate");

  mapInstance.fitBounds([start, end], { padding: [30, 30] });
  setTimeout(() => mapInstance.invalidateSize(), 200);
  return mapInstance;
}

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}
