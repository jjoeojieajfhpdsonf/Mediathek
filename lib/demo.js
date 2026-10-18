"use strict";
// DEMO=1: made-up Radarr, Sonarr, qBittorrent and Jellyfin that behave like the real ones, so every
// flow (adding, downloading, deleting) can be tried without touching a real library.

const GB = 1e9;
const DAY = 86400000;
const now = Date.now();

const movies = [
	{ id: 1, title: "Avatar: Fire and Ash", year: 2025, tmdb: 83533, poster: "demo/avatar.jpg", size: 11.8, added: 150, watched: 0.34, quality: "Bluray-1080p · x265 · HDR10", hash: "a1" },
	{ id: 2, title: "Jurassic World Rebirth", year: 2025, tmdb: 1234821, poster: "demo/jurassic.jpg", size: 8.4, added: 148, watched: 1, quality: "Bluray-1080p · x265 · HDR10", hash: "a2" },
	{ id: 3, title: "Inception", year: 2010, tmdb: 27205, poster: "demo/inception.jpg", size: 14.6, added: 150, watched: 1, quality: "Bluray-1080p · h264", hash: "a3" },
	{ id: 4, title: "The Super Mario Galaxy Movie", year: 2026, tmdb: 1083968, poster: "demo/mario.jpg", size: 3.1, added: 6, watched: 0, quality: "WEBRip-1080p · x265", hash: "a4" },
	{ id: 5, title: "Dune: Part Two", year: 2024, tmdb: 693134, poster: null, size: 0, added: 0.01, watched: 0, quality: null, hash: "a5", loading: 0.43 }
];
const shows = [
	{ id: 1, title: "Severance", year: 2022, tvdb: 371980, poster: null, size: 38.5, added: 230, watched: 0.7, seasons: [[9, 9], [10, 10]], hash: "b1" },
	{ id: 2, title: "The Bear", year: 2022, tvdb: 403245, poster: null, size: 21.2, added: 120, watched: 0.25, seasons: [[8, 8], [10, 10], [10, 10], [3, 10]], hash: "b2", stalled: 0.71 }
];
const hashOf = (s) => s.padEnd(40, "0");

// qBittorrent's view
const torrents = [
	...movies.map((m) => ({ hash: hashOf(m.hash), name: `${m.title.replace(/[^\w ]/g, "").replace(/ /g, ".")}.${m.year}.1080p.BluRay.x265-GRP`, item: `movie-${m.id}`, size: (m.size || 9.8) * GB, done: m.loading ?? 1, state: m.loading !== undefined ? "down" : m.id === 3 ? "done" : "seed", ratio: m.id === 3 ? 2.4 : m.id === 2 ? 1.8 : 0.4, added: now - m.added * DAY })),
	...shows.map((s) => ({ hash: hashOf(s.hash), name: `${s.title.replace(/ /g, ".")}.S0${s.seasons.length}.1080p.WEB-DL-FLUX`, item: `series-${s.id}`, size: s.stalled ? 1.4 * GB : s.size * GB, done: s.stalled ?? 1, state: s.stalled ? "stalled" : "seed", ratio: s.stalled ? 0 : 1.1, added: now - (s.stalled ? 0.1 : s.added) * DAY }))
];
let slow = false;

// downloads move on every second
setInterval(() => {
	for (const t of torrents) {
		if (t.state !== "down") continue;
		t.down = (slow ? 5 : 10 + Math.random() * 8) * 1e6;
		t.done = Math.min(1, t.done + t.down / t.size);
		if (t.done >= 1) {
			Object.assign(t, { state: "seed", down: 0, up: 0.6e6 });
			const m = movies.find((x) => `movie-${x.id}` === t.item);
			if (m) (m.size = t.size / GB), (m.quality = "Bluray-1080p · x265"), delete m.loading;
		}
	}
}, 1000).unref();

const CATALOG = [
	{ tmdb: 438631, title: "Dune", year: 2021, rating: 7.8, runtime: 155, poster: null, about: "Paul Atreides and his family arrive on Arrakis, the most dangerous planet in the universe." },
	{ tmdb: 157336, title: "Interstellar", year: 2014, rating: 8.4, runtime: 169, poster: null, about: "A team travels through a wormhole in search of a new home for humanity." },
	{ tmdb: 872585, title: "Oppenheimer", year: 2023, rating: 8.1, runtime: 180, poster: null, about: "The story of the physicist behind the Manhattan Project." },
	{ tvdb: 393189, title: "Andor", year: 2022, rating: 8.4, seasons: 2, poster: null, about: "How a thief becomes a rebel, five years before Rogue One." },
	{ tvdb: 392573, title: "Shōgun", year: 2024, rating: 8.6, seasons: 1, poster: null, about: "An English sailor is shipwrecked in Japan in 1600, in the middle of a power struggle." },
	{ tvdb: 359274, title: "Slow Horses", year: 2022, rating: 8.1, seasons: 5, poster: null, about: "Disgraced MI5 agents stumble into real cases." }
];

