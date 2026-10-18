"use strict";
// Radarr (movies) and Sonarr (series): the library, searching, adding, deleting – and the profiles
// that carry the language, which the app creates itself when one is missing.
const { call, base } = require("./http");

// language ids shared by Radarr and Sonarr
const LANG = { de: { id: 4, name: "German", label: "Deutsch" }, en: { id: 1, name: "English", label: "Englisch" }, orig: { id: -2, name: "Original", label: "Original" } };
// the stock profile each quality starts from
const QUALITY = { "720p": ["HD-720p"], "1080p": ["HD-1080p"], "4k": ["Ultra-HD", "UHD-2160p"] };
const PREFIX = "Mediathek";

class Arr {
	constructor(kind, cfg) {
		this.kind = kind; // "radarr" | "sonarr"
		this.name = kind === "radarr" ? "Radarr" : "Sonarr";
		this.what = kind === "radarr" ? "movie" : "series";
		this.url = base(cfg.url);
		this.key = cfg.apiKey;
	}

	api(p, opts = {}) {
		return call(this.name, `${this.url}/api/v3/${p}`, { ...opts, headers: { "X-Api-Key": this.key, ...(opts.headers || {}) } });
	}

	// ---------- library ----------

	async library() {
		const list = await this.api(this.what);
		return list.map((x) => (this.kind === "radarr" ? movie(x) : series(x)));
	}

	// which torrent (hash) brought which title: grabbed events in the history, plus the queue
	async downloads() {
		const map = new Map();
		const [hist, queue] = await Promise.all([this.api(`history?page=1&pageSize=1000&sortKey=date&sortDirection=descending&eventType=1`).catch(() => null), this.api(`queue?page=1&pageSize=200`).catch(() => null)]);
		for (const r of [...((queue && queue.records) || []), ...((hist && hist.records) || [])]) {
			const id = this.kind === "radarr" ? r.movieId : r.seriesId;
			if (!r.downloadId || !id) continue;
			const h = r.downloadId.toLowerCase();
			if (!map.has(h)) map.set(h, { id: `${this.what}-${id}`, queueId: queue && queue.records && queue.records.includes(r) ? r.id : null });
		}
		return map;
	}

	// free and total space where the library lives
	async space() {
		const [roots, disks] = await Promise.all([this.api("rootfolder"), this.api("diskspace").catch(() => [])]);
		const root = roots[0];
		if (!root) return null;
		const disk = disks.filter((d) => root.path.startsWith(d.path)).sort((a, b) => b.path.length - a.path.length)[0];
		return { path: root.path, free: root.freeSpace ?? (disk && disk.freeSpace) ?? null, total: (disk && disk.totalSpace) || root.totalSpace || null };
	}

	// ---------- search and add ----------

	async lookup(term) {
		const list = await this.api(`${this.what}/lookup?term=${encodeURIComponent(term)}`, { timeout: 20000 });
		return list.slice(0, 12).map((x) => ({
			id: x.id ? `${this.what}-${x.id}` : null,
			key: this.kind === "radarr" ? `tmdb-${x.tmdbId}` : `tvdb-${x.tvdbId}`,
			type: this.what,
			title: x.title,
			year: x.year || null,
			poster: posterOf(x),
			rating: rating(x),
			votes: votes(x),
			runtime: x.runtime || null,
			seasons: x.seasons ? x.seasons.filter((s) => s.seasonNumber > 0).length : undefined,
			about: short(x.overview || "", 240),
			have: !!x.id
		}));
	}

	// opts: { quality: "720p"|"1080p"|"4k", lang: "de"|"en"|"orig", monitor: "all"|"first"|"future" }
	async add(key, opts) {
		const [kind, extId] = String(key).split("-");
		const term = kind === "tmdb" ? `tmdb:${extId}` : `tvdb:${extId}`;
		const found = (await this.api(`${this.what}/lookup?term=${encodeURIComponent(term)}`))[0];
		if (!found) throw new Error(`${this.name}: not found`);
		if (found.id) return { id: `${this.what}-${found.id}`, existed: true };
		const [profile, roots] = await Promise.all([this.profileFor(opts.quality || "1080p", opts.lang || "de"), this.api("rootfolder")]);
		if (!roots.length) throw new Error(`${this.name}: no root folder set up`);
		const body = { ...found, qualityProfileId: profile.id, rootFolderPath: roots[0].path, monitored: true };
		if (this.kind === "radarr") Object.assign(body, { minimumAvailability: "released", addOptions: { searchForMovie: true } });
		else {
			const monitor = opts.monitor === "first" ? "firstSeason" : opts.monitor === "future" ? "future" : "all";
			Object.assign(body, { seasonFolder: true, addOptions: { monitor, searchForMissingEpisodes: monitor !== "future", searchForCutoffUnmetEpisodes: false } });
		}
		const added = await this.api(this.what, { json: body });
		return { id: `${this.what}-${added.id}`, profile: profile.name };
	}

