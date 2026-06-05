import { CONFIG, formatGhs, calcFees } from "./config.js";
import {
  loadState, saveState, loadRemoteState, saveRemoteState, mergeRemoteState,
  uid, getUser, seedDemoIfEmpty,
  findCollectorByJoinCode, getCollectors, getResidentsForCollector, generateJoinCode,
} from "./storage.js";
import { getAssignedCollector, joinLink, joinCodeFromUrl, pickupsForCollector } from "./assign.js";
import {
  destroyMap, initMap, setMarkerPosition, initCollectorMap, openDirections, getCurrentPosition,
} from "./map.js";

let state = seedDemoIfEmpty(loadState());
saveState(state);
let draftLat = CONFIG.defaultCenter.lat;
let draftLng = CONFIG.defaultCenter.lng;
let mapRef = null;
let activeTab = "home";

const STATUS_LABELS = {
  requested:  "Waiting for collector",
  accepted:   "Collector accepted",
  en_route:   "Collector on the way",
  arrived:    "Collector arrived",
  priced:     "Price set — pay now",
  payment_pending: "Payment awaiting collector",
  paid:       "Paid ✓",
  cancelled:  "Cancelled",
};

const MOMO_NETWORKS = ["MTN MoMo", "Telecel Cash", "AirtelTigo Money"];

function persist() {
  saveState(state);
  render();
  saveRemoteState(state)
    .then((remote) => {
      state = mergeRemoteState(state, remote);
      saveState(state);
    })
    .catch(() => showToast("Saved locally — server sync failed"));
}

async function syncFromServer({ notify = false } = {}) {
  try {
    const remote = await loadRemoteState();
    state = mergeRemoteState(state, remote);
    saveState(state);
    if (!isAuthScreenOpen()) render();
    if (notify) showToast("Synced with server");
  } catch {
    if (notify) showToast("Server sync unavailable");
  }
}

function isAuthScreenOpen() {
  return !currentUser() && Boolean(document.querySelector("#resident-form, #collector-form, #login-phone"));
}

function showToast(msg, duration = 2800) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

function currentUser() { return getUser(state, state.sessionUserId); }

