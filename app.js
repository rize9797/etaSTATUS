// SlopStatus5 frontend.
// Renders the snapshot in data.json (produced by fetch-live.mjs from live
// Sony + community sources), then attempts a live revalidation in the browser
// and labels every value as snapshot vs live-confirmed.

const SNAPSHOT_URL = "./data.json";
const PROXY = (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u);

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtSize(bytes) {
  if (bytes == null) return null;
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  return Math.round(bytes / 1e6) + " MB";
}

function fmtAge(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "unknown age";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 48) return h + "h " + (m % 60) + "m ago";
  return Math.floor(h / 24) + "d ago";
}

function fmtTime(iso) {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  } catch {
    return iso;
  }
}

function dateCell(entry) {
  if (entry.released) return `<td class="d">${esc(entry.released)}</td>`;
  if (entry.build) return `<td class="d">${esc(entry.build)} <span class="tag">build</span></td>`;
  return `<td class="d">unverified</td>`;
}

function renderPsn(psn, live) {
  const banner = $("psn-banner");
  const dot = $("psn-dot");
  const text = $("psn-text");
  const op = psn.operational;
  banner.classList.remove("ok", "down");
  dot.classList.remove("ok", "down", "pending");
  if (op === true) {
    banner.classList.add("ok");
    dot.classList.add("ok");
    const names = psn.services.map((s) => s.name).join(", ");
    text.textContent =
      `PSN (US): all services up (${names}).` +
      (live ? ` Live check ${live}.` : ` Snapshot ${fmtTime(psn.checkedAt)}.`);
  } else if (op === false) {
    banner.classList.add("down");
    dot.classList.add("down");
    const bad = psn.services.filter((s) => s.down).map((s) => s.name).join(", ") || "unspecified service";
    text.textContent = `PSN (US): issues reported (${bad}).` + (live ? ` Live check ${live}.` : "");
  } else {
    dot.classList.add("pending");
    text.textContent = "PSN (US): status unknown (feed unreachable, see sources below).";
  }
}

function metaRow(k, v, mono) {
  if (v == null || v === "") return "";
  return `<div><dt>${esc(k)}</dt><dd${mono ? ' class="mono"' : ""}>${v}</dd></div>`;
}

function psnPill(s) {
  if (s === "online") return `<span class="pill ok">online</span>`;
  if (s === "blocked") return `<span class="pill bad">blocked</span>`;
  if (s === "down") return `<span class="pill bad">psn down</span>`;
  return `<span class="pill">unknown</span>`;
}

function renderConsole(prefix, data) {
  $(`${prefix}-latest`).textContent = data.latest.version;
  const L = data.latest;
  const released = L.released
    ? `${esc(L.released)}${L.releasedVia ? ` <span class="muted">(${esc(L.releasedVia)})</span>` : ""}`
    : L.build
      ? `${esc(L.build)} <span class="muted">(build date; release date unverified)</span>`
      : "unverified";
  $(`${prefix}-meta`).innerHTML =
    metaRow("Released", released) +
    metaRow("Build", L.build ? esc(L.build) : null, true) +
    metaRow("Download size", L.size != null ? esc(fmtSize(L.size)) : null, true) +
    (L.sha256 ? `<div><dt>SHA-256</dt><dd class="mono" title="${esc(L.sha256)}">${esc(L.sha256.slice(0, 16))}…</dd></div>` : "") +
    metaRow("Minimum accepted", data.minimum ? esc(data.minimum.version) : null, true);

  const p = data.previous;
  const v = $(`${prefix}-verdict`);
  const cls = p.psn === "online" ? "online" : p.psn === "blocked" ? "blocked" : "unknown";
  const title = p.psn === "online"
    ? `${p.version} (N-1, can use PSN)`
    : p.psn === "blocked"
      ? `${p.version} (N-1, blocked from PSN)`
      : `${p.version} (N-1, status unknown)`;
  v.className = "verdict " + cls;
  v.innerHTML = `<strong>${esc(title)}</strong><p>${esc(p.reason)}</p>`;

  const tb = $(`${prefix}-table`).querySelector("tbody");
  if (!data.history || data.history.length === 0) {
    tb.innerHTML = `<tr><td colspan="5" class="n">No data yet. Run npm run update to fetch the live snapshot.</td></tr>`;
    const head = document.querySelector(`#${prefix}-table`)?.closest("section")?.querySelector("h3");
    if (head) head.textContent = "Recent firmware history (no data yet)";
    return;
  }
  tb.innerHTML = data.history.map((h, i) => {
    const tag = i === 0 ? '<span class="tag now">latest</span>'
      : h.version === p.version ? '<span class="tag">N-1</span>' : "";
    const note = h.notes && h.notes.length > 220 ? h.notes.slice(0, 220) + "…" : (h.notes || "-");
    return `<tr${h.version === p.version ? ' class="is-prev"' : ""}>` +
      `<td class="v">${esc(h.version)}${tag}</td>` +
      `<td>${psnPill(h.psn)}</td>` +
      dateCell(h) +
      `<td class="s">${h.size != null ? esc(fmtSize(h.size)) : "-"}</td>` +
      `<td class="n" title="${esc(h.notes || "")}">${esc(note)}</td></tr>`;
  }).join("");
  const online = data.history.filter((h) => h.psn === "online").length;
  const head = document.querySelector(`#${prefix}-table`)?.closest("section")?.querySelector("h3");
  if (head) head.textContent = `Recent firmware history (${data.history.length} versions, ${online} online)`;
}

