"use strict";
// Mediathek – the web app. One page: space and clean-up on top, the library as posters, qBittorrent
// on the right; ⌘K / Ctrl+K searches everything and adds new titles.

const S = { state: null, lib: null, tor: null, filter: "all", q: "", open: null };
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const nf = (n, d = 1) => n.toLocaleString("de-CH", { maximumFractionDigits: d });
const bytes = (b) => {
	if (b === null || b === undefined) return "–";
	if (b === 0) return "0 GB";
	if (b >= 1e12) return `${nf(b / 1e12, 2)} TB`;
	if (b >= 1e9) return `${nf(b / 1e9, b >= 1e11 ? 0 : 1)} GB`;
	if (b >= 1e6) return `${nf(b / 1e6, 0)} MB`;
	return `${nf(b / 1e3, 0)} KB`;
};
const speed = (b) => `${nf((b || 0) / 1e6, 1)} MB/s`;
const ago = (t) => {
	if (!t) return "–";
	const d = Math.floor((Date.now() - t) / 864e5);
	return d < 1 ? "heute" : d === 1 ? "gestern" : d < 30 ? `vor ${d} Tagen` : d < 60 ? "vor einem Monat" : d < 365 ? `vor ${Math.round(d / 30)} Monaten` : `vor ${nf(d / 365, 1)} Jahren`;
};
const eta = (s) => (!s ? "" : s < 60 ? "unter 1 min" : s < 3600 ? `noch ${Math.round(s / 60)} min` : s < 86400 ? `noch ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `noch ${Math.round(s / 86400)} Tage`);
const runtime = (m) => (m ? `${Math.floor(m / 60)} h ${m % 60} min` : "");
const typeTag = (x) => `<span class="tag ${x.type}">${x.type === "movie" ? "Film" : "Serie"}</span>`;
const appOf = (x) => (x.type === "movie" ? "Radarr" : "Sonarr");
const seen = (x) => (x.watched === null || x.watched === undefined ? "" : x.watched >= 1 ? "gesehen" : x.watched > 0 ? `${Math.round(x.watched * 100)} % gesehen` : "nicht gesehen");
const LS = {
	get(k, d) {
		try {
			return JSON.parse(localStorage.getItem(`mediathek.${k}`)) ?? d;
		} catch {
			return d;
		}
	},
	set(k, v) {
		try {
			localStorage.setItem(`mediathek.${k}`, JSON.stringify(v));
		} catch {}
	}
};

// the torrent states the app shows
const STATE = {
	down: ["Lädt", "var(--accent)"],
	meta: ["Sucht Quellen …", "var(--muted)"],
	stalled: ["Hängt – keine Quellen", "var(--warn)"],
	queued: ["Wartet", "var(--muted)"],
	checking: ["Prüft", "var(--muted)"],
	paused: ["Pausiert", "var(--faint)"],
	seed: ["Seeding", "var(--ok)"],
	done: ["Fertig · pausiert", "var(--faint)"],
	missing: ["Dateien fehlen", "var(--warn)"],
	error: ["Fehler", "var(--bad)"]
};
const LOADING = ["down", "meta", "stalled", "queued", "checking", "paused"];

async function api(method, url, body) {
	const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
	const d = await r.json().catch(() => ({}));
	if (r.status === 401 && d.login) {
		showLogin();
		throw new Error("login");
	}
	if (!r.ok) throw new Error(d.error || `Fehler ${r.status}`);
	return d;
}

function toast(msg, bad) {
	document.querySelectorAll(".toast").forEach((t) => t.remove());
	const t = document.createElement("div");
	t.className = "toast";
	if (bad) t.style.color = "#ff9c9c";
	t.innerHTML = msg;
	document.body.append(t);
	setTimeout(() => t.remove(), bad ? 5000 : 2800);
}

function modal(html, cls = "") {
	const scrim = document.createElement("div");
	scrim.className = "scrim";
	scrim.innerHTML = `<div class="modal ${cls}">${html}</div>`;
	const close = () => (scrim.remove(), document.removeEventListener("keydown", onKey));
	const onKey = (e) => e.key === "Escape" && close();
	scrim.addEventListener("click", (e) => e.target === scrim && close());
	document.addEventListener("keydown", onKey);
	document.body.append(scrim);
	return { el: scrim.firstChild, close };
}

function posterHtml(x, extra = "") {
	if (x.poster) return `<div class="poster" style="background-image:url('${esc(x.poster)}')">${extra}</div>`;
	return `<div class="poster ph" style="background-image:linear-gradient(160deg, #3a3f4c, #15171c)">${esc(x.title)}${extra}</div>`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const items = () => (S.lib && S.lib.items) || [];
const itemById = (id) => items().find((x) => x.id === id);
const torrents = () => (S.tor && S.tor.torrents) || [];
const torrentsOf = (it) => torrents().filter((t) => t.item === it.id);
const freedBy = (it) => (it.size || 0) + (it.copy || 0);

// ---------- start ----------

async function start() {
	try {
		S.state = await api("GET", "/api/state");
	} catch (err) {
		if (err.message === "login") return;
		$("#app").innerHTML = `<div class="empty"><h2>Mediathek nicht erreichbar</h2>${esc(err.message)}</div>`;
		return;
	}
	if (S.state.auth && !S.state.loggedIn) return showLogin();
	shell();
	const any = Object.values(S.state.services).some(Boolean);
	if (!any) return settingsSheet(true);
	await Promise.all([loadLib(), loadTor()]);
	setInterval(() => document.visibilityState === "visible" && loadTor(), 2000);
	setInterval(() => document.visibilityState === "visible" && loadLib(), 30000);
}

function shell() {
	$("#app").innerHTML = `
		<div class="topbar"><div class="brand">Mediathek${S.state.demo ? ` <span class="tag" style="margin-left:6px">Demo</span>` : ""}</div>
			<button class="find-btn" id="openSpot"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><span>Film oder Serie suchen …</span><kbd>${IS_MAC ? "⌘K" : "Ctrl K"}</kbd></button>
			<button class="auto-btn ${S.state.auto ? "on" : ""}" id="openAuto" title="Autopilot"><i></i>Autopilot</button>
			<button class="icon-btn" id="openSettings" title="Einstellungen" aria-label="Einstellungen"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg></button>
		</div>
		<div class="errs" id="errs"></div>
		<div class="wrap" style="padding-top:18px">
			<main>
				<div class="overview"><div class="card free" id="free"></div><div class="card"><div style="font-weight:650;margin-bottom:10px">Vorschläge zum Aufräumen</div><div class="sugg" id="sugg"></div></div></div>
				<div class="head2"><h2>Bibliothek</h2><div class="chips" id="chips"></div><input class="input" id="q" placeholder="Filtern …" style="width:200px;padding:7px 11px;background:var(--tile)"></div>
				<div id="lib"><div class="sm faint" style="padding:20px 2px">Lädt die Bibliothek …</div></div>
			</main>
			<aside class="side"><div class="card" id="qb"></div></aside>
		</div>
		<aside class="drawer" id="drawer"></aside>
		<div class="spot" id="spot" hidden><div class="spot-in">
			<div class="spot-box"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="sq" placeholder="Film oder Serie suchen …" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div>
			<div id="sres"></div>
			<div class="spot-foot"><span>↑ ↓ auswählen</span><span>↵ öffnen oder hinzufügen</span><span>esc schliessen</span></div>
		</div></div>`;
	$("#openSpot").onclick = openSpot;
	$("#openSettings").onclick = () => settingsSheet(false);
	$("#openAuto").onclick = autoSheet;
	$("#q").oninput = (e) => ((S.q = e.target.value), drawLib());
	bindSpot();
}

async function loadLib(fresh) {
	try {
		S.lib = await api("GET", `/api/library${fresh ? "?fresh=1" : ""}`);
	} catch (err) {
		if (err.message !== "login") drawErrors({ mediathek: err.message });
		return;
	}
	drawErrors(S.lib.errors);
	drawOverview();
	drawLib();
	if (S.open) openDetail(S.open, true);
}

async function loadTor() {
	if (!S.state.services.qbittorrent) return drawQb();
	try {
		S.tor = await api("GET", "/api/torrents");
		S.torError = null;
	} catch (err) {
		S.torError = err.message;
	}
	drawQb();
	if (S.lib) drawOverview();
	// posters show the progress of what's loading
	if (torrents().some((t) => t.item && LOADING.includes(t.state))) drawLib();
	if (S.open && $("#drawer").classList.contains("open")) drawDrawerTorrents();
}

function drawErrors(errors) {
	const list = Object.entries(errors || {});
	$("#errs").innerHTML = list.map(([svc, msg]) => `<div class="err">⚠ ${esc(msg)}<button data-set>Einstellungen</button></div>`).join("");
	$("#errs").querySelectorAll("[data-set]").forEach((b) => (b.onclick = () => settingsSheet(false)));
}

// ---------- space and clean-up ----------

function drawOverview() {
	const sp = S.lib.space;
	const movies = items().filter((x) => x.type === "movie").reduce((a, x) => a + (x.size || 0), 0);
	const series = items().filter((x) => x.type === "series").reduce((a, x) => a + (x.size || 0), 0);
	const dup = items().reduce((a, x) => a + (x.copy || 0), 0);
	const freeEl = $("#free");
	let freeHtml;
	if (sp && sp.total) {
		const other = Math.max(0, sp.total - sp.free - movies - series - dup);
		const w = (n) => `${(n / sp.total) * 100}%`;
		freeHtml = `<div class="muted sm">Frei auf dem Server</div><b class="num">${bytes(sp.free)}</b><span class="faint sm"> von ${bytes(sp.total)}</span>
			<div class="bar" style="margin-top:14px"><i style="width:${w(movies)};background:var(--movie)"></i><i style="width:${w(series)};background:var(--series)"></i><i style="width:${w(dup)};background:var(--bad)"></i><i style="width:${w(other)};background:#555"></i></div>
			<div class="legend"><span style="--c:var(--movie)">Filme ${bytes(movies)}</span><span style="--c:var(--series)">Serien ${bytes(series)}</span>${dup ? `<span style="--c:var(--bad)">Doppelt ${bytes(dup)}</span>` : ""}<span style="--c:#555">Anderes ${bytes(other)}</span></div>`;
	} else freeHtml = `<div class="muted sm">Frei auf dem Server</div><b class="num">${sp ? bytes(sp.free) : "–"}</b><div class="legend"><span style="--c:var(--movie)">Filme ${bytes(movies)}</span><span style="--c:var(--series)">Serien ${bytes(series)}</span></div>`;
	if (freeEl.dataset.html !== freeHtml) (freeEl.dataset.html = freeHtml), (freeEl.innerHTML = freeHtml);

	const sugg = [];
	// second copies of finished torrents that have seeded enough
	const dupDone = torrents().filter((t) => t.copy && t.item && t.done >= 1 && t.ratio >= 1);
	if (dupDone.length) sugg.push({ t: "Doppelte Kopien", s: `${dupDone.length === 1 ? "Ein Film liegt" : `${dupDone.length} Filme liegen`} zweimal auf dem Server: in der Bibliothek und im Download-Ordner fürs Seeding. Die Download-Kopie kann weg, ${dupDone.length === 1 ? "der Film bleibt" : "die Filme bleiben"}.`, n: dupDone.reduce((a, t) => a + t.size, 0), b: "Aufräumen", go: () => dupFlow(dupDone) });
	// finished torrents whose title is gone from Radarr and Sonarr: only taking space
	const arrsOn = S.state.services.radarr || S.state.services.sonarr;
	const orphans = arrsOn ? torrents().filter((t) => !t.item && t.done >= 1 && (!t.category || /radarr|sonarr|tv|movie|film|serie/i.test(t.category))) : [];
	const empty = torrents().filter((t) => t.state === "missing");
	const stale = [...orphans, ...empty.filter((t) => !orphans.includes(t))];
	if (stale.length)
		sugg.push({
			t: stale.length === 1 ? "1 überflüssiger Torrent" : `${stale.length} überflüssige Torrents`,
			s: `${stale.slice(0, 3).map((t) => t.title).join(", ")}${stale.length > 3 ? " …" : ""} – ${orphans.length && empty.length ? "nicht mehr in Radarr oder Sonarr oder ohne Dateien" : orphans.length ? "nicht mehr in Radarr oder Sonarr, belegen nur noch Platz" : "ihre Dateien sind schon weg, qBittorrent kennt sie noch"}.`,
			n: orphans.reduce((a, t) => a + t.size, 0),
			b: "Entfernen",
			go: () => orphanFlow(stale)
		});
	const seenAll = items().filter((x) => x.watched >= 1);
	if (seenAll.length) sugg.push({ t: seenAll.length === 1 ? "1 gesehener Titel" : `${seenAll.length} gesehene Titel`, s: seenAll.slice(0, 4).map((x) => x.title).join(", ") + (seenAll.length > 4 ? " …" : ""), n: seenAll.reduce((a, x) => a + freedBy(x), 0), b: "Ansehen", go: () => ((S.filter = "seen"), drawLib(), $("#lib").scrollIntoView({ behavior: "smooth" })) });
	const old = items().filter((x) => x.watched === 0 && x.hasFile && x.added && Date.now() - x.added > 90 * 864e5);
	if (old.length) sugg.push({ t: "Lange nicht geschaut", s: `${old.slice(0, 3).map((x) => x.title).join(", ")}${old.length > 3 ? " …" : ""} – seit über 3 Monaten da, nie angefangen.`, n: old.reduce((a, x) => a + freedBy(x), 0), b: "Ansehen", go: () => ((S.filter = "old"), drawLib(), $("#lib").scrollIntoView({ behavior: "smooth" })) });
	const html = sugg.map((x, i) => `<div class="sug"><div class="t">${esc(x.t)}</div><div class="s">${esc(x.s)}</div><div class="foot"><b class="num">${bytes(x.n)}</b><button class="btn small" data-s="${i}">${x.b}</button></div></div>`).join("") || `<div class="faint sm">Nichts aufzuräumen.</div>`;
	// redrawn every few seconds: only touch it when something changed
	if ($("#sugg").dataset.html === html) return;
	$("#sugg").dataset.html = html;
	$("#sugg").innerHTML = html;
	$("#sugg").querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => sugg[b.dataset.s].go()));
}

function orphanFlow(list) {
	const size = (t) => (t.state === "missing" ? 0 : t.size);
	const n = list.reduce((a, t) => a + size(t), 0);
	const m = modal(`<h3>Überflüssige Torrents entfernen</h3><div class="sm muted" style="margin:6px 0 14px">Sie werden aus qBittorrent entfernt, mit ihren Dateien im Download-Ordner. Die Titel in der Bibliothek bleiben.</div>
		<div class="steps">${list.map((t) => `<label class="step pick on" style="cursor:pointer"><input type="checkbox" data-h="${t.hash}" checked style="accent-color:var(--accent)"><div class="grow"><div class="t">${esc(t.title)}</div><div class="s">${t.state === "missing" ? "Dateien schon weg" : "nicht mehr in Radarr oder Sonarr"} · Ratio ${t.ratio}</div></div><span class="st num">${size(t) ? bytes(size(t)) : ""}</span></label>`).join("")}</div>
		<div class="freed"><span class="muted">Wird frei</span><b class="num" id="ofree">${bytes(n)}</b></div>
		<div class="acts"><button class="btn" data-x>Abbrechen</button><button class="btn solid-danger" data-go>Entfernen</button></div>`);
	const chosen = () => list.filter((t) => m.el.querySelector(`[data-h="${t.hash}"]`).checked);
	m.el.querySelectorAll("[data-h]").forEach((c) => (c.onchange = () => ($("#ofree", m.el).textContent = bytes(chosen().reduce((a, t) => a + size(t), 0)))));
	$("[data-x]", m.el).onclick = m.close;
	$("[data-go]", m.el).onclick = async (e) => {
		const pick = chosen();
		if (!pick.length) return m.close();
		e.currentTarget.classList.add("busy");
		let ok = 0;
		for (const t of pick) {
			try {
				await api("POST", `/api/torrents/${t.hash}/remove`, { mode: "copy" });
				ok++;
			} catch (err) {
				toast(esc(err.message), true);
			}
		}
		m.close();
		if (ok) toast(`${ok} ${ok === 1 ? "Torrent" : "Torrents"} entfernt`);
		await Promise.all([loadTor(), loadLib(true)]);
	};
}

function dupFlow(list) {
	const n = list.reduce((a, t) => a + t.size, 0);
	const m = modal(`<h3>Doppelte Kopien aufräumen</h3><div class="sm muted" style="margin:6px 0 14px;line-height:1.55">Diese Filme liegen <b>zweimal</b> auf dem Server: einmal in der Bibliothek – die schaust du in Jellyfin – und einmal im Download-Ordner, von wo qBittorrent sie weiter an andere verteilt (Seeding). Genug verteilt ist schon (Ratio über 1).<br><br>Aufräumen löscht nur die Kopie im Download-Ordner und beendet das Seeding. <b>Die Filme in der Bibliothek bleiben.</b></div>
		<div class="steps">${list.map((t) => `<div class="step">${typeTag(t)}<div class="grow"><div class="t">${esc(t.title)}</div><div class="s">Ratio ${t.ratio}</div></div><span class="st num">${bytes(t.size)}</span></div>`).join("")}</div>
		<div class="freed"><span class="muted">Wird frei</span><b class="num">${bytes(n)}</b></div>
		<div class="acts"><button class="btn" data-x>Abbrechen</button><button class="btn primary" data-go>Aufräumen</button></div>`);
	$("[data-x]", m.el).onclick = m.close;
	$("[data-go]", m.el).onclick = async (e) => {
		e.currentTarget.classList.add("busy");
		let ok = 0;
		for (const t of list) {
			try {
				await api("POST", `/api/torrents/${t.hash}/remove`, { mode: "copy" });
				ok++;
			} catch (err) {
				toast(esc(err.message), true);
			}
		}
		m.close();
		if (ok) toast(`${ok} ${ok === 1 ? "Torrent" : "Torrents"} entfernt · ${bytes(n)} frei`);
		await Promise.all([loadTor(), loadLib(true)]);
	};
}

// ---------- library ----------

const FILTERS = [["all", "Alle"], ["movie", "Filme"], ["series", "Serien"], ["seen", "Gesehen"], ["old", "Nie geschaut"], ["big", "Gross zuerst"]];

function drawLib() {
	if (!S.lib) return;
	$("#chips").innerHTML = FILTERS.map(([k, l]) => `<button data-f="${k}" class="${S.filter === k ? "on" : ""}">${l}</button>`).join("");
	$("#chips").querySelectorAll("button").forEach((b) => (b.onclick = () => ((S.filter = b.dataset.f), drawLib())));
	const w = S.q.toLowerCase().split(/\s+/).filter(Boolean);
	let list = items().filter((x) => w.every((p) => `${x.title} ${x.year || ""}`.toLowerCase().includes(p)));
	if (S.filter === "movie" || S.filter === "series") list = list.filter((x) => x.type === S.filter);
	if (S.filter === "seen") list = list.filter((x) => x.watched >= 1);
	if (S.filter === "old") list = list.filter((x) => x.watched === 0 && x.hasFile && x.added && Date.now() - x.added > 90 * 864e5);
	list.sort(S.filter === "big" ? (a, b) => freedBy(b) - freedBy(a) : (a, b) => (b.added || 0) - (a.added || 0));
	const started = S.filter === "all" && !w.length ? list.filter((x) => (x.watched > 0 && x.watched < 1) || x.watching) : [];
	const rest = list.filter((x) => !started.includes(x));
	if (!items().length) {
		$("#lib").innerHTML = `<div class="empty"><h2>Noch nichts in der Bibliothek</h2>Mit <kbd>${IS_MAC ? "⌘K" : "Ctrl K"}</kbd> suchst du Filme und Serien und fügst sie hinzu.</div>`;
		return;
	}
	$("#lib").innerHTML = `${started.length ? `<div class="sub-h">Angefangen</div><div class="row">${started.map(card).join("")}</div><div class="sub-h">Weitere</div>` : ""}
		<div class="row">${rest.map(card).join("") || `<div class="sm faint">Nichts gefunden</div>`}</div>`;
	$("#lib").querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => openDetail(b.dataset.id)));
	failedPosters($("#lib"));
}

function card(x) {
	const t = torrentsOf(x).find((t) => LOADING.includes(t.state));
	const prog = t ? `<div class="prog"><i style="width:${t.done * 100}%;${t.state === "stalled" ? "background:var(--warn)" : ""}"></i></div>` : x.watched > 0 && x.watched < 1 ? `<div class="prog"><i style="width:${x.watched * 100}%"></i></div>` : "";
	const badge = t
		? `<span class="tag dl-badge" style="color:${STATE[t.state][1]}">${t.state === "down" ? `${Math.round(t.done * 100)} %` : STATE[t.state][0].split(" ")[0]}</span>`
		: !x.hasFile
			? `<span class="tag dl-badge warn">${x.type === "movie" && x.status === "waiting" ? "Noch nicht erschienen" : "Fehlt"}</span>`
			: x.watching
				? `<span class="tag dl-badge" style="color:var(--accent)">▶ läuft</span>`
				: x.watched >= 1
					? `<span class="tag ok dl-badge">✓</span>`
					: "";
	const kept = (S.state.keep || []).includes(x.id) ? `<span class="keep-pin" title="Behalten">📌</span>` : "";
	return `<button class="pc" data-id="${x.id}">${posterHtml(x, prog)}${badge}${kept}<div class="tt">${esc(x.title)}</div><div class="ss"><span>${x.year || ""} · ${x.type === "movie" ? "Film" : "Serie"}</span><span class="num">${x.size ? bytes(x.size) : ""}</span></div></button>`;
}

// posters from TMDB that don't load: the quiet placeholder
function failedPosters(root) {
	root.querySelectorAll(".poster:not(.ph)").forEach((el) => {
		const url = (/url\(['"]?([^'")]+)/.exec(el.style.backgroundImage) || [])[1];
		if (!url || el.dataset.checked) return;
		el.dataset.checked = 1;
		const img = new Image();
		img.onerror = () => el.classList.add("img-failed");
		img.src = url;
	});
}

// ---------- details ----------

function openDetail(id, keep) {
	const x = itemById(id);
	const drawer = $("#drawer");
	if (!x) {
		S.open = null;
		return drawer.classList.remove("open");
	}
	S.open = id;
	if (keep && !drawer.classList.contains("open")) return;
	const seasons = x.seasons && x.seasons.length ? `<div class="seasons">${x.seasons.map((s) => `<div class="season"><span style="width:62px">Staffel ${s.n}</span><div class="bar"><i style="width:${s.of ? (s.have / s.of) * 100 : 0}%;background:${s.have >= s.of ? "var(--ok)" : "var(--warn)"}"></i></div><span class="faint num" style="width:48px;text-align:right">${s.have}/${s.of}</span></div>`).join("")}</div>` : "";
	drawer.innerHTML = `<button class="x" id="dx" aria-label="Schliessen">✕</button>
		<div class="top">${posterHtml(x)}<div style="padding-top:4px;min-width:0"><div>${typeTag(x)}</div><h3 style="margin-top:8px">${esc(x.title)}</h3><div class="sm muted">${[x.year, runtime(x.runtime)].filter(Boolean).join(" · ")}</div>
			${(x.watching || []).map((w) => `<div class="watching">${w.paused ? "❚❚" : "▶"} ${esc(w.user)} schaut gerade · ${esc(w.device)}</div>`).join("")}</div></div>
		${seasons}
		<div class="kv">
			${x.watched !== null && x.watched !== undefined ? `<div><span>Gesehen</span><span>${seen(x)}${x.lastPlayed ? ` · ${ago(x.lastPlayed)}` : ""}</span></div>` : ""}
			${x.quality ? `<div><span>Qualität</span><span>${esc(x.quality)}</span></div>` : ""}
			<div><span>Hinzugefügt</span><span>${ago(x.added)}</span></div>
			<div><span>Grösse</span><span class="num">${x.size ? bytes(x.size) : x.hasFile ? "–" : "noch keine Datei"}</span></div>
			${x.copy ? `<div><span>Kopie in Downloads</span><span class="num" style="color:var(--warn)">${bytes(x.copy)}</span></div>` : ""}
			${x.next ? `<div><span>Nächste Folge</span><span>${new Date(x.next).toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "short" })}</span></div>` : ""}
		</div>
		<div id="dtorWrap"></div>
		<label class="switch-row keep-row"><div class="grow"><div>Behalten</div><div class="sm faint">Der Autopilot löscht diesen Titel nie</div></div><span class="switch"><input type="checkbox" id="keep" ${(S.state.keep || []).includes(x.id) ? "checked" : ""}><span></span></span></label>
		<div style="display:flex;gap:8px;margin-top:14px"><button class="btn danger" id="del" style="flex:1;justify-content:center">Überall löschen${freedBy(x) ? ` · ${bytes(freedBy(x))}` : ""}</button></div>
		<div class="sm faint" style="margin-top:10px">Löscht in ${appOf(x)}${S.state.services.qbittorrent ? ", qBittorrent" : ""}${S.state.services.jellyfin ? " und Jellyfin" : ""} auf einmal – mit den Dateien.</div>`;
	$("#dx", drawer).onclick = closeDetail;
	$("#del", drawer).onclick = () => deleteFlow(x);
	$("#keep", drawer).onchange = async (e) => {
		try {
			S.state.keep = (await api("POST", `/api/items/${x.id}/keep`, { keep: e.target.checked })).keep;
			drawLib();
		} catch (err) {
			toast(esc(err.message), true);
		}
	};
	drawDrawerTorrents();
	failedPosters(drawer);
	drawer.classList.add("open");
}
function closeDetail() {
	S.open = null;
	$("#drawer").classList.remove("open");
}
function drawDrawerTorrents() {
	const x = itemById(S.open);
	const box = $("#dtorWrap");
	if (!x || !box) return;
	const list = torrentsOf(x);
	box.innerHTML = list.length ? `<div class="sm muted" style="margin:18px 2px 6px;font-weight:600">${list.length === 1 ? "Torrent" : "Torrents"}</div><div class="dtor">${list.map((t) => torrentRow(t, true)).join("")}</div>` : "";
	bindTorrents(box);
}

// ---------- delete everywhere ----------

function deleteFlow(x) {
	const tors = torrentsOf(x);
	const copies = x.copy || 0;
	const svc = [[appOf(x), x.type === "movie" ? "R" : "S", x.type === "movie" ? "var(--movie)" : "var(--series)", `Aus der Bibliothek, mit Dateien${x.size ? ` · ${bytes(x.size)}` : ""}`]];
	if (S.state.services.qbittorrent) svc.push(["qBittorrent", "qB", "var(--accent)", tors.length ? `${tors.length === 1 ? "Torrent" : `${tors.length} Torrents`} entfernen${copies ? `, Kopie in Downloads · ${bytes(copies)}` : ""}` : "Kein Torrent mehr vorhanden"]);
	if (S.state.services.jellyfin) svc.push(["Jellyfin", "J", "#c38cf0", "Bibliothek neu einlesen"]);
	const m = modal(`
		<div class="head">${posterHtml(x)}<div><h3>${esc(x.title)} löschen?</h3><div class="sm muted" style="margin-top:4px">${[x.year, x.type === "movie" ? "Film" : `Serie · ${(x.seasons || []).length} Staffeln`, seen(x)].filter(Boolean).join(" · ")}</div></div></div>
		<div class="steps">${svc.map(([n, ic, c, s], i) => `<div class="step" data-s="${i}"><span class="ic" style="background:color-mix(in srgb, ${c} 14%, transparent);color:${c}">${ic}</span><div class="grow"><div class="t">${n}</div><div class="s">${s}</div></div><span class="st"></span></div>`).join("")}</div>
		<label class="check"><input type="checkbox" id="excl" checked> Nicht wieder automatisch hinzufügen (Import-Listen)</label>
		<div class="freed"><span class="muted">Wird frei</span><b class="num">${bytes(freedBy(x))}</b></div>
		<div class="acts"><button class="btn" data-x>Abbrechen</button><button class="btn solid-danger" data-go>Überall löschen</button></div>`);
	failedPosters(m.el);
	$("[data-x]", m.el).onclick = m.close;
	$("[data-go]", m.el).onclick = async (e) => {
		e.currentTarget.disabled = true;
		$("[data-x]", m.el).style.visibility = "hidden";
		m.el.querySelectorAll(".step .st").forEach((s) => (s.textContent = "läuft …"));
		let r;
		try {
			r = await api("POST", `/api/items/${x.id}/delete`, { exclude: $("#excl", m.el).checked });
		} catch (err) {
			m.close();
			return toast(esc(err.message), true);
		}
		for (const [i, st] of r.steps.entries()) {
			const el = m.el.querySelector(`[data-s="${i}"]`);
			if (!el) continue;
			el.classList.add(st.ok ? "done" : "fail");
			$(".st", el).textContent = st.ok ? "✓ erledigt" : "✕ Fehler";
			if (!st.ok) $(".s", el).textContent = st.error;
			await sleep(250);
		}
		const failed = r.steps.filter((s) => !s.ok);
		if (failed.length) {
			$("[data-go]", m.el).replaceWith(Object.assign(document.createElement("button"), { className: "btn", textContent: "Schliessen", onclick: m.close }));
		} else {
			await sleep(450);
			m.close();
			toast(`${esc(x.title)} gelöscht`);
		}
		closeDetail();
		await Promise.all([loadLib(true), loadTor()]);
	};
}

// ---------- qBittorrent ----------

function torrentRow(t, compact) {
	const [label, color] = STATE[t.state] || STATE.error;
	const sub =
		t.state === "down" ? `${speed(t.down)} · ${eta(t.eta)} · ${t.seeds} Quellen`
		: t.state === "seed" ? `↑ ${speed(t.up)} · Ratio ${t.ratio}`
		: t.state === "stalled" ? `${Math.round(t.done * 100)} % · ${t.peers} Peers, keine vollständige Quelle`
		: t.state === "meta" || t.state === "queued" || t.state === "checking" ? `${Math.round(t.done * 100)} %`
		: t.state === "paused" ? `${Math.round(t.done * 100)} %`
		: t.state === "done" ? `Ratio ${t.ratio}`
		: t.state === "missing" ? (t.item && itemById(t.item) && itemById(t.item).hasFile ? "Kopie in Downloads gelöscht – der Titel ist in der Bibliothek" : "Dateien in Downloads gelöscht")
		: "";
	const paused = t.state === "paused" || t.state === "done";
	return `<div class="tor" data-tor="${t.hash}">
		<div class="tor-main"><div class="tor-t"><span class="tor-name">${esc(t.title || t.name)}</span>${t.type ? typeTag(t) : t.category ? `<span class="tag">${esc(t.category)}</span>` : ""}</div>
			<div class="tor-s"><span style="color:${color}">${label}</span>${sub ? ` · ${sub}` : ""}</div>
			${t.done < 1 && t.state !== "missing" ? `<div class="bar" style="height:4px;margin-top:7px"><i style="width:${(t.done * 100).toFixed(1)}%;background:${color}"></i></div>` : ""}</div>
		${compact ? "" : `<span class="tor-size num">${bytes(t.size)}</span>`}
		<button class="tor-btn" data-toggle="${t.hash}" data-paused="${paused ? 1 : ""}" title="${paused ? "Fortsetzen" : "Pausieren"}">${paused ? "▶" : "❚❚"}</button>
		<button class="tor-btn" data-detail="${t.hash}" title="Details">⋯</button>
	</div>`;
}

function drawQb() {
	const box = $("#qb");
	if (!box) return;
	if (!S.state.services.qbittorrent) return (box.innerHTML = `<h3>qBittorrent</h3><div class="sm faint">Nicht eingerichtet – in den <a href="#" id="qbset" style="text-decoration:underline">Einstellungen</a> verbinden.</div>`), ($("#qbset").onclick = (e) => (e.preventDefault(), settingsSheet(false)));
	if (S.torError) return (box.innerHTML = `<h3>qBittorrent</h3><div class="sm bad-text">${esc(S.torError)}</div>`);
	if (!S.tor) return (box.innerHTML = `<h3>qBittorrent</h3><div class="sm faint">Lädt …</div>`);
	const order = { down: 0, meta: 1, checking: 1, queued: 2, stalled: 2, paused: 3, error: 0, seed: 4, done: 5, missing: 6 };
	const list = [...torrents()].sort((a, b) => order[a.state] - order[b.state] || (b.added || 0) - (a.added || 0));
	const active = list.filter((t) => LOADING.includes(t.state) || t.state === "error");
	const rest = list.filter((t) => !active.includes(t));
	const anyRunning = list.some((t) => !["paused", "done"].includes(t.state));
	box.innerHTML = `<h3>qBittorrent</h3>
		<div class="qb-head"><div class="qb-speed"><span><b class="num">↓ ${speed(S.tor.down)}</b></span><span class="muted num">↑ ${speed(S.tor.up)}</span><span class="faint">${active.length} lädt · ${list.filter((t) => t.state === "seed").length} seeding</span></div>
			<div class="qb-acts"><button class="chip-btn ${S.tor.slow ? "on" : ""}" data-qb="slow" title="Die Grenzen aus qBittorrents «alternativen Geschwindigkeiten»">🐢 Langsam</button><button class="chip-btn" data-qb="${anyRunning ? "pauseAll" : "resumeAll"}">${anyRunning ? "❚❚ Alle pausieren" : "▶ Alle fortsetzen"}</button></div></div>
		<div class="grp">Lädt</div>${active.map((t) => torrentRow(t)).join("") || `<div class="sm faint" style="padding:8px 4px">Nichts wird geladen</div>`}
		${rest.length ? `<div class="grp">Fertig · seeding oder pausiert</div>${rest.map((t) => torrentRow(t)).join("")}` : ""}`;
	bindTorrents(box);
	box.querySelectorAll("[data-qb]").forEach((b) => (b.onclick = async () => {
		b.classList.add("busy");
		try {
			if (b.dataset.qb === "slow") await api("POST", "/api/slow");
			else await api("POST", `/api/torrents/all/${b.dataset.qb === "pauseAll" ? "pause" : "resume"}`);
		} catch (err) {
			toast(esc(err.message), true);
		}
		await loadTor();
	}));
}

function bindTorrents(el) {
	el.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = async (e) => {
		e.stopPropagation();
		b.classList.add("busy");
		try {
			await api("POST", `/api/torrents/${b.dataset.toggle}/${b.dataset.paused ? "resume" : "pause"}`);
		} catch (err) {
			toast(esc(err.message), true);
		}
		await loadTor();
	}));
	el.querySelectorAll("[data-tor]").forEach((r) => (r.onclick = () => torrentDetail(r.dataset.tor)));
}

async function torrentDetail(hash) {
	const t = torrents().find((x) => x.hash === hash);
	if (!t) return;
	const m = modal(`<h3>${esc(t.title || t.name)}</h3><div class="sm faint" style="margin-top:4px;word-break:break-all">${esc(t.name)}</div><div class="sm faint" style="margin-top:16px">Lädt Details …</div>`);
	let d;
	try {
		d = await api("GET", `/api/torrents/${hash}`);
	} catch (err) {
		m.close();
		return toast(esc(err.message), true);
	}
	const [label, color] = STATE[t.state] || STATE.error;
	const it = d.item && itemById(d.item);
	const paused = t.state === "paused" || t.state === "done";
	const files = [...d.files].sort((a, b) => b.size - a.size);
	m.el.innerHTML = `
		<h3>${esc(t.title || t.name)}</h3><div class="sm faint" style="margin-top:4px;word-break:break-all">${esc(t.name)}</div>
		<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:${color};font-weight:600">${label}</span><span class="num muted">${nf(t.done * 100, 1)} % von ${bytes(t.size)}</span></div>
			<div class="bar" style="margin-top:7px"><i style="width:${t.done * 100}%;background:${color}"></i></div></div>
		<div class="kv-grid">
			<div><span>Download</span><b class="num">${speed(t.down)}</b></div>
			<div><span>Upload</span><b class="num">${speed(t.up)}</b></div>
			<div><span>Restzeit</span><b>${t.state === "down" ? eta(t.eta) || "–" : "–"}</b></div>
			<div><span>Quellen / Peers</span><b class="num">${d.seeds} (${d.seedsTotal}) / ${d.peers} (${d.peersTotal})</b></div>
			<div><span>Ratio</span><b class="num">${nf(d.ratio, 2)}</b></div>
			<div><span>Hochgeladen</span><b class="num">${bytes(d.uploaded)}</b></div>
			<div><span>Hinzugefügt</span><b>${ago(d.addedOn)}</b></div>
			<div><span>Gehört zu</span><b>${it ? `${esc(it.title)} · ${appOf(it)}` : esc(t.category || "–")}</b></div>
			${d.tracker ? `<div style="grid-column:1/-1"><span>Tracker</span><b style="word-break:break-all">${esc(d.tracker.replace(/\/announce.*$/, ""))}</b></div>` : ""}
		</div>
		<div class="sm muted" style="margin:14px 2px 6px;font-weight:600">${files.length === 1 ? "Datei" : `${files.length} Dateien`}</div>
		<div class="steps" style="max-height:180px;overflow:auto">${files.slice(0, 40).map((f) => `<div class="step" style="padding:7px 10px"><div class="grow" style="font-size:12.5px;word-break:break-all">${esc(f.name.split("/").pop())}</div><span class="st num">${bytes(f.size)}</span></div>`).join("")}</div>
		${t.state === "stalled" && d.canReplace ? `<div class="note-warn">Keine vollständige Quelle. <b>Anderen Release suchen</b> sperrt diesen in ${it ? appOf(it) : "Radarr/Sonarr"} und holt einen neuen.</div>` : ""}
		<div class="acts" style="justify-content:space-between;flex-wrap:wrap">
			<div style="display:flex;gap:6px;flex-wrap:wrap">
				<button class="btn small" data-a="${paused ? "resume" : "pause"}">${paused ? "▶ Fortsetzen" : "❚❚ Pausieren"}</button>
				${t.done < 1 ? `<button class="btn small" data-a="first">Zuerst laden</button>` : ""}
				${t.done < 1 && d.canReplace ? `<button class="btn small" data-a="replace">Anderen Release suchen</button>` : ""}
				<button class="btn small" data-a="recheck">Neu prüfen</button>
			</div>
			<button class="btn small danger" data-a="remove">Entfernen …</button>
		</div>`;
	m.el.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
		const a = b.dataset.a;
		if (a === "remove") return m.close(), removeTorrent(t, it);
		b.classList.add("busy");
		try {
			await api("POST", `/api/torrents/${hash}/${a}`);
			toast(a === "replace" ? `${it ? appOf(it) : "Radarr/Sonarr"} sucht einen anderen Release` : a === "recheck" ? "Daten werden geprüft …" : a === "first" ? "Wird zuerst geladen" : a === "pause" ? "Pausiert" : "Läuft wieder");
		} catch (err) {
			toast(esc(err.message), true);
		}
		m.close();
		await loadTor();
	}));
}

// remove only a torrent: keep the title, cancel the download, or delete everything
function removeTorrent(t, it) {
	const opts = [];
	if (it && t.done >= 1) opts.push(["copy", "Nur den Torrent und seine Dateien in Downloads", `${esc(it.title)} bleibt in der Bibliothek${t.copy ? ` · ${bytes(t.size)} frei` : t.copy === false ? " · Hardlink, kein Platz frei" : ""}`]);
	if (t.done < 1) opts.push(["cancel", "Download abbrechen", it && !it.hasFile ? `Bisher Geladenes wird gelöscht, und ${esc(it.title)} kommt aus ${appOf(it)} weg` : "Bisher Geladenes wird gelöscht"]);
	if (it && t.done >= 1) opts.push(["all", "Alles löschen", `Auch aus der Bibliothek – wie «Überall löschen»`]);
	if (!it && t.done >= 1) opts.push(["copy", "Torrent mit Dateien entfernen", "Gehört zu keinem Titel in Radarr oder Sonarr"]);
	const m = modal(`<h3>Torrent entfernen</h3><div class="sm muted" style="margin:6px 0 14px">${esc(t.title || t.name)}</div>
		<div class="steps">${opts.map(([k, a, b], i) => `<button class="step pick ${i === 0 ? "on" : ""}" data-o="${k}"><div class="grow"><div class="t">${a}</div><div class="s">${b}</div></div></button>`).join("")}</div>
		<div class="acts"><button class="btn" data-x>Abbrechen</button><button class="btn solid-danger" data-go>Entfernen</button></div>`);
	let pick = opts[0][0];
	m.el.querySelectorAll(".pick").forEach((b) => (b.onclick = () => {
		m.el.querySelectorAll(".pick").forEach((x) => x.classList.toggle("on", x === b));
		pick = b.dataset.o;
	}));
	$("[data-x]", m.el).onclick = m.close;
	$("[data-go]", m.el).onclick = async (e) => {
		e.currentTarget.classList.add("busy");
		try {
			const r = await api("POST", `/api/torrents/${t.hash}/remove`, { mode: pick, exclude: true });
			const bad = (r.steps || []).filter((s) => !s.ok);
			toast(bad.length ? `Teilweise fehlgeschlagen: ${esc(bad.map((s) => `${s.service}: ${s.error}`).join(", "))}` : pick === "cancel" ? "Download abgebrochen" : "Entfernt", bad.length > 0);
		} catch (err) {
			toast(esc(err.message), true);
		}
		m.close();
		await Promise.all([loadTor(), loadLib(true)]);
	};
}

// ---------- search and add (⌘K / Ctrl+K) ----------

const SP = { hits: [], sel: 0, q: "", results: null, busy: false, timer: null, seq: 0 };

function openSpot() {
	$("#spot").hidden = false;
	$("#sq").select();
	$("#sq").focus();
	drawSpot();
}
function closeSpot() {
	$("#spot").hidden = true;
}

function bindSpot() {
	const sq = $("#sq");
	sq.oninput = () => {
		SP.sel = 0;
		const q = sq.value.trim();
		clearTimeout(SP.timer);
		if (q.length >= 2 && q !== SP.q) {
			SP.busy = true;
			const seq = ++SP.seq;
			SP.timer = setTimeout(async () => {
				let res = null;
				try {
					res = await api("GET", `/api/search?q=${encodeURIComponent(q)}`);
				} catch (err) {
					toast(esc(err.message), true);
				}
				if (seq !== SP.seq) return;
				SP.busy = false;
				SP.q = q;
				SP.results = res || [];
				drawSpot();
			}, 300);
		}
		drawSpot();
	};
	sq.onkeydown = (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			SP.sel = Math.max(0, Math.min(SP.hits.length - 1, SP.sel + (e.key === "ArrowDown" ? 1 : -1)));
			drawSpot();
			const el = $("#sres .hit.sel");
			if (el) el.scrollIntoView({ block: "nearest" });
		}
		if (e.key === "Enter") pickHit(SP.sel);
	};
	$("#spot").onclick = (e) => e.target === $("#spot") && closeSpot();
	document.addEventListener("keydown", (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			$("#spot").hidden ? openSpot() : closeSpot();
		} else if (e.key === "Escape" && !document.querySelector(".scrim")) {
			if (!$("#spot").hidden) closeSpot();
			else if ($("#drawer").classList.contains("open")) closeDetail();
		} else if (e.key === "/" && $("#spot").hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) (e.preventDefault(), openSpot());
	});
}

// what you have first (opens the details), then what Radarr and Sonarr can add
function drawSpot() {
	const text = $("#sq").value.trim();
	const w = text.toLowerCase().split(/\s+/).filter(Boolean);
	const mine = w.length ? items().filter((x) => w.every((p) => `${x.title} ${x.year || ""}`.toLowerCase().includes(p))) : [];
	const fresh = SP.q === text && SP.results ? SP.results.filter((x) => !(x.id && itemById(x.id))) : [];
	SP.hits = [...mine.map((x) => ({ x, mine: true })), ...fresh.map((x) => ({ x, mine: false }))];
	SP.sel = Math.min(SP.sel, Math.max(0, SP.hits.length - 1));
	const row = (h, i) => {
		const x = h.x;
		const t = h.mine && torrentsOf(x).find((t) => LOADING.includes(t.state));
		const sub = h.mine
			? [typeTag(x), x.year, x.size ? bytes(x.size) : "", t ? `<span style="color:${STATE[t.state][1]}">${STATE[t.state][0]} ${Math.round(t.done * 100)} %</span>` : seen(x)].filter(Boolean).join(" · ")
			: [typeTag(x), x.year, x.rating ? `★ ${x.rating}` : "", x.type === "series" && x.seasons ? `${x.seasons} ${x.seasons === 1 ? "Staffel" : "Staffeln"}` : "", esc(x.about || "")].filter(Boolean).join(" · ");
		const go = h.mine ? "Öffnen" : x.have ? `schon in ${appOf(x)}` : "+ Hinzufügen";
		return `<div class="hit ${i === SP.sel ? "sel" : ""}" data-i="${i}">${posterHtml(x)}<div class="grow"><div class="tt">${esc(x.title)}</div><div class="ss">${sub}</div></div><span class="go">${go}</span></div>`;
	};
	const n = mine.length;
	$("#sres").innerHTML = !w.length
		? `<div class="spot-sec" style="text-align:center;margin-top:30px">Sucht in deiner Bibliothek und in ${[S.state.services.radarr && "Radarr", S.state.services.sonarr && "Sonarr"].filter(Boolean).join(" und ") || "–"} – Filme und Serien in einem</div>`
		: `${n ? `<div class="spot-sec">In deiner Bibliothek</div><div class="spot-list">${SP.hits.slice(0, n).map(row).join("")}</div>` : ""}
			${SP.hits.length > n ? `<div class="spot-sec">Hinzufügen</div><div class="spot-list">${SP.hits.slice(n).map((h, i) => row(h, i + n)).join("")}</div>` : ""}
			${SP.busy || (text.length >= 2 && SP.q !== text) ? `<div class="spot-sec" style="text-align:center">Sucht in Radarr und Sonarr …</div>` : !SP.hits.length ? `<div class="spot-sec" style="text-align:center">Nichts gefunden für «${esc(text)}»</div>` : ""}`;
	$("#sres").querySelectorAll(".hit").forEach((el) => {
		el.onclick = () => pickHit(Number(el.dataset.i));
		el.onmousemove = () => {
			if (SP.sel === Number(el.dataset.i)) return;
			SP.sel = Number(el.dataset.i);
			$("#sres").querySelectorAll(".hit").forEach((x) => x.classList.toggle("sel", x === el));
		};
	});
	failedPosters($("#sres"));
}

function pickHit(i) {
	const h = SP.hits[i];
	if (!h) return;
	if (h.mine) return closeSpot(), openDetail(h.x.id);
	if (h.x.have) return toast(`${esc(h.x.title)} ist schon in ${appOf(h.x)}`);
	addFlow(h.x);
}

// adding: Radarr for a movie, Sonarr for a series; language and quality are remembered
function addFlow(x) {
	const series = x.type === "series";
	const last = LS.get("add", { lang: "de", quality: "1080p", monitor: "all" });
	const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([k, l]) => `<button data-v="${k}" class="${cur === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
	const m = modal(`
		<div class="head">${posterHtml(x)}<div><h3>${esc(x.title)}</h3><div class="sm muted" style="margin-top:4px">${[x.year, series ? `Serie${x.seasons ? ` · ${x.seasons} ${x.seasons === 1 ? "Staffel" : "Staffeln"}` : ""}` : `Film${x.runtime ? ` · ${runtime(x.runtime)}` : ""}`, x.rating ? `★ ${x.rating}` : ""].filter(Boolean).join(" · ")}</div>
		<div class="sm faint" style="margin-top:8px">${esc(x.about || "")}</div></div></div>
		<div class="field"><label>Sprache</label>${seg("lang", [["de", "Deutsch"], ["en", "Englisch"], ["orig", "Original"]], last.lang)}</div>
		<div class="field"><label>Qualität</label>${seg("quality", [["720p", "720p"], ["1080p", "1080p"], ["4k", "4K"]], last.quality)}</div>
		${series ? `<div class="field"><label>Was laden?</label>${seg("monitor", [["all", "Alle Staffeln"], ["first", "Nur Staffel 1"], ["future", "Nur Neue"]], last.monitor)}</div>` : ""}
		<div class="sm faint" style="margin-top:14px">Geht an ${appOf(x)} und sucht sofort. Beim ersten Mal legt die Mediathek dort das passende Profil an («Mediathek 1080p Deutsch»).</div>
		<div class="acts"><button class="btn" data-x>Abbrechen</button><button class="btn primary" data-go>Hinzufügen</button></div>`);
	failedPosters(m.el);
	const val = { ...last };
	m.el.querySelectorAll("[data-seg]").forEach((s) => s.addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		s.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
		val[s.dataset.seg] = b.dataset.v;
	}));
	$("[data-x]", m.el).onclick = m.close;
	$("[data-go]", m.el).onclick = async (e) => {
		e.currentTarget.classList.add("busy");
		e.currentTarget.textContent = "Wird hinzugefügt …";
		LS.set("add", val);
		try {
			const r = await api("POST", "/api/add", { type: x.type, key: x.key, lang: val.lang, quality: val.quality, monitor: val.monitor });
			m.close();
			closeSpot();
			toast(r.existed ? `${esc(x.title)} war schon da` : `${esc(x.title)} hinzugefügt – ${appOf(x)} sucht …`);
			SP.results = null;
			SP.q = "";
			await loadLib(true);
		} catch (err) {
			e.currentTarget.classList.remove("busy");
			e.currentTarget.textContent = "Hinzufügen";
			toast(esc(err.message), true);
		}
	};
}

