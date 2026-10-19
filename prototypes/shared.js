// Made-up data and the flows all three prototypes share: adding (Radarr or Sonarr, picked by
// itself) and deleting everywhere at once (Radarr/Sonarr, qBittorrent, Jellyfin).

const GB = 1;
const DISK = { total: 232, used: 106, movies: 50, series: 0, downloads: 31, dup: 31 };

// what's on the server
const LIBRARY = [
	{ id: "avatar", type: "movie", title: "Avatar: Fire and Ash", year: 2025, poster: "posters/avatar.jpg", size: 11.8, added: "2026-05-21", watched: 0.34, watching: "admin", torrent: { ratio: 0.42, seeding: true, copy: true }, quality: "1080p · x265 · HDR", runtime: "3 h 17 min" },
	{ id: "jurassic", type: "movie", title: "Jurassic World Rebirth", year: 2025, poster: "posters/jurassic.jpg", size: 8.4, added: "2026-05-23", watched: 1, torrent: { ratio: 1.8, seeding: true, copy: true }, quality: "1080p · x265 · HDR", runtime: "2 h 14 min" },
	{ id: "inception", type: "movie", title: "Inception", year: 2010, poster: "posters/inception.jpg", size: 14.6, added: "2026-05-21", watched: 1, torrent: { ratio: 2.4, seeding: false, copy: true }, quality: "1080p · Blu-ray", runtime: "2 h 28 min" },
	{ id: "mario", type: "movie", title: "The Super Mario Galaxy Movie", year: 2026, poster: "posters/mario.jpg", size: 3.1, added: "2026-10-12", watched: 0, torrent: { ratio: 0.1, seeding: true, copy: true }, quality: "1080p · WEB", runtime: "1 h 38 min" },
	{ id: "nochoice", type: "movie", title: "No Other Choice", year: 2025, colors: ["#3d5a6c", "#1b2a33"], size: 2.2, added: "2026-09-30", watched: 0, torrent: null, quality: "1080p · Blu-ray", runtime: "2 h 19 min" },
	{ id: "severance", type: "series", title: "Severance", year: 2022, colors: ["#2f6f8f", "#0f2430"], size: 38.5, added: "2026-03-02", watched: 0.7, seasons: [{ n: 1, have: 9, of: 9 }, { n: 2, have: 10, of: 10 }], torrent: { ratio: 1.1, seeding: true, copy: true }, quality: "1080p · WEB" },
	{ id: "bear", type: "series", title: "The Bear", year: 2022, colors: ["#8a3b2e", "#2a120e"], size: 21.2, added: "2026-06-26", watched: 0.25, seasons: [{ n: 1, have: 8, of: 8 }, { n: 2, have: 10, of: 10 }, { n: 3, have: 10, of: 10 }, { n: 4, have: 3, of: 10 }], torrent: { ratio: 0.6, seeding: true, copy: true }, quality: "1080p · WEB", next: "S4 · E4 morgen" }
];

