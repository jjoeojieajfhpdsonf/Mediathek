"use strict";
// Mediathek – the web app. A sidebar with the pages – library, adding, activity (qBittorrent),
// clean-up, autopilot – and ⌘K / Ctrl+K to search everything from anywhere.

const S = { state: null, lib: null, tor: null, open: null, page: "lib", type: "all", filter: "all", view: "poster", sort: "added", q: "" };
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

const ICON = {
	lib: "<rect x='3' y='4' width='7' height='16' rx='1.5'/><rect x='14' y='4' width='7' height='16' rx='1.5'/>",
	add: "<circle cx='12' cy='12' r='9'/><path d='M12 8v8M8 12h8'/>",
	act: "<path d='M12 3v12M7 10l5 5 5-5M5 21h14'/>",
	clean: "<path d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'/>",
	auto: "<path d='M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4'/><circle cx='12' cy='12' r='4'/>",
	refresh: "<path d='M20 11a8 8 0 10-2.3 5.7M20 5v6h-6'/>",
	search: "<circle cx='11' cy='11' r='7'/><path d='M20 20l-3.5-3.5'/>",
	grid: "<rect x='3' y='3' width='7' height='7' rx='1'/><rect x='14' y='3' width='7' height='7' rx='1'/><rect x='3' y='14' width='7' height='7' rx='1'/><rect x='14' y='14' width='7' height='7' rx='1'/>",
	table: "<path d='M3 5h18M3 12h18M3 19h18'/>",
	sort: "<path d='M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4'/>",
	filter: "<path d='M3 5h18l-7 8v6l-4 2v-8z'/>",
	pause: "<path d='M8 5v14M16 5v14'/>",
	play: "<path d='M7 4l13 8-13 8z'/>",
	slow: "<path d='M3 15c2-6 7-8 11-6s5 6 7 6M5 15v3M17 15v3'/>",
	trash: "<path d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'/>",
	gear: "<circle cx='12' cy='12' r='3'/><path d='M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1'/>",
	info: "<circle cx='12' cy='12' r='9'/><path d='M12 11v6M12 7h.01'/>"
};
const icon = (k, n = 18) => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const tbtn = (k, label, act, on) => `<button class="tb ${on ? "on" : ""}" data-a="${act}">${icon(k, 16)}<span>${label}</span></button>`;

function shell() {
	$("#app").innerHTML = `
		<div class="app">
			<header class="hd">
				<div class="logo"><svg width="30" height="30" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#222228"/><rect x="13" y="14" width="16" height="36" rx="4" fill="#ffc230"/><rect x="33" y="14" width="18" height="16" rx="4" fill="#35c5f4"/><rect x="33" y="34" width="18" height="16" rx="4" fill="#b18cff"/></svg>Mediathek${S.state.demo ? ` <span class="tag" style="margin-left:2px">Demo</span>` : ""}</div>
				<button class="hsearch" id="openSpot">${icon("search", 15)}<span>Film oder Serie suchen …</span><kbd>${IS_MAC ? "⌘K" : "Ctrl K"}</kbd></button>
				<div class="hicons">
					<button title="Aktivität" id="hAct">${icon("act")}<span class="badge" id="hBadge" hidden></span></button>
					<button title="Einstellungen" id="openSettings">${icon("gear")}</button>
				</div>
			</header>
			<nav class="sidenav" id="sidenav"></nav>
			<main class="pg"><div class="toolbar" id="toolbar"></div><div class="errs" id="errs"></div><div class="content" id="content"><div class="empty-h">Lädt …</div></div></main>
		</div>
		<aside class="drawer" id="drawer"></aside>
		<div class="spot" id="spot" hidden><div class="spot-in">
			<div class="spot-box"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="sq" placeholder="Film oder Serie suchen …" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div>
			<div id="sres"></div>
			<div class="spot-foot"><span>↑ ↓ auswählen</span><span>↵ öffnen oder hinzufügen</span><span>esc schliessen</span></div>
		</div></div>`;
	$("#openSpot").onclick = openSpot;
	$("#openSettings").onclick = () => settingsSheet(false);
	$("#hAct").onclick = () => go("activity");
	S.page = (location.hash.slice(1) in PAGES && location.hash.slice(1)) || LS.get("page", "lib");
	if (!(S.page in PAGES)) S.page = "lib";
	S.view = LS.get("view", "poster");
	window.addEventListener("hashchange", () => location.hash.slice(1) in PAGES && location.hash.slice(1) !== S.page && go(location.hash.slice(1)));
	bindSpot();
	render();
}

const PAGES = { lib: drawLibrary, add: drawAdd, activity: drawActivity, clean: drawClean, auto: drawAuto };

function go(page) {
	if (S.page !== page) window.scrollTo(0, 0);
	S.page = page;
	LS.set("page", page);
	if (location.hash.slice(1) !== page) history.replaceState(null, "", `#${page}`);
	render();
}

function render() {
	drawSide();
	const c = $("#content");
	if (c.dataset.page && c.dataset.page !== S.page) (c.dataset.page = ""), (c.dataset.html = "");
	$("#toolbar").dataset.html = "";
	PAGES[S.page]();
}

function drawSide() {
	const loading = torrents().filter((t) => LOADING.includes(t.state) && t.state !== "paused").length;
	const tidy = suggestions().length;
	const a = (k, ic, label, cnt, cls = "") => `<a class="${S.page === k ? "on" : ""} ${cls}" data-p="${k}">${icon(ic)}<span>${label}</span>${cnt ? `<span class="cnt">${cnt}</span>` : ""}</a>`;
	const html =
		a("lib", "lib", "Bibliothek") +
		(S.page === "lib" ? [["all", "Alle"], ["movie", "Filme"], ["series", "Serien"]].map(([k, l]) => `<a class="sub ${S.type === k ? "on" : ""}" data-t="${k}">${l}</a>`).join("") : "") +
		a("add", "add", "Hinzufügen") +
		a("activity", "act", "Aktivität", loading) +
		a("clean", "clean", "Aufräumen", tidy, "tidy") +
		a("auto", "auto", "Autopilot", S.state.auto ? "an" : "", S.state.auto ? "auto-on" : "");
	const nav = $("#sidenav");
	if (nav.dataset.html === html) return;
	nav.dataset.html = html;
	nav.innerHTML = html;
	nav.querySelectorAll("[data-p]").forEach((el) => (el.onclick = () => go(el.dataset.p)));
	nav.querySelectorAll("[data-t]").forEach((el) => (el.onclick = () => ((S.type = el.dataset.t), render())));
	$("#hBadge").hidden = !loading;
	$("#hBadge").textContent = loading || "";
}