function escapeAttr(s) { return String(s || "").replace(/"/g, "&quot;"); }
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ——— ROLE GUARD: ensures each user only ever sees their own role's screens ———
function assertRole(expected) {
  const user = currentUser();
  if (!user) return false;
  return user.role === expected;
}

// ——— Auth ———

function renderAuth() {
  const logoutBtn = document.getElementById("btn-logout");
  const nav = document.getElementById("nav");
  logoutBtn.hidden = true;
  logoutBtn.classList.add("hidden");
  nav.hidden = true;
  nav.classList.add("hidden");
  destroyMap();

  const prefillJoin = joinCodeFromUrl();
  const collectors = getCollectors(state);
  const collectorOptions = collectors
    .map((c) => `<option value="${escapeAttr(c.joinCode)}">${escapeAttr(c.name)} — ${escapeAttr(c.serviceArea || c.address || "Area")}</option>`)
    .join("");

  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="auth-hero">
      <span class="hero-icon">♻️</span>
      <h1>BinRoute Ghana</h1>
      <p class="muted">Your bin is full? One tap and your collector is on the way.</p>
    </div>

    <form id="resident-form" class="card">
      <h2>I need pickup</h2>
      <label for="resident-name">Full name</label>
      <input id="resident-name" required placeholder="e.g. Ama Mensah" />
      <label for="resident-phone">Phone (Ghana)</label>
      <input id="resident-phone" required type="tel" placeholder="024 / 055 / 020" />
      <label for="join-code">Collector code</label>
      <input id="join-code" placeholder="e.g. KWAME1 — ask your collector" value="${escapeAttr(prefillJoin)}" />
        ${collectors.length ? `
          <label for="pick-collector">Or pick your collector</label>
          <select id="pick-collector">
            <option value="">— Select —</option>
            ${collectorOptions}
          </select>` : ""}
      <label for="address">Home / pickup address</label>
      <input id="address" required placeholder="Area, landmark, house number" />
      <p class="muted">Drag the pin to your exact location.</p>
      <div id="map"></div>
      <button type="button" class="btn btn-secondary" id="btn-gps">📍 Use my current location</button>
      <button type="submit" class="btn btn-primary">Join my collector</button>
    </form>

    <form id="collector-form" class="card">
      <h2>I'm a collector</h2>
      <label for="collector-name">Full name</label>
      <input id="collector-name" required placeholder="e.g. Kwame Mensah" />
      <label for="collector-phone">Phone (Ghana)</label>
      <input id="collector-phone" required type="tel" placeholder="024 / 055 / 020" />
      <label for="service-area">Areas you serve</label>
      <input id="service-area" required placeholder="e.g. Osu, Labone, Cantonments" />
      <label for="momo">MoMo number (residents pay you here)</label>
      <input id="momo" type="tel" placeholder="Same as your phone is fine" />
      <label for="momo-network">MoMo network</label>
      <select id="momo-network">
        ${MOMO_NETWORKS.map((n) => `<option>${n}</option>`).join("")}
      </select>
      <label for="collector-address">Base / depot (optional)</label>
      <input id="collector-address" placeholder="Where you usually start" />
      <button type="submit" class="btn btn-primary">Register as collector</button>
    </form>

    <div class="card" style="margin-top:16px">
      <strong>Already registered?</strong>
      <label for="login-phone" style="margin-top:8px">Phone number</label>
      <input id="login-phone" type="tel" placeholder="Same number you used before" />
      <button type="button" class="btn btn-secondary" id="btn-login">Sign in</button>
    </div>
    <p class="muted" style="margin-top:12px;font-size:0.75rem">
      Demo — admin: <code>0500000000</code> · collector: <code>0241234567</code> · resident: <code>0559876543</code>
    </p>
  `;

  mapRef = initMap("map", {
    lat: draftLat, lng: draftLng, draggable: true,
    onMove: (la, ln) => { draftLat = la; draftLng = ln; },
  });

  main.querySelector("#pick-collector")?.addEventListener("change", (e) => {
    if (e.target.value) main.querySelector("#join-code").value = e.target.value;
  });

  main.querySelector("#btn-gps")?.addEventListener("click", async () => {
    try {
      const pos = await getCurrentPosition();
      draftLat = pos.lat; draftLng = pos.lng;
      if (mapRef?.marker) setMarkerPosition(mapRef.marker, draftLat, draftLng);
      showToast("Location updated");
    } catch { showToast("Could not get GPS — drag the pin instead"); }
  });

  main.querySelector("#resident-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = main.querySelector("#resident-name").value.trim();
    const phone = main.querySelector("#resident-phone").value.trim();
    if (!name || !phone) return;

    const existing = state.users.find((u) => u.phone === phone);
    if (existing) {
      state.sessionUserId = existing.id;
      activeTab = "home";
      showToast("Welcome back!");
      persist();
      return;
    }

    const address = main.querySelector("#address").value.trim();
    const code = main.querySelector("#join-code").value.trim();
    const collector = findCollectorByJoinCode(state, code);
    if (!collector) { showToast("Invalid collector code — ask your collector"); return; }
    if (!address) { showToast("Enter your address"); return; }
    state.users.push({
      id: uid(), role: "resident", name, phone, address,
      collectorId: collector.id, lat: draftLat, lng: draftLng,
    });
    showToast(`Joined ${collector.name}'s customers`);

    state.sessionUserId = state.users[state.users.length - 1].id;
    activeTab = "home";
    history.replaceState({}, "", location.pathname);
    persist();
  });

  main.querySelector("#collector-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = main.querySelector("#collector-name").value.trim();
    const phone = main.querySelector("#collector-phone").value.trim();
    const serviceArea = main.querySelector("#service-area").value.trim();
    if (!name || !phone || !serviceArea) return;

    const existing = state.users.find((u) => u.phone === phone);
    if (existing) {
      state.sessionUserId = existing.id;
      activeTab = "home";
      showToast("Welcome back!");
      persist();
      return;
    }

    const momo = main.querySelector("#momo").value.trim() || phone;
    const momoNetwork = main.querySelector("#momo-network").value;
    const base = main.querySelector("#collector-address").value.trim();
    const joinCode = generateJoinCode(state);
    state.users.push({
      id: uid(), role: "collector", name, phone, address: base,
      serviceArea, joinCode, momoNumber: momo, momoNetwork,
      lat: draftLat, lng: draftLng,
    });
    state.sessionUserId = state.users[state.users.length - 1].id;
    activeTab = "home";
    showToast(`Registered — your collector code is ${joinCode}`);
    persist();
  });

  main.querySelector("#btn-login").addEventListener("click", () => {
    const phone = main.querySelector("#login-phone").value.trim();
    const user = state.users.find((u) => u.phone === phone);
    if (!user) { showToast("No account for that number"); return; }
    state.sessionUserId = user.id;
    activeTab = "home";
    persist();
  });
}

// ═══════════════════════════════════════════
// RESIDENT SCREENS
// ═══════════════════════════════════════════

