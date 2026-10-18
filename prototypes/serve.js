// Tiny server for the prototypes: node serve.js [port]
// Serves the files, and /api/search?q= asks the real Radarr and Sonarr (read-only lookup) so the
// search finds every movie and show. Keys come from .keys (radarr=… / sonarr=…), never the page.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const PORT = Number(process.env.PORT || process.argv[2]) || 8130;
const HOST = process.env.ARR_HOST || "http://192.168.0.31";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const KEYS = {};
try {
	for (const line of fs.readFileSync(path.join(__dirname, ".keys"), "utf8").split("\n")) {
		const m = /^(\w+)=(\S+)$/.exec(line.trim());
		if (m) KEYS[m[1]] = m[2];
	}
} catch {}

const lookup = async (app, port, q) => {
	if (!KEYS[app]) return [];
	const what = app === "radarr" ? "movie" : "series";
	const r = await fetch(`${HOST}:${port}/api/v3/${what}/lookup?term=${encodeURIComponent(q)}`, { headers: { "X-Api-Key": KEYS[app] }, signal: AbortSignal.timeout(8000) });
	if (!r.ok) return [];
	return (await r.json()).slice(0, 10).map((x) => ({
		id: `${what}-${x.tmdbId || x.tvdbId}`,
		type: what === "movie" ? "movie" : "series",
		title: x.title,
		year: x.year,
		poster: (x.remotePoster || ((x.images || []).find((i) => i.coverType === "poster") || {}).remoteUrl || "").replace("/original/", "/w342/") || null,
		rating: Math.round(((x.ratings && ((x.ratings.tmdb && x.ratings.tmdb.value) || (x.ratings.imdb && x.ratings.imdb.value) || x.ratings.value)) || 0) * 10) / 10 || null,
		runtime: x.runtime ? `${Math.floor(x.runtime / 60)} h ${x.runtime % 60} min` : null,
		seasons: x.seasons ? x.seasons.filter((s) => s.seasonNumber > 0).length : undefined,
		about: short(x.overview || "", 220),
		have: !!x.id
	}));
};

http
	.createServer(async (req, res) => {
		const url = new URL(req.url, "http://x");
		if (url.pathname === "/api/search") {
			const q = (url.searchParams.get("q") || "").trim();
			const [movies, shows] = q.length < 2 ? [[], []] : await Promise.all([lookup("radarr", 7878, q).catch(() => []), lookup("sonarr", 8989, q).catch(() => [])]);
			// movies and shows mixed, closest match first
			const all = [...movies, ...shows].sort((a, b) => score(b, q) - score(a, q));
			res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
			return res.end(JSON.stringify(all));
		}
		const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "d.html";
		if (rel.startsWith(".")) return res.writeHead(403).end();
		const file = path.join(__dirname, path.normalize(rel));
		if (!file.startsWith(__dirname)) return res.writeHead(403).end();
		fs.readFile(file, (err, data) => {
			if (err) return res.writeHead(404).end("not found");
			res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
			res.end(data);
		});
	})
	.listen(PORT, "127.0.0.1", () => console.log(`Prototypes on http://localhost:${PORT} · search: ${Object.keys(KEYS).join(", ") || "examples only"}`));

function score(x, q) {
	const t = x.title.toLowerCase();
	q = q.toLowerCase();
	return (t === q ? 3 : t.startsWith(q) ? 2 : t.includes(q) ? 1 : 0) + (x.rating || 0) / 20;
}

// cut at a word, with an ellipsis
function short(text, n) {
	if (text.length <= n) return text;
	return `${text.slice(0, n).replace(/\s+\S*$/, "")} …`;
}