class DemoArr {
	constructor(kind) {
		this.kind = kind;
		this.name = kind === "radarr" ? "Radarr" : "Sonarr";
		this.what = kind === "radarr" ? "movie" : "series";
	}
	async api(p) {
		if (p === "system/status") return { version: "demo" };
		return [];
	}
	list() {
		return this.kind === "radarr" ? movies : shows;
	}
	async library() {
		return this.list().map((x) =>
			this.kind === "radarr"
				? { id: `movie-${x.id}`, num: x.id, app: "radarr", type: "movie", title: x.title, year: x.year, tmdb: x.tmdb, poster: x.poster, size: x.size * GB, hasFile: !x.loading && x.size > 0, added: now - x.added * DAY, quality: x.quality, runtime: x.runtime || null, monitored: true, status: x.loading ? "missing" : "ok" }
				: { id: `series-${x.id}`, num: x.id, app: "sonarr", type: "series", title: x.title, year: x.year, tvdb: x.tvdb, poster: x.poster, size: x.size * GB, hasFile: true, added: now - x.added * DAY, quality: "WEBDL-1080p", seasons: x.seasons.map(([have, of], i) => ({ n: i + 1, have, of, monitored: true })), episodes: { have: x.seasons.reduce((a, s) => a + s[0], 0), of: x.seasons.reduce((a, s) => a + s[1], 0) }, monitored: true, status: "continuing" }
		);
	}
	async downloads() {
		const map = new Map();
		for (const t of torrents) if (t.item.startsWith(this.what)) map.set(t.hash, { id: t.item, queueId: t.done < 1 ? 1 : null });
		return map;
	}
	async space() {
		const used = movies.reduce((a, m) => a + m.size, 0) + shows.reduce((a, s) => a + s.size, 0) + torrents.reduce((a, t) => a + (t.done >= 1 ? t.size / GB : 0), 0);
		return { path: "/media", free: (232 - 22 - used) * GB, total: 232 * GB };
	}
	async lookup(term) {
		const q = term.toLowerCase();
		const mine = this.list().filter((x) => x.title.toLowerCase().includes(q)).map((x) => ({ id: `${this.what}-${x.id}`, key: this.kind === "radarr" ? `tmdb-${x.tmdb}` : `tvdb-${x.tvdb}`, type: this.what, title: x.title, year: x.year, poster: x.poster, rating: 8, have: true }));
		const other = CATALOG.filter((x) => (this.kind === "radarr" ? x.tmdb : x.tvdb) && x.title.toLowerCase().includes(q) && !this.list().some((m) => m.title === x.title)).map((x) => ({ id: null, key: this.kind === "radarr" ? `tmdb-${x.tmdb}` : `tvdb-${x.tvdb}`, type: this.what, title: x.title, year: x.year, poster: x.poster, rating: x.rating, runtime: x.runtime || null, seasons: x.seasons, about: x.about, have: false }));
		return [...mine, ...other];
	}
	async add(key, opts) {
		const x = CATALOG.find((c) => `tmdb-${c.tmdb}` === key || `tvdb-${c.tvdb}` === key);
		const id = Math.max(0, ...this.list().map((m) => m.id)) + 1;
		const h = `c${id}${this.kind === "radarr" ? "a" : "b"}`;
		if (this.kind === "radarr") movies.push({ id, title: x.title, year: x.year, tmdb: x.tmdb, poster: x.poster, size: 0, added: 0, watched: 0, quality: null, hash: h, loading: 0 });
		else shows.push({ id, title: x.title, year: x.year, tvdb: x.tvdb, poster: x.poster, size: 0, added: 0, watched: 0, seasons: Array.from({ length: x.seasons || 1 }, () => [0, 8]), hash: h });
		// a moment later the release is found and the download starts
		setTimeout(() => torrents.unshift({ hash: hashOf(h), name: `${x.title.replace(/[^\w ]/g, "").replace(/ /g, ".")}.${x.year}.1080p.WEB-DL-GRP`, item: `${this.what}-${id}`, size: 7.2 * GB, done: 0, state: "down", ratio: 0, added: Date.now() }), 2500);
		return { id: `${this.what}-${id}`, profile: `Mediathek ${opts.quality} ${opts.lang}` };
	}
	async remove(num) {
		const list = this.list();
		const i = list.findIndex((m) => m.id === num);
		if (i >= 0) list.splice(i, 1);
	}
	async releases(num) {
		const x = this.list().find((m) => m.id === num) || { title: "Demo", year: 2024 };
		const n = x.title.replace(/[^\w ]/g, "").replace(/ /g, ".");
		return [
			{ guid: "g1", indexerId: 1, title: `${n}.${x.year}.1080p.BluRay.x265-GRP`, indexer: "1337x", size: 9.4e9, seeders: 210, peers: 12, quality: "Bluray-1080p", languages: ["English"], age: 400, rejected: true, reasons: ["German is wanted, but found English"] },
			{ guid: "g2", indexerId: 1, title: `${n}.${x.year}.2160p.UHD.BluRay.REMUX-FraMeSToR`, indexer: "1337x", size: 61e9, seeders: 40, peers: 3, quality: "Remux-2160p", languages: ["English"], age: 900, rejected: true, reasons: ["German is wanted, but found English", "Remux-2160p is not wanted in profile"] },
			{ guid: "g3", indexerId: 2, title: `${n}.${x.year}.1080p.BRRip.x264-YTS`, indexer: "YTS", size: 2.1e9, seeders: 640, peers: 30, quality: "Bluray-1080p", languages: ["English"], age: 1200, rejected: true, reasons: ["German is wanted, but found English"] }
		];
	}
	async grab(guid) {
		const m = movies.find((x) => x.loading !== undefined && !torrents.some((t) => t.item === `movie-${x.id}`)) || movies.find((x) => !x.size);
		if (m) torrents.unshift({ hash: hashOf(`d${m.id}a`), name: `${m.title.replace(/[^\w ]/g, "").replace(/ /g, ".")}.${m.year}.1080p.BluRay-${guid}`, item: `movie-${m.id}`, size: 9.4e9, done: 0, state: "down", ratio: 0, added: Date.now() });
	}
	async reprofile(num, quality, lang) {
		return `Mediathek ${quality} ${lang}`;
	}
	async profileOf() {
		return "Mediathek 1080p Deutsch";
	}
	async replace() {
		const t = torrents.find((x) => x.state === "stalled");
		if (t) Object.assign(t, { state: "down", done: 0, name: t.name.replace(/-\w+$/, "-NTb") });
	}
}