async function loadLib(fresh) {
	try {
		S.lib = await api("GET", `/api/library${fresh ? "?fresh=1" : ""}`);
	} catch (err) {
		if (err.message !== "login") drawErrors({ mediathek: err.message });
		return;
	}
	drawErrors(S.lib.errors);
	if (["lib", "clean"].includes(S.page)) render();
	else drawSide();
	if (S.open) openDetail(S.open, true);
}

async function loadTor() {
	if (!S.state.services.qbittorrent) return;
	try {
		S.tor = await api("GET", "/api/torrents");
		S.torError = null;
	} catch (err) {
		S.torError = err.message;
	}
	drawSide();
	if (S.page === "activity") drawActivity();
	else if (S.page === "clean") drawClean();
	// posters show the progress of what's loading
	else if (S.page === "lib" && torrents().some((t) => t.item && LOADING.includes(t.state))) drawLibrary(true);
	if (S.open && $("#drawer").classList.contains("open")) drawDrawerTorrents();
}

// sets the page's html only when it changed (pages are redrawn every few seconds)
function put(el, html) {
	if (el.dataset.html === html) return false;
	el.dataset.html = html;
	el.innerHTML = html;
	return true;
}

function drawErrors(errors) {
	const list = Object.entries(errors || {});
	$("#errs").innerHTML = list.map(([svc, msg]) => `<div class="err">⚠ ${esc(msg)}<button data-set>Einstellungen</button></div>`).join("");
	$("#errs").querySelectorAll("[data-set]").forEach((b) => (b.onclick = () => settingsSheet(false)));
}

// ---------- clean-up ----------

// what could go, each with what it frees and what to do
function suggestions() {
	const out = [];
	const dupDone = torrents().filter((t) => t.copy && t.item && t.done >= 1 && t.ratio >= 1);
	if (dupDone.length) out.push({ key: "dup", t: "Doppelte Kopien", s: `${dupDone.length === 1 ? "Ein Film liegt" : `${dupDone.length} Titel liegen`} zweimal auf dem Server: in der Bibliothek und im Download-Ordner fürs Seeding. Genug verteilt ist schon (Ratio über 1) – die Download-Kopie kann weg, ${dupDone.length === 1 ? "der Titel bleibt" : "die Titel bleiben"}.`, list: dupDone.map((t) => ({ title: t.title, sub: `Ratio ${t.ratio}`, size: t.size })), n: dupDone.reduce((a, t) => a + t.size, 0), b: "Kopien löschen", go: () => dupFlow(dupDone) });
	// finished torrents whose title is gone from Radarr and Sonarr, or whose files are gone
	const arrsOn = S.state.services.radarr || S.state.services.sonarr;
	const orphans = arrsOn && S.lib ? torrents().filter((t) => !t.item && t.done >= 1 && (!t.category || /radarr|sonarr|tv|movie|film|serie/i.test(t.category))) : [];
	const empty = torrents().filter((t) => t.state === "missing");
	const stale = [...orphans, ...empty.filter((t) => !orphans.includes(t))];
	if (stale.length) out.push({ key: "stale", t: "Überflüssige Torrents", s: "Nicht mehr in Radarr oder Sonarr, oder ihre Dateien sind schon weg – qBittorrent kennt sie aber noch.", list: stale.map((t) => ({ title: t.title, sub: t.state === "missing" ? "Dateien schon weg" : "nicht mehr in Radarr oder Sonarr", size: t.state === "missing" ? 0 : t.size })), n: orphans.reduce((a, t) => a + t.size, 0), b: "Entfernen …", go: () => orphanFlow(stale) });
	const seenAll = items().filter((x) => x.watched >= 1);
	if (seenAll.length) out.push({ key: "seen", t: "Gesehen", s: "Fertig geschaut – löschen, was du nicht nochmals schauen willst.", items: seenAll });
	const old = items().filter((x) => x.watched === 0 && x.hasFile && x.added && Date.now() - x.added > 90 * 864e5);
	if (old.length) out.push({ key: "old", t: "Lange nicht geschaut", s: "Seit über drei Monaten da und nie angefangen.", items: old });
	return out;
}