	// "Mediathek 1080p Deutsch": Radarr keeps the language in the profile; Sonarr needs a custom
	// format for it and a profile that requires that format
	async profileFor(quality, lang) {
		const L = LANG[lang] || LANG.de;
		const name = `${PREFIX} ${quality === "4k" ? "4K" : quality} ${L.label}`;
		const profiles = await this.api("qualityprofile");
		const have = profiles.find((p) => p.name === name);
		if (have) return have;
		const start = (QUALITY[quality] || QUALITY["1080p"]).map((n) => profiles.find((p) => p.name === n)).find(Boolean) || profiles[0];
		if (!start) throw new Error(`${this.name}: no quality profile to start from`);
		const copy = JSON.parse(JSON.stringify(start));
		delete copy.id;
		copy.name = name;
		if (this.kind === "radarr") {
			copy.language = { id: L.id, name: L.name };
			return this.api("qualityprofile", { json: copy });
		}
		const cf = await this.languageFormat(L);
		const fresh = (await this.api(`qualityprofile/${start.id}`)) || start;
		const p = JSON.parse(JSON.stringify(fresh));
		delete p.id;
		p.name = name;
		p.formatItems = (p.formatItems || []).map((f) => ({ ...f, score: f.format === cf.id ? 100 : f.score }));
		if (!p.formatItems.some((f) => f.format === cf.id)) p.formatItems.push({ format: cf.id, name: cf.name, score: 100 });
		p.minFormatScore = 100;
		return this.api("qualityprofile", { json: p });
	}

	async languageFormat(L) {
		const name = `${PREFIX} ${L.label}`;
		const formats = await this.api("customformat");
		const have = formats.find((f) => f.name === name);
		if (have) return have;
		return this.api("customformat", {
			json: { name, includeCustomFormatWhenRenaming: false, specifications: [{ name: "Sprache", implementation: "LanguageSpecification", negate: false, required: true, fields: [{ name: "value", value: L.id }] }] }
		});
	}

	// ---------- delete and re-search ----------

	async remove(numId, exclude) {
		const ex = this.kind === "radarr" ? "addImportExclusion" : "addImportListExclusion";
		await this.api(`${this.what}/${numId}?deleteFiles=true&${ex}=${exclude ? "true" : "false"}`, { method: "DELETE" });
	}

	// a stuck download: block this release and let Radarr/Sonarr look for another one
	async replace(queueId) {
		await this.api(`queue/${queueId}?removeFromClient=true&blocklist=true&skipRedownload=false`, { method: "DELETE" });
	}

	async profiles() {
		return (await this.api("qualityprofile")).map((p) => ({ id: p.id, name: p.name }));
	}
}

// ---------- shapes ----------

function posterOf(x) {
	const img = x.remotePoster || ((x.images || []).find((i) => i.coverType === "poster") || {}).remoteUrl || "";
	return img ? img.replace("/original/", "/w342/") : null;
}
function rating(x) {
	const r = x.ratings || {};
	const v = (r.tmdb && r.tmdb.value) || (r.imdb && r.imdb.value) || r.value || 0;
	return v ? Math.round(v * 10) / 10 : null;
}
function votes(x) {
	const r = x.ratings || {};
	return (r.tmdb && r.tmdb.votes) || (r.imdb && r.imdb.votes) || r.votes || 0;
}
function short(text, n) {
	if (text.length <= n) return text;
	return `${text.slice(0, n).replace(/\s+\S*$/, "")} …`;
}
function qualityName(q) {
	return q && q.quality ? q.quality.name : null;
}

function movie(x) {
	const f = x.movieFile || null;
	return {
		id: `movie-${x.id}`,
		num: x.id,
		app: "radarr",
		type: "movie",
		title: x.title,
		year: x.year || null,
		tmdb: x.tmdbId || null,
		imdb: x.imdbId || null,
		poster: posterOf(x),
		size: x.sizeOnDisk || (f && f.size) || 0,
		hasFile: !!x.hasFile,
		added: x.added ? Date.parse(x.added) : null,
		quality: [qualityName(f && f.quality), f && f.mediaInfo && f.mediaInfo.videoCodec, f && f.mediaInfo && f.mediaInfo.videoDynamicRangeType].filter(Boolean).join(" · ") || null,
		languages: f && f.languages ? f.languages.map((l) => l.name) : [],
		runtime: x.runtime || null,
		monitored: !!x.monitored,
		status: x.hasFile ? "ok" : x.isAvailable ? "missing" : "waiting"
	};
}

function series(x) {
	const st = x.statistics || {};
	return {
		id: `series-${x.id}`,
		num: x.id,
		app: "sonarr",
		type: "series",
		title: x.title,
		year: x.year || null,
		tvdb: x.tvdbId || null,
		imdb: x.imdbId || null,
		poster: posterOf(x),
		size: st.sizeOnDisk || 0,
		hasFile: (st.episodeFileCount || 0) > 0,
		added: x.added ? Date.parse(x.added) : null,
		quality: null,
		seasons: (x.seasons || []).filter((s) => s.seasonNumber > 0).map((s) => ({ n: s.seasonNumber, have: (s.statistics && s.statistics.episodeFileCount) || 0, of: (s.statistics && (s.statistics.totalEpisodeCount || s.statistics.episodeCount)) || 0, monitored: !!s.monitored })),
		episodes: { have: st.episodeFileCount || 0, of: st.episodeCount || 0 },
		next: x.nextAiring ? Date.parse(x.nextAiring) : null,
		monitored: !!x.monitored,
		status: x.ended ? "ended" : "continuing"
	};
}

module.exports = { Arr, LANG, profileName: (q, l) => `${PREFIX} ${q === "4k" ? "4K" : q} ${(LANG[l] || LANG.de).label}`, short };
