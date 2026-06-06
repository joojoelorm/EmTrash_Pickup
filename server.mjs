import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 8094);
const host = process.env.HOST || "127.0.0.1";
const dataDir = join(root, "data");
const dataFile = join(dataDir, "binroute-state.json");

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function resolvePath(url) {
  const pathname = new URL(url, `http://${host}:${port}`).pathname;
  if (pathname === "/") return join(root, "index.html");
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  return join(root, safePath);
}

function uid() {
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function demoState() {
  const collectorId = uid();
  const res1Id = uid();
  const res2Id = uid();
  return {
    users: [
      {
        id: collectorId,
        role: "collector",
        name: "Kwame (Tricycle)",
        phone: "0241234567",
        address: "Osu, Accra",
        serviceArea: "Osu · Labone · Airport Residential",
        joinCode: "KWAME1",
        momoNumber: "0241234567",
        momoNetwork: "MTN MoMo",
        lat: 5.557,
        lng: -0.182,
      },
      {
        id: uid(),
        role: "admin",
        name: "Emtrash Operator",
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
        lng: -0.18,
      },
    ],
    pickups: [
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
    ],
    notifications: [],
  };
}

function publicState(state) {
  return {
    users: Array.isArray(state?.users) ? state.users : [],
    pickups: Array.isArray(state?.pickups) ? state.pickups : [],
    notifications: Array.isArray(state?.notifications) ? state.notifications : [],
  };
}

async function loadData() {
  await mkdir(dataDir, { recursive: true });
  try {
    return publicState(JSON.parse(await readFile(dataFile, "utf8")));
  } catch {
    const seeded = demoState();
    await saveData(seeded);
    return seeded;
  }
}

async function saveData(state) {
  await mkdir(dataDir, { recursive: true });
  const clean = publicState(state);
  await writeFile(dataFile, JSON.stringify(clean, null, 2), "utf8");
  return clean;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    sendJson(res, 200, await loadData());
    return;
  }

  if (url.pathname === "/api/state" && req.method === "PUT") {
    try {
      sendJson(res, 200, await saveData(await readJson(req)));
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Invalid state" });
    }
    return;
  }

  try {
    const filePath = resolvePath(req.url || "/");
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    res.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, host);
