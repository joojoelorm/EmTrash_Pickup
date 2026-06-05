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
  }

  setTimeout(() => mapInstance.invalidateSize(), 200);
  return { map: mapInstance, marker };
}

export function setMarkerPosition(marker, lat, lng) {
  if (marker) marker.setLatLng([lat, lng]);
  if (mapInstance) mapInstance.setView([lat, lng], mapInstance.getZoom());
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