// what a search finds (as TMDB would), movies and series mixed
const CATALOG = [
	{ id: "dune2", type: "movie", title: "Dune: Part Two", year: 2024, colors: ["#b9853f", "#3a2410"], rating: 8.1, runtime: "2 h 46 min", about: "Paul Atreides verbündet sich mit den Fremen und stellt sich dem Haus Harkonnen." },
	{ id: "dune1", type: "movie", title: "Dune", year: 2021, colors: ["#9a7a52", "#2b2014"], rating: 7.8, runtime: "2 h 35 min", about: "Der erste Teil: die Familie Atreides übernimmt den Wüstenplaneten Arrakis." },
	{ id: "duneprophecy", type: "series", title: "Dune: Prophecy", year: 2024, colors: ["#6c5a3a", "#1f190f"], rating: 7.1, seasons: 1, about: "10 000 Jahre vor Paul: die Anfänge der Bene Gesserit." },
	{ id: "oppenheimer", type: "movie", title: "Oppenheimer", year: 2023, colors: ["#a2512a", "#1d0e08"], rating: 8.1, runtime: "3 h 0 min", about: "Die Geschichte des Physikers hinter dem Manhattan-Projekt." },
	{ id: "interstellar", type: "movie", title: "Interstellar", year: 2014, colors: ["#34465a", "#0b1016"], rating: 8.4, runtime: "2 h 49 min", about: "Eine Crew sucht hinter einem Wurmloch eine neue Heimat für die Menschheit." },
	{ id: "andor", type: "series", title: "Andor", year: 2022, colors: ["#4b4f57", "#121316"], rating: 8.4, seasons: 2, about: "Wie aus einem Dieb ein Rebell wird – fünf Jahre vor Rogue One." },
	{ id: "shogun", type: "series", title: "Shōgun", year: 2024, colors: ["#7b2b2b", "#1c0a0a"], rating: 8.6, seasons: 1, about: "Ein englischer Seefahrer strandet 1600 in Japan, mitten im Machtkampf." },
	{ id: "slowhorses", type: "series", title: "Slow Horses", year: 2022, colors: ["#4f5b3a", "#14170e"], rating: 8.1, seasons: 5, about: "Ausgemusterte Agenten des MI5 stolpern in echte Fälle." },
	{ id: "tlou", type: "series", title: "The Last of Us", year: 2023, colors: ["#3e5a40", "#0f1810"], rating: 8.6, seasons: 2, about: "Joel bringt Ellie quer durch ein zerstörtes Amerika." },
	{ id: "sinners", type: "movie", title: "Sinners", year: 2025, colors: ["#6b2f3f", "#1c0c10"], rating: 7.6, runtime: "2 h 17 min", about: "Zwei Brüder kehren 1932 nach Mississippi zurück – und etwas folgt ihnen." },
	{ id: "mickey17", type: "movie", title: "Mickey 17", year: 2025, colors: ["#3a4f6b", "#0e131c"], rating: 6.8, runtime: "2 h 17 min", about: "Ein Wegwerf-Arbeiter auf einer Eiswelt wird nach jedem Tod neu gedruckt." },
	{ id: "superman", type: "movie", title: "Superman", year: 2025, colors: ["#2d4c8f", "#0c1428"], rating: 7.2, runtime: "2 h 9 min", about: "Clark Kent zwischen Kansas und Metropolis." },
	// already there – a search shows it as "in der Bibliothek"
	{ id: "avatar", type: "movie", title: "Avatar: Fire and Ash", year: 2025 },
	{ id: "inception", type: "movie", title: "Inception", year: 2010 },
	{ id: "severance", type: "series", title: "Severance", year: 2022 }
];

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const gb = (n) => `${n.toLocaleString("de-CH", { maximumFractionDigits: 1 })} GB`;
const inLibrary = (id) => LIBRARY.find((x) => x.id === id);
const typeTag = (x) => `<span class="tag ${x.type}">${x.type === "movie" ? "Film" : "Serie"}</span>`;
const appOf = (x) => (x.type === "movie" ? "Radarr" : "Sonarr");
const ago = (iso) => {
	const d = Math.round((Date.parse("2026-10-18") - Date.parse(iso)) / 864e5);
	return d < 1 ? "heute" : d === 1 ? "gestern" : d < 30 ? `vor ${d} Tagen` : d < 60 ? "vor einem Monat" : `vor ${Math.round(d / 30)} Monaten`;
};
const seen = (x) => (x.watched >= 1 ? "gesehen" : x.watched > 0 ? `${Math.round(x.watched * 100)} % gesehen` : "nicht gesehen");
// what deleting frees: the library file, plus the copy in the downloads folder while the torrent is there
const freedBy = (x) => x.size + (x.torrent && x.torrent.copy ? x.size : 0);

function posterHtml(x, extra = "") {
	const p = x.poster ? `style="background-image:url('${x.poster}')"` : `style="background-image:linear-gradient(160deg, ${(x.colors || ["#333", "#111"]).join(", ")})"`;
	return `<div class="poster ${x.poster ? "" : "ph"}" ${p}>${x.poster ? "" : esc(x.title)}${extra}</div>`;
}