function drawClean() {
	put($("#toolbar"), tbtn("refresh", "Neu berechnen", "refresh"));
	$("#toolbar").querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => (b.classList.add("busy"), await Promise.all([loadLib(true), loadTor()]), b.classList.remove("busy"))));
	if (!S.lib) return;
	const sp = S.lib.space;
	const movies = items().filter((x) => x.type === "movie").reduce((a, x) => a + (x.size || 0), 0);
	const series = items().filter((x) => x.type === "series").reduce((a, x) => a + (x.size || 0), 0);
	const dup = items().reduce((a, x) => a + (x.copy || 0), 0);
	const other = sp && sp.total ? Math.max(0, sp.total - sp.free - movies - series - dup) : 0;
	const w = (n) => (sp && sp.total ? `${(n / sp.total) * 100}%` : "0");
	const sugg = suggestions();
	const titleRow = (x) => `<tr data-id="${x.id}" style="cursor:pointer"><td style="width:42px">${posterHtml(x)}</td><td><div>${esc(x.title)}</div><div class="sm faint">${[x.year, x.type === "movie" ? "Film" : "Serie", x.lastPlayed ? `gesehen ${ago(x.lastPlayed)}` : `da ${ago(x.added)}`].filter(Boolean).join(" · ")}</div></td><td class="num" style="text-align:right">${bytes(freedBy(x))}</td><td style="width:1%"><button class="ic-btn" data-del="${x.id}" title="Überall löschen">${icon("trash", 15)}</button></td></tr>`;
	const html = `<div class="page-h"><h1>Aufräumen</h1></div>
		<div class="box2"><h3>Speicher</h3>
			<div class="space"><div><b class="num">${sp ? bytes(sp.free) : "–"}</b><span class="faint"> frei${sp && sp.total ? ` von ${bytes(sp.total)}` : ""}</span></div></div>
			${sp && sp.total ? `<div class="bar" style="margin-top:12px;height:10px"><i style="width:${w(movies)};background:var(--movie)"></i><i style="width:${w(series)};background:var(--series)"></i><i style="width:${w(dup)};background:var(--bad)"></i><i style="width:${w(other)};background:#4a4a52"></i></div>` : ""}
			<div class="legend2" style="margin-top:12px"><span><i style="background:var(--movie)"></i>Filme ${bytes(movies)}</span><span><i style="background:var(--series)"></i>Serien ${bytes(series)}</span>${dup ? `<span><i style="background:var(--bad)"></i>Doppelt ${bytes(dup)}</span>` : ""}${sp && sp.total ? `<span><i style="background:#4a4a52"></i>Anderes ${bytes(other)}</span>` : ""}</div></div>
		${sugg.map((g, i) => `<div class="box2"><div class="box-h"><div><h3>${esc(g.t)}</h3><div class="sm muted">${esc(g.s)}</div></div>${g.go ? `<button class="abtn ${g.key === "dup" ? "primary" : ""}" data-g="${i}">${g.n ? `${bytes(g.n)} · ` : ""}${g.b}</button>` : ""}</div>
			<table>${g.items ? g.items.map(titleRow).join("") : g.list.map((r) => `<tr><td>${esc(r.title)}<div class="sm faint">${esc(r.sub)}</div></td><td class="num" style="text-align:right">${r.size ? bytes(r.size) : ""}</td></tr>`).join("")}</table></div>`).join("") || `<div class="box2"><div class="sm faint">Nichts aufzuräumen.</div></div>`}`;
	if (!put($("#content"), html)) return;
	$("#content").querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => sugg[b.dataset.g].go()));
	$("#content").querySelectorAll("[data-del]").forEach((b) => (b.onclick = (e) => (e.stopPropagation(), deleteFlow(itemById(b.dataset.del)))));
	$("#content").querySelectorAll("tr[data-id]").forEach((r) => (r.onclick = () => openDetail(r.dataset.id)));
	failedPosters($("#content"));
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

const FILTERS = [["all", "Alle"], ["seen", "Gesehen"], ["unseen", "Nicht gesehen"], ["missing", "Fehlt"], ["loading", "Lädt"], ["old", "Nie geschaut, alt"]];
const SORTS = { added: "Neueste", title: "Titel", size: "Grösse", year: "Jahr" };

// the state of a title: colour and word for the pill on the poster
function statusOf(x) {
	const t = torrentsOf(x).find((t) => LOADING.includes(t.state));
	if (t) return t.state === "stalled" ? ["var(--warn)", "Hängt", t] : t.state === "paused" ? ["var(--faint)", "Pausiert", t] : ["var(--purple)", t.state === "down" ? `${Math.round(t.done * 100)} %` : STATE[t.state][0].replace(" …", ""), t];
	if (!x.hasFile) return [x.type === "movie" && x.status === "waiting" ? "var(--muted)" : "var(--bad)", x.type === "movie" && x.status === "waiting" ? "Erscheint noch" : "Fehlt", null];
	if (x.watching) return ["var(--accent)", "Läuft", null];
	if (x.watched >= 1) return ["var(--series)", "Gesehen", null];
	if (x.watched > 0) return ["var(--series)", `${Math.round(x.watched * 100)} % gesehen`, null];
	return ["var(--ok)", "Geladen", null];
}

function libList() {
	const w = S.q.toLowerCase().split(/\s+/).filter(Boolean);
	let list = items().filter((x) => (S.type === "all" || x.type === S.type) && w.every((p) => `${x.title} ${x.year || ""}`.toLowerCase().includes(p)));
	const f = S.filter;
	if (f === "seen") list = list.filter((x) => x.watched >= 1);
	if (f === "unseen") list = list.filter((x) => x.hasFile && !(x.watched >= 1));
	if (f === "missing") list = list.filter((x) => !x.hasFile);
	if (f === "loading") list = list.filter((x) => torrentsOf(x).some((t) => LOADING.includes(t.state)));
	if (f === "old") list = list.filter((x) => x.watched === 0 && x.hasFile && x.added && Date.now() - x.added > 90 * 864e5);
	const by = { added: (a, b) => (b.added || 0) - (a.added || 0), title: (a, b) => a.title.localeCompare(b.title), size: (a, b) => freedBy(b) - freedBy(a), year: (a, b) => (b.year || 0) - (a.year || 0) };
	return list.sort(by[S.sort]);
}