function renderSources(sources) {
  const rows = [
    ["Sony PS5 support page", "PS5 version list + patch notes", sources.ps5Support],
    ["Sony PS4 support page", "PS4 version list + patch notes", sources.ps4Support],
    ["Sony PS5 US updatelist XML", "PS5 latest build + sign-in minimum", sources.ps5Updatelist],
    ["Sony PS4 US updatelist XML", "PS4 latest build + sign-in minimum", sources.ps4Updatelist],
    ["Sony PSN status feed (SCEA)", "Live PSN service status, US", sources.psnScea],
    ["MewX PS5 firmware list", "PS5 build dates, sizes, SHA-256", "https://github.com/MewX/ps5-official-firmware-list"],
  ];
  $("src-table").querySelector("tbody").innerHTML = rows.map(([name, use, url]) =>
    `<tr><td>${esc(name)}</td><td>${esc(use)}</td>` +
    `<td><a href="${esc(url)}" rel="noopener" target="_blank">open</a></td></tr>`
  ).join("");
}

function setTag(prefix, state, text) {
  const el = $(`${prefix}-live`);
  el.className = "src-tag " + state;
  el.textContent = text;
}

async function fetchTimeout(url, ms, asJson) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return asJson ? r.json() : r.text();
  } finally {
    clearTimeout(t);
  }
}

function parseMewxLatest(readme) {
  // first "| long | short | Update | build | sha | ..." row = newest known
  for (const line of readme.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length >= 8 && /^\d/.test(cells[1] ?? "") && /Update/i.test(cells[3] ?? "")) {
      return { long: cells[1], short: cells[2] };
    }
  }
  return null;
}

function psnOperational(feed) {
  const us = feed?.countries?.find((c) => c.countryCode === "US") ?? feed?.countries?.[0];
  if (!us) return null;
  const ok = (us.status ?? []).length === 0 &&
    (us.services ?? []).every((s) => (s.status ?? []).length === 0);
  const names = (us.services ?? []).map((s) => s.serviceName ?? s.serviceId);
  return { ok, names };
}