function toast(msg) {
	document.querySelectorAll(".toast").forEach((t) => t.remove());
	const t = document.createElement("div");
	t.className = "toast";
	t.innerHTML = msg;
	document.body.append(t);
	setTimeout(() => t.remove(), 2600);
}

function modal(html) {
	const scrim = document.createElement("div");
	scrim.className = "scrim";
	scrim.innerHTML = `<div class="modal">${html}</div>`;
	const close = () => scrim.remove();
	scrim.addEventListener("click", (e) => e.target === scrim && close());
	document.addEventListener("keydown", function esc(e) {
		if (e.key === "Escape") close(), document.removeEventListener("keydown", esc);
	});
	document.body.append(scrim);
	return { el: scrim.firstChild, close };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deleting one or more titles: what happens where, then done step by step.
function deleteFlow(items, onDone) {
	items = [].concat(items);
	const one = items.length === 1 ? items[0] : null;
	const lib = items.reduce((a, x) => a + x.size, 0);
	const copies = items.reduce((a, x) => a + (x.torrent && x.torrent.copy ? x.size : 0), 0);
	const apps = [...new Set(items.map(appOf))].join(" + ");
	const torrents = items.filter((x) => x.torrent).length;
	const m = modal(`
		<div class="head">${one ? posterHtml(one) : ""}<div><h3>${one ? `${esc(one.title)} löschen?` : `${items.length} Titel löschen?`}</h3>
			<div class="sm muted" style="margin-top:4px">${one ? `${one.year} · ${one.type === "movie" ? "Film" : `Serie · ${one.seasons.length} Staffeln`} · ${seen(one)}` : items.map((x) => esc(x.title)).join(", ")}</div></div></div>
		<div class="steps">
			<div class="step" data-s="0"><span class="ic" style="background:rgba(255,194,48,.12);color:var(--movie)">${apps.includes("Sonarr") && !apps.includes("Radarr") ? "S" : "R"}</span><div class="grow"><div class="t">${apps}</div><div class="s">Aus der Bibliothek, mit Dateien · ${gb(lib)}</div></div><span class="st"></span></div>
			<div class="step" data-s="1"><span class="ic" style="background:rgba(157,188,255,.12);color:var(--accent)">qB</span><div class="grow"><div class="t">qBittorrent</div><div class="s">${torrents ? `${torrents === 1 ? "Torrent" : `${torrents} Torrents`} entfernen, Kopie in Downloads · ${gb(copies)}` : "Kein Torrent mehr vorhanden"}</div></div><span class="st"></span></div>
			<div class="step" data-s="2"><span class="ic" style="background:rgba(169,92,224,.14);color:#c38cf0">J</span><div class="grow"><div class="t">Jellyfin</div><div class="s">Bibliothek neu einlesen</div></div><span class="st"></span></div>
		</div>
		<label class="check"><input type="checkbox" checked> Nicht wieder automatisch hinzufügen</label>
		<div class="freed"><span class="muted">Wird frei</span><b class="num">${gb(lib + copies)}</b></div>
		<div class="acts"><button class="btn" data-x>Abbrechen</button><button class="btn solid-danger" data-go>Überall löschen</button></div>`);
	$("[data-x]", m.el).onclick = m.close;
	$("[data-go]", m.el).onclick = async (e) => {
		e.currentTarget.disabled = true;
		$("[data-x]", m.el).style.visibility = "hidden";
		for (const i of [0, 1, 2]) {
			const s = $(`[data-s="${i}"]`, m.el);
			s.classList.add("run");
			$(".st", s).textContent = "läuft …";
			await sleep(650);
			s.classList.replace("run", "done");
			$(".st", s).textContent = "✓ erledigt";
		}
		await sleep(400);
		m.close();
		for (const x of items) LIBRARY.splice(LIBRARY.indexOf(x), 1);
		DISK.used -= lib + copies;
		DISK.dup -= copies;
		toast(`${one ? esc(one.title) : `${items.length} Titel`} gelöscht · ${gb(lib + copies)} frei`);
		onDone && onDone();
	};
}

// Adding: Radarr for a movie, Sonarr for a series – the user doesn't have to care which.
function addFlow(x, onDone) {
	const series = x.type === "series";
	const m = modal(`
		<div class="head">${posterHtml(x)}<div><h3>${esc(x.title)}</h3><div class="sm muted" style="margin-top:4px">${[x.year, series ? `Serie${x.seasons ? ` · ${x.seasons} ${x.seasons === 1 ? "Staffel" : "Staffeln"}` : ""}` : `Film${x.runtime ? ` · ${x.runtime}` : ""}`, x.rating ? `★ ${x.rating}` : ""].filter(Boolean).join(" · ")}</div>
		<div class="sm faint" style="margin-top:8px">${esc(x.about)}</div></div></div>
		<div class="field"><label>Sprache</label><div class="seg" data-l><button class="on">Deutsch</button><button>Englisch</button><button>Deutsch + Englisch</button><button>Original</button></div></div>
		<div class="field"><label>Qualität</label><div class="seg" data-q><button>720p</button><button class="on">1080p</button><button>4K</button></div></div>
		${series ? `<div class="field"><label>Was laden?</label><div class="seg" data-w><button class="on">Alle Staffeln</button><button>Nur Staffel 1</button><button>Nur Neue</button></div></div>` : ""}
		<div class="sm faint" style="margin-top:14px">Geht an ${appOf(x)} · sucht sofort über Prowlarr · Sprache und Qualität werden gemerkt</div>
		<div class="acts"><button class="btn" data-x>Abbrechen</button><button class="btn primary" data-go>Hinzufügen</button></div>`);
	m.el.querySelectorAll(".seg").forEach((seg) => seg.addEventListener("click", (e) => {
		if (e.target.tagName !== "BUTTON") return;
		seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
	}));
	$("[data-x]", m.el).onclick = m.close;
	$("[data-go]", m.el).onclick = () => {
		m.close();
		const size = series ? 6.5 * (x.seasons || 1) : 6.8;
		x = { ...x, about: undefined, have: false };
		LIBRARY.unshift({ ...x, size, added: "2026-10-18", watched: 0, torrent: { ratio: 0, seeding: false, copy: true }, quality: "1080p", downloading: 0, seasons: series ? Array.from({ length: x.seasons }, (_, i) => ({ n: i + 1, have: 0, of: 8 })) : undefined });
		toast(`${esc(x.title)} hinzugefügt – ${appOf(x)} sucht …`);
		// a moment later the search found a release and qBittorrent starts
		TORRENTS.unshift({ id: `t-${x.id}`, lib: x.id, name: releaseName(x), state: "meta", size: size, done: 0, down: 0, up: 0, seeds: 0, peers: 0, ratio: 0, indexer: "1337x", added: "gerade eben", category: series ? "sonarr" : "radarr" });
		onDone && onDone();
		setTimeout(() => {
			const t = TORRENTS.find((t) => t.id === `t-${x.id}`);
			if (t && t.state === "meta") Object.assign(t, { state: "down", seeds: 64, peers: 9 });
		}, 1800);
	};
}

function protoNav(on) {
	const n = document.createElement("nav");
	n.className = "proto-nav";
	n.innerHTML = [["d.html", "D · Kombiniert"], ["a.html", "A · Suche"], ["b.html", "B · Poster-Wand"], ["c.html", "C · Aufräumen"], ["e.html", "E · Radarr-Stil"], ["f.html", "F · E modern"]].map(([h, l]) => `<a href="${h}" class="${h === on ? "on" : ""}">${l}</a>`).join("");
	document.body.append(n);
}

// ---------- qBittorrent: what's loading and seeding, with details and controls ----------

const QB = { limit: false, paused: false };
const releaseName = (x) => `${x.title.replace(/[^\w ]/g, "").replace(/ +/g, ".")}.${x.year}.1080p.WEB-DL.x265-GRP`;
// size in GB, speeds in MB/s
const TORRENTS = [
	{ id: "t-dune2", lib: null, title: "Dune: Part Two", name: "Dune.Part.Two.2024.1080p.BluRay.x265.10bit-GRP", state: "down", size: 9.8, done: 0.43, down: 12.4, up: 0.6, seeds: 84, peers: 12, ratio: 0.02, indexer: "1337x", added: "vor 4 min", category: "radarr", files: [["Dune.Part.Two.2024.1080p.mkv", 9.7], ["Subs/German.srt", 0.0001], ["Sample/sample.mkv", 0.08]] },
	{ id: "t-bear", lib: "bear", name: "The.Bear.S04E03.1080p.WEB.h264-ETHEL", state: "stalled", size: 1.4, done: 0.71, down: 0, up: 0, seeds: 0, peers: 2, ratio: 0, indexer: "EZTV", added: "vor 2 h", category: "sonarr", files: [["The.Bear.S04E03.1080p.mkv", 1.4]] },
	{ id: "t-jurassic", lib: "jurassic", name: "Jurassic.World.Rebirth.2025.1080p.UHD.BluRay.x265-WeSLeY", state: "seed", size: 8.4, done: 1, down: 0, up: 1.2, seeds: 31, peers: 6, ratio: 1.8, indexer: "1337x", added: "vor 5 Monaten", category: "radarr" },
	{ id: "t-avatar", lib: "avatar", name: "Avatar.Fire.and.Ash.2025.Hybrid.1080p.UHD.BluRay.DV.HDR10P.x265-NeoNoir", state: "seed", size: 11.8, done: 1, down: 0, up: 0.4, seeds: 112, peers: 20, ratio: 0.42, indexer: "1337x", added: "vor 5 Monaten", category: "radarr" },
	{ id: "t-inception", lib: "inception", name: "Inception.2010.1080p.BluRay.DTS-HD.MA-Soup", state: "paused", size: 14.6, done: 1, down: 0, up: 0, seeds: 0, peers: 0, ratio: 2.4, indexer: "YTS", added: "vor 5 Monaten", category: "radarr" },
	{ id: "t-mario", lib: "mario", name: "The.Super.Mario.Galaxy.Movie.2026.1080p.WEBRip.x265-RMTeam", state: "seed", size: 3.1, done: 1, down: 0, up: 0.2, seeds: 48, peers: 3, ratio: 0.1, indexer: "1337x", added: "vor 6 Tagen", category: "radarr" },
	{ id: "t-severance", lib: "severance", name: "Severance.S02.1080p.ATVP.WEB-DL.DDP5.1.H.264-FLUX", state: "seed", size: 38.5, done: 1, down: 0, up: 0.8, seeds: 22, peers: 4, ratio: 1.1, indexer: "EZTV", added: "vor 7 Monaten", category: "sonarr" }
];
const STATE = {
	meta: ["Sucht Quellen …", "var(--muted)"],
	down: ["Lädt", "var(--accent)"],
	stalled: ["Hängt – keine Quellen", "var(--warn)"],
	seed: ["Seeding", "var(--ok)"],
	paused: ["Pausiert", "var(--faint)"],
	done: ["Fertig", "var(--ok)"]
};
const mbs = (v) => `${v.toLocaleString("de-CH", { maximumFractionDigits: 1 })} MB/s`;
const eta = (t) => {
	if (t.state !== "down" || !t.down) return "";
	const s = ((1 - t.done) * t.size * 1000) / t.down;
	return s < 60 ? "unter 1 min" : s < 3600 ? `noch ${Math.round(s / 60)} min` : `noch ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};
const totals = () => ({ down: TORRENTS.reduce((a, t) => a + (QB.paused ? 0 : t.down), 0), up: TORRENTS.reduce((a, t) => a + (QB.paused ? 0 : t.up), 0), loading: TORRENTS.filter((t) => ["down", "stalled", "meta"].includes(t.state)).length, seeding: TORRENTS.filter((t) => t.state === "seed").length });
const titleOfTorrent = (t) => {
	const lib = t.lib && inLibrary(t.lib);
	if (lib) return lib.title;
	if (t.title) return t.title;
	return t.name.replace(/\.(19|20)\d\d\..*$/, "").replace(/\.S\d\d.*$/, "").replace(/\./g, " ");
};

// one torrent as a row: name, state, progress; actions on the right
function torrentRow(t, opts = {}) {
	const [label, color] = STATE[t.state];
	const sub = t.state === "down" ? `${mbs(t.down)} · ${eta(t)} · ${t.seeds} Quellen` : t.state === "seed" ? `↑ ${mbs(t.up)} · Ratio ${t.ratio}` : t.state === "stalled" ? `${Math.round(t.done * 100)} % · ${t.peers} Peers, keine vollständige Quelle` : t.state === "paused" ? `Ratio ${t.ratio}` : "";
	return `<div class="tor" data-tor="${t.id}">
		<div class="tor-main"><div class="tor-t"><span class="tor-name">${esc(titleOfTorrent(t))}</span>${t.category ? `<span class="tag ${t.category === "radarr" ? "movie" : "series"}">${t.category === "radarr" ? "Film" : "Serie"}</span>` : ""}</div>
			<div class="tor-s"><span style="color:${color}">${label}</span>${sub ? ` · ${sub}` : ""}</div>
			${t.done < 1 ? `<div class="bar" style="height:4px;margin-top:7px"><i style="width:${(t.done * 100).toFixed(1)}%;background:${color}"></i></div>` : ""}</div>
		${opts.compact ? "" : `<span class="tor-size num">${gb(t.size)}</span>`}
		<button class="tor-btn" data-toggle="${t.id}" title="${t.state === "paused" ? "Fortsetzen" : "Pausieren"}">${t.state === "paused" ? "▶" : "❚❚"}</button>
		<button class="tor-btn" data-detail="${t.id}" title="Details">⋯</button>
	</div>`;
}

// the head of a qBittorrent box: speeds and the global switches
function qbHead() {
	const s = totals();
	return `<div class="qb-head"><div class="qb-speed"><span><b class="num">↓ ${mbs(s.down)}</b></span><span class="muted num">↑ ${mbs(s.up)}</span><span class="faint">${s.loading} lädt · ${s.seeding} teilt</span></div>
		<div class="qb-acts"><button class="chip-btn ${QB.limit ? "on" : ""}" data-qb="limit" title="Langsam: 5 MB/s ↓ · 1 MB/s ↑">🐢 Langsam</button><button class="chip-btn ${QB.paused ? "on" : ""}" data-qb="pause">${QB.paused ? "▶ Alle fortsetzen" : "❚❚ Alle pausieren"}</button></div></div>`;
}

// wire up the buttons inside an element that shows torrents
function bindTorrents(el, rerender) {
	el.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = (e) => {
		e.stopPropagation();
		const t = TORRENTS.find((x) => x.id === b.dataset.toggle);
		t.state = t.state === "paused" ? (t.done < 1 ? "down" : "seed") : "paused";
		if (t.state === "paused") (t.down = 0), (t.up = 0);
		else if (t.state === "down") (t.down = 9), (t.seeds = t.seeds || 40);
		else t.up = 0.5;
		rerender();
	}));
	el.querySelectorAll("[data-detail]").forEach((b) => (b.onclick = (e) => (e.stopPropagation(), torrentDetail(TORRENTS.find((x) => x.id === b.dataset.detail), rerender))));
	el.querySelectorAll("[data-tor]").forEach((r) => (r.onclick = () => torrentDetail(TORRENTS.find((x) => x.id === r.dataset.tor), rerender)));
	el.querySelectorAll("[data-qb]").forEach((b) => (b.onclick = () => {
		if (b.dataset.qb === "limit") (QB.limit = !QB.limit), toast(QB.limit ? "Langsam-Modus an: 5 MB/s ↓ · 1 MB/s ↑" : "Volle Geschwindigkeit");
		else (QB.paused = !QB.paused), toast(QB.paused ? "Alle Torrents pausiert" : "Alle Torrents laufen wieder");
		rerender();
	}));
}

// everything about one torrent, and what can be done with it
function torrentDetail(t, rerender) {
	if (!t) return;
	const [label, color] = STATE[t.state];
	const lib = t.lib && inLibrary(t.lib);
	const files = t.files || [[`${t.name}.mkv`, t.size]];
	const m = modal(`
		<div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><h3>${esc(titleOfTorrent(t))}</h3><div class="sm faint" style="margin-top:4px;word-break:break-all">${esc(t.name)}</div></div></div>
		<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:${color};font-weight:600">${label}</span><span class="num muted">${(t.done * 100).toFixed(1)} % von ${gb(t.size)}</span></div>
			<div class="bar" style="margin-top:7px"><i style="width:${t.done * 100}%;background:${color}"></i></div></div>
		<div class="kv-grid">
			<div><span>Download</span><b class="num">${mbs(t.down)}</b></div>
			<div><span>Upload</span><b class="num">${mbs(t.up)}</b></div>
			<div><span>Restzeit</span><b>${eta(t) || "–"}</b></div>
			<div><span>Quellen / Peers</span><b class="num">${t.seeds} / ${t.peers}</b></div>
			<div><span>Ratio</span><b class="num">${t.ratio}</b></div>
			<div><span>Indexer</span><b>${esc(t.indexer)}</b></div>
			<div><span>Hinzugefügt</span><b>${esc(t.added)}</b></div>
			<div><span>Gehört zu</span><b>${lib ? `${esc(lib.title)} · ${appOf(lib)}` : t.category === "radarr" ? "Radarr" : "Sonarr"}</b></div>
		</div>
		<div class="sm muted" style="margin:14px 2px 6px;font-weight:600">Dateien</div>
		<div class="steps">${files.map(([n, s]) => `<div class="step" style="padding:7px 10px"><div class="grow" style="font-size:12.5px;word-break:break-all">${esc(n)}</div><span class="st num">${s < 0.01 ? "< 0.1 MB" : gb(s)}</span></div>`).join("")}</div>
		${t.state === "stalled" ? `<div class="note-warn">Seit 2 h keine vollständige Quelle. <b>Anderen Release suchen</b> lässt ${t.category === "radarr" ? "Radarr" : "Sonarr"} diesen sperren und einen neuen holen.</div>` : ""}
		<div class="acts" style="justify-content:space-between;flex-wrap:wrap">
			<div style="display:flex;gap:6px;flex-wrap:wrap">
				<button class="btn small" data-a="toggle">${t.state === "paused" ? "▶ Fortsetzen" : "❚❚ Pausieren"}</button>
				${t.done < 1 ? `<button class="btn small" data-a="first">Zuerst laden</button><button class="btn small" data-a="other">Anderen Release suchen</button>` : ""}
				<button class="btn small" data-a="check">Neu prüfen</button>
			</div>
			<button class="btn small danger" data-a="remove">Entfernen …</button>
		</div>`);
	const act = (a) => {
		if (a === "toggle") {
			t.state = t.state === "paused" ? (t.done < 1 ? "down" : "seed") : "paused";
			if (t.state === "paused") (t.down = 0), (t.up = 0);
			else if (t.state === "down") (t.down = 9), (t.seeds = t.seeds || 40);
		}
		if (a === "first") toast("Wird zuerst geladen");
		if (a === "check") toast("Daten werden geprüft …");
		if (a === "other") {
			Object.assign(t, { state: "meta", done: 0, down: 0, seeds: 0, name: t.name.replace(/-[A-Za-z]+$/, "-NTb") });
			setTimeout(() => t.state === "meta" && Object.assign(t, { state: "down", seeds: 51, peers: 7 }), 1800);
			toast(`${t.category === "radarr" ? "Radarr" : "Sonarr"} sucht einen anderen Release`);
		}
		if (a === "remove") return m.close(), removeTorrent(t, rerender);
		m.close();
		rerender();
	};
	m.el.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => act(b.dataset.a)));
}

// removing only the torrent: keep the movie (it's in the library) or throw everything away
function removeTorrent(t, rerender) {
	const lib = t.lib && inLibrary(t.lib);
	const m = modal(`<h3>Torrent entfernen</h3><div class="sm muted" style="margin:6px 0 14px">${esc(titleOfTorrent(t))}</div>
		<div class="steps">
			${lib && t.done >= 1 ? `<button class="step pick on" data-o="copy"><div class="grow"><div class="t">Nur den Torrent und die Kopie in Downloads</div><div class="s">${esc(lib.title)} bleibt in Jellyfin · ${gb(t.size)} frei</div></div></button>` : ""}
			<button class="step pick ${lib && t.done >= 1 ? "" : "on"}" data-o="all"><div class="grow"><div class="t">${t.done < 1 ? "Download abbrechen" : "Alles löschen"}</div><div class="s">${t.done < 1 ? `Bisher Geladenes wird gelöscht · ${appOf({ type: t.category === "radarr" ? "movie" : "series" })} sucht nicht weiter` : "Auch aus der Bibliothek – wie «Überall löschen»"}</div></div></button>
		</div>
		<div class="acts"><button class="btn" data-x>Abbrechen</button><button class="btn solid-danger" data-go>Entfernen</button></div>`);
	let pick = m.el.querySelector(".pick.on").dataset.o;
	m.el.querySelectorAll(".pick").forEach((b) => (b.onclick = () => {
		m.el.querySelectorAll(".pick").forEach((x) => x.classList.toggle("on", x === b));
		pick = b.dataset.o;
	}));
	$("[data-x]", m.el).onclick = m.close;
	$("[data-go]", m.el).onclick = () => {
		m.close();
		if (pick === "all" && lib && t.done >= 1) return deleteFlow(lib, rerender);
		TORRENTS.splice(TORRENTS.indexOf(t), 1);
		if (lib) {
			if (t.done < 1 && lib.downloading !== undefined) LIBRARY.splice(LIBRARY.indexOf(lib), 1);
			else lib.torrent = null;
		}
		if (t.done >= 1) (DISK.used -= t.size), (DISK.dup -= t.size);
		toast(pick === "copy" ? `Torrent entfernt · ${gb(t.size)} frei` : "Download abgebrochen");
		rerender();
	};
}

// deleting a title also removes its torrent
const _deleteFlow = deleteFlow;
deleteFlow = (items, onDone) =>
	_deleteFlow(items, () => {
		for (let i = TORRENTS.length - 1; i >= 0; i--) if (TORRENTS[i].lib && !inLibrary(TORRENTS[i].lib)) TORRENTS.splice(i, 1);
		onDone && onDone();
	});

// the simulation: downloads move on, finished ones start seeding and land in the library
let tickers = [];
const onTick = (fn) => tickers.push(fn);
setInterval(() => {
	for (const t of TORRENTS) {
		if (t.state !== "down" || QB.paused) continue;
		const speed = QB.limit ? Math.min(5, t.down || 5) : 8 + Math.random() * 8;
		t.down = Math.round(speed * 10) / 10;
		t.done = Math.min(1, t.done + (t.down / 1000 / t.size) * 25);
		const lib = t.lib && inLibrary(t.lib);
		if (lib) lib.downloading = t.done;
		if (t.done >= 1) {
			Object.assign(t, { state: "seed", down: 0, up: 0.6, ratio: 0 });
			if (lib) delete lib.downloading;
			toast(`${esc(titleOfTorrent(t))} ist fertig und in Jellyfin`);
		}
	}
	tickers.forEach((fn) => fn());
}, 1000);

// ---------- the real search: Radarr and Sonarr look it up (through serve.js) ----------

const LIVE = { q: "", items: null, busy: false };
let liveTimer = null;
const words = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);
const have = (x) => inLibrary(x.id) || (x.have ? x : null);
// what the search offers for this text: the real results once they're there, the examples until then
function catalogFor(text, rerender) {
	const q = text.trim();
	if (q.length >= 2 && LIVE.q !== q) {
		clearTimeout(liveTimer);
		LIVE.busy = true;
		liveTimer = setTimeout(async () => {
			const items = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null);
			LIVE.busy = false;
			if (!items || !items.length) return rerender();
			for (const x of items) if (!CATALOG.some((c) => c.id === x.id)) CATALOG.push(x);
			Object.assign(LIVE, { q, items });
			rerender();
		}, 280);
	}
	if (LIVE.q === q && LIVE.items) return LIVE.items;
	const w = words(q);
	return CATALOG.filter((x) => x.rating && w.every((p) => `${x.title} ${x.year}`.toLowerCase().includes(p)));
}