function residentPickups(userId) {
  return state.pickups
    .filter((p) => p.residentId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function activePickup(userId) {
  return residentPickups(userId).find((p) => !["paid", "cancelled"].includes(p.status));
}

function renderResidentHome(user) {
  if (!assertRole("resident")) return "";
  const collector = getAssignedCollector(state, user);
  const active = activePickup(user.id);

  const collectorCard = collector
    ? `<div class="card collector-badge">
        <div class="collector-avatar">${escapeHtml(collector.name[0])}</div>
        <div>
          <p class="muted" style="margin:0 0 2px">Your collector</p>
          <strong>${escapeHtml(collector.name)}</strong>
          <p class="muted">${escapeHtml(collector.serviceArea || "")} · ${escapeHtml(collector.phone)}</p>
        </div>
      </div>`
    : `<div class="card" style="border-color:var(--red)">
        <strong>No collector linked</strong>
        <p class="muted">Go to Location tab and enter a collector code.</p>
      </div>`;

  // Status block — shows current pickup state
  let statusBlock = "";
  if (active) {
    const isPriced = active.status === "priced";
    const fees = isPriced ? calcFees(active.priceGhs) : null;
    const momo = collector?.momoNumber || "";
    const momoNet = collector?.momoNetwork || "MTN MoMo";

    statusBlock = `
      <div class="card status-card status-${active.status}">
        <span class="status-pill status-${active.status}">${STATUS_LABELS[active.status]}</span>
        ${active.note ? `<p class="muted" style="margin:6px 0 0">Note: ${escapeHtml(active.note)}</p>` : ""}
        ${active.status === "accepted" ? `<p class="muted">Your collector accepted the request and will start soon.</p>` : ""}
        ${active.status === "en_route" ? `<p class="muted">Your collector is heading to you.</p>` : ""}
        ${active.status === "arrived" ? `<p class="muted">Collector is at your location — they'll set the price shortly.</p>` : ""}
        ${active.status === "payment_pending" ? `<p class="muted">Payment reference submitted. Your collector will confirm once the MoMo payment is received.</p>` : ""}

        ${isPriced ? `
          <div class="price-reveal">
            <p class="muted">Collector has assessed and set the price:</p>
            <p class="price-big">${formatGhs(active.priceGhs)}</p>
            <p class="fee-note">You pay this to ${escapeHtml(collector?.name || "your collector")}</p>
          </div>
          <div style="margin-top:12px">
            <p>Send <strong>${formatGhs(fees.total)}</strong> to <strong>${escapeHtml(momo)}</strong> (${escapeHtml(momoNet)})</p>
            <p class="fee-note">Platform fee ${CONFIG.platformFeePercent}% (${formatGhs(fees.platformFee)}) · Collector gets ${formatGhs(fees.collectorGets)}</p>
            <label for="momo-ref">MoMo transaction ID</label>
            <input id="momo-ref" placeholder="e.g. 123456789" />
            <button type="button" class="btn btn-gold" id="btn-paid">✅ I've paid — confirm</button>
          </div>` : ""}

        <button type="button" class="btn btn-cancel" id="btn-cancel" style="margin-top:8px">Cancel request</button>
      </div>`;
  }

  const canRequest = collector && !active;

  return `
    <div class="screen-header">
      <h1>Hello, ${escapeHtml(user.name.split(" ")[0])} 👋</h1>
      <p class="muted">${escapeHtml(user.address)}</p>
    </div>
    ${collectorCard}
    ${statusBlock}
    ${canRequest ? `
      <div class="request-block">
        <label for="req-note">Note for collector (optional)</label>
        <input id="req-note" placeholder="e.g. Kitchen + outdoor bins" />
        <button type="button" class="btn btn-primary btn-big" id="btn-full">
          🗑️ My bin is full — alert collector
        </button>
        <p class="muted">Only <strong>${escapeHtml(collector.name)}</strong> sees this alert.</p>
      </div>` : ""}
    <h2 style="margin-top:20px">Recent pickups</h2>
    ${renderPickupHistory(user.id)}
  `;
}

function renderPickupHistory(userId) {
  const list = residentPickups(userId).slice(0, 10);
  if (!list.length) return `<p class="empty-state">No pickups yet. Tap when your bin is full.</p>`;
  return `<ul class="pickup-list">${list.map((p) => `
    <li>
      <span class="status-pill status-${p.status}">${STATUS_LABELS[p.status]}</span>
      <p class="muted">${new Date(p.createdAt).toLocaleString()}</p>
      ${p.priceGhs ? `<p class="muted">Price: <strong>${formatGhs(p.priceGhs)}</strong></p>` : ""}
      ${p.momoRef ? `<p class="muted">Ref: ${escapeHtml(p.momoRef)}</p>` : ""}
    </li>`).join("")}</ul>`;
}

function bindResidentHome(user) {
  const main = document.getElementById("main");
  const collector = getAssignedCollector(state, user);

  main.querySelector("#btn-full")?.addEventListener("click", () => {
    if (!collector) { showToast("Link to a collector first (Location tab)"); return; }
    if (activePickup(user.id)) return;
    const note = main.querySelector("#req-note")?.value.trim() || "";
    state.pickups.push({
      id: uid(), residentId: user.id, collectorId: collector.id,
      status: "requested", createdAt: new Date().toISOString(), note,
    });
    showToast(`${collector.name} has been alerted 🔔`);
    persist();
  });

  main.querySelector("#btn-paid")?.addEventListener("click", () => {
    const active = activePickup(user.id);
    if (!active || active.status !== "priced") return;
    const ref = main.querySelector("#momo-ref")?.value.trim();
    if (!ref) { showToast("Enter your MoMo transaction ID"); return; }
    active.status = "payment_pending";
    active.paymentSubmittedAt = new Date().toISOString();
    active.momoRef = ref;
    active.amountGhs = active.priceGhs;
    showToast("Payment ref sent — waiting for collector confirmation");
    persist();
  });

  main.querySelector("#btn-cancel")?.addEventListener("click", () => {
    const active = activePickup(user.id);
    if (!active) return;
    if (!["requested", "accepted", "en_route"].includes(active.status)) {
      showToast("Can't cancel after collector has arrived"); return;
    }
    active.status = "cancelled";
    active.cancelledAt = new Date().toISOString();
    showToast("Request cancelled");
    persist();
  });
}

function renderResidentProfile(user) {
  if (!assertRole("resident")) return "";
  const collector = getAssignedCollector(state, user);
  return `
    <div class="screen-header">
      <h1>📍 My location</h1>
      ${collector ? `<p class="muted">Linked to <strong>${escapeHtml(collector.name)}</strong> (code <code>${collector.joinCode}</code>)</p>` : ""}
    </div>
    <label>Address</label>
    <input id="prof-address" value="${escapeAttr(user.address)}" />
    <p class="muted">Drag the pin to your exact gate / front door.</p>
    <div id="map"></div>
    <button type="button" class="btn btn-secondary" id="btn-gps">📍 Use GPS</button>
    <button type="button" class="btn btn-primary" id="btn-save-profile">Save location</button>

    <div class="card" style="margin-top:20px">
      <h2>Change collector</h2>
      <p class="muted">Moved area or joined the wrong group? Enter your new collector's code.</p>
      <label for="new-join-code">New collector code</label>
      <input id="new-join-code" placeholder="e.g. KUMASI2" />
      <button type="button" class="btn btn-secondary" id="btn-switch-collector">Switch collector</button>
    </div>
  `;
}

function bindResidentProfile(user) {
  draftLat = user.lat || CONFIG.defaultCenter.lat;
  draftLng = user.lng || CONFIG.defaultCenter.lng;
  mapRef = initMap("map", {
    lat: draftLat, lng: draftLng, draggable: true,
    onMove: (la, ln) => { draftLat = la; draftLng = ln; },
  });
  const main = document.getElementById("main");
  main.querySelector("#btn-gps").addEventListener("click", async () => {
    try {
      const pos = await getCurrentPosition();
      draftLat = pos.lat; draftLng = pos.lng;
      setMarkerPosition(mapRef?.marker, draftLat, draftLng);
      showToast("Location updated");
    } catch { showToast("GPS unavailable — drag the pin"); }
  });
  main.querySelector("#btn-save-profile").addEventListener("click", () => {
    user.address = main.querySelector("#prof-address").value.trim();
    user.lat = draftLat; user.lng = draftLng;
    showToast("Location saved ✓");
    persist();
  });
  main.querySelector("#btn-switch-collector")?.addEventListener("click", () => {
    const code = main.querySelector("#new-join-code").value.trim();
    const collector = findCollectorByJoinCode(state, code);
    if (!collector) { showToast("Invalid code — check with your collector"); return; }
    user.collectorId = collector.id;
    showToast(`Now linked to ${collector.name}`);
    persist();
  });
}

// ═══════════════════════════════════════════
// COLLECTOR SCREENS
// ═══════════════════════════════════════════

function pendingForCollector(collectorId) {
  return pickupsForCollector(state, collectorId,
    (p) => !["paid", "cancelled"].includes(p.status));
}

function renderCollectorHome(user) {
  if (!assertRole("collector")) return "";
  const pending = pendingForCollector(user.id);
  const customers = getResidentsForCollector(state, user.id);
  const today = new Date().toDateString();
  const todayPaid = pickupsForCollector(state, user.id,
    (p) => p.status === "paid" && p.paidAt && new Date(p.paidAt).toDateString() === today);
  const earnings = todayPaid.reduce((s, p) => s + calcFees(p.amountGhs || CONFIG.pickupPriceGhs).collectorGets, 0);

  return `
    <div class="screen-header collector-header">
      <div>
        <h1>${escapeHtml(user.name)}</h1>
        <p class="muted">${escapeHtml(user.serviceArea || "")} · <strong>${customers.length}</strong> households</p>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat-box"><strong>${pending.length}</strong><span>Active</span></div>
      <div class="stat-box"><strong>${todayPaid.length}</strong><span>Done today</span></div>
      <div class="stat-box"><strong>${formatGhs(earnings)}</strong><span>Your share today</span></div>
    </div>

    <h2>Live map — your customers</h2>
    <div id="collector-map"></div>

    <h2>Active pickups (${pending.length})</h2>
    ${pending.length
      ? `<ul class="pickup-list" id="pending-list">${pending.map((p) => renderCollectorPickupRow(p)).join("")}</ul>`
      : `<p class="empty-state">🎉 All clear — no bins waiting right now.</p>`}
  `;
}

function renderCollectorPickupRow(p) {
  const resident = getUser(state, p.residentId);
  if (!resident) return "";
  const isPriced = p.status === "priced";
  const isPaymentPending = p.status === "payment_pending";

  return `
    <li class="pickup-row" data-pickup-id="${p.id}">
      <div class="pickup-row-top">
        <div>
          <strong>${escapeHtml(resident.name)}</strong>
          <p class="muted">${escapeHtml(resident.address)} · ${escapeHtml(resident.phone)}</p>
          ${p.note ? `<p class="muted note-text">📝 ${escapeHtml(p.note)}</p>` : ""}
        </div>
        <span class="status-pill status-${p.status}">${STATUS_LABELS[p.status]}</span>
      </div>

      ${isPriced ? `<p class="price-set-line">Price set: <strong>${formatGhs(p.priceGhs)}</strong> — waiting for resident to pay</p>` : ""}
      ${isPaymentPending ? `<p class="price-set-line">Resident submitted MoMo ref <strong>${escapeHtml(p.momoRef || "—")}</strong> for ${formatGhs(p.amountGhs || p.priceGhs)}.</p>` : ""}

      <div class="pickup-actions">
        <button type="button" class="btn btn-secondary btn-sm btn-nav"
          data-lat="${resident.lat}" data-lng="${resident.lng}">🗺️ Navigate</button>

        ${p.status === "requested"
          ? `<button type="button" class="btn btn-primary btn-sm btn-accept">Accept</button>
             <button type="button" class="btn btn-cancel btn-sm btn-decline">Decline</button>` : ""}
        ${p.status === "accepted"
          ? `<button type="button" class="btn btn-secondary btn-sm btn-enroute">🚛 On my way</button>` : ""}
        ${p.status === "en_route"
          ? `<button type="button" class="btn btn-secondary btn-sm btn-arrived">📍 I've arrived</button>` : ""}
        ${p.status === "arrived"
          ? `<button type="button" class="btn btn-primary btn-sm btn-set-price">💰 Set price</button>` : ""}
        ${p.status === "priced"
          ? `<button type="button" class="btn btn-secondary btn-sm btn-edit-price">✏️ Edit price</button>` : ""}
        ${p.status === "payment_pending"
          ? `<button type="button" class="btn btn-primary btn-sm btn-confirm-payment">✅ Confirm received</button>` : ""}
      </div>

      ${(p.status === "arrived" || p.status === "priced")
        ? `<div class="price-form hidden" id="price-form-${p.id}">
            <label>Pickup price (GH₵)</label>
            <input type="number" min="1" step="0.5" class="price-input" placeholder="e.g. 8" value="${p.priceGhs || ""}" />
            <button type="button" class="btn btn-primary btn-sm btn-confirm-price">Confirm price</button>
          </div>` : ""}
    </li>`;
}

function bindCollectorHome(user) {
  const pending = pendingForCollector(user.id);
  const residents = getResidentsForCollector(state, user.id);
  initCollectorMap("collector-map", pending, [...residents, user]);

  const main = document.getElementById("main");

  main.querySelectorAll(".btn-nav").forEach((btn) => {
    btn.addEventListener("click", () => {
      openDirections(parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lng));
    });
  });

  main.querySelectorAll(".btn-accept").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = state.pickups.find((x) => x.id === btn.closest("li").dataset.pickupId);
      if (p) {
        p.status = "accepted";
        p.acceptedAt = new Date().toISOString();
        showToast("Request accepted");
        persist();
      }
    });
  });

  main.querySelectorAll(".btn-decline").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = state.pickups.find((x) => x.id === btn.closest("li").dataset.pickupId);
      if (p) {
        p.status = "cancelled";
        p.cancelledAt = new Date().toISOString();
        p.cancelledBy = user.id;
        showToast("Request declined");
        persist();
      }
    });
  });

  main.querySelectorAll(".btn-enroute").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = state.pickups.find((x) => x.id === btn.closest("li").dataset.pickupId);
      if (p) { p.status = "en_route"; showToast("Resident sees you're on the way 🚛"); persist(); }
    });
  });

  main.querySelectorAll(".btn-arrived").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = state.pickups.find((x) => x.id === btn.closest("li").dataset.pickupId);
      if (p) { p.status = "arrived"; showToast("Arrival confirmed — set the price after inspection"); persist(); }
    });
  });

  // Show price form
  main.querySelectorAll(".btn-set-price, .btn-edit-price").forEach((btn) => {
    btn.addEventListener("click", () => {
      const li = btn.closest("li");
      const form = li.querySelector(".price-form");
      if (form) {
        form.classList.toggle("hidden");
        form.querySelector(".price-input")?.focus();
      }
    });
  });

  // Confirm price — this is the key new flow
  main.querySelectorAll(".btn-confirm-price").forEach((btn) => {
    btn.addEventListener("click", () => {
      const li = btn.closest("li");
      const pickupId = li.dataset.pickupId;
      const p = state.pickups.find((x) => x.id === pickupId);
      const input = li.querySelector(".price-input");
      const price = parseFloat(input?.value);
      if (!p) return;
      if (!price || price <= 0) { showToast("Enter a valid price"); return; }
      p.status = "priced";
      p.priceGhs = price;
      p.pricedAt = new Date().toISOString();
      showToast(`Price set to ${formatGhs(price)} — resident will be prompted to pay`);
      persist();
    });
  });

  main.querySelectorAll(".btn-confirm-payment").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pickupId = btn.closest("li").dataset.pickupId;
      const p = state.pickups.find((x) => x.id === pickupId);
      if (!p || p.status !== "payment_pending") return;
      p.status = "paid";
      p.paidAt = new Date().toISOString();
      p.confirmedByCollectorAt = new Date().toISOString();
      p.amountGhs = p.amountGhs || p.priceGhs;
      showToast("Payment confirmed — pickup completed");
      persist();
    });
  });
}

function renderCollectorGroup(user) {
  if (!assertRole("collector")) return "";
  const customers = getResidentsForCollector(state, user.id);
  const link = joinLink(user);
  return `
    <div class="screen-header">
      <h1>👥 My group</h1>
      <p class="muted">Share your code so people join your group (like your WhatsApp group — but on the app).</p>
    </div>
    <div class="card highlight code-card">
      <p class="muted">Your collector code</p>
      <p class="join-code-big">${user.joinCode}</p>
      <p class="muted">${escapeHtml(user.serviceArea || "")}</p>
    </div>
    <div class="card">
      <p class="muted">WhatsApp invite link</p>
      <input id="invite-link" readonly value="${escapeAttr(link)}" />
      <div style="display:flex;gap:8px;margin-top:4px">
        <button type="button" class="btn btn-primary" id="btn-copy-link">📋 Copy link</button>
        <button type="button" class="btn btn-secondary" id="btn-copy-code">Copy code</button>
      </div>
    </div>
    <p class="muted">When someone opens your link, the code fills in automatically during sign-up.</p>
    <h2>Your households (${customers.length})</h2>
    ${customers.length
      ? `<ul class="pickup-list">${customers.map((r) => `
          <li class="household-row">
            <div class="collector-avatar sm">${escapeHtml(r.name[0])}</div>
            <div>
              <strong>${escapeHtml(r.name)}</strong>
              <p class="muted">${escapeHtml(r.address)} · ${escapeHtml(r.phone)}</p>
            </div>
          </li>`).join("")}</ul>`
      : `<p class="empty-state">No customers yet — share your code in WhatsApp.</p>`}
  `;
}

function bindCollectorGroup(user) {
  const main = document.getElementById("main");
  main.querySelector("#btn-copy-link")?.addEventListener("click", async () => {
    const val = main.querySelector("#invite-link").value;
    try { await navigator.clipboard.writeText(val); showToast("Link copied — paste in WhatsApp ✓"); }
    catch { showToast(val); }
  });
  main.querySelector("#btn-copy-code")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(user.joinCode); showToast(`Code ${user.joinCode} copied ✓`); }
    catch { showToast(user.joinCode); }
  });
}

function renderCollectorEarnings(user) {
  if (!assertRole("collector")) return "";
  const paid = pickupsForCollector(state, user.id, (p) => p.status === "paid");
  const allPickups = pickupsForCollector(state, user.id);
  const total = paid.reduce((s, p) => s + calcFees(p.amountGhs || CONFIG.pickupPriceGhs).collectorGets, 0);
  const platform = paid.reduce((s, p) => s + calcFees(p.amountGhs || CONFIG.pickupPriceGhs).platformFee, 0);
  const pending = allPickups.filter((p) => !["paid", "cancelled"].includes(p.status)).length;

  // Group by week for a simple chart
  const byDay = {};
  paid.forEach((p) => {
    const d = new Date(p.paidAt).toLocaleDateString();
    byDay[d] = (byDay[d] || 0) + calcFees(p.amountGhs || CONFIG.pickupPriceGhs).collectorGets;
  });

  return `
    <div class="screen-header">
      <h1>💰 Earnings</h1>
    </div>
    <div class="stats-row">
      <div class="stat-box"><strong>${paid.length}</strong><span>Paid pickups</span></div>
      <div class="stat-box"><strong>${pending}</strong><span>In progress</span></div>
      <div class="stat-box"><strong>${formatGhs(total)}</strong><span>Your total</span></div>
    </div>
    <div class="card">
      <p class="muted">Total after ${CONFIG.platformFeePercent}% platform fee</p>
      <p class="money" style="font-size:1.8rem">${formatGhs(total)}</p>
      <p class="fee-note">BinRoute platform share: ${formatGhs(platform)}</p>
    </div>

    <h2>Paid pickups</h2>
    ${paid.length ? `
      <ul class="pickup-list">
        ${paid.slice().reverse().slice(0, 20).map((p) => {
          const r = getUser(state, p.residentId);
          const f = calcFees(p.amountGhs || CONFIG.pickupPriceGhs);
          return `<li>
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <strong>${escapeHtml(r?.name || "—")}</strong>
                <p class="muted">${p.paidAt ? new Date(p.paidAt).toLocaleString() : ""}</p>
                <p class="muted">Ref: ${escapeHtml(p.momoRef || "—")}</p>
              </div>
              <div style="text-align:right">
                <p class="money">${formatGhs(f.collectorGets)}</p>
                <p class="fee-note">of ${formatGhs(f.total)}</p>
              </div>
            </div>
          </li>`;
        }).join("")}
      </ul>` : `<p class="empty-state">No paid pickups yet.</p>`}
  `;
}

function renderCollectorSettings(user) {
  if (!assertRole("collector")) return "";
  return `
    <div class="screen-header">
      <h1>⚙️ Settings</h1>
    </div>
    <div class="card">
      <h2>Your profile</h2>
      <label>Display name</label>
      <input id="set-name" value="${escapeAttr(user.name)}" />
      <label>Phone</label>
      <input id="set-phone" type="tel" value="${escapeAttr(user.phone)}" />
      <label>Areas you serve</label>
      <input id="set-area" value="${escapeAttr(user.serviceArea || "")}" />
    </div>
    <div class="card">
      <h2>Mobile Money</h2>
      <p class="muted">Residents pay this number after you set the price.</p>
      <label>MoMo number</label>
      <input id="set-momo" type="tel" value="${escapeAttr(user.momoNumber || user.phone)}" />
      <label>Network</label>
      <select id="set-momo-network">
        ${MOMO_NETWORKS.map((n) => `<option ${n === user.momoNetwork ? "selected" : ""}>${n}</option>`).join("")}
      </select>
    </div>
    <button type="button" class="btn btn-primary" id="btn-save-settings">Save changes</button>
    <div class="card" style="margin-top:16px;border-color:var(--red)">
      <h2 style="color:var(--red)">Danger zone</h2>
      <button type="button" class="btn btn-cancel" id="btn-logout-settings">Sign out</button>
    </div>
  `;
}

function bindCollectorSettings(user) {
  const main = document.getElementById("main");
  main.querySelector("#btn-save-settings")?.addEventListener("click", () => {
    user.name = main.querySelector("#set-name").value.trim() || user.name;
    user.phone = main.querySelector("#set-phone").value.trim() || user.phone;
    user.serviceArea = main.querySelector("#set-area").value.trim();
    user.momoNumber = main.querySelector("#set-momo").value.trim() || user.phone;
    user.momoNetwork = main.querySelector("#set-momo-network").value;
    showToast("Settings saved ✓");
    persist();
  });
  main.querySelector("#btn-logout-settings")?.addEventListener("click", () => {
    state.sessionUserId = null; activeTab = "home"; persist();
  });
}

// ═══════════════════════════════════════════
// ADMIN SCREENS
// ═══════════════════════════════════════════

function renderAdminDashboard(user) {
  if (!assertRole("admin")) return "";
  const collectors = state.users.filter((u) => u.role === "collector");
  const residents = state.users.filter((u) => u.role === "resident");
  const active = state.pickups.filter((p) => !["paid", "cancelled"].includes(p.status));
  const paid = state.pickups.filter((p) => p.status === "paid");
  const platform = paid.reduce((s, p) => s + calcFees(p.amountGhs || p.priceGhs || CONFIG.pickupPriceGhs).platformFee, 0);

  return `
    <div class="screen-header">
      <h1>${escapeHtml(user.name)}</h1>
      <p class="muted">Operator view across collectors, households, requests, and platform fees.</p>
    </div>
    <div class="stats-row">
      <div class="stat-box"><strong>${collectors.length}</strong><span>Collectors</span></div>
      <div class="stat-box"><strong>${residents.length}</strong><span>Households</span></div>
      <div class="stat-box"><strong>${active.length}</strong><span>Active jobs</span></div>
    </div>
    <div class="card">
      <p class="muted">Platform fees recorded</p>
      <p class="money" style="font-size:1.8rem">${formatGhs(platform)}</p>
      <p class="fee-note">Based on collector-confirmed paid pickups.</p>
    </div>
    <h2>Needs attention</h2>
    ${active.length ? `<ul class="pickup-list">${active.slice(0, 8).map((p) => renderAdminPickupItem(p)).join("")}</ul>` : `<p class="empty-state">No active requests right now.</p>`}
  `;
}

function renderAdminPickupItem(p) {
  const resident = getUser(state, p.residentId);
  const collector = getUser(state, p.collectorId);
  return `
    <li>
      <span class="status-pill status-${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
      <p><strong>${escapeHtml(resident?.name || "Unknown resident")}</strong> → ${escapeHtml(collector?.name || "Unassigned")}</p>
      <p class="muted">${escapeHtml(resident?.address || "")} · ${p.createdAt ? new Date(p.createdAt).toLocaleString() : ""}</p>
      ${p.priceGhs ? `<p class="muted">Price: <strong>${formatGhs(p.priceGhs)}</strong>${p.momoRef ? ` · Ref: ${escapeHtml(p.momoRef)}` : ""}</p>` : ""}
    </li>`;
}

function renderAdminRequests() {
  if (!assertRole("admin")) return "";
  const pickups = state.pickups.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return `
    <div class="screen-header">
      <h1>All requests</h1>
      <p class="muted">Every pickup request across the network.</p>
    </div>
    ${pickups.length ? `<ul class="pickup-list">${pickups.map((p) => renderAdminPickupItem(p)).join("")}</ul>` : `<p class="empty-state">No requests yet.</p>`}
  `;
}

function renderAdminUsers() {
  if (!assertRole("admin")) return "";
  const collectors = state.users.filter((u) => u.role === "collector");
  const residents = state.users.filter((u) => u.role === "resident");
  return `
    <div class="screen-header">
      <h1>Network</h1>
      <p class="muted">${collectors.length} collectors · ${residents.length} households</p>
    </div>
    <h2>Collectors</h2>
    ${collectors.length ? `<ul class="pickup-list">${collectors.map((c) => `
      <li>
        <strong>${escapeHtml(c.name)}</strong>
        <p class="muted">${escapeHtml(c.serviceArea || "")} · ${escapeHtml(c.phone)} · Code ${escapeHtml(c.joinCode || "")}</p>
        <p class="fee-note">${getResidentsForCollector(state, c.id).length} linked households · MoMo ${escapeHtml(c.momoNumber || c.phone || "")}</p>
      </li>`).join("")}</ul>` : `<p class="empty-state">No collectors yet.</p>`}
    <h2 style="margin-top:20px">Households</h2>
    ${residents.length ? `<ul class="pickup-list">${residents.map((r) => {
      const c = getAssignedCollector(state, r);
      return `<li>
        <strong>${escapeHtml(r.name)}</strong>
        <p class="muted">${escapeHtml(r.address || "")} · ${escapeHtml(r.phone)}</p>
        <p class="fee-note">Collector: ${escapeHtml(c?.name || "Unassigned")}</p>
      </li>`;
    }).join("")}</ul>` : `<p class="empty-state">No households yet.</p>`}
  `;
}

// ——— Nav + Shell ———

function renderNav(user) {
  const nav = document.getElementById("nav");
  nav.hidden = false;
  nav.classList.remove("hidden");

  const tabs = user.role === "admin"
    ? [
        { id: "home",     icon: "📊", label: "Overview" },
        { id: "requests", icon: "🧾", label: "Requests" },
        { id: "users",    icon: "👥", label: "Network" },
      ]
    : user.role === "collector"
      ? [
        { id: "home",     icon: "🗺️",  label: "Route" },
        { id: "group",    icon: "👥",  label: "My group" },
        { id: "earnings", icon: "💰",  label: "Earnings" },
        { id: "settings", icon: "⚙️",  label: "Settings" },
      ]
      : [
        { id: "home",    icon: "🏠", label: "Home" },
        { id: "profile", icon: "📍", label: "Location" },
      ];

  nav.innerHTML = tabs.map((t) => `
    <button type="button" data-tab="${t.id}" class="${activeTab === t.id ? "active" : ""}">
      <span class="nav-icon">${t.icon}</span>${t.label}
    </button>`).join("");

  nav.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => { activeTab = btn.dataset.tab; render(); });
  });
}

function renderApp() {
  const user = currentUser();
  if (!user) { renderAuth(); return; }

  const logoutBtn = document.getElementById("btn-logout");
  logoutBtn.hidden = false;
  logoutBtn.classList.remove("hidden");
  renderNav(user);

  const main = document.getElementById("main");
  destroyMap();

  if (user.role === "admin") {
    if (activeTab === "requests") {
      main.innerHTML = renderAdminRequests();
    } else if (activeTab === "users") {
      main.innerHTML = renderAdminUsers();
    } else {
      activeTab = "home";
      main.innerHTML = renderAdminDashboard(user);
    }
  } else if (user.role === "resident") {
    // Resident: only home and profile tabs
    if (activeTab === "profile") {
      main.innerHTML = renderResidentProfile(user);
      bindResidentProfile(user);
    } else {
      activeTab = "home";
      main.innerHTML = renderResidentHome(user);
      bindResidentHome(user);
    }
  } else if (user.role === "collector") {
    // Collector: route / group / earnings / settings
    if (activeTab === "group") {
      main.innerHTML = renderCollectorGroup(user);
      bindCollectorGroup(user);
    } else if (activeTab === "earnings") {
      main.innerHTML = renderCollectorEarnings(user);
    } else if (activeTab === "settings") {
      main.innerHTML = renderCollectorSettings(user);
      bindCollectorSettings(user);
    } else {
      activeTab = "home";
      main.innerHTML = renderCollectorHome(user);
      bindCollectorHome(user);
    }
  }
}

function render() { renderApp(); }

document.getElementById("btn-logout").addEventListener("click", () => {
  state.sessionUserId = null; activeTab = "home"; persist();
});

render();
syncFromServer();
setInterval(() => {
  if (!document.hidden && currentUser()) syncFromServer();
}, 7000);
