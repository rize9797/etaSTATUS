// fetch-live.mjs refreshes data.json from real Sony + community sources.
// Zero dependencies. Requires Node 18+ (global fetch).
// Run: node fetch-live.mjs
//
// Sources (all live, all linked in the UI):
//   1. Sony PS5 support page  -> ordered version list + official patch notes
//   2. Sony PS4 support page  -> ordered version list + official patch notes
//   3. Sony PS5 updatelist XML (US) -> latest build, forced-minimum version, image size/sha/date
//   4. Sony PS4 updatelist XML (US) -> latest build, forced-minimum version, image size/date
//   5. Sony PSN status feed (SCEA region) -> live service status for US
//   6. MewX ps5-official-firmware-list (GitHub) -> PS5 build dates, sizes, sha256 per version

const OUT = new URL("./data.json", import.meta.url);

const URLS = {
  ps5Support:
    "https://www.playstation.com/en-us/support/hardware/ps5/system-software-info/",
  ps4Support:
    "https://www.playstation.com/en-us/support/hardware/ps4/system-software-info/",
  ps5Updatelist:
    "http://fus01.ps5.update.playstation.net/update/ps5/official/tJMRE80IbXnE9YuG0jzTXgKEjIMoabr6/list/us/updatelist.xml",
  ps4Updatelist:
    "http://fus01.ps4.update.playstation.net/update/ps4/list/us/ps4-updatelist.xml",
  psnScea: "https://status.playstation.com/data/statuses/region/SCEA.json",
  mewxReadme:
    "https://raw.githubusercontent.com/MewX/ps5-official-firmware-list/main/README.md",
};

const UA = { "User-Agent": "SlopStatus5-fetcher (contact: site owner)" };

// Release dates confirmed by press coverage at time of writing. Applied only
// when the version string matches a live-fetched version; anything unknown
// keeps date=null and the UI falls back to the firmware build date.
const RELEASE_DATES = {
  "26.06-14.00.00": { date: "2026-09-16", via: "IGN, 16 Sep 2026" },
  "26.05-13.60.00": { date: "2026-07-23", via: "PS Lifestyle / GameSpot, 23 Jul 2026" },
  "26.04-13.40.00": { date: "2026-06-04", via: "The Tech Outlook, 4 Jun 2026" },
  "26.03-13.20.00": { date: "2026-04-24", via: "firmware archive file date" },
  "26.01-12.70.00": { date: "2026-02-12", via: "firmware archive file date" },
  "26.01-12.60.00": { date: "2026-01-28", via: "press, 28 Jan 2026" },
  "14.00": { date: "2026-09-16", via: "PS Lifestyle, 16 Sep 2026" },
  "13.52": { date: "2026-06-16", via: "PSU, 16 Jun 2026" },
  "13.50": { date: "2026-03-17", via: "PS Lifestyle, 17 Mar 2026" },
  "13.04": { date: "2026-01-28", via: "PS Lifestyle, 28 Jan 2026" },
  "13.02": { date: "2025-10-01", via: "Sony support history" },
  "13.00": { date: "2025-09-21", via: "firmware archive file date" },
  "12.52": { date: "2025-07-10", via: "firmware archive file date" },
  "12.50": { date: "2025-03-14", via: "Sony support history" },
};

async function getText(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}
async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

function decodeEntities(s) {
  return s
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;|’/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, " "));
}

// Parse Sony support page: every "<h3 ...> Version: X </h3>" followed by notes.
// Returns [{version, notes}] in page order (latest first).
function parseSupportPage(html) {
  const out = [];
  const re = /<h3[^>]*>\s*Version:\s*([^<]+?)\s*<\/h3>/gi;
  let m;
  const heads = [];
  while ((m = re.exec(html))) heads.push({ version: m[1].trim(), idx: m.index + m[0].length });
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].idx : heads[i].idx + 3000;
    const chunk = html.slice(heads[i].idx, end);
    // first list block after the heading holds the patch notes
    const ul = chunk.match(/<ul[^>]*>([\s\S]*?)<\/ul>/i);
    const notes = ul ? stripTags(ul[1]).slice(0, 600) : "";
    out.push({ version: heads[i].version, notes });
  }
  return out;
}

function parsePs5Updatelist(xml) {
  const label = /<system_pup[^>]*label="([^"]+)"/i.exec(xml)?.[1] ?? null;
  const upd = /<system_pup[^>]*upd_version="([^"]+)"/i.exec(xml)?.[1] ?? null;
  const force = /<force_update>[\s\S]*?upd_version="([^"]+)"/i.exec(xml)?.[1] ?? null;
  const img = /<image size="(\d+)">([^<]*\/image\/(\d+_\d+)\/sys_([a-f0-9]+)\/)/i.exec(xml);
  return {
    label, // e.g. 26.06-14.00.00.39-00.00.00.0.1
    updVersion: upd, // e.g. 14.00.00.00
    forceMin: force, // e.g. 13.60.00.00 (minimum to stay online)
    size: img ? Number(img[1]) : null,
    build: img ? img[3] : null,
    sha256: img ? img[4] : null,
  };
}

