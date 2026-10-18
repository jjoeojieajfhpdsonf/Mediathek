"use strict";
// Mediathek – movies and series in one place: search and add (Radarr/Sonarr), what's loading and
// seeding (qBittorrent), what's been watched (Jellyfin), and deleting everywhere at once.
// No dependencies: node server.js
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Config } = require("./lib/config");
const { Arr, keyFromLogin } = require("./lib/arr");
const { Qbit } = require("./lib/qbit");
const { Jellyfin, tokenFromLogin } = require("./lib/jellyfin");
const { detect } = require("./lib/detect");
const { Media } = require("./lib/media");
const { Auto } = require("./lib/auto");

const PORT = Number(process.env.PORT) || 8098;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const PUBLIC = path.join(__dirname, "public");
const PASSWORD = process.env.PASSWORD || "";
const DEMO = process.env.DEMO === "1";
const VERSION = require("./package.json").version;

const config = new Config(DATA_DIR);
const media = new Media({}, { downloadsMap: config.downloadsMap() });

function connect() {
	if (DEMO) return media.set(require("./lib/demo").clients());
	media.set({
		radarr: config.configured("radarr") ? new Arr("radarr", config.get("radarr")) : null,
		sonarr: config.configured("sonarr") ? new Arr("sonarr", config.get("sonarr")) : null,
		qbit: config.configured("qbittorrent") ? new Qbit(config.get("qbittorrent")) : null,
		jellyfin: config.configured("jellyfin") ? new Jellyfin(config.get("jellyfin")) : null
	});
	media.downloadsMap = config.downloadsMap();
	media.linkCache.clear();
}
connect();
const auto = new Auto(media, config, DATA_DIR);
auto.start();

// ---------- login (optional, with PASSWORD) ----------

const SECRET = crypto.createHash("sha256").update(`mediathek:${PASSWORD}`).digest("hex");
const TOKEN = crypto.createHmac("sha256", SECRET).update("session").digest("hex");
const cookieOf = (req) => Object.fromEntries(String(req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => c.split("=").map(decodeURIComponent)));
const loggedIn = (req) => !PASSWORD || cookieOf(req).mediathek === TOKEN;

// ---------- routes ----------

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), fn });
class UserError extends Error {}

