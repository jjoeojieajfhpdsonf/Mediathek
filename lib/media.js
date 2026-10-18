"use strict";
// Puts the services together: one library (Radarr + Sonarr, watched from Jellyfin, the torrent from
// qBittorrent), the torrents with the title they belong to, and the actions that span several
// services – adding, deleting everywhere, cancelling or replacing a download.
const fs = require("node:fs");
const path = require("node:path");

const LIB_TTL = 20000;

class Media {
	// clients: { radarr, sonarr, qbit, jellyfin } – each may be null when not set up
	constructor(clients, opts = {}) {
		this.set(clients);
		this.downloadsMap = opts.downloadsMap || "";
		this.linkCache = new Map(); // hash → hardlinked? (true/false)
	}

	set(clients) {
		this.c = clients;
		this.cache = null;
		this.links = new Map(); // hash → { id, queueId }
	}

	arrs() {
		return [this.c.radarr, this.c.sonarr].filter(Boolean);
	}
	arrFor(id) {
		return String(id).startsWith("movie-") ? this.c.radarr : this.c.sonarr;
	}

	// ---------- library ----------

	async library(force) {
		if (!force && this.cache && Date.now() - this.cache.at < LIB_TTL) return this.cache.data;
		const errors = {};
		const soft = (name, p) => p.catch((err) => ((errors[name] = err.message), null));
		const arrs = this.arrs();
		const [lists, maps, spaces, watched, playing, qb] = await Promise.all([
			Promise.all(arrs.map((a) => soft(a.kind, a.library()))),
			Promise.all(arrs.map((a) => soft(a.kind, a.downloads()))),
			Promise.all(arrs.map((a) => soft(a.kind, a.space()))),
			this.c.jellyfin ? soft("jellyfin", this.c.jellyfin.watched()) : null,
			this.c.jellyfin ? soft("jellyfin", this.c.jellyfin.playing()) : null,
			this.c.qbit ? soft("qbittorrent", this.c.qbit.torrents()) : null
		]);
		const items = lists.flat().filter(Boolean);
		this.links = new Map();
		for (const m of maps) if (m) for (const [h, v] of m) this.links.set(h, v);

		// watched (Jellyfin) and who's watching now
		const byJf = new Map();
		for (const it of items) {
			const w = watched && ((it.type === "movie" && it.tmdb && watched.tmdb.get(String(it.tmdb))) || (it.type === "series" && it.tvdb && watched.tvdb.get(String(it.tvdb))) || (it.imdb && watched.imdb.get(String(it.imdb))));
			it.watched = w ? w.watched : null;
			it.lastPlayed = w ? w.lastPlayed : null;
			if (w) byJf.set(w.jellyfinId, it);
		}
		for (const p of playing || []) {
			const it = byJf.get(p.id);
			if (it) (it.watching = it.watching || []).push({ user: p.user, device: p.device, paused: p.paused });
		}

		// the torrent of each title, and whether its file in the downloads folder is a second copy
		const torrents = (qb && qb.torrents) || [];
		const byId = new Map(items.map((it) => [it.id, it]));
		for (const t of torrents) {
			const link = this.links.get(t.hash.toLowerCase());
			const it = link && byId.get(link.id);
			if (!it) continue;
			(it.torrents = it.torrents || []).push(t.hash);
			if (t.done >= 1) {
				const hard = this.hardlinked(t);
				t.copy = hard === null ? null : !hard;
				if (t.copy) it.copy = (it.copy || 0) + t.size;
				if (hard === null) it.copyUnknown = (it.copyUnknown || 0) + t.size;
			}
		}

		const space = spaces.find(Boolean) || null;
		const data = { at: Date.now(), items, space, errors, services: this.services() };
		this.cache = { at: Date.now(), data };
		return data;
	}

	services() {
		return { radarr: !!this.c.radarr, sonarr: !!this.c.sonarr, qbittorrent: !!this.c.qbit, jellyfin: !!this.c.jellyfin };
	}

	// is the finished torrent's file also the library's file (a hardlink)? Only answerable when the
	// downloads folder is visible in here: DOWNLOADS_MAP="/downloads=/media/downloads"
	hardlinked(t) {
		if (this.c.qbit && this.c.qbit.demo) return false;
		if (this.linkCache.has(t.hash)) return this.linkCache.get(t.hash);
		const [from, to] = String(this.downloadsMap || "").split("=");
		if (!from || !to || !t.contentPath || !t.contentPath.startsWith(from)) return null;
		const local = path.join(to, t.contentPath.slice(from.length));
		let answer = null;
		try {
			const big = largestFile(local);
			if (big) answer = fs.statSync(big).nlink > 1;
		} catch {}
		this.linkCache.set(t.hash, answer);
		return answer;
	}

	// ---------- torrents ----------