function drawLibrary(quiet) {
	if (!quiet) {
		put($("#toolbar"), `${tbtn("refresh", "Aktualisieren", "refresh")}${tbtn("add", "Hinzufügen", "add")}
			<input class="tb-find" id="q" placeholder="Filtern …" value="${esc(S.q)}">
			<div class="tb-right">${tbtn("grid", "Poster", "poster", S.view === "poster")}${tbtn("table", "Tabelle", "table", S.view === "table")}${tbtn("sort", SORTS[S.sort], "sort")}${tbtn("filter", S.filter === "all" ? "Filter" : FILTERS.find((x) => x[0] === S.filter)[1], "filter", S.filter !== "all")}</div>`);
		const tb = $("#toolbar");
		tb.querySelectorAll("[data-a]").forEach((b) => (b.onclick = (e) => {
			const a = b.dataset.a;
			if (a === "refresh") return b.classList.add("busy"), loadLib(true).then(() => b.classList.remove("busy"));
			if (a === "add") return go("add");
			if (a === "poster" || a === "table") return (S.view = a), LS.set("view", a), drawLibrary();
			if (a === "sort") return menu(b, Object.entries(SORTS), S.sort, (v) => ((S.sort = v), drawLibrary()));
			if (a === "filter") return menu(b, FILTERS, S.filter, (v) => ((S.filter = v), drawLibrary()));
		}));
		$("#q", tb).oninput = (e) => ((S.q = e.target.value), drawLibrary(true));
	}
	if (!S.lib) return;
	if (!items().length) return put($("#content"), `<div class="empty"><h2>Noch nichts in der Bibliothek</h2>Unter <b>Hinzufügen</b> oder mit <kbd>${IS_MAC ? "⌘K" : "Ctrl K"}</kbd> suchst du Filme und Serien.</div>`);
	const list = libList();
	const loaded = items().filter((x) => x.hasFile).length;
	const card = (x) => {
		const [c, label, t] = statusOf(x);
		const kept = (S.state.keep || []).includes(x.id) ? `<span class="keep-pin" title="Behalten">📌</span>` : "";
		return `<div class="pcard" data-id="${x.id}">${posterHtml(x, `<span class="pill" style="color:${c}"><i style="background:${c}"></i>${esc(label)}</span>${kept}${t ? `<div class="pstat"><i style="width:${t.done * 100}%;background:${c}"></i></div>` : x.watched > 0 && x.watched < 1 ? `<div class="pstat"><i style="width:${x.watched * 100}%;background:var(--series)"></i></div>` : ""}`)}
			<div class="acts"><button data-del="${x.id}" title="Überall löschen">${icon("trash", 14)}</button></div>
			<div class="info"><div class="tt">${esc(x.title)}</div><div class="ss"><span>${[x.year, x.type === "movie" ? "Film" : `${(x.seasons || []).length} Staffeln`].filter(Boolean).join(" · ")}</span><span class="num">${x.size ? bytes(x.size) : ""}</span></div></div></div>`;
	};
	const row = (x) => {
		const [c, label] = statusOf(x);
		return `<tr data-id="${x.id}" style="cursor:pointer"><td style="width:42px">${posterHtml(x)}</td><td><div>${esc(x.title)}</div><div class="sm faint">${x.year || ""}</div></td><td><span class="label" style="color:${c};background:color-mix(in srgb, ${c} 15%, transparent)">${esc(label)}</span></td><td>${typeTag(x)}</td><td class="sm muted">${esc(x.quality || "")}</td><td>${seen(x)}</td><td class="num">${x.size ? bytes(x.size) : ""}</td><td class="sm muted">${ago(x.added)}</td><td style="width:1%"><button class="ic-btn" data-del="${x.id}" title="Überall löschen">${icon("trash", 15)}</button></td></tr>`;
	};
	const sp = S.lib.space;
	const dup = items().reduce((a, x) => a + (x.copy || 0), 0);
	const html = (list.length ? (S.view === "poster" ? `<div class="pgrid">${list.map(card).join("")}</div>` : `<div class="box2" style="padding:6px 10px"><table class="ltable">${list.map(row).join("")}</table></div>`) : `<div class="empty-h">Nichts gefunden</div>`) +
		`<div class="legend2"><span><i style="background:var(--bad)"></i>Fehlt</span><span><i style="background:var(--purple)"></i>Lädt</span><span><i style="background:var(--warn)"></i>Hängt</span><span><i style="background:var(--ok)"></i>Geladen</span><span><i style="background:var(--series)"></i>Gesehen</span><span><i style="background:var(--accent)"></i>Läuft</span></div>
		<div class="stats"><div><b>${items().filter((x) => x.type === "movie").length}</b>Filme</div><div><b>${items().filter((x) => x.type === "series").length}</b>Serien</div><div><b>${loaded}</b>Geladen</div><div><b>${items().filter((x) => x.watched >= 1).length}</b>Gesehen</div><div><b>${sp ? bytes(sp.free) : "–"}</b>Frei</div>${dup ? `<div class="warn-stat" data-p="clean"><b>${bytes(dup)}</b>Doppelt</div>` : ""}</div>`;
	if (!put($("#content"), html)) return;
	const c = $("#content");
	c.querySelectorAll("[data-del]").forEach((b) => (b.onclick = (e) => (e.stopPropagation(), deleteFlow(itemById(b.dataset.del)))));
	c.querySelectorAll("[data-id]").forEach((el) => (el.onclick = () => openDetail(el.dataset.id)));
	c.querySelectorAll(".stats [data-p]").forEach((el) => (el.onclick = () => go(el.dataset.p)));
	failedPosters(c);
}