route("GET", "/api/state", () => ({ version: VERSION, demo: DEMO, auth: !!PASSWORD, services: media.services(), auto: auto.rules().enabled, keep: [...auto.keep()] }));
route("GET", "/api/library", (b, p, q) => media.library(q.get("fresh") === "1"));
route("GET", "/api/torrents", () => media.torrents());
route("GET", "/api/torrents/:hash", (b, p) => media.torrentDetails(hash(p.hash)));
route("POST", "/api/torrents/:hash/:action", async (b, p) => {
	const h = p.hash === "all" ? "all" : hash(p.hash);
	const qb = needQbit();
	if (p.action === "pause") await qb.pause(h);
	else if (p.action === "resume") await qb.resume(h);
	else if (p.action === "recheck") await qb.recheck(h);
	else if (p.action === "first") await qb.first(h);
	else if (p.action === "replace") await media.replace(h);
	else if (p.action === "remove") return media.removeTorrent(h, b.mode, !!b.exclude);
	else throw new UserError("Unknown action");
	return { ok: true };
});
route("POST", "/api/slow", async () => (await needQbit().toggleSlow(), { ok: true }));
route("GET", "/api/search", (b, p, q) => {
	const term = String(q.get("q") || "").trim();
	return term.length < 2 ? [] : media.search(term);
});
route("POST", "/api/add", (b) => {
	if (!["movie", "series"].includes(b.type) || !/^(tmdb|tvdb)-\d+$/.test(String(b.key))) throw new UserError("Invalid title");
	return media.add(b.type, b.key, { quality: ["720p", "1080p", "4k"].includes(b.quality) ? b.quality : "1080p", lang: ["de", "en", "orig"].includes(b.lang) ? b.lang : "de", monitor: b.monitor });
});
route("POST", "/api/items/:id/delete", (b, p) => {
	if (!/^(movie|series)-\d+$/.test(p.id)) throw new UserError("Invalid title");
	return media.removeEverywhere(p.id, b.exclude !== false);
});
// automatic mode: rules, what the next run would do, what was done
route("GET", "/api/auto", async () => ({ rules: auto.rules(), plan: await auto.plan().catch((err) => ({ error: err.message })), log: auto.log.slice(0, 60), lastRun: auto.lastRun, keep: [...auto.keep()] }));
route("POST", "/api/auto", (b) => ({ rules: auto.setRules(b) }));
route("POST", "/api/auto/run", async () => ({ done: await auto.run(true) }));
route("POST", "/api/items/:id/keep", (b, p) => {
	if (!/^(movie|series)-\d+$/.test(p.id)) throw new UserError("Invalid title");
	auto.setKeep(p.id, !!b.keep);
	return { keep: [...auto.keep()] };
});
route("GET", "/api/settings", () => config.view());
// a login instead of a key: Radarr and Sonarr hand out their key, Jellyfin a token – the password
// itself is never kept
route("POST", "/api/settings", async (b) => {
	if (DEMO) throw new UserError("Not in the demo");
	const errors = {};
	for (const [svc, name] of [["radarr", "Radarr"], ["sonarr", "Sonarr"]]) {
		const x = b[svc];
		if (!x) continue;
		if (x.username && x.password && !x.apiKey) {
			try {
				x.apiKey = await keyFromLogin(name, x.url || config.get(svc).url, x.username, x.password);
			} catch (err) {
				errors[svc] = err.message;
			}
		}
		delete x.username;
		delete x.password;
	}
	const j = b.jellyfin;
	if (j && j.user && j.password && !j.apiKey) {
		try {
			const r = await tokenFromLogin(j.url || config.get("jellyfin").url, j.user, j.password);
			j.apiKey = r.token;
			j.user = r.user;
		} catch (err) {
			errors.jellyfin = err.message;
		}
	}
	if (j) delete j.password;
	config.update(b);
	connect();
	return { ...config.view(), errors };
});
// where the services probably are (fills in the addresses)
route("GET", "/api/settings/detect", (b, p, q, req) => detect([String(req.headers.host || "").replace(/:\d+$/, ""), "127.0.0.1"]));
// try each configured service once
route("POST", "/api/settings/test", async () => {
	const c = media.c;
	const t = async (name, fn) => {
		if (!fn) return [name, { ok: null }];
		try {
			const info = await fn();
			return [name, { ok: true, info }];
		} catch (err) {
			return [name, { ok: false, error: err.message }];
		}
	};
	return Object.fromEntries(
		await Promise.all([
			t("radarr", c.radarr && (async () => `${(await c.radarr.api("system/status")).version}`)),
			t("sonarr", c.sonarr && (async () => `${(await c.sonarr.api("system/status")).version}`)),
			t("qbittorrent", c.qbit && (async () => `${await c.qbit.api("app/version")}`)),
			t("jellyfin", c.jellyfin && (async () => `${(await c.jellyfin.api("System/Info")).Version}`))
		])
	);
});
route("POST", "/api/login", (b, p, q, req, res) => {
	if (!PASSWORD) return { ok: true };
	const a = Buffer.from(String(b.password || ""));
	const want = Buffer.from(PASSWORD);
	if (a.length !== want.length || !crypto.timingSafeEqual(a, want)) throw Object.assign(new UserError("Wrong password"), { status: 401 });
	res.setHeader("Set-Cookie", `mediathek=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}`);
	return { ok: true };
});

function hash(h) {
	if (!/^[a-f0-9]{40}$/i.test(h)) throw new UserError("Invalid torrent");
	return h.toLowerCase();
}
function needQbit() {
	if (!media.c.qbit) throw new UserError("qBittorrent is not set up");
	return media.c.qbit;
}

// ---------- server ----------

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, "http://x");
	if (url.pathname.startsWith("/api/")) {
		const send = (status, data) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
			res.end(JSON.stringify(data));
		};
		if (url.pathname !== "/api/login" && url.pathname !== "/api/state" && !loggedIn(req)) return send(401, { error: "login", login: true });
		const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
		if (!r) return send(404, { error: "Not found" });
		try {
			let body = {};
			if (req.method === "POST") {
				let raw = "";
				for await (const chunk of req) {
					raw += chunk;
					if (raw.length > 100000) throw new UserError("Too large");
				}
				body = raw ? JSON.parse(raw) : {};
			}
			// cross-site requests can't change anything
			if (req.method === "POST" && req.headers["content-type"] && !/application\/json/.test(req.headers["content-type"])) throw new UserError("JSON only");
			const out = await r.fn(body, r.re.exec(url.pathname).groups || {}, url.searchParams, req, res);
			if (url.pathname === "/api/state") out.loggedIn = loggedIn(req);
			send(200, out ?? { ok: true });
		} catch (err) {
			const status = err.status && err.status >= 400 && err.status < 500 && err instanceof UserError ? err.status : err instanceof UserError ? 400 : 502;
			if (!(err instanceof UserError)) console.error(`${req.method} ${url.pathname}:`, err.message);
			send(status, { error: err.message });
		}
		return;
	}
	// static files
	const rel = decodeURIComponent(url.pathname) === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
	const file = path.join(PUBLIC, path.normalize(rel));
	if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
	fs.readFile(file, (err, data) => {
		if (err) return res.writeHead(404).end("Not found");
		res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
		res.end(data);
	});
});

if (require.main === module) server.listen(PORT, HOST, () => console.log(`Mediathek ${VERSION} on http://localhost:${PORT}${DEMO ? " (demo)" : ""}`));

module.exports = { server, media };