function parsePs4Updatelist(xml) {
  const label = /<system_pup[^>]*label="([^"]+)"/i.exec(xml)?.[1] ?? null;
  const ver = /<system_pup[^>]*version="([^"]+)"/i.exec(xml)?.[1] ?? null;
  const force = /level1_system_version="([^"]+)"/i.exec(xml)?.[1] ?? null;
  const img = /<image size="(\d+)">([^<]*\/image\/(\d+_\d+)\/sys_([a-f0-9]+)\/)/i.exec(xml);
  return {
    label, // e.g. 14.00
    version: ver, // e.g. 14.008.000
    forceMin: force, // e.g. 13.520.000
    size: img ? Number(img[1]) : null,
    build: img ? img[3] : null,
    sysHash: img ? img[4] : null,
  };
}

// MewX README table rows: | long | short | type | build | sha256 | md5 | size |
function parseMewx(readme) {
  const map = new Map();
  for (const line of readme.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 8 || !/^\d/.test(cells[1] ?? "")) continue;
    const [long, short, type, build, sha, , sizeRaw] = cells.slice(1);
    if (!/Update/i.test(type)) continue;
    const size = Number(String(sizeRaw).replace(/[^\d]/g, "")) || null;
    if (!map.has(short)) map.set(short, { long, build, sha256: sha, size });
  }
  return map;
}

function shortOfPs5(supportVersion) {
  // "26.06-14.00.00" -> "14.00.00"
  const m = supportVersion.match(/(\d+\.\d+\.\d+)$/);
  return m ? m[1] : supportVersion;
}

function normPs4(v) {
  // Sony's numeric form pads the minor component: "13.520.000" means 13.52.
  // Take major + minor and drop the padding zeros.
  const p = String(v).split(".");
  let minor = (p[1] ?? "0").replace(/0+$/, "");
  if (minor === "") minor = "0";
  return `${p[0]}.${minor}`;
}

