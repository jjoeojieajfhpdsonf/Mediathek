"use strict";
// Jellyfin: what has been watched (by the chosen user, else the first admin), what's playing now,
// and a library refresh after deleting.
const { call, base } = require("./http");

class Jellyfin {
	constructor(cfg) {
		this.url = base(cfg.url);
		this.key = cfg.apiKey;
		this.userName = cfg.user || "";
		this.userId = null;
	}

	api(p, opts = {}) {
		return call("Jellyfin", `${this.url}/${p}`, { ...opts, headers: { Authorization: `MediaBrowser Client="Mediathek", Device="Mediathek", DeviceId="mediathek", Version="1", Token="${this.key}"`, ...(opts.headers || {}) } });
	}

	async user() {
		if (this.userId) return this.userId;
		const users = await this.api("Users");
		const u = (this.userName && users.find((x) => x.Name.toLowerCase() === this.userName.toLowerCase())) || users.find((x) => x.Policy && x.Policy.IsAdministrator) || users[0];
		this.userId = u ? u.Id : null;
		return this.userId;
	}

	// watched state per TMDB/TVDB id: 0 … 1
	async watched() {
		const uid = await this.user();
		const r = await this.api(`Items?userId=${uid}&Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds,RecursiveItemCount&EnableUserData=true&EnableImages=false`, { timeout: 30000 });
		const out = { tmdb: new Map(), tvdb: new Map(), imdb: new Map(), ids: new Map() };
		for (const it of r.Items || []) {
			const ud = it.UserData || {};
			let w;
			if (it.Type === "Series") {
				const total = it.RecursiveItemCount || 0;
				const left = ud.UnplayedItemCount ?? total;
				w = ud.Played ? 1 : total ? Math.max(0, Math.min(1, 1 - left / total)) : 0;
			} else w = ud.Played ? 1 : ud.PlayedPercentage ? ud.PlayedPercentage / 100 : 0;
			const entry = { watched: w, jellyfinId: it.Id, lastPlayed: ud.LastPlayedDate ? Date.parse(ud.LastPlayedDate) : null };
			const p = it.ProviderIds || {};
			if (p.Tmdb && it.Type === "Movie") out.tmdb.set(String(p.Tmdb), entry);
			if (p.Tvdb && it.Type === "Series") out.tvdb.set(String(p.Tvdb), entry);
			if (p.Imdb) out.imdb.set(String(p.Imdb), entry);
			out.ids.set(it.Id, entry);
		}
		return out;
	}

	// who's watching what: Jellyfin item id (the series for an episode) → user and device
	async playing() {
		const sessions = await this.api("Sessions?ActiveWithinSeconds=900");
		return sessions.filter((s) => s.NowPlayingItem).map((s) => ({ id: s.NowPlayingItem.SeriesId || s.NowPlayingItem.Id, user: s.UserName, device: s.DeviceName, paused: !!(s.PlayState && s.PlayState.IsPaused) }));
	}

	async refresh() {
		await this.api("Library/Refresh", { method: "POST" });
	}
}

// With user and password: Jellyfin hands out a token for this app (kept instead of the password)
async function tokenFromLogin(url, username, password) {
	const r = await call("Jellyfin", `${base(url)}/Users/AuthenticateByName`, {
		json: { Username: username, Pw: password },
		headers: { Authorization: `MediaBrowser Client="Mediathek", Device="Mediathek", DeviceId="mediathek", Version="1"` }
	}).catch((err) => {
		throw err.status === 401 ? new Error("Jellyfin: login failed – check user and password") : err;
	});
	if (!r || !r.AccessToken) throw new Error("Jellyfin: login failed – check user and password");
	return { token: r.AccessToken, user: (r.User && r.User.Name) || username };
}

module.exports = { Jellyfin, tokenFromLogin };
