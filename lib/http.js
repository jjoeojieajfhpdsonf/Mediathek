"use strict";
// A small wrapper around fetch: timeout, JSON in and out, and errors that say which service failed.

class ServiceError extends Error {
	constructor(service, message, status) {
		super(`${service}: ${message}`);
		this.service = service;
		this.status = status || null;
	}
}

// opts: { method, headers, json (body as JSON), form (body as x-www-form-urlencoded), timeout, raw }
async function call(service, url, opts = {}) {
	const headers = { ...(opts.headers || {}) };
	let body;
	if (opts.json !== undefined) {
		headers["content-type"] = "application/json";
		body = JSON.stringify(opts.json);
	} else if (opts.form) {
		headers["content-type"] = "application/x-www-form-urlencoded";
		body = new URLSearchParams(opts.form).toString();
	}
	let res;
	try {
		res = await fetch(url, { method: opts.method || (body ? "POST" : "GET"), headers, body, signal: AbortSignal.timeout(opts.timeout || 15000), redirect: opts.redirect || "follow" });
	} catch (err) {
		const why = err.name === "TimeoutError" ? "no answer (timeout)" : err.cause && err.cause.code === "ECONNREFUSED" ? "not reachable" : err.message;
		throw new ServiceError(service, why);
	}
	if (opts.raw) return res;
	const text = await res.text();
	if (!res.ok) {
		let msg = text.slice(0, 300);
		try {
			const j = JSON.parse(text);
			msg = (Array.isArray(j) ? j.map((x) => x.errorMessage || x.message).join(", ") : j.message || j.title || j.error) || msg;
		} catch {}
		throw new ServiceError(service, res.status === 401 || res.status === 403 ? "access denied – check the key or login" : `${res.status} ${msg}`.trim(), res.status);
	}
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

const base = (url) => String(url || "").trim().replace(/\/+$/, "");

module.exports = { call, base, ServiceError };