class DemoQbit {
	constructor() {
		this.demo = true;
	}
	async api(p) {
		if (p === "app/version") return "v5.1.2 (demo)";
		return null;
	}
	async torrents() {
		return {
			down: torrents.reduce((a, t) => a + (t.state === "down" ? t.down || 0 : 0), 0),
			up: torrents.reduce((a, t) => a + (t.state === "seed" ? 0.4e6 : 0), 0),
			slow,
			torrents: torrents.map((t) => ({ hash: t.hash, name: t.name, state: t.state, raw: t.state, size: t.size, done: t.done, down: t.state === "down" ? t.down || 0 : 0, up: t.state === "seed" ? 0.4e6 : 0, eta: t.state === "down" && t.down ? Math.round(((1 - t.done) * t.size) / t.down) : null, seeds: t.state === "stalled" ? 0 : 42, seedsAll: 120, peers: 6, peersAll: 30, ratio: t.ratio, category: t.item.startsWith("movie") ? "radarr" : "sonarr", added: t.added, completed: t.done >= 1 ? t.added + 3600000 : null, seedingTime: t.done >= 1 ? Math.round((Date.now() - t.added) / 1000) : 0, contentPath: `/downloads/${t.name}`, savePath: "/downloads" }))
		};
	}
	async details(hash) {
		const t = torrents.find((x) => x.hash === hash);
		return { addedOn: t.added, completedOn: t.done >= 1 ? t.added + 3600000 : null, savePath: "/downloads", seeds: 42, seedsTotal: 120, peers: 6, peersTotal: 30, ratio: t.ratio, seedingTime: t.done >= 1 ? 86400 * 3 : 0, uploaded: t.ratio * t.size, downloaded: t.size * t.done, tracker: "udp://tracker.example.org:1337/announce", files: [{ name: `${t.name}/${t.name}.mkv`, size: t.size * 0.99, progress: t.done }, { name: `${t.name}/Subs/German.srt`, size: 80000, progress: t.done }] };
	}
	async pause(h) {
		for (const t of torrents) if (h === "all" || t.hash === h) t.state = t.done < 1 ? "paused" : "done";
	}
	async resume(h) {
		for (const t of torrents) if (h === "all" || t.hash === h) t.state = t.done < 1 ? "down" : "seed";
	}
	async remove(hashes) {
		for (const h of String(hashes).split("|")) {
			const i = torrents.findIndex((t) => t.hash === h);
			if (i >= 0) torrents.splice(i, 1);
		}
	}
	async recheck() {}
	async first() {}
	async toggleSlow() {
		slow = !slow;
	}
}

class DemoJellyfin {
	async api(p) {
		if (p === "System/Info") return { Version: "10.11 (demo)" };
		return null;
	}
	async watched() {
		const out = { tmdb: new Map(), tvdb: new Map(), imdb: new Map(), ids: new Map() };
		for (const m of movies) out.tmdb.set(String(m.tmdb), { watched: m.watched || 0, jellyfinId: `m${m.id}`, lastPlayed: m.watched ? now - 9 * DAY : null });
		for (const s of shows) out.tvdb.set(String(s.tvdb), { watched: s.watched || 0, jellyfinId: `s${s.id}`, lastPlayed: s.watched ? now - 2 * DAY : null });
		return out;
	}
	async playing() {
		return [{ id: "m1", user: "Alex", device: "Apple TV", paused: false }];
	}
	async refresh() {}
}

module.exports = { clients: () => ({ radarr: new DemoArr("radarr"), sonarr: new DemoArr("sonarr"), qbit: new DemoQbit(), jellyfin: new DemoJellyfin() }) };