	async torrents() {
		if (!this.c.qbit) return null;
		const data = await this.c.qbit.torrents();
		if (!this.links.size) await this.library().catch(() => null);
		const items = this.cache ? new Map(this.cache.data.items.map((it) => [it.id, it])) : new Map();
		for (const t of data.torrents) {
			const link = this.links.get(t.hash.toLowerCase());
			const it = link && items.get(link.id);
			if (it) Object.assign(t, { item: it.id, title: it.title, type: it.type });
			else t.title = cleanName(t.name);
			if (t.done >= 1 && t.copy === undefined) {
				const hard = this.hardlinked(t);
				t.copy = hard === null ? null : !hard;
			}
		}
		return data;
	}

	async torrentDetails(hash) {
		const d = await this.c.qbit.details(hash);
		const link = this.links.get(hash.toLowerCase());
		return { ...d, item: link ? link.id : null, canReplace: !!(link && link.queueId) };
	}

	// ---------- actions ----------

	async search(q) {
		const out = await Promise.all(this.arrs().map((a) => a.lookup(q).catch(() => [])));
		const term = q.toLowerCase();
		// how well the title matches, and how well known it is (number of ratings)
		const score = (x) => {
			const t = x.title.toLowerCase();
			return (t === term ? 2 : t.startsWith(term) || t === `the ${term}` ? 1.5 : t.includes(term) ? 1 : 0) + Math.log10((x.votes || 0) + 1);
		};
		return out.flat().sort((a, b) => score(b) - score(a));
	}

	async add(type, key, opts) {
		const a = type === "movie" ? this.c.radarr : this.c.sonarr;
		if (!a) throw new Error(`${type === "movie" ? "Radarr" : "Sonarr"} is not set up`);
		const r = await a.add(key, opts);
		this.cache = null;
		return r;
	}

	// delete a title everywhere; every step reports on its own so one failure doesn't hide the rest
	async removeEverywhere(id, exclude) {
		const lib = await this.library(true);
		const it = lib.items.find((x) => x.id === id);
		if (!it) throw new Error("Not in the library");
		const hashes = [...this.links].filter(([, v]) => v.id === id).map(([h]) => h);
		const steps = [];
		const step = async (service, fn) => {
			try {
				const info = await fn();
				steps.push({ service, ok: true, info: info || null });
			} catch (err) {
				steps.push({ service, ok: false, error: err.message });
			}
		};
		await step(it.app === "radarr" ? "Radarr" : "Sonarr", () => this.arrFor(id).remove(it.num, exclude));
		if (this.c.qbit) await step("qBittorrent", async () => {
			const present = (await this.c.qbit.torrents()).torrents.map((t) => t.hash.toLowerCase());
			const mine = hashes.filter((h) => present.includes(h));
			if (mine.length) await this.c.qbit.remove(mine.join("|"), true);
			return mine.length ? `${mine.length} torrent(s)` : "none";
		});
		if (this.c.jellyfin) await step("Jellyfin", () => this.c.jellyfin.refresh());
		this.cache = null;
		return { steps };
	}

	// remove only a torrent: "copy" keeps the title in the library (deletes the download's files),
	// "cancel" stops a download that isn't finished (and the title, if it has no file yet)
	async removeTorrent(hash, mode, exclude) {
		const link = this.links.get(hash.toLowerCase());
		if (mode === "all" && link) return this.removeEverywhere(link.id, exclude);
		if (mode === "cancel" && link) {
			const lib = await this.library(true);
			const it = lib.items.find((x) => x.id === link.id);
			if (it && !it.hasFile) return this.removeEverywhere(link.id, exclude);
		}
		await this.c.qbit.remove(hash, true);
		this.cache = null;
		return { steps: [{ service: "qBittorrent", ok: true }] };
	}

	async replace(hash) {
		const link = this.links.get(hash.toLowerCase());
		if (!link || !link.queueId) throw new Error("This download isn't in Radarr's or Sonarr's queue");
		await this.arrFor(link.id).replace(link.queueId);
		this.cache = null;
	}
}

function largestFile(p) {
	const st = fs.statSync(p);
	if (st.isFile()) return p;
	let best = null;
	let size = -1;
	for (const name of fs.readdirSync(p)) {
		const f = largestFile(path.join(p, name));
		if (!f) continue;
		const s = fs.statSync(f).size;
		if (s > size) (best = f), (size = s);
	}
	return best;
}

// "Dune.Part.Two.2024.1080p.BluRay.x265-GRP" → "Dune Part Two"
function cleanName(name) {
	return String(name)
		.replace(/\.(mkv|mp4|avi)$/i, "")
		.replace(/[._]/g, " ")
		// cut at the year – also "(2025)" or "[2025]", but never a title that starts with one
		.replace(/^(.+?)[\s([]+(19|20)\d\d\b.*$/, "$1")
		.replace(/\s+S\d{1,2}(E\d{1,3})?\b.*$/i, "")
		.replace(/\s+(1080p|2160p|720p|480p)\b.*$/i, "")
		.trim();
}

module.exports = { Media, cleanName };