// a small menu under a toolbar button
function menu(anchor, options, current, pick) {
	document.querySelectorAll(".menu").forEach((m) => m.remove());
	const m = document.createElement("div");
	m.className = "menu";
	m.innerHTML = options.map(([k, l]) => `<button data-v="${k}" class="${k === current ? "on" : ""}">${esc(l)}</button>`).join("");
	const r = anchor.getBoundingClientRect();
	m.style.top = `${r.bottom + 6}px`;
	m.style.right = `${Math.max(8, innerWidth - r.right)}px`;
	document.body.append(m);
	const close = (e) => {
		if (e && m.contains(e.target)) return;
		m.remove();
		document.removeEventListener("mousedown", close);
	};
	setTimeout(() => document.addEventListener("mousedown", close));
	m.querySelectorAll("button").forEach((b) => (b.onclick = () => (pick(b.dataset.v), close())));
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
	// a refresh while it's open: only the torrent part changes (the search results stay)
	if (keep) return drawer.classList.contains("open") ? drawDrawerTorrents() : undefined;
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
		${missingSeason(x) !== null ? `<div id="relWrap"></div>` : ""}
		<label class="switch-row keep-row"><div class="grow"><div>Behalten</div><div class="sm faint">Der Autopilot löscht diesen Titel nie</div></div><span class="switch"><input type="checkbox" id="keep" ${(S.state.keep || []).includes(x.id) ? "checked" : ""}><span></span></span></label>
		<div style="display:flex;gap:8px;margin-top:14px"><button class="btn danger" id="del" style="flex:1;justify-content:center">Überall löschen${freedBy(x) ? ` · ${bytes(freedBy(x))}` : ""}</button></div>
		<div class="sm faint" style="margin-top:10px">Löscht in ${appOf(x)}${S.state.services.qbittorrent ? ", qBittorrent" : ""}${S.state.services.jellyfin ? " und Jellyfin" : ""} auf einmal – mit den Dateien.</div>`;
	$("#dx", drawer).onclick = closeDetail;
	$("#del", drawer).onclick = () => deleteFlow(x);
	$("#keep", drawer).onchange = async (e) => {
		try {
			S.state.keep = (await api("POST", `/api/items/${x.id}/keep`, { keep: e.target.checked })).keep;
			if (S.page === "lib") drawLibrary(true);
		} catch (err) {
			toast(esc(err.message), true);
		}
	};
	drawDrawerTorrents();
	failedPosters(drawer);
	drawer.classList.add("open");
	if (missingSeason(x) !== null && !keep) loadReleases(x);
}

// what isn't loaded yet: a movie without file, or the first season of a series with episodes missing
function missingSeason(x) {
	// something is already loading: nothing to explain
	if (torrentsOf(x).some((t) => ["down", "meta", "queued", "checking"].includes(t.state))) return null;
	if (x.type === "movie") return x.hasFile ? null : -1;
	const s = (x.seasons || []).find((s) => s.monitored && s.have < s.of);
	return s ? s.n : null;
}
const LANG_OF = { Deutsch: "de", Englisch: "en", Original: "orig" };
const LANG_NAME = { de: "Deutsch", en: "Englisch", orig: "Original" };
const profileParts = (name) => {
	const m = /^Mediathek (720p|1080p|4K) (Deutsch|Englisch|Original)$/.exec(name || "");
	return m ? { quality: m[1] === "4K" ? "4k" : m[1], lang: LANG_OF[m[2]] } : null;
};

// asks Radarr/Sonarr what a search finds right now and says why nothing was loaded
async function loadReleases(x) {
	const box = $("#relWrap");
	if (!box) return;
	const season = missingSeason(x);
	const head = `<div class="sm muted" style="margin:18px 2px 6px;font-weight:600">${x.type === "movie" ? "Noch nicht geladen" : `Staffel ${season} unvollständig`}</div>`;
	box.innerHTML = `${head}<div class="relbox"><div class="sm faint">Fragt ${appOf(x)}, was die Suche findet …</div></div>`;
	let d;
	try {
		d = await api("GET", `/api/items/${x.id}/releases${x.type === "series" ? `?season=${season}` : ""}`);
	} catch (err) {
		if ($("#relWrap") === box) box.innerHTML = `${head}<div class="relbox"><div class="sm bad-text">${esc(err.message)}</div></div>`;
		return;
	}
	if (S.open !== x.id || $("#relWrap") !== box) return;
	const ok = d.releases.filter((r) => !r.rejected);
	const lang = d.releases.filter((r) => r.rejected && r.reasons.some((m) => /is wanted, but found|language/i.test(m)));
	const cur = profileParts(d.profile);
	const wanted = cur ? LANG_NAME[cur.lang] : null;
	let msg;
	if (!d.releases.length) msg = `Die Suche findet gerade nichts. ${appOf(x)} sucht regelmässig weiter.`;
	else if (ok.length) msg = `${ok.length} passende ${ok.length === 1 ? "Release" : "Releases"} – ${appOf(x)} lädt den besten, sobald er an der Reihe ist. Du kannst auch selbst einen wählen.`;
	else if (lang.length) msg = `${d.releases.length} gefunden, aber ${lang.length === d.releases.length ? "keiner" : "kaum einer"} ${wanted ? `auf ${wanted}` : "in der gewünschten Sprache"}. Deine Indexer haben vor allem englische Releases.`;
	else msg = `${d.releases.length} gefunden, aber keiner passt zum Profil${d.profile ? ` «${esc(d.profile)}»` : ""}.`;
	const other = cur ? ["orig", "en", "de"].filter((l) => l !== cur.lang) : ["orig", "en"];
	box.innerHTML = `${head}<div class="relbox"><div class="sm" style="line-height:1.5">${msg}</div>
		<div class="relacts">${!ok.length && d.releases.length ? other.map((l) => `<button class="btn small" data-lang="${l}">Auf ${LANG_NAME[l]} suchen</button>`).join("") : ""}${d.releases.length ? `<button class="btn small" data-all>Alle ${d.releases.length} ansehen</button>` : ""}</div></div>`;
	box.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = async () => {
		b.classList.add("busy");
		try {
			const r = await api("POST", `/api/items/${x.id}/reprofile`, { lang: b.dataset.lang, quality: cur ? cur.quality : "1080p" });
			toast(`Profil «${esc(r.profile)}» – ${appOf(x)} sucht neu`);
			await sleep(4000);
			await loadLib(true);
			loadReleases(x);
		} catch (err) {
			toast(esc(err.message), true);
			b.classList.remove("busy");
		}
	}));
	const all = $("[data-all]", box);
	if (all) all.onclick = () => releasesSheet(x, d.releases);
}

// Radarr's and Sonarr's reasons, in German where they're common
const LANGS = { German: "Deutsch", English: "Englisch", French: "Französisch", Spanish: "Spanisch", Italian: "Italienisch", Hindi: "Hindi", Japanese: "Japanisch", Korean: "Koreanisch", Russian: "Russisch", Portuguese: "Portugiesisch", Turkish: "Türkisch", Dutch: "Niederländisch", Polish: "Polnisch", Unknown: "unbekannt", Original: "Original" };
const langDe = (list) => list.split(/,\s*/).map((l) => LANGS[l.trim()] || l.trim()).join(", ");
function reasonDe(r) {
	let m;
	if ((m = /^(.+?) is wanted, but found (.+)$/i.exec(r))) return `Sprache: ${langDe(m[1])} gewünscht, ${langDe(m[2])} gefunden`;
	if ((m = /^(.+?) is not wanted in profile$/i.exec(r))) return `${m[1]} ist nicht im Profil`;
	if (/hardcode subs found/i.test(r)) return "Eingebrannte Untertitel";
	if ((m = /^Not enough seeders: (\d+)/i.exec(r))) return `Zu wenige Seeds (${m[1]})`;
	if (/blocklist/i.test(r)) return "Gesperrt (Blocklist)";
	if (/existing file.*(meets|better)/i.test(r)) return "Vorhandene Datei ist schon gut genug";
	if (/custom format score/i.test(r)) return "Format-Bewertung zu tief";
	if (/size/i.test(r) && /(too|maximum|minimum)/i.test(r)) return "Grösse passt nicht";
	return r;
}

// every release the search found, the rejected ones with the reason – any can be loaded
function releasesSheet(x, list) {
	const age = (d) => (d === null || d === undefined ? "" : d < 1 ? "heute" : d < 60 ? `${Math.round(d)} Tage` : `${Math.round(d / 30)} Mon.`);
	const m = modal(`<h3>${esc(x.title)} – Releases</h3><div class="sm muted" style="margin:6px 0 12px">Was ${appOf(x)} gerade findet. Abgelehnte kannst du trotzdem laden.</div>
		<div class="rels">${list.map((r, i) => `<div class="rel ${r.rejected ? "rej" : ""}"><div class="grow"><div class="t">${esc(r.title)}</div>
			<div class="s">${[r.quality, bytes(r.size), r.languages.map((l) => LANGS[l] || l).join(" + "), r.seeders !== null ? `${r.seeders} Seeds` : "", r.indexer, age(r.age)].filter(Boolean).map(esc).join(" · ")}</div>
			${r.rejected ? `<div class="s why">${esc(r.reasons.slice(0, 2).map(reasonDe).join(" · "))}</div>` : ""}</div>
			<button class="btn small ${r.rejected ? "" : "primary"}" data-i="${i}">${r.rejected ? "Trotzdem laden" : "Laden"}</button></div>`).join("")}</div>`, "wide");
	m.el.style.width = "min(760px, 100%)";
	m.el.querySelectorAll("[data-i]").forEach((b) => (b.onclick = async () => {
		const r = list[Number(b.dataset.i)];
		b.classList.add("busy");
		try {
			await api("POST", `/api/items/${x.id}/grab`, { guid: r.guid, indexerId: r.indexerId });
			m.close();
			toast("Wird geladen – erscheint gleich bei qBittorrent");
			await sleep(2500);
			await Promise.all([loadTor(), loadLib(true)]);
		} catch (err) {
			toast(esc(err.message), true);
			b.classList.remove("busy");
		}
	}));
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

function drawActivity() {
	const tor = S.tor;
	const anyRunning = torrents().some((t) => !["paused", "done", "missing", "error"].includes(t.state));
	put($("#toolbar"), `${tbtn("refresh", "Aktualisieren", "refresh")}${S.state.services.qbittorrent ? `<span class="tb-sep"></span>${tbtn(anyRunning ? "pause" : "play", anyRunning ? "Alle pausieren" : "Alle fortsetzen", anyRunning ? "pauseAll" : "resumeAll")}${tbtn("slow", "Langsam", "slow", tor && tor.slow)}` : ""}`);
	$("#toolbar").querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
		b.classList.add("busy");
		try {
			const a = b.dataset.a;
			if (a === "slow") await api("POST", "/api/slow");
			else if (a === "pauseAll" || a === "resumeAll") await api("POST", `/api/torrents/all/${a === "pauseAll" ? "pause" : "resume"}`);
		} catch (err) {
			toast(esc(err.message), true);
		}
		await loadTor();
		b.classList.remove("busy");
	}));
	if (!S.state.services.qbittorrent) return put($("#content"), `<div class="page-h"><h1>Aktivität</h1></div><div class="box2"><div class="sm muted">qBittorrent ist nicht verbunden – in den <a href="#" id="qbset" style="text-decoration:underline">Einstellungen</a> einrichten.</div></div>`) && ($("#qbset").onclick = (e) => (e.preventDefault(), settingsSheet(false)));
	if (S.torError) return put($("#content"), `<div class="page-h"><h1>Aktivität</h1></div><div class="box2"><div class="sm bad-text">${esc(S.torError)}</div></div>`);
	if (!tor) return put($("#content"), `<div class="empty-h">Lädt …</div>`);
	const order = { error: 0, down: 0, meta: 1, checking: 1, queued: 2, stalled: 2, paused: 3, seed: 4, done: 5, missing: 6 };
	const list = [...torrents()].sort((a, b) => order[a.state] - order[b.state] || (b.added || 0) - (a.added || 0));
	const active = list.filter((t) => LOADING.includes(t.state) || t.state === "error");
	const rest = list.filter((t) => !active.includes(t));
	const html = `<div class="page-h"><h1>Aktivität</h1><span class="muted num">↓ ${speed(tor.down)} · ↑ ${speed(tor.up)}${tor.slow ? " · langsam" : ""}</span></div>
		<div class="box2"><h3>Warteschlange <span class="faint">${active.length}</span></h3><div class="tors">${active.map((t) => torrentRow(t)).join("") || `<div class="sm faint" style="padding:10px 4px">Nichts wird geladen</div>`}</div></div>
		${rest.length ? `<div class="box2"><h3>Seeding und fertig <span class="faint">${rest.length}</span></h3><div class="tors">${rest.map((t) => torrentRow(t)).join("")}</div></div>` : ""}`;
	if (put($("#content"), html)) bindTorrents($("#content"));
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

function drawAuto() {
	put($("#toolbar"), tbtn("play", "Jetzt ausführen", "run"));
	$("#toolbar").querySelector("[data-a]").onclick = async (e) => {
		const b = e.currentTarget;
		b.classList.add("busy");
		try {
			const res = await api("POST", "/api/auto/run");
			const bad = res.done.filter((x) => !x.ok).length;
			toast(res.done.length ? `${res.done.length - bad} erledigt${bad ? `, ${bad} fehlgeschlagen` : ""}` : "Nichts zu tun", bad > 0);
			await Promise.all([loadLib(true), loadTor()]);
			$("#content").dataset.html = "";
			drawAuto();
		} catch (err) {
			toast(esc(err.message), true);
		}
		b.classList.remove("busy");
	};
	if ($("#content").dataset.page === "auto") return;
	$("#content").dataset.page = "auto";
	$("#content").dataset.html = "";
	$("#content").innerHTML = `<div class="empty-h">Lädt …</div>`;
	api("GET", "/api/auto").then(autoPage, (err) => toast(esc(err.message), true));
}

function autoPage(d) {
	if (S.page !== "auto") return;
	const r = d.rules;
	const sw = (id, on) => `<span class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><span></span></span>`;
	const n = (id, v, w = 64, step = 1) => `<input class="input num-in" id="${id}" type="number" min="0" step="${step}" value="${v}" style="width:${w}px">`;
	const c = $("#content");
	c.innerHTML = `<div class="page-h"><h1>Autopilot</h1><span class="muted">alle 15 Minuten · «Behalten», angefangene und laufende Titel werden nie angefasst</span></div>
		<div class="box2 auto-master"><div><h3 style="margin:0">Autopilot ${r.enabled ? "ist an" : "ist aus"}</h3><div class="sm muted">${r.enabled ? "Die eingeschalteten Regeln laufen von selbst." : "Nichts passiert von selbst. «Jetzt ausführen» geht trotzdem."}</div></div>${sw("a-on", r.enabled)}</div>
		<div class="rules">
			<div class="rule" data-rule="s"><div class="rule-top"><div class="t">Fertig geteilte Torrents entfernen</div>${sw("s-on", r.seeded.on)}</div><div class="d">Die Kopie im Download-Ordner wird gelöscht, der Titel bleibt in der Bibliothek.</div><div class="s"><span>ab Ratio</span>${n("s-ratio", r.seeded.ratio, 64, 0.1)}<span>oder nach</span>${n("s-days", r.seeded.days, 64)}<span>Tagen</span></div></div>
			<div class="rule" data-rule="w"><div class="rule-top"><div class="t">Gesehenes löschen</div>${sw("w-on", r.watched.on)}</div><div class="d">Überall gelöscht, wie mit «Überall löschen».</div><div class="s">${n("w-days", r.watched.days, 64)}<span>Tage nach dem Fertigschauen</span><span class="sep"></span><label class="inl"><input type="checkbox" id="w-movies" ${r.watched.movies ? "checked" : ""}>Filme</label><label class="inl"><input type="checkbox" id="w-series" ${r.watched.series ? "checked" : ""}>Serien</label></div></div>
			<div class="rule" data-rule="p"><div class="rule-top"><div class="t">Platz schaffen</div>${sw("p-on", r.space.on)}</div><div class="d">Gesehenes löschen, das am längsten her ist – bis wieder genug frei ist.</div><div class="s"><span>wenn weniger als</span>${n("p-gb", r.space.minGB, 72)}<span>GB frei sind</span></div></div>
			<div class="rule" data-rule="t"><div class="rule-top"><div class="t">Hängende Downloads ersetzen</div>${sw("t-on", r.stalled.on)}</div><div class="d">Radarr bzw. Sonarr sperrt den Release und sucht einen anderen.</div><div class="s"><span>nach</span>${n("t-hours", r.stalled.hours, 64)}<span>Stunden ohne vollständige Quelle</span></div></div>
		</div>
		<div class="two">
			<div class="box2"><h3>Beim nächsten Lauf</h3><div id="a-plan"></div></div>
			<div class="box2"><h3>Erledigt</h3><div class="steps" style="max-height:340px;overflow:auto">${d.log.length ? d.log.map((e) => `<div class="step ${e.ok ? "" : "fail"}"><span class="tag" style="color:${KIND[e.kind][1]}">${KIND[e.kind][0]}</span><div class="grow"><div class="t">${esc(e.title)}</div><div class="s">${esc(e.ok ? e.why : e.error)} · ${new Date(e.at).toLocaleString("de-CH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div></div><span class="st num">${e.bytes ? bytes(e.bytes) : ""}</span></div>`).join("") : `<div class="sm faint" style="padding:8px 10px">Noch nichts</div>`}</div></div>
		</div>`;
	const collect = () => ({
		enabled: $("#a-on", c).checked,
		seeded: { on: $("#s-on", c).checked, ratio: $("#s-ratio", c).value, days: $("#s-days", c).value },
		watched: { on: $("#w-on", c).checked, days: $("#w-days", c).value, movies: $("#w-movies", c).checked, series: $("#w-series", c).checked },
		space: { on: $("#p-on", c).checked, minGB: $("#p-gb", c).value },
		stalled: { on: $("#t-on", c).checked, hours: $("#t-hours", c).value }
	});
	const drawPlan = (plan) => {
		const box = $("#a-plan", c);
		if (!box) return;
		if (plan && plan.error) return (box.innerHTML = `<div class="sm bad-text">${esc(plan.error)}</div>`);
		const total = (plan || []).reduce((a, x) => a + (x.bytes || 0), 0);
		box.innerHTML = plan && plan.length
			? `<div class="steps">${plan.map((a) => `<div class="step"><span class="tag" style="color:${KIND[a.kind][1]}">${KIND[a.kind][0]}</span><div class="grow"><div class="t">${esc(a.title)}</div><div class="s">${esc(a.why)}</div></div><span class="st num">${a.bytes ? bytes(a.bytes) : ""}</span></div>`).join("")}</div>${total ? `<div class="freed"><span class="muted">Würde frei</span><b class="num">${bytes(total)}</b></div>` : ""}`
			: `<div class="sm faint" style="padding:8px 2px">Nichts zu tun</div>`;
	};
	drawPlan(d.plan);
	const dim = () => c.querySelectorAll("[data-rule]").forEach((el) => el.classList.toggle("off", !$(`#${el.dataset.rule}-on`, c).checked));
	dim();
	// every change is saved right away, and the plan follows
	let timer;
	c.querySelectorAll(".rules input, #a-on").forEach((i) => i.addEventListener("input", () => {
		dim();
		clearTimeout(timer);
		timer = setTimeout(async () => {
			try {
				const res = await api("POST", "/api/auto", collect());
				if (S.state.auto !== res.rules.enabled) {
					S.state.auto = res.rules.enabled;
					toast(S.state.auto ? "Autopilot ist an" : "Autopilot ist aus");
					const h = $(".auto-master h3", c);
					if (h) h.textContent = `Autopilot ${S.state.auto ? "ist an" : "ist aus"}`;
					drawSide();
				}
				drawPlan((await api("GET", "/api/auto")).plan);
			} catch (err) {
				toast(esc(err.message), true);
			}
		}, 350);
	}));
}

