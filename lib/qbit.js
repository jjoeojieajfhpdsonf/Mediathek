"use strict";
// qBittorrent Web API: torrents with their state, details and files, and what can be done with
// them. Logs in when a user is set (the session cookie is kept and renewed on 403).
const { call, base, ServiceError } = require("./http");

// qBittorrent's states → the few the app shows
const STATE = {
	downloading: "down",
	forcedDL: "down",
	metaDL: "meta",
	forcedMetaDL: "meta",
	stalledDL: "stalled",
	queuedDL: "queued",
	checkingDL: "checking",
	checkingUP: "checking",
	checkingResumeData: "checking",
	moving: "checking",
	pausedDL: "paused",
	stoppedDL: "paused",
	uploading: "seed",
	forcedUP: "seed",
	stalledUP: "seed",
	queuedUP: "seed",
	pausedUP: "done",
	stoppedUP: "done",
	error: "error",
	missingFiles: "error",
	unknown: "error"
};

class Qbit {
	constructor(cfg) {
		this.url = base(cfg.url);
		this.user = cfg.username;
		this.pass = cfg.password;
		this.sid = null;
		this.v5 = null;
	}

	async login() {
		if (!this.user) return;
		const res = await call("qBittorrent", `${this.url}/api/v2/auth/login`, { form: { username: this.user, password: this.pass || "" }, headers: { Referer: this.url, Origin: this.url }, raw: true });
		const text = await res.text();
		// the session cookie is "SID" up to qBittorrent 4, "QBT_SID_<port>" from version 5
		const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
		const cookie = all.map((c) => c.split(";")[0]).find((c) => /^(QBT_)?SID[^=]*=/.test(c));
		// wrong login: 200 "Fails." (older) or 401 (newer); too many tries: 403
		if (res.status === 403) throw new ServiceError("qBittorrent", "blocks this address after too many failed logins – wait a while", 403);
		if (res.status === 401 || /fails/i.test(text) || !cookie) throw new ServiceError("qBittorrent", "login failed – check user and password", res.status);
		this.sid = cookie;
	}

	async api(p, opts = {}, retry = true) {
		if (this.user && !this.sid) await this.login();
		try {
			return await call("qBittorrent", `${this.url}/api/v2/${p}`, { ...opts, headers: { Referer: this.url, ...(this.sid ? { Cookie: this.sid } : {}), ...(opts.headers || {}) } });
		} catch (err) {
			if (retry && err.status === 403 && this.user) {
				this.sid = null;
				return this.api(p, opts, false);
			}
			throw err;
		}
	}

	// v5 renamed pause/resume to stop/start
	async isV5() {
		if (this.v5 === null) this.v5 = /^v?5\./.test(String(await this.api("app/version").catch(() => "")));
		return this.v5;
	}

	async torrents() {
		const [list, transfer, slow] = await Promise.all([this.api("torrents/info"), this.api("transfer/info").catch(() => null), this.api("transfer/speedLimitsMode").catch(() => null)]);
		return {
			down: transfer ? transfer.dl_info_speed : list.reduce((a, t) => a + t.dlspeed, 0),
			up: transfer ? transfer.up_info_speed : list.reduce((a, t) => a + t.upspeed, 0),
			slow: String(slow) === "1",
			torrents: list.map(torrent)
		};
	}

	async details(hash) {
		const [props, files, trackers] = await Promise.all([this.api(`torrents/properties?hash=${hash}`), this.api(`torrents/files?hash=${hash}`), this.api(`torrents/trackers?hash=${hash}`).catch(() => [])]);
		return {
			addedOn: props.addition_date ? props.addition_date * 1000 : null,
			completedOn: props.completion_date > 0 ? props.completion_date * 1000 : null,
			savePath: props.save_path,
			seeds: props.seeds,
			seedsTotal: props.seeds_total,
			peers: props.peers,
			peersTotal: props.peers_total,
			ratio: props.share_ratio,
			seedingTime: props.seeding_time || 0,
			uploaded: props.total_uploaded,
			downloaded: props.total_downloaded,
			tracker: (trackers.find((t) => /^https?:|^udp:/.test(t.url) && t.status === 2) || trackers.find((t) => /^https?:|^udp:/.test(t.url)) || {}).url || null,
			files: files.map((f) => ({ name: f.name, size: f.size, progress: f.progress }))
		};
	}

	async pause(hashes) {
		await this.api((await this.isV5()) ? "torrents/stop" : "torrents/pause", { form: { hashes } });
	}
	async resume(hashes) {
		await this.api((await this.isV5()) ? "torrents/start" : "torrents/resume", { form: { hashes } });
	}
	async remove(hashes, deleteFiles) {
		await this.api("torrents/delete", { form: { hashes, deleteFiles: deleteFiles ? "true" : "false" } });
	}
	async recheck(hash) {
		await this.api("torrents/recheck", { form: { hashes: hash } });
	}
	// first in the queue (works when queueing is on), and asked for first pieces
	async first(hash) {
		await this.api("torrents/topPrio", { form: { hashes: hash } }).catch(() => null);
		await this.api("torrents/setForceStart", { form: { hashes: hash, value: "true" } });
	}
	async toggleSlow() {
		await this.api("transfer/toggleSpeedLimitsMode", { form: {} });
	}
}

function torrent(t) {
	return {
		hash: t.hash,
		name: t.name,
		state: STATE[t.state] || "error",
		raw: t.state,
		size: t.size || t.total_size || 0,
		done: t.progress,
		down: t.dlspeed,
		up: t.upspeed,
		eta: t.eta > 0 && t.eta < 8640000 ? t.eta : null,
		seeds: t.num_seeds,
		seedsAll: t.num_complete,
		peers: t.num_leechs,
		peersAll: t.num_incomplete,
		ratio: Math.round((t.ratio || 0) * 100) / 100,
		category: t.category || null,
		added: t.added_on ? t.added_on * 1000 : null,
		completed: t.completion_on > 0 ? t.completion_on * 1000 : null,
		seedingTime: t.seeding_time || 0,
		contentPath: t.content_path || null,
		savePath: t.save_path || null
	};
}

module.exports = { Qbit, STATE };