async function liveCheck(snap) {
  const line = $("live-line");
  const btn = $("recheck");
  btn.disabled = true;
  if (!snap.fetchedAt) {
    line.textContent = "No snapshot yet. Run npm run update, then reload.";
    btn.disabled = false;
    return;
  }
  line.textContent = `Snapshot ${fmtAge(snap.fetchedAt)} (fetched ${fmtTime(snap.fetchedAt)}). Revalidating live…`;

  const [mewx, psn, ps5xml, ps4xml] = await Promise.allSettled([
    fetchTimeout("https://raw.githubusercontent.com/MewX/ps5-official-firmware-list/main/README.md", 9000, false),
    fetchTimeout(PROXY(snap.sources.psnScea), 9000, true),
    fetchTimeout(PROXY(snap.sources.ps5Updatelist), 9000, false),
    fetchTimeout(PROXY(snap.sources.ps4Updatelist), 9000, false),
  ]);

  const now = new Date().toISOString().slice(11, 19) + " UTC";
  const notes = [];

  if (mewx.status === "fulfilled") {
    const latest = parseMewxLatest(mewx.value);
    if (latest && latest.short === snap.ps5.latest.short) {
      setTag("ps5", "live", "live: confirmed " + now);
      notes.push("PS5 latest confirmed live (MewX, CORS)");
    } else if (latest) {
      setTag("ps5", "stale", "stale: upstream has " + latest.short);
      notes.push(`PS5 snapshot ${snap.ps5.latest.short} differs from upstream ${latest.short} (run node fetch-live.mjs)`);
    } else {
      setTag("ps5", "", "snapshot");
      notes.push("PS5 live parse failed, showing snapshot");
    }
  } else {
    setTag("ps5", "", "snapshot");
    notes.push("PS5 live unreachable, showing snapshot");
  }

  if (ps5xml.status === "fulfilled") {
    const m = /<system_pup[^>]*label="([^"]+)"/i.exec(ps5xml.value);
    if (m && m[1].startsWith(snap.ps5.latest.version)) notes.push("PS5 Sony updatelist agrees");
    else if (m) notes.push("PS5 Sony updatelist shows " + m[1]);
  }
  if (ps4xml.status === "fulfilled") {
    const m = /<system_pup[^>]*label="([^"]+)"/i.exec(ps4xml.value);
    if (m) {
      if (m[1] === snap.ps4.latest.version) {
        setTag("ps4", "live", "live: confirmed " + now);
        notes.push("PS4 latest confirmed live (Sony updatelist)");
      } else {
        setTag("ps4", "stale", "stale: upstream has " + m[1]);
        notes.push(`PS4 snapshot ${snap.ps4.latest.version} differs from Sony ${m[1]} (run node fetch-live.mjs)`);
      }
    }
  } else if (ps4xml.status !== "fulfilled") {
    setTag("ps4", "", "snapshot");
    notes.push("PS4 live unreachable, showing snapshot");
  }

  if (psn.status === "fulfilled") {
    const live = psnOperational(psn.value);
    if (live) {
      const same = live.ok === snap.psn.operational;
      renderPsn({ operational: live.ok, services: live.names.map((n) => ({ name: n })), checkedAt: snap.psn.checkedAt }, now);
      notes.push(same ? "PSN live agrees with snapshot" : "PSN live differs (banner shows live state)");
    } else {
      notes.push("PSN live parse failed, showing snapshot");
    }
  } else {
    notes.push("PSN live blocked by CORS proxy, showing snapshot");
  }

  line.textContent = `Snapshot ${fmtAge(snap.fetchedAt)} (fetched ${fmtTime(snap.fetchedAt)}). Live check ${now}: ${notes.join("; ")}.`;
  btn.disabled = false;
}

function tickClock() {
  $("clock").textContent = new Date().toISOString().slice(11, 19) + " UTC";
}

async function main() {
  const root = document.documentElement;
  const themeBtn = $("theme");
  const saved = localStorage.getItem("eta-theme");
  if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  const paint = () => { themeBtn.textContent = root.dataset.theme === "light" ? "dark" : "light"; };
  paint();
  themeBtn.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    localStorage.setItem("eta-theme", root.dataset.theme);
    paint();
  });
  tickClock();
  setInterval(tickClock, 1000);
  try {
    const r = await fetch(SNAPSHOT_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const snap = await r.json();
    renderPsn(snap.psn, null);
    renderConsole("ps5", snap.ps5);
    renderConsole("ps4", snap.ps4);
    renderSources(snap.sources);
    $("foot-fetched").textContent = "Snapshot fetched " + fmtTime(snap.fetchedAt);
    $("recheck").addEventListener("click", () => liveCheck(snap));
    liveCheck(snap);
  } catch (e) {
    $("psn-text").textContent = "Could not load data.json (" + e.message + "). Serve this folder over HTTP or run node fetch-live.mjs first.";
    $("live-line").textContent = "No snapshot available.";
  }
}

main();