// ---------- the add page: search through Radarr and Sonarr, add right there ----------
const ADD = { q: "", results: null, busy: false, timer: null, seq: 0, open: null };

function drawAdd() {
	put($("#toolbar"), tbtn("search", "Suchen", "focus"));
	$("#toolbar").querySelector("[data-a]").onclick = () => $("#aq") && $("#aq").focus();
	if ($("#content").dataset.page !== "add") {
		$("#content").dataset.page = "add";
		$("#content").dataset.html = "";
		$("#content").innerHTML = `<div class="page-h"><h1>Hinzufügen</h1><span class="muted">Filme gehen an Radarr, Serien an Sonarr</span></div>
			<div class="addq">${icon("search", 18)}<input id="aq" placeholder="z. B. Interstellar, The Bear …" autocomplete="off" spellcheck="false" value="${esc(ADD.q)}"></div><div id="ares"></div>`;
		const aq = $("#aq");
		aq.oninput = () => {
			ADD.q = aq.value;
			clearTimeout(ADD.timer);
			const q = aq.value.trim();
			if (q.length < 2) return (ADD.results = null), drawResults();
			ADD.busy = true;
			drawResults();
			const seq = ++ADD.seq;
			ADD.timer = setTimeout(async () => {
				let res = [];
				try {
					res = await api("GET", `/api/search?q=${encodeURIComponent(q)}`);
				} catch (err) {
					toast(esc(err.message), true);
				}
				if (seq !== ADD.seq) return;
				ADD.busy = false;
				ADD.results = res;
				drawResults();
			}, 300);
		};
		setTimeout(() => aq.focus(), 30);
	}
	drawResults();
}

