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
	// "Mediathek 1080p Deutsch". The language counts in two ways: Radarr's profile language (Radarr
	// only), and a custom format for it, scored so that a file in that language is an upgrade over one
	// in another – that's what lets "Auf Deutsch holen" replace an English file.
	async profileFor(quality, lang) {
		const L = LANG[lang] || LANG.de;
		const name = `${PREFIX} ${quality === "4k" ? "4K" : quality} ${L.label}`;
		const profiles = await this.api("qualityprofile");
		let profile = profiles.find((p) => p.name === name);
		if (!profile) {
			const start = (QUALITY[quality] || QUALITY["1080p"]).map((n) => profiles.find((p) => p.name === n)).find(Boolean) || profiles[0];
			if (!start) throw new Error(`${this.name}: no quality profile to start from`);
			const copy = JSON.parse(JSON.stringify(start));
			delete copy.id;
			copy.name = name;
			if (this.kind === "radarr") copy.language = { id: L.id, name: L.name };
			profile = await this.api("qualityprofile", { json: copy });
		}
		return this.scoreLanguage(profile, L);
	}

	// the language's custom format scored 100, upgrades allowed until a file in that language is there
	async scoreLanguage(profile, L) {
		const cf = await this.languageFormat(L);
		const p = await this.api(`qualityprofile/${profile.id}`);
		const item = (p.formatItems || []).find((f) => f.format === cf.id);
		const sonarr = this.kind === "sonarr";
		if (item && item.score === 100 && p.upgradeAllowed && p.cutoffFormatScore >= 100 && (!sonarr || p.minFormatScore === 100)) return p;
		p.formatItems = (p.formatItems || []).map((f) => ({ ...f, score: f.format === cf.id ? 100 : f.score }));
		if (!item) p.formatItems.push({ format: cf.id, name: cf.name, score: 100 });
		p.upgradeAllowed = true;
		p.cutoffFormatScore = Math.max(100, p.cutoffFormatScore || 0);
		// Sonarr has no profile language: the format is required. Radarr's profile language already
		// filters, so a file in another language may stay until a better one comes.
		if (sonarr) p.minFormatScore = 100;
		return this.api(`qualityprofile/${p.id}`, { method: "PUT", json: p });
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

	// what a search finds right now for a movie (Radarr) or a season (Sonarr), with why releases are rejected
	async releases(numId, season) {
		const q = this.kind === "radarr" ? `release?movieId=${numId}` : `release?seriesId=${numId}${season !== undefined ? `&seasonNumber=${season}` : ""}`;
		const list = await this.api(q, { timeout: 90000 });
		return list
			.map((r) => ({
				guid: r.guid,
				indexerId: r.indexerId,
				title: r.title,
				indexer: r.indexer,
				size: r.size || 0,
				seeders: r.seeders ?? null,
				peers: r.leechers ?? null,
				quality: r.quality && r.quality.quality ? r.quality.quality.name : null,
				languages: (r.languages || []).map((l) => l.name),
				age: r.ageHours !== undefined ? r.ageHours / 24 : r.age ?? null,
				rejected: !!r.rejected,
				reasons: (r.rejections || []).map((x) => (typeof x === "string" ? x : x.reason)).filter(Boolean),
				fullSeason: !!r.fullSeason
			}))
			.sort((a, b) => a.rejected - b.rejected || (b.seeders || 0) - (a.seeders || 0));
	}

	// load this release, also one the profile would reject
	async grab(guid, indexerId) {
		await this.api("release", { json: { guid, indexerId: Number(indexerId) } });
	}

	// another language or quality: switch the profile, then search again
	async reprofile(numId, quality, lang) {
		const profile = await this.profileFor(quality, lang);
		const item = await this.api(`${this.what}/${numId}`);
		item.qualityProfileId = profile.id;
		await this.api(`${this.what}/${numId}`, { method: "PUT", json: item });
		await this.api("command", { json: this.kind === "radarr" ? { name: "MoviesSearch", movieIds: [numId] } : { name: "SeriesSearch", seriesId: numId } });
		return profile.name;
	}

	// the profile of a title, read as quality and language ("Mediathek 1080p Deutsch" → 1080p, de)
	async profileOf(numId) {
		const [item, profiles] = await Promise.all([this.api(`${this.what}/${numId}`), this.api("qualityprofile")]);
		const p = profiles.find((x) => x.id === item.qualityProfileId);
		return p ? p.name : null;
	}

	async profiles() {
		return (await this.api("qualityprofile")).map((p) => ({ id: p.id, name: p.name }));
	}
}

// With the web login instead of the key: sign in once, then the app's own start data carries the key.
async function keyFromLogin(name, url, username, password) {
	url = base(url);
	const login = await call(name, `${url}/login?returnUrl=%2F`, { form: { username, password, rememberMe: "on" }, raw: true, redirect: "manual" });
	const cookies = (login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get("set-cookie") || ""]).map((c) => c.split(";")[0]).filter(Boolean);
	const where = login.headers.get("location") || "";
	if (!cookies.length || /loginFailed/i.test(where)) throw new Error(`${name}: login failed – check user and password`);
	const init = await call(name, `${url}/initialize.json`, { headers: { Cookie: cookies.join("; ") }, raw: true, redirect: "manual" });
	const data = init.ok ? await init.json().catch(() => null) : null;
	if (!data || !data.apiKey) throw new Error(`${name}: login failed – check user and password`);
	return data.apiKey;
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

module.exports = { Arr, keyFromLogin, LANG, profileName: (q, l) => `${PREFIX} ${q === "4k" ? "4K" : q} ${(LANG[l] || LANG.de).label}`, short };
