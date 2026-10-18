"use strict";
// Finds the services on the usual ports, on the machine the app was opened through and on this
// one – only to fill in the addresses; nothing needs a key for this.
const { base } = require("./http");

const PROBES = {
	radarr: { ports: [7878], check: (t) => /radarr/i.test(t) },
	sonarr: { ports: [8989], check: (t) => /sonarr/i.test(t) },
	qbittorrent: { ports: [8080, 8082, 8090, 8081, 8085], check: (t) => /qbittorrent/i.test(t) },
	jellyfin: { ports: [8096, 8920], path: "/System/Info/Public", check: (t) => /jellyfin/i.test(t) }
};

async function look(url, path, check) {
	try {
		const r = await fetch(`${url}${path || "/"}`, { signal: AbortSignal.timeout(2500), redirect: "follow" });
		return check(await r.text());
	} catch {
		return false;
	}
}

// hosts: where to look, in order of preference (the address the browser used reads best)
async function detect(hosts) {
	hosts = [...new Set(hosts.filter(Boolean))];
	const out = {};
	await Promise.all(
		Object.entries(PROBES).map(async ([svc, p]) => {
			for (const host of hosts)
				for (const port of p.ports) {
					const url = base(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`);
					if (await look(url, p.path, p.check)) return (out[svc] = url);
				}
			out[svc] = null;
		})
	);
	return out;
}

module.exports = { detect };
