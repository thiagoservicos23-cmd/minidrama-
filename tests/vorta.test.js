const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");
const express = require("express");

const vortaApi = require("../src/services/vortaApi");
const vortaRoutes = require("../src/routes/vorta");
const playsRoutes = require("../src/routes/plays");

let server, base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/vorta", vortaRoutes);
  app.use("/api/plays", playsRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(() => server.close());

const get = (p) => new Promise((resolve, reject) => {
  http.get(base + p, (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      try {
        resolve({ status: res.statusCode, body: JSON.parse(d) });
      } catch (e) {
        resolve({ status: res.statusCode, body: d });
      }
    });
  }).on("error", reject);
});

const post = (p, data) => new Promise((resolve, reject) => {
  const payload = JSON.stringify(data);
  const u = new URL(base + p);
  const req = http.request({
    hostname: u.hostname,
    port: u.port,
    path: u.pathname + u.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    }
  }, (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      try {
        resolve({ status: res.statusCode, body: JSON.parse(d) });
      } catch (e) {
        resolve({ status: res.statusCode, body: d });
      }
    });
  });
  req.on("error", reject);
  req.write(payload);
  req.end();
});

test("HMAC-SHA256 signature is calculated correctly", () => {
  const secret = "test-secret";
  const path = "/api/v2/categories";
  const { timestamp, signature, payload } = vortaApi.signRequest("GET", path, secret);
  assert.ok(timestamp);
  assert.ok(signature);
  assert.equal(payload, `GET:${path}:${timestamp}`);
  assert.equal(signature.length, 64); // SHA256 hex string is 64 chars
});

test("formatVortaPlay formats drama into Mini Drama structure", () => {
  const item = {
    id: "abc123xyz",
    title: "Amor de Milhões",
    cover: "https://exemplo.com/cover.jpg",
    synopsis: "História de romance dramático.",
    author: "FreeReels",
    chapters: 50,
    genres: ["Romance", "Drama"],
    views: "1.2M",
    status: "Completed"
  };
  const play = vortaApi.formatVortaPlay(item, "freereels");
  assert.equal(play.id, "vorta:freereels:abc123xyz");
  assert.equal(play.rawId, "abc123xyz");
  assert.equal(play.title, "Amor de Milhões");
  assert.equal(play.posterUrl, "https://exemplo.com/cover.jpg");
  assert.equal(play.backdropUrl, "https://exemplo.com/cover.jpg");
  assert.equal(play.durationMinutes, 100);
  assert.equal(play.isVorta, true);
  assert.equal(play.platform, "freereels");
  assert.equal(play.canWatch, true);
  assert.deepEqual(play.genreLabels, ["Romance", "Drama"]);
});

test("/api/vorta/status returns active plan and platforms", async () => {
  const res = await get("/vorta/status");
  assert.equal(res.status, 200);
  assert.ok(res.body.status);
  assert.ok(res.body.plan);
});

test("/api/vorta/categories returns available platforms", async () => {
  const res = await get("/vorta/categories");
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.some((c) => c.name === "freereels"));
});

test("/api/vorta/languages returns supported languages", async () => {
  const res = await get("/vorta/languages?category=freereels");
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.some((l) => l.code === "pt"));
});

test("/api/vorta/home returns drama items formatted for Mini Drama", async () => {
  const res = await get("/vorta/home?category=freereels&lang=pt");
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.plays));
  if (res.body.plays.length > 0) {
    const first = res.body.plays[0];
    assert.ok(first.id.startsWith("vorta:freereels:"));
    assert.ok(first.title);
    assert.ok(first.posterUrl);
  }
});

test("/api/vorta/track accepts analytics payload", async () => {
  const res = await post("/vorta/track", {
    deviceId: "test-device-123",
    deviceModel: "Chrome Test",
    osVersion: "Win32",
    appVersion: "1.0.0"
  });
  assert.equal(res.status, 200);
});
