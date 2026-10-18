"use strict";
// Where the services are and how to log in. Kept in DATA_DIR/config.json (mode 600); environment
// variables fill in what isn't set there. Secrets never go back to the browser – only whether they're set.
const fs = require("node:fs");
const path = require("node:path");

const FIELDS = {
	radarr: ["url", "apiKey"],
	sonarr: ["url", "apiKey"],
	qbittorrent: ["url", "username", "password"],
	jellyfin: ["url", "apiKey", "user"]
};
const SECRET = new Set(["apiKey", "password"]);
const ENV = (svc, key) => process.env[`${svc.toUpperCase()}_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`];

class Config {
	constructor(dir) {
		this.file = path.join(dir, "config.json");
		fs.mkdirSync(dir, { recursive: true });
		try {
			this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
		} catch {
			this.data = {};
		}
	}

	// the settings of one service: saved values, else the environment
	get(svc) {
		const saved = this.data[svc] || {};
		const out = {};
		for (const k of FIELDS[svc]) out[k] = saved[k] !== undefined && saved[k] !== "" ? saved[k] : ENV(svc, k) || "";
		return out;
	}

	configured(svc) {
		const c = this.get(svc);
		return !!(c.url && (svc === "qbittorrent" || c.apiKey));
	}

	// for the settings form: values, but secrets only as "set"
	view() {
		const out = {};
		for (const svc of Object.keys(FIELDS)) {
			const c = this.get(svc);
			out[svc] = {};
			for (const k of FIELDS[svc]) out[svc][k] = SECRET.has(k) ? (c[k] ? { set: true } : { set: false }) : c[k];
		}
		out.downloadsMap = this.downloadsMap();
		return out;
	}

	// an empty secret keeps the old one; "-" removes it
	update(body) {
		for (const svc of Object.keys(FIELDS)) {
			if (!body[svc]) continue;
			const cur = (this.data[svc] = this.data[svc] || {});
			for (const k of FIELDS[svc]) {
				let v = body[svc][k];
				if (v === undefined || v === null) continue;
				v = String(v).trim();
				if (SECRET.has(k)) {
					if (v === "") continue;
					if (v === "-") v = "";
				}
				if (k === "url" && v && !/^https?:\/\//i.test(v)) v = `http://${v}`;
				cur[k] = v;
			}
		}
		if (typeof body.downloadsMap === "string") this.data.downloadsMap = body.downloadsMap.trim();
		this.save();
	}

	// "/downloads=/media/downloads": how qBittorrent's paths look inside this container
	downloadsMap() {
		const v = this.data.downloadsMap !== undefined ? this.data.downloadsMap : process.env.DOWNLOADS_MAP || "";
		return v;
	}

	save() {
		fs.writeFileSync(this.file, JSON.stringify(this.data, null, "\t"), { mode: 0o600 });
	}
}

module.exports = { Config, FIELDS };
