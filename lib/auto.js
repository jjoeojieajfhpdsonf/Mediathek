"use strict";
// The automatic mode: rules that keep the server tidy, checked every 15 minutes.
//  seeded  – a finished torrent that has seeded enough goes, with its second copy (the title stays)
//  watched – a title watched to the end some days ago is deleted everywhere
//  space   – below a free-space limit, the watched titles go, longest ago first
//  stalled – a download without a complete source for hours: another release is searched
// Never touched: titles marked "keep", titles someone is watching or has started.
const fs = require("node:fs");
const path = require("node:path");

const DAY = 86400000;
const EVERY = 15 * 60000;
const DEFAULTS = {
	enabled: false,
	seeded: { on: true, ratio: 1, days: 14 },
	watched: { on: false, days: 30, movies: true, series: false },
	space: { on: false, minGB: 50 },
	stalled: { on: true, hours: 6 }
};
const num = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : d);

class Auto {
	constructor(media, config, dir) {
		this.media = media;
		this.config = config;
		this.logFile = path.join(dir, "auto-log.json");
		this.stalledSince = new Map();
		this.lastRun = null;
		try {
			this.log = JSON.parse(fs.readFileSync(this.logFile, "utf8"));
		} catch {
			this.log = [];
		}
	}

	rules() {
		const r = this.config.data.auto || {};
		return {
			enabled: !!r.enabled,
			seeded: { ...DEFAULTS.seeded, ...(r.seeded || {}) },
			watched: { ...DEFAULTS.watched, ...(r.watched || {}) },
			space: { ...DEFAULTS.space, ...(r.space || {}) },
			stalled: { ...DEFAULTS.stalled, ...(r.stalled || {}) }
		};
	}

	setRules(b) {
		const r = this.rules();
		this.config.data.auto = {
			enabled: b.enabled !== undefined ? !!b.enabled : r.enabled,
			seeded: { on: !!(b.seeded || r.seeded).on, ratio: num((b.seeded || {}).ratio, 0.1, 100, r.seeded.ratio), days: num((b.seeded || {}).days, 0, 365, r.seeded.days) },
			watched: { on: !!(b.watched || r.watched).on, days: num((b.watched || {}).days, 0, 3650, r.watched.days), movies: (b.watched || r.watched).movies !== false, series: !!(b.watched || r.watched).series },
			space: { on: !!(b.space || r.space).on, minGB: num((b.space || {}).minGB, 1, 100000, r.space.minGB) },
			stalled: { on: !!(b.stalled || r.stalled).on, hours: num((b.stalled || {}).hours, 1, 720, r.stalled.hours) }
		};
		this.config.save();
		return this.rules();
	}

	keep() {
		return new Set(this.config.data.keep || []);
	}
	setKeep(id, on) {
		const k = this.keep();
		on ? k.add(id) : k.delete(id);
		this.config.data.keep = [...k];
		this.config.save();
	}

	// what the next run would do – nothing is changed here
	async plan() {
		const r = this.rules();
		const [lib, tor] = await Promise.all([this.media.library(true), this.media.torrents().catch(() => null)]);
		const keep = this.keep();
		const now = Date.now();
		const out = [];
		const safe = (it) => it && !keep.has(it.id) && !(it.watching && it.watching.length) && !(it.watched > 0 && it.watched < 1);
		const byId = new Map(lib.items.map((it) => [it.id, it]));
		const gone = new Set();

		if (r.watched.on)
			for (const it of lib.items) {
				if (!safe(it) || it.watched < 1 || !it.lastPlayed) continue;
				if ((it.type === "movie" && !r.watched.movies) || (it.type === "series" && !r.watched.series)) continue;
				if (now - it.lastPlayed < r.watched.days * DAY) continue;
				out.push({ kind: "watched", id: it.id, title: it.title, why: `vor ${Math.floor((now - it.lastPlayed) / DAY)} Tagen fertig geschaut`, bytes: (it.size || 0) + (it.copy || 0) });
				gone.add(it.id);
			}

		if (r.space.on && lib.space && lib.space.free !== null) {
			let free = lib.space.free + out.reduce((a, x) => a + x.bytes, 0);
			const min = r.space.minGB * 1e9;
			const list = lib.items.filter((it) => safe(it) && it.watched >= 1 && !gone.has(it.id)).sort((a, b) => (a.lastPlayed || 0) - (b.lastPlayed || 0));
			for (const it of list) {
				if (free >= min) break;
				const bytes = (it.size || 0) + (it.copy || 0);
				out.push({ kind: "space", id: it.id, title: it.title, why: `weniger als ${r.space.minGB} GB frei · gesehen`, bytes });
				gone.add(it.id);
				free += bytes;
			}
		}

		if (tor) {
			const seen = new Set();
			for (const t of tor.torrents) {
				seen.add(t.hash);
				const it = t.item && byId.get(t.item);
				if (r.seeded.on && it && !gone.has(it.id) && t.done >= 1 && (t.state === "seed" || t.state === "done") && t.copy !== false) {
					const days = t.completed ? (now - t.completed) / DAY : (t.seedingTime || 0) / 86400;
					const enough = t.ratio >= r.seeded.ratio || (r.seeded.days > 0 && days >= r.seeded.days);
					if (enough && !keep.has(`torrent:${t.hash}`)) out.push({ kind: "seeded", hash: t.hash, title: t.title || t.name, why: t.ratio >= r.seeded.ratio ? `Ratio ${t.ratio}` : `${Math.floor(days)} Tage geteilt`, bytes: t.copy ? t.size : 0 });
				}
				if (t.state === "stalled") {
					if (!this.stalledSince.has(t.hash)) this.stalledSince.set(t.hash, now);
					const h = (now - this.stalledSince.get(t.hash)) / 3600000;
					const link = this.media.links.get(t.hash.toLowerCase());
					if (r.stalled.on && link && link.queueId && h >= r.stalled.hours) out.push({ kind: "stalled", hash: t.hash, title: t.title || t.name, why: `hängt seit ${Math.floor(h)} h`, bytes: 0 });
				} else this.stalledSince.delete(t.hash);
			}
			for (const h of this.stalledSince.keys()) if (!seen.has(h)) this.stalledSince.delete(h);
		}
		return out;
	}

	async run(force) {
		const r = this.rules();
		if (!r.enabled && !force) return [];
		this.lastRun = Date.now();
		const plan = await this.plan();
		const done = [];
		for (const a of plan) {
			const entry = { at: Date.now(), ...a };
			try {
				if (a.kind === "watched" || a.kind === "space") {
					const res = await this.media.removeEverywhere(a.id, true);
					const bad = res.steps.filter((s) => !s.ok);
					if (bad.length) throw new Error(bad.map((s) => `${s.service}: ${s.error}`).join(", "));
				} else if (a.kind === "seeded") await this.media.removeTorrent(a.hash, "copy");
				else if (a.kind === "stalled") {
					await this.media.replace(a.hash);
					this.stalledSince.delete(a.hash);
				}
				entry.ok = true;
			} catch (err) {
				entry.ok = false;
				entry.error = err.message;
			}
			done.push(entry);
		}
		if (done.length) {
			this.log = [...done.reverse(), ...this.log].slice(0, 200);
			fs.writeFileSync(this.logFile, JSON.stringify(this.log));
		}
		return done;
	}

	start() {
		const tick = () => this.run(false).catch((err) => console.error("auto:", err.message));
		this.timer = setInterval(tick, EVERY);
		this.timer.unref();
		setTimeout(tick, 60000).unref();
	}
}

module.exports = { Auto, DEFAULTS };