function drawResults() {
	const box = $("#ares");
	if (!box) return;
	if (!ADD.q.trim()) return (box.innerHTML = `<div class="empty-h">Tippe einen Titel – gesucht wird über Radarr und Sonarr.</div>`);
	const list = ADD.results || [];
	const last = LS.get("add", { lang: "de", quality: "1080p", monitor: "all" });
	const opt = (v, cur, l) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`;
	box.innerHTML = list.map((x, i) => {
		const mine = x.id && itemById(x.id);
		return `<div class="result ${ADD.open === x.key ? "open" : ""}" data-r="${i}">${posterHtml(x)}<div class="grow"><h2>${esc(x.title)}<span>${x.year ? `(${x.year})` : ""}</span></h2>
			<div class="meta">${typeTag(x)}${x.rating ? `<span class="label">★ ${x.rating}</span>` : ""}${x.runtime ? `<span class="label">${runtime(x.runtime)}</span>` : ""}${x.seasons ? `<span class="label">${x.seasons} ${x.seasons === 1 ? "Staffel" : "Staffeln"}</span>` : ""}${x.have ? `<span class="label ok">${mine ? "In der Bibliothek" : `Schon in ${appOf(x)}`}</span>` : ""}</div>
			<div class="ov">${esc(x.about || "")}</div>
			${x.have ? (mine ? `<div class="form" style="display:flex"><button class="abtn" data-open="${x.id}">Öffnen</button></div>` : "") : `<div class="form"><label>Sprache<select data-k="lang">${opt("de", last.lang, "Deutsch")}${opt("en", last.lang, "Englisch")}${opt("orig", last.lang, "Original")}</select></label><label>Qualität<select data-k="quality">${opt("720p", last.quality, "720p")}${opt("1080p", last.quality, "1080p")}${opt("4k", last.quality, "4K")}</select></label>${x.type === "series" ? `<label>Laden<select data-k="monitor">${opt("all", last.monitor, "Alle Staffeln")}${opt("first", last.monitor, "Nur Staffel 1")}${opt("future", last.monitor, "Nur Neue")}</select></label>` : ""}<button class="abtn primary" data-add="${i}">${x.type === "movie" ? "Film" : "Serie"} hinzufügen</button></div>`}
			</div></div>`;
	}).join("") || `<div class="empty-h">${ADD.busy ? "Sucht in Radarr und Sonarr …" : "Nichts gefunden"}</div>`;
	if (ADD.busy && list.length) box.insertAdjacentHTML("afterbegin", `<div class="sm faint" style="margin-top:12px">Sucht …</div>`);
	box.querySelectorAll(".result").forEach((r) => (r.onclick = (e) => {
		if (e.target.closest(".form")) return;
		const x = list[Number(r.dataset.r)];
		ADD.open = ADD.open === x.key ? null : x.key;
		box.querySelectorAll(".result").forEach((o) => o.classList.toggle("open", o === r && ADD.open === x.key));
	}));
	box.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openDetail(b.dataset.open)));
	box.querySelectorAll("[data-add]").forEach((b) => (b.onclick = async () => {
		const x = list[Number(b.dataset.add)];
		const form = b.closest(".form");
		const val = { ...last };
		form.querySelectorAll("[data-k]").forEach((s) => (val[s.dataset.k] = s.value));
		LS.set("add", val);
		b.classList.add("busy");
		b.textContent = "Wird hinzugefügt …";
		try {
			const r = await api("POST", "/api/add", { type: x.type, key: x.key, lang: val.lang, quality: val.quality, monitor: val.monitor });
			toast(r.existed ? `${esc(x.title)} war schon da` : `${esc(x.title)} hinzugefügt – ${appOf(x)} sucht …`);
			x.have = true;
			x.id = r.id;
			ADD.open = null;
			await loadLib(true);
			drawResults();
		} catch (err) {
			toast(esc(err.message), true);
			b.classList.remove("busy");
			b.textContent = `${x.type === "movie" ? "Film" : "Serie"} hinzufügen`;
		}
	}));
	failedPosters(box);
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