// ---------- automatic mode ----------

const KIND = { watched: ["Gesehen", "var(--movie)"], space: ["Wenig Platz", "var(--bad)"], seeded: ["Fertig geteilt", "var(--ok)"], stalled: ["Hängt", "var(--warn)"] };

async function autoSheet() {
	let d;
	try {
		d = await api("GET", "/api/auto");
	} catch (err) {
		return toast(esc(err.message), true);
	}
	const r = d.rules;
	const sw = (id, on) => `<span class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><span></span></span>`;
	const n = (id, v, w = 64, step = 1) => `<input class="input num-in" id="${id}" type="number" min="0" step="${step}" value="${v}" style="width:${w}px">`;
	const m = modal(`
		<div style="display:flex;align-items:center;gap:12px"><h3 style="flex:1">Autopilot</h3>${sw("a-on", r.enabled)}</div>
		<div class="sm muted" style="margin-top:6px">Hält den Server sauber – alle 15 Minuten. Titel mit «Behalten», angefangene und gerade laufende werden nie angefasst.</div>
		<div class="rules">
			<div class="rule" data-rule="s"><div class="rule-top"><div class="t">Fertig geteilte Torrents entfernen</div>${sw("s-on", r.seeded.on)}</div><div class="d">Die Kopie im Download-Ordner wird gelöscht, der Titel bleibt in der Bibliothek.</div><div class="s"><span>ab Ratio</span>${n("s-ratio", r.seeded.ratio, 64, 0.1)}<span>oder nach</span>${n("s-days", r.seeded.days, 64)}<span>Tagen</span></div></div>
			<div class="rule" data-rule="w"><div class="rule-top"><div class="t">Gesehenes löschen</div>${sw("w-on", r.watched.on)}</div><div class="d">Überall gelöscht, wie mit «Überall löschen».</div><div class="s">${n("w-days", r.watched.days, 64)}<span>Tage nach dem Fertigschauen</span><span class="sep"></span><label class="inl"><input type="checkbox" id="w-movies" ${r.watched.movies ? "checked" : ""}>Filme</label><label class="inl"><input type="checkbox" id="w-series" ${r.watched.series ? "checked" : ""}>Serien</label></div></div>
			<div class="rule" data-rule="p"><div class="rule-top"><div class="t">Platz schaffen</div>${sw("p-on", r.space.on)}</div><div class="d">Gesehenes löschen, das am längsten her ist – bis wieder genug frei ist.</div><div class="s"><span>wenn weniger als</span>${n("p-gb", r.space.minGB, 72)}<span>GB frei sind</span></div></div>
			<div class="rule" data-rule="t"><div class="rule-top"><div class="t">Hängende Downloads ersetzen</div>${sw("t-on", r.stalled.on)}</div><div class="d">${"Radarr bzw. Sonarr sperrt den Release und sucht einen anderen."}</div><div class="s"><span>nach</span>${n("t-hours", r.stalled.hours, 64)}<span>Stunden ohne vollständige Quelle</span></div></div>
		</div>
		<div class="sm muted" style="margin:18px 2px 6px;font-weight:600">Beim nächsten Lauf</div>
		<div id="a-plan"></div>
		<div class="sm muted" style="margin:18px 2px 6px;font-weight:600">Erledigt</div>
		<div class="steps" style="max-height:220px;overflow:auto">${d.log.length ? d.log.map((e) => `<div class="step ${e.ok ? "" : "fail"}"><span class="tag" style="color:${KIND[e.kind][1]}">${KIND[e.kind][0]}</span><div class="grow"><div class="t">${esc(e.title)}</div><div class="s">${esc(e.ok ? e.why : e.error)} · ${new Date(e.at).toLocaleString("de-CH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div></div><span class="st num">${e.bytes ? bytes(e.bytes) : ""}</span></div>`).join("") : `<div class="sm faint" style="padding:8px 10px">Noch nichts</div>`}</div>
		<div class="acts"><button class="btn" data-run>Jetzt ausführen</button><button class="btn primary" data-save>Speichern</button></div>`, "wide");
	m.el.style.width = "min(680px, 100%)";
	const collect = () => ({
		enabled: $("#a-on", m.el).checked,
		seeded: { on: $("#s-on", m.el).checked, ratio: $("#s-ratio", m.el).value, days: $("#s-days", m.el).value },
		watched: { on: $("#w-on", m.el).checked, days: $("#w-days", m.el).value, movies: $("#w-movies", m.el).checked, series: $("#w-series", m.el).checked },
		space: { on: $("#p-on", m.el).checked, minGB: $("#p-gb", m.el).value },
		stalled: { on: $("#t-on", m.el).checked, hours: $("#t-hours", m.el).value }
	});
	const drawPlan = (plan) => {
		const box = $("#a-plan", m.el);
		if (plan && plan.error) return (box.innerHTML = `<div class="sm bad-text">${esc(plan.error)}</div>`);
		const total = (plan || []).reduce((a, x) => a + (x.bytes || 0), 0);
		box.innerHTML = plan && plan.length
			? `<div class="steps">${plan.map((a) => `<div class="step"><span class="tag" style="color:${KIND[a.kind][1]}">${KIND[a.kind][0]}</span><div class="grow"><div class="t">${esc(a.title)}</div><div class="s">${esc(a.why)}</div></div><span class="st num">${a.bytes ? bytes(a.bytes) : ""}</span></div>`).join("")}</div>${total ? `<div class="freed"><span class="muted">Würde frei</span><b class="num">${bytes(total)}</b></div>` : ""}`
			: `<div class="sm faint" style="padding:8px 10px;background:var(--tile-2);border-radius:14px">Nichts zu tun</div>`;
	};
	drawPlan(d.plan);
	const dim = () => m.el.querySelectorAll("[data-rule]").forEach((el) => el.classList.toggle("off", !$(`#${el.dataset.rule}-on`, m.el).checked));
	dim();
	m.el.querySelectorAll(".rule .switch input").forEach((i) => i.addEventListener("change", dim));
	// changing a rule shows its effect right away (saved, then planned again)
	let timer;
	m.el.querySelectorAll(".rules input, #a-on").forEach((i) => i.addEventListener("input", () => {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			try {
				await api("POST", "/api/auto", collect());
				drawPlan((await api("GET", "/api/auto")).plan);
			} catch (err) {
				toast(esc(err.message), true);
			}
		}, 400);
	}));
	$("[data-save]", m.el).onclick = async () => {
		try {
			const res = await api("POST", "/api/auto", collect());
			S.state.auto = res.rules.enabled;
			$("#openAuto").classList.toggle("on", S.state.auto);
			m.close();
			toast(S.state.auto ? "Autopilot ist an" : "Autopilot ist aus");
		} catch (err) {
			toast(esc(err.message), true);
		}
	};
	$("[data-run]", m.el).onclick = async (e) => {
		e.currentTarget.classList.add("busy");
		try {
			await api("POST", "/api/auto", collect());
			const res = await api("POST", "/api/auto/run");
			const bad = res.done.filter((x) => !x.ok).length;
			toast(res.done.length ? `${res.done.length - bad} erledigt${bad ? `, ${bad} fehlgeschlagen` : ""}` : "Nichts zu tun", bad > 0);
			m.close();
			await Promise.all([loadLib(true), loadTor()]);
		} catch (err) {
			toast(esc(err.message), true);
			e.currentTarget.classList.remove("busy");
		}
	};
}

// ---------- settings ----------

// per service: [field, label, placeholder, secret, full width]
const LOGIN_HELP = "Mit deinem Login holt die Mediathek den Schlüssel selbst – das Passwort wird nicht gespeichert.";
const SERVICES = [
	["radarr", "Radarr", "Filme", [["url", "Adresse", "http://…:7878", false, true], ["username", "Benutzer", "dein Radarr-Login"], ["password", "Passwort", "", true], ["apiKey", "oder API-Schlüssel", "Settings → General → API Key", true, true]], LOGIN_HELP],
	["sonarr", "Sonarr", "Serien", [["url", "Adresse", "http://…:8989", false, true], ["username", "Benutzer", "dein Sonarr-Login"], ["password", "Passwort", "", true], ["apiKey", "oder API-Schlüssel", "Settings → General → API Key", true, true]], LOGIN_HELP],
	["qbittorrent", "qBittorrent", "Downloads", [["url", "Adresse", "http://…:8080", false, true], ["username", "Benutzer", "leer, wenn ohne Login erlaubt"], ["password", "Passwort", "", true]]],
	["jellyfin", "Jellyfin", "Gesehen, läuft gerade", [["url", "Adresse", "http://…:8096", false, true], ["user", "Benutzer", "wessen «gesehen» zählt"], ["password", "Passwort", "", true], ["apiKey", "oder API-Schlüssel", "Dashboard → API-Schlüssel → +", true, true]], "Mit Benutzer und Passwort holt sich die Mediathek ein eigenes Token – das Passwort wird nicht gespeichert. Ohne Benutzer zählt der erste Admin."]
];

async function settingsSheet(first) {
	let cfg;
	try {
		cfg = await api("GET", "/api/settings");
	} catch (err) {
		return toast(esc(err.message), true);
	}
	const field = (svc, [k, label, help, secret, full]) => {
		const v = (cfg[svc] || {})[k];
		const isSet = secret && v && v.set;
		const ph = isSet ? "gesetzt – leer lassen, um ihn zu behalten" : help;
		return `<div class="field" style="margin-top:0${full ? ";grid-column:1/-1" : ""}"><label>${label}</label><input class="input" data-svc="${svc}" data-k="${k}" type="${secret ? "password" : "text"}" value="${secret ? "" : esc(v || "")}" placeholder="${esc(ph || "")}" autocomplete="${secret ? "new-password" : "off"}" spellcheck="false"></div>`;
	};
	const m = modal(`
		<h3>${first ? "Willkommen bei der Mediathek" : "Einstellungen"}</h3>
		<div class="sm muted" style="margin-top:6px">${first ? "Verbinde deine Dienste – Radarr oder Sonarr reicht für den Anfang. Die Adressen sucht die Mediathek selbst. " : ""}Schlüssel und Passwörter bleiben auf dem Server.</div>
		${SERVICES.map(([svc, name, what, fields, help]) => `<div class="svc-form"><h4>${name} <span class="faint" style="font-weight:500;font-size:12.5px">${what}</span><span class="st" data-st="${svc}"></span></h4>
			<div class="row2">${fields.map((f) => field(svc, f)).join("")}</div>${help ? `<div class="help">${help}</div>` : ""}</div>`).join("")}
		<div class="svc-form"><h4>Doppelte Kopien erkennen <span class="faint" style="font-weight:500;font-size:12.5px">optional</span></h4>
			<div class="field" style="margin-top:0"><label>Download-Ordner</label><input class="input" id="dmap" value="${esc(cfg.downloadsMap || "")}" placeholder="/downloads=/media/downloads" spellcheck="false"></div>
			<div class="help">qBittorrents Pfad = derselbe Ordner in diesem Container (lesend eingebunden). Dann sieht die Mediathek, ob eine Datei doppelt Platz braucht oder ein Hardlink ist.</div></div>
		<div class="acts"><button class="btn" data-test>Verbindung testen</button><button class="btn primary" data-save>Speichern</button></div>`, "wide");
	m.el.style.width = "min(720px, 100%)";
	const status = (svc, cls, text) => {
		const s = m.el.querySelector(`[data-st="${svc}"]`);
		if (s) (s.className = `st ${cls}`), (s.textContent = text);
	};
	// empty addresses: filled in with what's found on the usual ports
	api("GET", "/api/settings/detect")
		.then((found) => {
			for (const [svc, url] of Object.entries(found)) {
				const input = m.el.querySelector(`[data-svc="${svc}"][data-k="url"]`);
				if (!input) continue;
				if (url && !input.value) {
					input.value = url;
					status(svc, "faint", "Adresse gefunden");
				} else if (!url && !input.value) status(svc, "faint", "nicht gefunden – Adresse eintragen");
			}
		})
		.catch(() => null);
	const collect = () => {
		const body = { downloadsMap: $("#dmap", m.el).value };
		m.el.querySelectorAll("[data-svc]").forEach((i) => ((body[i.dataset.svc] = body[i.dataset.svc] || {})[i.dataset.k] = i.value));
		return body;
	};
	// saves; a login that didn't work shows at its service and keeps the form open
	const save = async () => {
		const r = await api("POST", "/api/settings", collect());
		S.state = await api("GET", "/api/state");
		m.el.querySelectorAll('[data-k="password"]').forEach((i) => i.dataset.svc !== "qbittorrent" && (i.value = ""));
		for (const [svc, msg] of Object.entries(r.errors || {})) status(svc, "bad-text", `✕ ${msg}`);
		return !Object.keys(r.errors || {}).length;
	};
	const test = async () => {
		m.el.querySelectorAll("[data-st]").forEach((s) => (s.textContent = "…"));
		const r = await api("POST", "/api/settings/test");
		for (const [svc, v] of Object.entries(r)) status(svc, v.ok ? "ok-text" : v.ok === false ? "bad-text" : "faint", v.ok ? `✓ verbunden · ${v.info}` : v.ok === false ? `✕ ${v.error}` : "nicht eingerichtet");
	};
	$("[data-test]", m.el).onclick = async (e) => {
		const b = e.currentTarget;
		b.classList.add("busy");
		try {
			if (await save()) await test();
		} catch (err) {
			toast(esc(err.message), true);
		}
		b.classList.remove("busy");
	};
	$("[data-save]", m.el).onclick = async (e) => {
		const b = e.currentTarget;
		b.classList.add("busy");
		try {
			if (!(await save())) return b.classList.remove("busy");
		} catch (err) {
			b.classList.remove("busy");
			return toast(esc(err.message), true);
		}
		m.close();
		location.reload();
	};
	if (!first) test().catch(() => null);
}

// ---------- login ----------

function showLogin() {
	$("#app").innerHTML = `<div class="login"><h1>Mediathek</h1><input class="input" id="pw" type="password" placeholder="Passwort" autocomplete="current-password"><button class="btn primary" id="go" style="justify-content:center">Anmelden</button><div id="msg" class="sm bad-text"></div></div>`;
	const go = async () => {
		try {
			await api("POST", "/api/login", { password: $("#pw").value });
			location.reload();
		} catch (err) {
			$("#msg").textContent = err.message === "login" ? "" : err.message;
		}
	};
	$("#go").onclick = go;
	$("#pw").onkeydown = (e) => e.key === "Enter" && go();
	setTimeout(() => $("#pw").focus(), 50);
}

start();
