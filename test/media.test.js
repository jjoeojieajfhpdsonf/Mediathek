"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { cleanName, Media } = require("../lib/media");
const { profileName } = require("../lib/arr");
const { Config } = require("../lib/config");
const { Auto } = require("../lib/auto");
const { clients } = require("../lib/demo");

test("release names become titles", () => {
	assert.strictEqual(cleanName("Dune.Part.Two.2024.1080p.BluRay.x265-GRP"), "Dune Part Two");
	assert.strictEqual(cleanName("The.Bear.S04E03.1080p.WEB.h264-ETHEL"), "The Bear");
	assert.strictEqual(cleanName("Some Movie 1080p WEB"), "Some Movie");
	assert.strictEqual(cleanName("Jurassic World Rebirth (2025) (1080p DS4K BluRay x265 10-bit HDR AAC 7.1) [WeSLeY].mkv"), "Jurassic World Rebirth");
	assert.strictEqual(cleanName("Eojjeolsuga Eobsda (2025) [1080p] [BluRay] [5.1] [YTS.BZ]"), "Eojjeolsuga Eobsda");
	assert.strictEqual(cleanName("2001.A.Space.Odyssey.1968.1080p.BluRay"), "2001 A Space Odyssey");
});

test("profile names carry quality and language", () => {
	assert.strictEqual(profileName("1080p", "de"), "Mediathek 1080p Deutsch");
	assert.strictEqual(profileName("4k", "orig"), "Mediathek 4K Original");
	assert.strictEqual(profileName("720p", "xx"), "Mediathek 720p Deutsch");
});

test("settings keep secrets on the server", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-"));
	const c = new Config(dir);
	c.update({ radarr: { url: "192.168.0.31:7878", apiKey: "abc" } });
	assert.strictEqual(c.get("radarr").url, "http://192.168.0.31:7878");
	assert.deepStrictEqual(c.view().radarr.apiKey, { set: true });
	assert.ok(!JSON.stringify(c.view()).includes("abc"));
	// empty keeps the key, "-" removes it
	c.update({ radarr: { apiKey: "" } });
	assert.strictEqual(c.get("radarr").apiKey, "abc");
	c.update({ radarr: { apiKey: "-" } });
	assert.strictEqual(c.get("radarr").apiKey, "");
	assert.strictEqual((fs.statSync(path.join(dir, "config.json")).mode & 0o777).toString(8), "600");
});

test("the library joins Radarr, Sonarr, Jellyfin and qBittorrent", async () => {
	const m = new Media(clients());
	const lib = await m.library(true);
	const avatar = lib.items.find((x) => x.title === "Avatar: Fire and Ash");
	assert.ok(avatar.watched > 0 && avatar.watched < 1);
	assert.strictEqual(avatar.watching[0].user, "Alex");
	assert.strictEqual(avatar.torrents.length, 1);
	const tor = await m.torrents();
	assert.ok(tor.torrents.every((t) => t.title));
	assert.ok(tor.torrents.find((t) => t.item === avatar.id));
});

test("automatic mode plans, never touches kept or started titles", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-"));
	const m = new Media(clients());
	const c = new Config(dir);
	const a = new Auto(m, c, dir);
	a.setRules({ enabled: true, seeded: { on: true, ratio: 1, days: 0 }, watched: { on: true, days: 0, movies: true, series: true }, space: { on: false }, stalled: { on: false } });
	let plan = await a.plan();
	assert.ok(plan.some((x) => x.kind === "watched" && x.title === "Jurassic World Rebirth"));
	assert.ok(!plan.some((x) => x.title === "Avatar: Fire and Ash" && x.kind === "watched"), "started titles stay");
	a.setKeep("movie-2", true);
	plan = await a.plan();
	assert.ok(!plan.some((x) => x.id === "movie-2"), "kept titles stay");
	const done = await a.run(false);
	assert.ok(done.length > 0 && done.every((x) => x.ok));
	assert.ok(fs.existsSync(path.join(dir, "auto-log.json")));
});