function cmpDotted(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function summarizePsn(feed) {
  const us = feed?.countries?.find((c) => c.countryCode === "US") ?? feed?.countries?.[0];
  const services = (us?.services ?? []).map((s) => ({
    name: s.serviceName ?? s.serviceId,
    down: (s.status ?? []).length > 0,
    detail: (s.status ?? []).map((x) => x?.message?.messageKey ?? x?.statusType ?? "issue").join(", "),
  }));
  const countryIssues = (us?.status ?? []).length;
  return {
    region: feed?.regionName ?? "SCEA",
    operational: countryIssues === 0 && services.every((s) => !s.down),
    services,
  };
}

async function main() {
  const errors = [];
  const [ps5Support, ps4Support, ps5Xml, ps4Xml, psnFeed, mewx] = await Promise.all([
    getText(URLS.ps5Support).catch((e) => (errors.push("ps5Support: " + e.message), null)),
    getText(URLS.ps4Support).catch((e) => (errors.push("ps4Support: " + e.message), null)),
    getText(URLS.ps5Updatelist).catch((e) => (errors.push("ps5Updatelist: " + e.message), null)),
    getText(URLS.ps4Updatelist).catch((e) => (errors.push("ps4Updatelist: " + e.message), null)),
    getJson(URLS.psnScea).catch((e) => (errors.push("psnScea: " + e.message), null)),
    getText(URLS.mewxReadme).catch((e) => (errors.push("mewxReadme: " + e.message), null)),
  ]);

  if (!ps5Support || !ps4Support || !ps5Xml || !ps4Xml) {
    console.error("FATAL: core Sony sources failed:\n" + errors.join("\n"));
    process.exit(1);
  }

  const ps5Versions = parseSupportPage(ps5Support);
  const ps4Versions = parseSupportPage(ps4Support);
  const ps5Up = parsePs5Updatelist(ps5Xml);
  const ps4Up = parsePs4Updatelist(ps4Xml);
  const mewxMap = mewx ? parseMewx(mewx) : new Map();
  const psn = psnFeed ? summarizePsn(psnFeed) : { region: "SCEA", operational: null, services: [] };

  const now = new Date().toISOString();

  function buildEntry(kind, v, notes, i, isLatest, updatelistInfo) {
    const rel = RELEASE_DATES[v] ?? null;
    let extra = {};
    if (kind === "ps5") {
      const mw = mewxMap.get(shortOfPs5(v));
      extra = {
        short: shortOfPs5(v),
        build: mw?.build ?? (isLatest ? updatelistInfo.build?.replace("_", "_") ?? null : null),
        size: mw?.size ?? (isLatest ? updatelistInfo.size : null),
        sha256: mw?.sha256 ?? (isLatest ? updatelistInfo.sha256 : null),
      };
      if (isLatest && updatelistInfo.build) {
        const ymd = updatelistInfo.build; // 2026_0909
        extra.build = ymd.slice(0, 4) + "-" + ymd.slice(5, 7) + "-" + ymd.slice(7, 9);
      } else if (mw?.build) {
        const b = mw.build;
        extra.build = /^\d{4}_\d{4}$/.test(b) ? b.slice(0, 4) + "-" + b.slice(5, 7) + "-" + b.slice(7) : b;
      }
    } else {
      extra = {
        size: isLatest ? updatelistInfo.size : null,
        build: isLatest && updatelistInfo.build
          ? updatelistInfo.build.slice(0, 4) + "-" + updatelistInfo.build.slice(5, 7) + "-" + updatelistInfo.build.slice(7)
          : null,
        sha256: null,
      };
    }
    return {
      version: v,
      ...extra,
      released: rel?.date ?? null,
      releasedVia: rel?.via ?? null,
      notes,
    };
  }

  const ps5History = ps5Versions.map((e, i) => buildEntry("ps5", e.version, e.notes, i, i === 0, ps5Up));
  const ps4History = ps4Versions.map((e, i) => buildEntry("ps4", e.version, e.notes, i, i === 0, ps4Up));

  // N-1 verdict: previous version still signs in while it meets Sony's
  // published forced-minimum in the US updatelist AND global PSN is up.
  // Comparisons use the short numeric form (PS5 "13.60.00", PS4 "13.52").
  function verdict(prevShort, forceMinShort, psnOperational, prevLabel) {
    if (!prevShort || !forceMinShort) {
      return { psn: "unknown", reason: "Sony's updatelist did not expose a minimum version; check the linked sources." };
    }
    const ok = cmpDotted(prevShort, forceMinShort) >= 0 && psnOperational !== false;
    return ok
      ? {
          psn: "online",
          reason: `Sony's US updatelist still accepts ${forceMinShort} as its minimum, which covers ${prevLabel}; PSN reports no outage.`,
        }
      : {
          psn: "blocked",
          reason: `Sony's US updatelist minimum is ${forceMinShort}, which no longer covers ${prevLabel}, or PSN reports an outage.`,
        };
  }

  const ps5ForceShort = (ps5Up.forceMin ?? "").split(".").slice(0, 3).join("."); // 13.60.00.00 -> 13.60.00
  const ps5ForceLabel =
    ps5History.find((h) => h.short === ps5ForceShort)?.version ?? ps5Up.forceMin;
  const ps4ForceShort = ps4Up.forceMin ? normPs4(ps4Up.forceMin) : null; // 13.520.000 -> 13.52

  function psnFor(kind, entry) {
    const key = kind === "ps5" ? entry.short : entry.version;
    const min = kind === "ps5" ? ps5ForceShort : ps4ForceShort;
    if (!key || !min) return "unknown";
    if (psn.operational === false) return "down";
    return cmpDotted(key, min) >= 0 ? "online" : "blocked";
  }
  for (const h of ps5History) h.psn = psnFor("ps5", h);
  for (const h of ps4History) h.psn = psnFor("ps4", h);

  const data = {
    fetchedAt: now,
    sources: URLS,
    psn: { ...psn, checkedAt: now },
    ps5: {
      latest: ps5History[0],
      minimum: { version: ps5ForceLabel, raw: ps5Up.forceMin },
      previous: {
        ...ps5History[1],
        ...verdict(ps5History[1]?.short, ps5ForceShort, psn.operational, ps5History[1]?.version),
      },
      history: ps5History,
      updatelist: { label: ps5Up.label, updVersion: ps5Up.updVersion },
    },
    ps4: {
      latest: ps4History[0],
      minimum: { version: ps4ForceShort, raw: ps4Up.version },
      previous: {
        ...ps4History[1],
        ...verdict(ps4History[1]?.version, ps4ForceShort, psn.operational, ps4History[1]?.version),
      },
      history: ps4History,
    },
    errors,
  };

  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote ${OUT.pathname}`);
  console.log(`PS5 latest ${data.ps5.latest.version} (min ${data.ps5.minimum.version}) prev=${data.ps5.previous.version}:${data.ps5.previous.psn}`);
  console.log(`PS4 latest ${data.ps4.latest.version} (min ${data.ps4.minimum.version}) prev=${data.ps4.previous.version}:${data.ps4.previous.psn}`);
  console.log(`PSN operational=${data.psn.operational} services=${data.psn.services.length}`);
  if (errors.length) console.log("non-fatal errors:\n" + errors.join("\n"));
}

main();
