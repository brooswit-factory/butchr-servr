// @bun
// ../butchr/src/providers/pinned-webpage.ts
import { lookup } from "dns/promises";
import { BlockList, isIP } from "net";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { checkServerIdentity } from "tls";
import { createGunzip, createInflate, createBrotliDecompress } from "zlib";
var denied4 = new BlockList;
var denied6 = new BlockList;
var global6 = new BlockList;
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4], ["168.63.129.16", 32]])
  denied4.addSubnet(network, prefix, "ipv4");
global6.addSubnet("2000::", 3, "ipv6");
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]])
  denied6.addSubnet(network, prefix, "ipv6");
function publicProviderAddress(address) {
  const family = isIP(address);
  return family === 4 ? !denied4.check(address, "ipv4") : family === 6 && global6.check(address, "ipv6") && !denied6.check(address, "ipv6");
}
function createPinnedWebpageFetch(deps = {}) {
  const resolve = deps.resolve ?? ((host) => lookup(host, { all: true, verbatim: true }));
  return async (input, init = {}) => {
    const url = new URL(input), host = url.hostname.replace(/^\[|\]$/g, "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || host === "localhost" || /\.(?:localhost|local|internal)$/i.test(host) || init.body || init.method && init.method !== "GET")
      throw Error("Public webpage read required");
    const headers = new Headers(init.headers);
    for (const key of headers.keys())
      if (!["if-none-match", "if-modified-since"].includes(key))
        throw Error("Webpage credentials and custom headers are forbidden");
    const signal = AbortSignal.any([AbortSignal.timeout(deps.timeoutMs ?? 1e4), ...init.signal ? [init.signal] : []]);
    const answers = await Promise.race([isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : resolve(host), new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(Error("Webpage resolution timed out")), { once: true });
    })]);
    if (signal.aborted || !answers.length || answers.length > 32 || answers.some((a) => !publicProviderAddress(a.address) || a.family !== isIP(a.address)))
      throw Error("Nonpublic or invalid webpage address");
    const pinned = answers[0];
    return new Promise((resolveResponse, reject) => {
      const request = deps.request ?? (url.protocol === "https:" ? httpsRequest : httpRequest);
      let responseBody = null;
      let settled = false;
      const req = request({ protocol: url.protocol, hostname: pinned.address, port: url.port || (url.protocol === "https:" ? 443 : 80), path: url.pathname + url.search, agent: false, method: "GET", headers: { host: url.host, ...Object.fromEntries(headers) }, family: pinned.family, ...url.protocol === "https:" ? { rejectUnauthorized: true, checkServerIdentity: (_hostname, cert) => checkServerIdentity(host, cert), ...!isIP(host) ? { servername: host } : {} } : {}, signal, maxHeaderSize: 16384 }, (message) => {
        if (signal.aborted) {
          message.destroy();
          reject(Error("Webpage request aborted"));
          return;
        }
        message.pause();
        let source = null, decoder = null, encoded = 0, decoded = 0, ended = false;
        const destroy = () => {
          decoder?.destroy();
          message.destroy();
          req.destroy();
        };
        const fail = () => {
          if (ended)
            return;
          ended = true;
          try {
            responseBody?.error(Error("Webpage response failed"));
          } catch {}
          responseBody = null;
          destroy();
        };
        message.on("error", fail);
        req.on("error", fail);
        const body = new ReadableStream({ start(controller) {
          responseBody = controller;
        }, pull(controller) {
          if (!source) {
            const coding = String(message.headers["content-encoding"] ?? "identity").trim().toLowerCase();
            if (!["identity", "", "gzip", "x-gzip", "deflate", "br"].includes(coding)) {
              fail();
              return;
            }
            decoder = coding === "gzip" || coding === "x-gzip" ? createGunzip() : coding === "deflate" ? createInflate() : coding === "br" ? createBrotliDecompress() : null;
            source = decoder ?? message;
            message.on("data", (chunk) => {
              encoded += chunk.byteLength;
              if (encoded > 1e6)
                fail();
            });
            source.on("data", (chunk) => {
              source.pause();
              decoded += chunk.byteLength;
              if (decoded > 1e6) {
                fail();
                return;
              }
              if (!ended)
                controller.enqueue(new Uint8Array(chunk));
            });
            source.on("end", () => {
              if (ended)
                return;
              ended = true;
              responseBody = null;
              controller.close();
            });
            if (decoder) {
              decoder.on("error", fail);
              message.pipe(decoder);
            }
          }
          source.resume();
        }, cancel() {
          ended = true;
          responseBody = null;
          destroy();
        } }, { highWaterMark: 0 });
        const responseHeaders = new Headers;
        for (const [name, value] of Object.entries(message.headers))
          if (value !== undefined)
            for (const item of Array.isArray(value) ? value : [value])
              responseHeaders.append(name, item);
        try {
          const status = message.statusCode ?? 502;
          const response = new Response([204, 205, 304].includes(status) ? null : body, { status, headers: responseHeaders });
          settled = true;
          resolveResponse(response);
          if ([204, 205, 304].includes(status)) {
            responseBody = null;
            message.destroy();
            req.destroy();
          }
        } catch {
          responseBody = null;
          message.destroy();
          req.destroy();
          reject(Error("Invalid webpage response"));
        }
      });
      req.on("error", () => {
        if (!settled)
          reject(Error("Webpage connection failed"));
        else {
          try {
            responseBody?.error(Error("Webpage connection failed"));
          } catch {}
        }
      });
      req.end();
    });
  };
}

// ../butchr/src/resources/jira-key.ts
var JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-[0-9]+$/;

// ../butchr/src/resources/confluence-url.ts
function pageIdFromUrl(url) {
  const m = /\/pages\/(\d+)(?:\/|$)/.exec(url);
  return m?.[1] ?? null;
}

// ../butchr/src/resources/id.ts
function isIssueKey(id) {
  return JIRA_KEY_RE.test(id);
}
var PROJECT_ID_RE = /^[A-Z][A-Z0-9_]*$/;
function isProjectId(id) {
  return PROJECT_ID_RE.test(id);
}

// ../butchr/src/resources/github-issue-ref.ts
var OWNER_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
var REPO_RE = /^[a-z0-9._-]{1,100}$/;
var NUMBER_RE = /^[1-9][0-9]{0,9}$/;
var isGithubOwner = (owner) => OWNER_RE.test(owner);
var isGithubRepo = (repo) => REPO_RE.test(repo) && repo !== "." && repo !== "..";
function isGithubIssueRef(id) {
  return parseGithubIssueRef(id) !== null;
}
function formatGithubIssueRef(ref) {
  const id = `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`;
  if (!isGithubIssueRef(id))
    throw new Error(`invalid GitHub issue reference: ${JSON.stringify(id)}`);
  return id;
}
function parseGithubIssueRef(id) {
  const m = /^([^/#]+)\/([^/#]+)#([^/#]+)$/.exec(id);
  if (!m)
    return null;
  const [, owner, repo, number] = m;
  if (!isGithubOwner(owner) || !isGithubRepo(repo) || !NUMBER_RE.test(number))
    return null;
  return { owner, repo, number: Number(number) };
}
function githubIssueRefFromUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.port || u.username || u.password)
    return null;
  const m = /^\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/?$/.exec(u.pathname);
  if (!m)
    return null;
  return parseGithubIssueRef(`${m[1].toLowerCase()}/${m[2].toLowerCase()}#${m[3]}`);
}
function githubPrRefFromUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.port || u.username || u.password)
    return null;
  const m = /^\/([^/]+)\/([^/]+)\/pull\/([^/]+)\/?$/.exec(u.pathname);
  if (!m)
    return null;
  return parseGithubIssueRef(`${m[1].toLowerCase()}/${m[2].toLowerCase()}#${m[3]}`);
}

// ../butchr/src/resources/linked-discovery.ts
var KEY_CANDIDATE_RE = /\b[A-Z][A-Z0-9_]*-[0-9]+\b/g;
var URL_CANDIDATE_RE = /https?:\/\/[^\s<>"'`\[\]]+/g;
var TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;
function stripTrailingPunct(raw) {
  let url = raw;
  for (let prev = "";prev !== url; ) {
    prev = url;
    url = url.replace(TRAILING_PUNCT_RE, "");
  }
  return url;
}
var ATLASSIAN_CLOUD_HOST_RE = /\.atlassian\.net$/;
function jiraBrowseKey(rawUrl) {
  const url = stripTrailingPunct(rawUrl);
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    return null;
  if (!ATLASSIAN_CLOUD_HOST_RE.test(u.hostname))
    return null;
  const browse = /^\/browse\/([^/]+)\/?$/.exec(u.pathname);
  return browse && isIssueKey(browse[1]) ? browse[1] : null;
}
function classifyUrl(rawUrl) {
  const url = stripTrailingPunct(rawUrl);
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    return null;
  const browseKey = jiraBrowseKey(url);
  if (browseKey)
    return { kind: "jira-key", target: browseKey };
  if (ATLASSIAN_CLOUD_HOST_RE.test(u.hostname) && u.pathname.startsWith("/wiki/"))
    return { kind: "confluence", target: url };
  const issueRef = githubIssueRefFromUrl(url);
  if (issueRef)
    return { kind: "github-issue", target: formatGithubIssueRef(issueRef) };
  const prRef = githubPrRefFromUrl(url);
  if (prRef)
    return { kind: "github-pr", target: formatGithubIssueRef(prRef) };
  return { kind: "webpage", target: url };
}
function descriptionItems(description) {
  const items = [];
  for (const m of description.matchAll(KEY_CANDIDATE_RE)) {
    if (isIssueKey(m[0]))
      items.push({ kind: "jira-key", target: m[0] });
  }
  for (const m of description.matchAll(URL_CANDIDATE_RE)) {
    const item = classifyUrl(m[0]);
    if (item)
      items.push(item);
  }
  return dedupeByTarget(items);
}
function dedupeByTarget(items) {
  const seen = new Set;
  const out = [];
  for (const item of items) {
    if (seen.has(item.target))
      continue;
    seen.add(item.target);
    out.push(item);
  }
  return out;
}

// ../butchr/src/jira-watch/external-poll.ts
import { lookup as dnsLookup } from "dns/promises";
import { isIP as isIP2 } from "net";
import { fnv1a } from "@brooswit/sundry";

// ../butchr/src/labels/pr.ts
function headRefMatch(headRef, key) {
  if (headRef === key)
    return "exact";
  if (headRef.length > key.length && headRef.startsWith(key) && "-_/".includes(headRef[key.length]))
    return "prefixed";
  return null;
}
var ghHeaders = (token) => ({
  accept: "application/vnd.github+json",
  "user-agent": "butchr",
  ...token ? { authorization: `Bearer ${token}` } : {}
});
function reviewState(reviews) {
  const latest = new Map;
  for (const r of reviews) {
    if (r.state !== "APPROVED" && r.state !== "CHANGES_REQUESTED")
      continue;
    latest.set(r.user?.login ?? "", r.state);
  }
  const votes = [...latest.values()];
  if (votes.includes("CHANGES_REQUESTED"))
    return "changes-requested";
  if (votes.includes("APPROVED"))
    return "approved";
  return "open";
}
async function fetchPull(deps, ref) {
  const res = await deps.fetchImpl(`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`, { headers: ghHeaders(deps.token) });
  if (!res.ok)
    return "unavailable";
  return await res.json();
}
var DISCOVER_CANDIDATES = 5;
var BACKOFF_MS = [15000, 30000, 60000, 120000];
var MERGED_SWEEP_EVERY_ROUNDS = 20;
var THROTTLE_FALLBACK_MS = 60000;
function parseIntHeader(v) {
  if (v == null || v.trim() === "")
    return;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
async function discoverStatus(deps, key, status, onSearch) {
  let unconfirmed = false;
  let prefixed;
  for (const org of deps.orgs) {
    const q = new URLSearchParams({ q: `is:pr is:${status} head:${key} org:${org}` });
    const res = await deps.fetchImpl(`https://api.github.com/search/issues?${q}`, { headers: ghHeaders(deps.token) });
    onSearch(res);
    if (!res.ok) {
      return {
        nonOk: {
          status: res.status,
          remaining: parseIntHeader(res.headers.get("x-ratelimit-remaining")),
          resetEpochSec: parseIntHeader(res.headers.get("x-ratelimit-reset"))
        }
      };
    }
    const body = await res.json();
    for (const item of body.items?.slice(0, DISCOVER_CANDIDATES) ?? []) {
      const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(item.repository_url);
      if (!m)
        continue;
      const ref = { owner: m[1], repo: m[2], number: item.number };
      const pull = await fetchPull(deps, ref);
      if (pull === "unavailable") {
        unconfirmed = true;
        continue;
      }
      const match = headRefMatch(pull.head.ref, key);
      if (match === "exact")
        return { found: { ref, pull } };
      if (match === "prefixed")
        prefixed ??= { ref, pull };
    }
  }
  if (prefixed)
    return { found: prefixed };
  return unconfirmed ? { unconfirmed: true } : {};
}
async function fetchReviews(deps, ref) {
  const res = await deps.fetchImpl(`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`, { headers: ghHeaders(deps.token) });
  if (!res.ok)
    return "unavailable";
  return await res.json();
}

class PrTracker {
  deps;
  cache = new Map;
  merged = new Set;
  keyState = new Map;
  loggedStatus = new Map;
  throttledUntil = 0;
  searchesThisPoll = 0;
  lastRemaining;
  now;
  constructor(deps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }
  pullRequestFor(key) {
    const ref = this.cache.get(key);
    return ref ? { ...ref } : undefined;
  }
  onSearch = (res) => {
    this.searchesThisPoll++;
    const remaining = parseIntHeader(res.headers.get("x-ratelimit-remaining"));
    if (remaining !== undefined)
      this.lastRemaining = remaining;
  };
  handleNonOk(key, outcome, now) {
    const resetMs = outcome.resetEpochSec != null ? outcome.resetEpochSec * 1000 : undefined;
    this.throttledUntil = resetMs != null && resetMs > now ? resetMs : now + THROTTLE_FALLBACK_MS;
    if (this.loggedStatus.get(key) === outcome.status)
      return;
    this.loggedStatus.set(key, outcome.status);
    const remainingPart = outcome.remaining != null ? `remaining=${outcome.remaining}` : "remaining=absent";
    const resetPart = resetMs != null ? `reset=${new Date(resetMs).toISOString()}` : "reset=absent";
    this.deps.log?.(`[pr] ${key} search ${outcome.status}: ${remainingPart} ${resetPart}`);
  }
  async stateFor(key) {
    if (this.merged.has(key))
      return "merged";
    let ref = this.cache.get(key);
    let pull;
    if (ref) {
      pull = await fetchPull(this.deps, ref);
    } else {
      const now = this.now();
      if (now < this.throttledUntil)
        return "unknown";
      const ks = this.keyState.get(key);
      if (ks && now < ks.nextSearchAt)
        return "unknown";
      const runMerged = !ks || ks.rounds === 0 || ks.rounds % MERGED_SWEEP_EVERY_ROUNDS === 0;
      const openOutcome = await discoverStatus(this.deps, key, "open", this.onSearch);
      if (openOutcome.nonOk) {
        this.handleNonOk(key, openOutcome.nonOk, now);
        return "unknown";
      }
      let found = openOutcome.found;
      let unconfirmed = openOutcome.unconfirmed ?? false;
      if (!found && runMerged) {
        const mergedOutcome = await discoverStatus(this.deps, key, "merged", this.onSearch);
        if (mergedOutcome.nonOk) {
          this.handleNonOk(key, mergedOutcome.nonOk, now);
          return "unknown";
        }
        found = mergedOutcome.found;
        unconfirmed = unconfirmed || (mergedOutcome.unconfirmed ?? false);
      }
      if (!found && unconfirmed) {
        return "unknown";
      }
      if (!found) {
        const misses = (ks?.misses ?? 0) + 1;
        const rounds = (ks?.rounds ?? 0) + 1;
        const delay = BACKOFF_MS[Math.min(misses - 1, BACKOFF_MS.length - 1)];
        this.keyState.set(key, { misses, rounds, nextSearchAt: now + delay });
        return null;
      }
      this.keyState.delete(key);
      ref = found.ref;
      pull = found.pull;
      this.cache.set(key, ref);
    }
    if (pull === "unavailable")
      return "unknown";
    if (pull.merged) {
      this.merged.add(key);
      this.cache.delete(key);
      return "merged";
    }
    if (pull.state === "closed") {
      this.cache.delete(key);
      return null;
    }
    const reviews = await fetchReviews(this.deps, ref);
    if (reviews === "unavailable")
      return "unknown";
    return reviewState(reviews);
  }
  endPoll() {
    if (this.searchesThisPoll > 0) {
      this.deps.log?.(`[pr] searches=${this.searchesThisPoll} remaining=${this.lastRemaining ?? "?"}`);
    }
    this.searchesThisPoll = 0;
  }
}

// ../butchr/src/jira-watch/external-poll.ts
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }, (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}
var CONFLUENCE_TIMEOUT_MS = 1e4;
var BARE_PAGE_ID_RE = /^[0-9]+$/;
async function pollConfluencePage(target, deps) {
  const pageId = BARE_PAGE_ID_RE.test(target) ? target : pageIdFromUrl(target);
  if (pageId === null)
    return { status: "unreadable" };
  let r;
  try {
    r = await withTimeout(deps.getVersion(pageId), deps.timeoutMs ?? CONFLUENCE_TIMEOUT_MS);
  } catch {
    return { status: "error" };
  }
  if (!r.ok)
    return r.transient ? { status: "error" } : { status: "unreadable", httpStatus: r.httpStatus };
  return { status: "ok", fingerprint: String(r.version) };
}
var GITHUB_TIMEOUT_MS = 1e4;
function isGithubRateLimited(res) {
  return res.headers.get("x-ratelimit-remaining") === "0" || res.headers.get("retry-after") !== null;
}
async function pollGithubLink(item, priorEtag, deps) {
  const ref = parseGithubIssueRef(item.target);
  if (!ref)
    return { status: "unreadable" };
  const path = item.kind === "github-issue" ? "issues" : "pulls";
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}/${path}/${ref.number}`;
  const timeoutMs = deps.timeoutMs ?? GITHUB_TIMEOUT_MS;
  let res;
  try {
    res = await withTimeout(deps.fetchImpl(url, {
      headers: { ...ghHeaders(deps.token), ...priorEtag ? { "if-none-match": priorEtag } : {} },
      signal: AbortSignal.timeout(timeoutMs)
    }), timeoutMs);
  } catch {
    return { status: "error" };
  }
  if (res.status === 304) {
    await drain(res);
    return { status: "not-modified" };
  }
  if (res.status === 403 && isGithubRateLimited(res)) {
    await drain(res);
    return { status: "error" };
  }
  if (res.status === 404 || res.status === 403) {
    await drain(res);
    return { status: "unreadable", httpStatus: res.status };
  }
  if (!res.ok) {
    await drain(res);
    return { status: "error" };
  }
  const etag = res.headers.get("etag");
  await drain(res);
  return { status: "ok", fingerprint: etag ?? `no-etag:${res.headers.get("last-modified") ?? ""}` };
}
var PULL_ACTIVITY_PREFIX = "pr-activity/1";
var PULL_REVIEWS_PER_PAGE = 100;
var PULL_REVIEW_PAGE_CAP = 50;
function parseLinkHeader(header) {
  const out = {};
  for (const part of (header ?? "").split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
    if (m)
      for (const rel of m[2].split(/\s+/))
        out[rel] = m[1];
  }
  return out;
}
function isGithubApiUrl(url) {
  try {
    return new URL(url).origin === "https://api.github.com";
  } catch {
    return false;
  }
}
function formatPullActivityFingerprint(a) {
  return [PULL_ACTIVITY_PREFIX, a.comments, a.reviewComments, a.reviews, a.etag].join("\t");
}
function parsePullActivityFingerprint(fingerprint) {
  if (!fingerprint)
    return null;
  const parts = fingerprint.split("\t");
  if (parts.length < 5 || parts[0] !== PULL_ACTIVITY_PREFIX)
    return null;
  const [comments, reviewComments, reviews] = parts.slice(1, 4).map(Number);
  if (![comments, reviewComments, reviews].every(isCount))
    return null;
  return { comments, reviewComments, reviews, etag: parts.slice(4).join("\t") };
}
function isCount(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}
async function pollGithubPullActivity(target, priorFingerprint, deps) {
  const ref = parseGithubIssueRef(target);
  if (!ref)
    return { status: "unreadable" };
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const priorEtag = parsePullActivityFingerprint(priorFingerprint)?.etag;
  const timeoutMs = deps.timeoutMs ?? GITHUB_TIMEOUT_MS;
  const get = (url, etag2) => withTimeout(deps.fetchImpl(url, { headers: { ...ghHeaders(deps.token), ...etag2 ? { "if-none-match": etag2 } : {} }, signal: AbortSignal.timeout(timeoutMs) }), timeoutMs);
  let res;
  try {
    res = await get(base, priorEtag || undefined);
  } catch {
    return { status: "error" };
  }
  if (res.status === 304) {
    await drain(res);
    return { status: "not-modified" };
  }
  if (res.status === 403 && isGithubRateLimited(res)) {
    await drain(res);
    return { status: "error" };
  }
  if (res.status === 404 || res.status === 403) {
    await drain(res);
    return { status: "unreadable", httpStatus: res.status };
  }
  if (!res.ok) {
    await drain(res);
    return { status: "error" };
  }
  const etag = res.headers.get("etag") ?? "";
  let pull;
  try {
    pull = await res.json();
  } catch {
    return { status: "error" };
  }
  if (!isCount(pull.comments) || !isCount(pull.review_comments))
    return { status: "error" };
  const readReviews = async (url) => {
    let r;
    try {
      r = await get(url);
    } catch {
      return null;
    }
    if (!r.ok) {
      await drain(r);
      return null;
    }
    let body;
    try {
      body = await r.json();
    } catch {
      return null;
    }
    return Array.isArray(body) ? { count: body.length, links: parseLinkHeader(r.headers.get("link")) } : null;
  };
  const first = await readReviews(`${base}/reviews?per_page=${PULL_REVIEWS_PER_PAGE}`);
  if (!first)
    return { status: "error" };
  let reviews = first.count;
  const lastUrl = first.links.last;
  const lastPage = lastUrl && isGithubApiUrl(lastUrl) ? Number(new URL(lastUrl).searchParams.get("page")) : Number.NaN;
  if (Number.isInteger(lastPage) && lastPage > 1) {
    const last = await readReviews(lastUrl);
    if (!last)
      return { status: "error" };
    reviews = (lastPage - 1) * PULL_REVIEWS_PER_PAGE + last.count;
  } else {
    let next = first.links.next;
    for (let pages = 1;next; pages++) {
      if (pages >= PULL_REVIEW_PAGE_CAP || !isGithubApiUrl(next))
        return { status: "error" };
      const page = await readReviews(next);
      if (!page)
        return { status: "error" };
      reviews += page.count;
      next = page.links.next;
    }
  }
  return { status: "ok", fingerprint: formatPullActivityFingerprint({ comments: pull.comments, reviewComments: pull.review_comments, reviews, etag }) };
}
var WEBPAGE_TIMEOUT_MS = 1e4;
var DNS_TIMEOUT_MS = 5000;
var WEBPAGE_MAX_BODY_BYTES = 1e6;
var WEBPAGE_MAX_REDIRECTS = 5;
async function drain(res) {
  await res.arrayBuffer().catch(() => {
    return;
  });
}
async function cancelBody(res) {
  await res.body?.cancel().catch(() => {
    return;
  });
}
function conditionalHeadersFor(fingerprint) {
  if (!fingerprint)
    return {};
  if (fingerprint.startsWith("etag:"))
    return { "if-none-match": fingerprint.slice("etag:".length) };
  if (fingerprint.startsWith("lm:"))
    return { "if-modified-since": fingerprint.slice("lm:".length) };
  return {};
}
async function readCapped(res, maxBytes, deadlineMs) {
  try {
    const len = res.headers.get("content-length");
    if (len !== null && Number(len) > maxBytes) {
      await cancelBody(res);
      return null;
    }
    if (!res.body) {
      const buf = await withTimeout(res.arrayBuffer(), Math.max(1, deadlineMs - Date.now()));
      return buf.byteLength > maxBytes ? null : new Uint8Array(buf);
    }
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;; ) {
      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        await reader.cancel().catch(() => {
          return;
        });
        return null;
      }
      const { done, value } = await withTimeout(reader.read(), remaining);
      if (done)
        break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {
          return;
        });
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } catch {
    return null;
  }
}
var PRIVATE_V4_RANGES = [
  ["10.0.0.0", "10.255.255.255"],
  ["100.64.0.0", "100.127.255.255"],
  ["172.16.0.0", "172.31.255.255"],
  ["192.168.0.0", "192.168.255.255"],
  ["127.0.0.0", "127.255.255.255"],
  ["169.254.0.0", "169.254.255.255"],
  ["0.0.0.0", "0.255.255.255"]
];
function ipToInt(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}
function isPrivateV4(address) {
  const n = ipToInt(address);
  return PRIVATE_V4_RANGES.some(([lo, hi]) => n >= ipToInt(lo) && n <= ipToInt(hi));
}
function parseIPv6(address) {
  const zone = address.indexOf("%");
  const a = zone === -1 ? address : address.slice(0, zone);
  const halves = a.split("::");
  if (halves.length > 2)
    return null;
  const expand = (s) => {
    if (s === "")
      return [];
    const groups2 = s.split(":");
    const last = groups2[groups2.length - 1];
    if (last.includes(".")) {
      const octets = last.split(".");
      if (octets.length !== 4)
        return null;
      const nums = octets.map(Number);
      if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
        return null;
      const hi = (nums[0] << 8 | nums[1]).toString(16);
      const lo = (nums[2] << 8 | nums[3]).toString(16);
      return [...groups2.slice(0, -1), hi, lo];
    }
    return groups2;
  };
  const head = expand(halves[0] ?? "");
  const tail = halves.length === 2 ? expand(halves[1] ?? "") : [];
  if (head === null || tail === null)
    return null;
  let groups;
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0)
      return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8)
    return null;
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g))
      return null;
    value = value << 16n | BigInt(Number.parseInt(g, 16));
  }
  return value;
}
function isPrivateV6(address) {
  const v = parseIPv6(address);
  if (v === null)
    return true;
  if (v === 0n)
    return true;
  if (v === 1n)
    return true;
  if (v >> 32n === 0xffffn)
    return isPrivateV4([24n, 16n, 8n, 0n].map((shift) => Number(v >> shift & 0xffn)).join("."));
  if (v >> 118n === 0b1111111010n)
    return true;
  if (v >> 121n === 0b1111110n)
    return true;
  return false;
}
async function defaultIsBlockedHost(hostname, lookup2 = dnsLookup) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost"))
    return true;
  const literalFamily = isIP2(hostname);
  if (literalFamily === 4)
    return isPrivateV4(hostname);
  if (literalFamily === 6)
    return isPrivateV6(hostname);
  try {
    const results = await withTimeout(lookup2(hostname, { all: true }), DNS_TIMEOUT_MS);
    return results.some((r) => r.family === 4 ? isPrivateV4(r.address) : isPrivateV6(r.address));
  } catch {
    return true;
  }
}
async function pollWebpage(item, priorFingerprint, deps) {
  const isBlocked = deps.isBlockedHost ?? defaultIsBlockedHost;
  const timeoutMs = deps.timeoutMs ?? WEBPAGE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let current;
  try {
    current = new URL(item.target);
  } catch {
    return { status: "unreadable" };
  }
  if (current.protocol !== "http:" && current.protocol !== "https:")
    return { status: "unreadable" };
  for (let hop = 0;; hop++) {
    if (hop > WEBPAGE_MAX_REDIRECTS)
      return { status: "unreadable" };
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      return { status: "error" };
    let blocked;
    try {
      blocked = await withTimeout(isBlocked(current.hostname), Math.min(remaining, DNS_TIMEOUT_MS));
    } catch {
      return { status: "error" };
    }
    if (blocked)
      return { status: "unreadable" };
    let res;
    try {
      res = await withTimeout(deps.fetchImpl(current.toString(), {
        redirect: "manual",
        headers: hop === 0 ? conditionalHeadersFor(priorFingerprint) : {},
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now()))
      }), Math.max(1, deadline - Date.now()));
    } catch {
      return { status: "error" };
    }
    if (res.status === 304) {
      await cancelBody(res);
      return { status: "not-modified" };
    }
    if (res.status >= 300 && res.status < 400) {
      await cancelBody(res);
      const location = res.headers.get("location");
      if (!location)
        return { status: "unreadable" };
      let next;
      try {
        next = new URL(location, current);
      } catch {
        return { status: "unreadable" };
      }
      if (next.protocol !== "http:" && next.protocol !== "https:")
        return { status: "unreadable" };
      current = next;
      continue;
    }
    if (res.status === 404 || res.status === 403) {
      await cancelBody(res);
      return { status: "unreadable", httpStatus: res.status };
    }
    if (!res.ok) {
      await cancelBody(res);
      return { status: "error" };
    }
    const etag = res.headers.get("etag");
    if (etag) {
      await cancelBody(res);
      return { status: "ok", fingerprint: `etag:${etag}` };
    }
    const lastModified = res.headers.get("last-modified");
    if (lastModified) {
      await cancelBody(res);
      return { status: "ok", fingerprint: `lm:${lastModified}` };
    }
    const body = await readCapped(res, WEBPAGE_MAX_BODY_BYTES, deadline);
    if (body === null)
      return { status: "error" };
    return { status: "ok", fingerprint: `hash:${fnv1a(Buffer.from(body).toString("latin1"))}` };
  }
}
async function pollFilesystem(path, deps) {
  let st;
  try {
    st = await deps.stat(path);
  } catch (e) {
    if (e?.code === "ENOENT")
      return { status: "unreadable" };
    return { status: "error" };
  }
  if (st.isDirectory())
    return { status: "unreadable" };
  return { status: "ok", fingerprint: `${st.mtimeMs}:${st.size}` };
}

// ../butchr/src/jira-watch/poll-linked-item.ts
async function pollExternalItem(item, priorFingerprint, deps) {
  try {
    if (item.kind === "confluence") {
      if (!deps.confluenceVersion)
        return { status: "error" };
      return await pollConfluencePage(item.target, { getVersion: deps.confluenceVersion });
    }
    if (item.origin === "ticket-pr") {
      if (!deps.github)
        return { status: "error" };
      return await pollGithubPullActivity(item.target, priorFingerprint ?? null, deps.github);
    }
    if (item.kind === "github-issue" || item.kind === "github-pr") {
      if (!deps.github)
        return { status: "error" };
      return await pollGithubLink({ kind: item.kind, target: item.target }, priorFingerprint ?? null, deps.github);
    }
    if (item.kind === "webpage") {
      if (!deps.webpage)
        return { status: "error" };
      return await pollWebpage(item, priorFingerprint, deps.webpage);
    }
    if (item.kind === "filesystem") {
      if (!deps.filesystem)
        return { status: "error" };
      return await pollFilesystem(item.target, deps.filesystem);
    }
    return { status: "error" };
  } catch (e) {
    deps.log?.(`  WARNING: [linked-eventing] external poll threw for ${item.kind} ${item.target}: ${e?.message ?? e}`);
    return { status: "error" };
  }
}

// ../butchr/src/resources/jira-project.ts
function parseProjectQuery(text) {
  let q;
  try {
    q = JSON.parse(text);
  } catch {
    throw new Error("jira-project query must be a JSON object");
  }
  if (!q || Array.isArray(q) || typeof q !== "object")
    throw new Error("jira-project query must be an object");
  for (const key of Object.keys(q))
    if (!["leadAccountId", "keys", "query"].includes(key))
      throw new Error(`Unknown jira-project query field: ${key}`);
  if (q.leadAccountId !== undefined && (typeof q.leadAccountId !== "string" || !q.leadAccountId.trim()))
    throw new Error('leadAccountId must be non-empty (or "me")');
  if (q.query !== undefined && (typeof q.query !== "string" || !q.query.trim()))
    throw new Error("query must be non-empty");
  if (q.keys !== undefined && (!Array.isArray(q.keys) || !q.keys.length || q.keys.some((k) => typeof k !== "string" || !isProjectId(k))))
    throw new Error("keys must be a non-empty list of project keys");
  return q;
}

// ../butchr/src/atlassian/client.ts
var KNOWN_EMPTY_LEAVES = new Set(["paragraph", "heading", "listItem", "bulletList", "orderedList", "doc", "codeBlock", "blockquote", "panel", "expand", "table", "tableRow", "tableCell", "tableHeader", "mediaSingle", "mediaGroup"]);
var ADF_BLOCK_TYPES = new Set(["doc", "bulletList", "orderedList", "blockquote", "panel", "expand", "table", "tableRow", "tableCell", "tableHeader"]);
function adfToText(node) {
  if (!node || typeof node !== "object")
    return "";
  if (node.type === "text") {
    const href = node.marks?.find((m) => m?.type === "link")?.attrs?.href;
    const text = node.text ?? "";
    return typeof href === "string" && href && href !== text ? `${text} (${href})` : text;
  }
  if (node.type === "hardBreak")
    return `
`;
  if (node.type === "mention")
    return node.attrs?.text ?? "";
  if (node.type === "inlineCard" || node.type === "blockCard")
    return node.attrs?.url ?? "";
  if (node.type === "emoji")
    return node.attrs?.text ?? node.attrs?.shortName ?? "";
  if (node.type === "status")
    return node.attrs?.text ?? "";
  if (node.type === "rule")
    return "---";
  if (node.type && node.content === undefined && !KNOWN_EMPTY_LEAVES.has(node.type))
    return `[unsupported ${node.type}${typeof node.attrs?.alt === "string" ? `: ${node.attrs.alt}` : ""}]`;
  const parts = (node.content ?? []).map(adfToText);
  return node.type && ADF_BLOCK_TYPES.has(node.type) ? parts.join(`
`) : parts.join("");
}

class AtlassianHttpError extends Error {
  status;
  constructor(status, method, path, bodySnippet) {
    super(`Atlassian ${status} on ${method} ${path}: ${bodySnippet}`);
    this.status = status;
    this.name = "AtlassianHttpError";
  }
}
var SEARCH_FIELDS = "summary,status,issuetype,assignee,parent,updated,labels,issuelinks,project,description";

class AtlassianClient {
  site;
  fetchImpl;
  log;
  auth;
  constructor(site, email, token, fetchImpl = globalThis.fetch, log = () => {}) {
    this.site = site;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  }
  async searchProjects(query) {
    const q = parseProjectQuery(query);
    const lead = q.leadAccountId === "me" ? (await this.get("/rest/api/3/myself")).accountId : q.leadAccountId;
    if (q.leadAccountId && !lead)
      throw new Error("Cannot determine project lead identity");
    const out = [];
    for (let offset = 0;; ) {
      const params = new URLSearchParams({ startAt: String(offset), maxResults: "100", expand: "lead", status: "live" });
      if (q.query)
        params.set("query", q.query);
      const page = await this.get("/rest/api/3/project/search?" + params);
      if (!Array.isArray(page.values) || typeof page.total !== "number")
        throw new Error("Invalid project search page");
      for (const p of page.values) {
        if (typeof p.id !== "string" || typeof p.key !== "string" || typeof p.name !== "string")
          throw new Error("Invalid project record");
        if (lead && typeof p.lead?.accountId !== "string")
          throw new Error("Project search omitted lead identity");
        if (p.archived || lead && p.lead.accountId !== lead || q.keys && !q.keys.includes(p.key))
          continue;
        out.push({ id: p.id, key: p.key, name: p.name, ...p.lead?.accountId ? { leadAccountId: p.lead.accountId } : {}, ...typeof p.archived === "boolean" ? { archived: p.archived } : {} });
      }
      offset += page.values.length;
      if (page.isLast === true || offset >= page.total)
        return out;
      if (!page.values.length)
        throw new Error("Incomplete project search pagination");
    }
  }
  async get(path) {
    const res = await this.fetchImpl(`${this.site}${path}`, {
      headers: { authorization: this.auth, accept: "application/json" }
    });
    if (!res.ok)
      throw new AtlassianHttpError(res.status, "GET", path, (await res.text()).slice(0, 200));
    return res.json();
  }
  async canSuppressNotifications(projectKey) {
    try {
      const body = await this.get(`/rest/api/3/mypermissions?projectKey=${encodeURIComponent(projectKey)}&permissions=ADMINISTER_PROJECTS,ADMINISTER`);
      return Boolean(body.permissions?.ADMINISTER_PROJECTS?.havePermission || body.permissions?.ADMINISTER?.havePermission);
    } catch (e) {
      this.log(`[atlassian] mypermissions check for project ${projectKey} failed: ${e?.message ?? e}`);
      return false;
    }
  }
  async search(jql, maxResults = 100) {
    const q = new URLSearchParams({ jql, maxResults: String(maxResults), fields: SEARCH_FIELDS });
    const body = await this.get(`/rest/api/3/search/jql?${q}`);
    return (body.issues ?? []).map(mapIssue);
  }
  async searchAll(jql, maxIssues = 1000, pageSize = 100) {
    const out = [];
    let token;
    do {
      const q = new URLSearchParams({ jql, maxResults: String(pageSize), fields: SEARCH_FIELDS, ...token ? { nextPageToken: token } : {} });
      const body = await this.get(`/rest/api/3/search/jql?${q}`);
      out.push(...(body.issues ?? []).map(mapIssue));
      if (out.length > maxIssues)
        throw new Error(`JQL matched more than ${maxIssues} issues \u2014 refusing a partial result: ${jql}`);
      const next = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : undefined;
      if (body.isLast === false && !next)
        throw new Error(`Jira reported more results without a nextPageToken \u2014 refusing a partial result: ${jql}`);
      if (next !== undefined && next === token)
        throw new Error(`Jira repeated nextPageToken \u2014 refusing a partial result: ${jql}`);
      token = next;
    } while (token);
    return out;
  }
  async updateLabels(key, ops, opts) {
    const update = [
      ...(ops.add ?? []).map((label) => ({ add: label })),
      ...(ops.remove ?? []).map((label) => ({ remove: label }))
    ];
    if (!update.length)
      return;
    const path = `/rest/api/3/issue/${key}${opts?.notify ? "" : "?notifyUsers=false"}`;
    const res = await this.fetchImpl(`${this.site}${path}`, {
      method: "PUT",
      headers: { authorization: this.auth, "content-type": "application/json" },
      body: JSON.stringify({ update: { labels: update } })
    });
    if (!res.ok)
      throw new AtlassianHttpError(res.status, "PUT", path, (await res.text()).slice(0, 200));
  }
  async links(issueKey) {
    const body = await this.get(`/rest/api/3/issue/${issueKey}?fields=issuelinks`);
    return parseIssueLinks(body.fields?.issuelinks);
  }
  async issue(issueKey) {
    const body = await this.get(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${SEARCH_FIELDS}`);
    if (!body || typeof body.key !== "string")
      throw new Error(`Jira issue read for ${issueKey} returned an unexpected body`);
    return { ...mapIssue(body), description: adfToText(body.fields?.description) };
  }
  async allComments(issueKey, maxComments = 1000, pageSize = 100) {
    const out = [];
    for (;; ) {
      const q = new URLSearchParams({ orderBy: "created", startAt: String(out.length), maxResults: String(pageSize) });
      const body = await this.get(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?${q}`);
      if (!Array.isArray(body?.comments) || typeof body.total !== "number")
        throw new Error(`Jira comments for ${issueKey} returned an unexpected body`);
      out.push(...body.comments.map(mapComment));
      if (out.length > maxComments)
        throw new Error(`Jira comments for ${issueKey} exceed ${maxComments} \u2014 refusing a partial list`);
      if (out.length >= body.total)
        return out;
      if (!body.comments.length)
        throw new Error(`Jira comments for ${issueKey} stopped before the reported total (${body.total}) \u2014 refusing a partial list`);
    }
  }
  async addComment(issueKey, text) {
    const path = `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;
    const res = await this.fetchImpl(`${this.site}${path}`, {
      method: "POST",
      headers: { authorization: this.auth, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] } })
    });
    if (!res.ok)
      throw new AtlassianHttpError(res.status, "POST", path, (await res.text()).slice(0, 200));
    return mapComment(await res.json());
  }
  async remoteLinks(issueKey) {
    const body = await this.get(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/remotelink`);
    if (!Array.isArray(body))
      throw new Error(`Jira remote links for ${issueKey} returned an unexpected body`);
    const str = (v) => typeof v === "string" ? v : null;
    return body.flatMap((l) => {
      const url = str(l?.object?.url), title = str(l?.object?.title);
      if (url === null || title === null || typeof l.id !== "number" && typeof l.id !== "string")
        return [];
      return [{ id: String(l.id), globalId: str(l.globalId), relationship: str(l.relationship), url, title, applicationType: str(l.application?.type) }];
    });
  }
  async confluencePageVersion(pageId) {
    try {
      const body = await this.get(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`);
      const version = body?.version?.number;
      if (typeof version !== "number")
        throw new Error(`Confluence page ${pageId} read returned no version.number`);
      return { ok: true, version };
    } catch (e) {
      if (e instanceof AtlassianHttpError && (e.status === 404 || e.status === 403))
        return { ok: false, transient: false, httpStatus: e.status };
      if (e instanceof AtlassianHttpError)
        return { ok: false, transient: true };
      throw e;
    }
  }
  async upsertRemoteLink(issueKey, link) {
    const path = `/rest/api/3/issue/${encodeURIComponent(issueKey)}/remotelink`;
    const res = await this.fetchImpl(`${this.site}${path}`, {
      method: "POST",
      headers: { authorization: this.auth, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(link)
    });
    if (!res.ok)
      throw new AtlassianHttpError(res.status, "POST", path, (await res.text()).slice(0, 200));
    const body = await res.json();
    if (typeof body?.id !== "number" && typeof body?.id !== "string")
      throw new Error(`Jira remote link write for ${issueKey} returned an unexpected body`);
    return { id: String(body.id), created: res.status === 201 };
  }
  async comments(issueKey, maxResults = 20) {
    const q = new URLSearchParams({ orderBy: "-created", maxResults: String(maxResults) });
    const body = await this.get(`/rest/api/3/issue/${issueKey}/comment?${q}`);
    return (body.comments ?? []).map(mapComment);
  }
}
function parseIssueLinks(raw) {
  const out = [];
  for (const l of raw ?? []) {
    const id = l.id !== undefined ? { id: String(l.id) } : {};
    if (l.outwardIssue)
      out.push({ type: l.type?.name ?? "", otherEnd: "outward", key: l.outwardIssue.key, ...id, ...l.outwardIssue.fields?.status?.name !== undefined ? { status: l.outwardIssue.fields.status.name } : {} });
    else if (l.inwardIssue)
      out.push({ type: l.type?.name ?? "", otherEnd: "inward", key: l.inwardIssue.key, ...id, ...l.inwardIssue.fields?.status?.name !== undefined ? { status: l.inwardIssue.fields.status.name } : {} });
  }
  return out;
}
function mapComment(c) {
  return { id: c.id, body: adfToText(c.body), created: c.created ?? "", authorEmail: c.author?.emailAddress ?? null };
}
function mapIssue(i) {
  const f = i.fields ?? {};
  return {
    key: i.key,
    summary: f.summary ?? "",
    status: f.status?.name ?? "",
    issuetype: f.issuetype?.name ?? "",
    assignee: f.assignee?.displayName ?? null,
    parent: f.parent?.key ?? null,
    updated: f.updated ?? "",
    labels: f.labels ?? [],
    ...typeof f.project?.projectTypeKey === "string" ? { projectType: f.project.projectTypeKey } : {},
    ...f.issuelinks !== undefined ? { issuelinks: parseIssueLinks(f.issuelinks) } : {},
    ...f.description !== undefined ? { description: adfToText(f.description) } : {}
  };
}

// ../butchr/src/tools/atlassian-real.ts
import { createCloudClient, isNotFoundError } from "jira.js";
import { createV2Client, createV1Client } from "confluence.js";
var adf = (text) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }]
});
var adfForCorrection = (text) => text === "" ? { type: "doc", version: 1, content: [{ type: "paragraph" }] } : adf(text);
var MAX_COMMENT_PAGES = 100;
function realAtlassian(cfg, transports) {
  if (transports && (typeof transports.jira?.sendRequest !== "function" || typeof transports.confluence?.sendRequest !== "function"))
    throw Error("Explicit SDK transports required");
  const auth = { type: "basic", email: cfg.email, apiToken: cfg.token };
  const jira = createCloudClient(transports?.jira ?? { host: cfg.site, auth });
  const wiki = createV2Client(transports?.confluence ?? { host: cfg.site, auth });
  const wiki1 = createV1Client(transports?.confluence ?? { host: cfg.site, auth });
  return {
    getIssue: (key) => jira.issues.getIssue({ issueIdOrKey: key }),
    search: (jql, maxResults) => jira.issueSearch.searchAndReconsileIssuesUsingJqlPost({ jql, maxResults, fields: ["summary", "status", "issuetype", "assignee", "labels", "parent", "description"] }),
    addComment: (key, text) => jira.issueComments.addComment({ issueIdOrKey: key, body: adf(text) }),
    linkIssues: (from, to, type) => jira.issueLinks.linkIssues({ type: { name: type }, outwardIssue: { key: from }, inwardIssue: { key: to } }),
    transition: async (key, statusName) => {
      const t = await jira.issues.getTransitions({ issueIdOrKey: key });
      const want = statusName.toLowerCase();
      const hit = (t.transitions ?? []).find((x) => (x.to?.name ?? x.name ?? "").toLowerCase() === want);
      if (!hit)
        throw new Error(`no transition to "${statusName}" from ${key}; available: ${(t.transitions ?? []).map((x) => x.to?.name ?? x.name).join(", ")}`);
      await jira.issues.doTransition({ issueIdOrKey: key, transition: { id: hit.id } });
      return { transitioned: key, to: statusName };
    },
    createIssue: (p) => jira.issues.createIssue({
      fields: {
        project: { key: p.projectKey },
        issuetype: { name: p.issuetype },
        summary: p.summary,
        ...p.description ? { description: adf(p.description) } : {},
        ...p.parent ? { parent: { key: p.parent } } : {},
        ...p.labels?.length ? { labels: p.labels } : {},
        ...p.assignee ? { assignee: { accountId: p.assignee } } : {},
        ...p.priority ? { priority: { name: p.priority } } : {}
      }
    }),
    setPriority: (key, priority) => jira.issues.editIssue({ issueIdOrKey: key, fields: { priority: { name: priority } } }),
    assign: (key, accountId) => jira.issues.editIssue({ issueIdOrKey: key, fields: { assignee: { accountId } } }),
    correctText: (key, p) => jira.issues.editIssue({
      issueIdOrKey: key,
      fields: {
        ...p.description !== undefined ? { description: adfForCorrection(p.description) } : {},
        ...p.summary !== undefined ? { summary: p.summary } : {}
      }
    }),
    createPage: (p) => wiki.page.createPage({
      body: {
        spaceId: p.spaceId,
        status: "current",
        title: p.title,
        body: { representation: "storage", value: p.body },
        ...p.parentId ? { parentId: p.parentId } : {}
      }
    }),
    getPage: (id) => wiki.page.getPageById({ id, bodyFormat: "storage" }).then((r) => ({
      ...r,
      bodyRequested: true,
      bodyLength: r?.body?.storage?.value?.length ?? 0
    })),
    updatePage: async (p) => {
      const current = await wiki.page.getPageById({ id: p.id, bodyFormat: "storage" });
      const nextVersion = (current?.version?.number ?? 0) + 1;
      const updated = await wiki.page.updatePage({
        id: p.id,
        body: {
          id: p.id,
          status: "current",
          title: p.title ?? current?.title,
          body: { representation: "storage", value: p.body },
          version: { number: nextVersion, message: "butchr: confluence_update_page" }
        }
      });
      return { ...updated ?? {}, version: nextVersion };
    },
    searchPages: (cql, limit) => wiki1.search.searchByCQL({ cql, limit }),
    listSpaces: () => wiki.space?.getSpaces?.({ limit: 50 }) ?? wiki.spaces?.getSpaces?.({ limit: 50 }),
    getProjectProperty: (projectKey, propertyKey) => jira.projectProperties.getProjectProperty({ projectIdOrKey: projectKey, propertyKey }).then((r) => r?.value),
    getProjectPropertyOrNull: (projectKey, propertyKey) => jira.projectProperties.getProjectProperty({ projectIdOrKey: projectKey, propertyKey }).then((r) => r?.value).catch((e) => {
      if (isNotFoundError(e))
        return null;
      throw e;
    }),
    projectExists: (projectKey) => jira.projects.getProject({ projectIdOrKey: projectKey }).then(() => true).catch((e) => {
      if (isNotFoundError(e))
        return false;
      throw e;
    }),
    getRemoteLink: (key, globalId) => jira.issueRemoteLinks.getRemoteIssueLinks({ issueIdOrKey: key, globalId }).catch((e) => {
      if (isNotFoundError(e))
        return null;
      throw e;
    }),
    upsertRemoteLink: (key, globalId, relationship, object) => jira.issueRemoteLinks.createOrUpdateRemoteIssueLink({ issueIdOrKey: key, globalId, relationship, object }),
    getChildPages: async (parentId, cursor) => {
      const r = await wiki.children.getChildPages({ id: parentId, limit: 50, ...cursor ? { cursor } : {} });
      const nextUrl = r?._links?.next;
      const nextCursor = nextUrl ? new URL(nextUrl, "https://placeholder.invalid").searchParams.get("cursor") : null;
      return { results: (r?.results ?? []).map((c) => ({ id: c.id, title: c.title })), ...nextCursor ? { nextCursor } : {} };
    },
    addLabels: async (key, labels) => {
      const current = await jira.issues.getIssue({ issueIdOrKey: key, fields: ["labels"] });
      const existing = current?.fields?.labels ?? [];
      const merged = [...new Set([...existing, ...labels])];
      return jira.issues.editIssue({ issueIdOrKey: key, fields: { labels: merged } });
    },
    removeLabels: async (key, labels) => {
      const current = await jira.issues.getIssue({ issueIdOrKey: key, fields: ["labels"] });
      const existing = current?.fields?.labels ?? [];
      const toRemove = new Set(labels);
      const remaining = existing.filter((l) => !toRemove.has(l));
      return jira.issues.editIssue({ issueIdOrKey: key, fields: { labels: remaining } });
    },
    deleteIssue: (key) => jira.issues.deleteIssue({ issueIdOrKey: key }),
    commentOnPage: (pageId, body) => wiki.comment.createFooterComment({ pageId, body: { representation: "storage", value: body } }),
    getPageComments: async (pageId) => {
      const results = [];
      let cursor;
      for (let page = 0;; page++) {
        if (page >= MAX_COMMENT_PAGES) {
          throw new Error(`getPageComments(${pageId}): exceeded ${MAX_COMMENT_PAGES} pages without the cursor running out \u2014 refusing to return a silently partial list; likely a malformed/never-terminating _links.next cursor`);
        }
        const r = await wiki.comment.getPageFooterComments({ id: pageId, bodyFormat: "storage", limit: 250, ...cursor ? { cursor } : {} });
        for (const c of r?.results ?? []) {
          results.push({
            id: c.id,
            body: c?.body?.storage?.value ?? "",
            author: c?.version?.authorId,
            created: c?.version?.createdAt instanceof Date ? c.version.createdAt.toISOString() : undefined
          });
        }
        const nextUrl = r?._links?.next;
        if (!nextUrl)
          break;
        const parsedCursor = new URL(nextUrl, "https://placeholder.invalid").searchParams.get("cursor");
        if (!parsedCursor) {
          throw new Error(`getPageComments(${pageId}): _links.next was present ("${nextUrl}") but no \`cursor\` query parameter could be parsed from it \u2014 refusing to treat "more data exists" as "pagination complete"`);
        }
        cursor = parsedCursor;
      }
      return { results };
    },
    searchProjects: (status) => jira.projects.searchProjects({ status: [status], expand: "lead" }).then((r) => ({
      values: (r?.values ?? []).map((p) => ({ key: p.key, name: p.name, lead: p.lead ? { accountId: p.lead.accountId } : undefined }))
    })),
    getMyself: () => jira.myself.getCurrentUser().then((r) => ({ accountId: r.accountId })),
    setProjectProperty: (projectKey, propertyKey, value) => jira.projectProperties.setProjectProperty({ projectIdOrKey: projectKey, propertyKey, body: value }),
    getPageVersions: async (pageIds) => {
      if (!pageIds.length)
        return {};
      const r = await wiki.page.getPages({ id: pageIds.map(Number) });
      const out = {};
      for (const p of r?.results ?? [])
        if (p?.id != null && p?.version?.number != null)
          out[String(p.id)] = p.version.number;
      return out;
    },
    getIssueComments: async (key) => {
      const results = [];
      let startAt = 0;
      let total;
      const PAGE_SIZE = 100;
      for (let page = 0;total === undefined || startAt < total; page++) {
        if (page >= MAX_COMMENT_PAGES) {
          throw new Error(`getIssueComments(${key}): exceeded ${MAX_COMMENT_PAGES} pages without reaching the reported total (${total ?? "unknown"}) \u2014 refusing to return a silently partial list`);
        }
        const r = await jira.issueComments.getComments({ issueIdOrKey: key, orderBy: "-created", startAt, maxResults: PAGE_SIZE });
        if (!r || typeof r !== "object" || !Array.isArray(r.comments)) {
          throw new Error(`getIssueComments(${key}): malformed response at startAt=${startAt} (no \`comments\` array) \u2014 refusing to report an empty or partial list`);
        }
        const batch = r.comments;
        for (const c of batch) {
          const validBody = typeof c?.body === "string" || c?.body && typeof c.body === "object" && !Array.isArray(c.body) && c.body.type === "doc" && Array.isArray(c.body.content);
          if (!c || typeof c.id !== "string" || !validBody) {
            throw new Error(`getIssueComments(${key}): malformed comment at startAt=${startAt} (id, or body that is neither a string nor an ADF doc) \u2014 refusing to return it as readable`);
          }
          results.push({
            id: c.id,
            body: typeof c.body === "string" ? c.body : adfToText(c.body),
            bodyRaw: c.body ?? null,
            created: c.created ?? "",
            author: { accountId: c.author?.accountId ?? null, displayName: c.author?.displayName ?? null, email: c.author?.emailAddress ?? null }
          });
        }
        const responseTotal = typeof r?.total === "number" ? r.total : undefined;
        const responseMaxResults = typeof r?.maxResults === "number" ? r.maxResults : undefined;
        if (responseTotal !== undefined)
          total = responseTotal;
        startAt += batch.length;
        if (total !== undefined) {
          if (batch.length === 0) {
            if (startAt < total)
              throw new Error(`getIssueComments(${key}): empty page at startAt=${startAt} before reported total ${total} \u2014 refusing to return a silently partial list`);
            break;
          }
        } else if (responseMaxResults !== undefined) {
          if (batch.length < responseMaxResults)
            break;
        } else if (batch.length === 0) {
          break;
        }
      }
      return { results };
    }
  };
}

// ../butchr/src/resources/github-issue.ts
class GithubHttpError extends Error {
  status;
  constructor(status, what) {
    super(`GitHub ${what} failed: HTTP ${status}`);
    this.status = status;
    this.name = "GithubHttpError";
  }
}
function tokens(query) {
  return query.match(/(?:[^\s"]+|"[^"]*"?)+/g) ?? [];
}
var unquoted = (token) => token.replace(/"[^"]*"?/g, "");
function githubIssueQueryProblems(query) {
  const problems = [];
  for (const token of tokens(query)) {
    const bare = unquoted(token);
    if (/[()]/.test(bare))
      problems.push(`parentheses are not supported ("${token}")`);
    if (/^(AND|OR|NOT)$/.test(token))
      problems.push(`boolean operator ${token} is not supported`);
    const q = /^(-?)([A-Za-z-]+):(.*)$/.exec(token);
    if (!q)
      continue;
    const [, neg, rawKey, rawValue] = q;
    const key = rawKey.toLowerCase();
    const value = rawValue.replace(/^"|"$/g, "").toLowerCase();
    if (key === "org" || key === "user" || key === "owner")
      problems.push(`"${token}": scope comes from BUTCHR_GITHUB_ORGS; narrow with repo:owner/name`);
    if ((key === "is" || key === "type") && (value === "pr" || value === "pull-request"))
      problems.push(`"${token}": github-issue rules match issues, never pull requests`);
    if (key === "is" && value === "issue" && neg)
      problems.push(`"${token}": github-issue rules match issues, never pull requests`);
    if (key === "repo" && !neg && !repoQualifier(rawValue))
      problems.push(`"${token}" must name owner/name`);
  }
  return problems;
}
function repoQualifier(value) {
  const [owner, repo, ...rest] = value.toLowerCase().split("/");
  return owner && repo && !rest.length && isGithubOwner(owner) && isGithubRepo(repo) ? { owner, repo } : null;
}
function scopedIssueQuery(query, orgs) {
  const problems = githubIssueQueryProblems(query);
  if (problems.length)
    throw new Error(`github-issue query rejected: ${problems.join("; ")}`);
  const allowed = new Set(orgs.map((o) => o.toLowerCase()));
  if (!allowed.size)
    throw new Error("github-issue search needs BUTCHR_GITHUB_ORGS");
  const repos = tokens(query).flatMap((t) => {
    const m = /^repo:(.*)$/i.exec(t);
    return m ? [repoQualifier(m[1])] : [];
  });
  for (const r of repos)
    if (!allowed.has(r.owner))
      throw new Error(`github-issue query names repo:${r.owner}/${r.repo} outside BUTCHR_GITHUB_ORGS`);
  const scope = repos.length ? [] : [...allowed].map((o) => `org:${o}`);
  return [query.trim(), "is:issue", ...scope].join(" ");
}
function mapGithubIssue(item) {
  if (item.pull_request !== undefined)
    return null;
  const repoUrl = typeof item.repository_url === "string" ? /\/repos\/([^/]+)\/([^/]+)$/.exec(item.repository_url) : null;
  if (!repoUrl || typeof item.number !== "number" || !Number.isInteger(item.number) || item.number < 1)
    return null;
  let ref;
  try {
    ref = formatGithubIssueRef({ owner: repoUrl[1], repo: repoUrl[2], number: item.number });
  } catch {
    return null;
  }
  const [owner, rest] = ref.split("/");
  return {
    ref,
    owner,
    repo: rest.split("#")[0],
    number: item.number,
    title: typeof item.title === "string" ? item.title : "",
    body: typeof item.body === "string" ? item.body : "",
    state: typeof item.state === "string" ? item.state : "unknown",
    stateReason: typeof item.state_reason === "string" ? item.state_reason : null,
    issueType: typeof item.type?.name === "string" ? item.type.name : null,
    labels: (item.labels ?? []).map((l) => typeof l === "string" ? l : typeof l.name === "string" ? l.name : "").filter(Boolean).sort(),
    comments: typeof item.comments === "number" ? item.comments : 0,
    updated: typeof item.updated_at === "string" ? item.updated_at : "",
    url: typeof item.html_url === "string" ? item.html_url : ""
  };
}
var GITHUB_SEARCH_LIMIT = 1000;
var PAGE = 100;
var COMMENT_PAGE_LIMIT = 30;
function createGithubIssueClient(deps) {
  const allowed = new Set(deps.orgs.map((o) => o.toLowerCase()));
  const get = async (url, what) => {
    const res = await deps.fetchImpl(url, { headers: ghHeaders(deps.token) });
    if (!res.ok)
      throw new GithubHttpError(res.status, what);
    return res.json();
  };
  const issueUrl = (ref) => `https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
  const getIssue = async (ref) => {
    const want = formatGithubIssueRef(ref);
    if (!allowed.has(ref.owner.toLowerCase()))
      throw new Error(`${want} is outside BUTCHR_GITHUB_ORGS`);
    const item = await get(issueUrl(ref), "issue read");
    if (item && typeof item === "object" && item.pull_request !== undefined)
      throw new Error(`${want} is a pull request, not an issue`);
    const issue = item && typeof item === "object" ? mapGithubIssue(item) : null;
    if (!issue)
      throw new Error(`GitHub issue read for ${want} returned an unexpected body`);
    if (issue.ref !== want)
      throw new Error(`GitHub answered ${issue.ref} for ${want}; refusing a moved or transferred issue`);
    return issue;
  };
  return {
    get: getIssue,
    async addComment(ref, body) {
      await getIssue(ref);
      const res = await deps.fetchImpl(`${issueUrl(ref)}/comments`, {
        method: "POST",
        headers: { ...ghHeaders(deps.token), "content-type": "application/json" },
        body: JSON.stringify({ body })
      });
      if (!res.ok)
        throw new GithubHttpError(res.status, "issue comment");
      return mapComment2(await res.json());
    },
    async searchAll(query) {
      const q = scopedIssueQuery(query, deps.orgs);
      const byRef = new Map;
      for (let page = 1;; page++) {
        const params = new URLSearchParams({ q, sort: "created", order: "asc", per_page: String(PAGE), page: String(page) });
        const body = await get(`https://api.github.com/search/issues?${params}`, "issue search");
        if (typeof body.total_count !== "number" || !Array.isArray(body.items))
          throw new Error("GitHub issue search returned an unexpected body");
        if (body.incomplete_results === true)
          throw new Error("GitHub issue search returned incomplete results");
        if (body.total_count > GITHUB_SEARCH_LIMIT)
          throw new Error(`GitHub issue search matched ${body.total_count} issues, over the ${GITHUB_SEARCH_LIMIT} it can list`);
        for (const item of body.items) {
          const issue = mapGithubIssue(item);
          if (!issue)
            continue;
          if (!allowed.has(issue.owner)) {
            deps.log?.(`[github-issue] dropped ${issue.ref}: owner outside BUTCHR_GITHUB_ORGS`);
            continue;
          }
          byRef.set(issue.ref, issue);
        }
        if (body.items.length < PAGE || page * PAGE >= body.total_count)
          break;
      }
      return [...byRef.values()];
    },
    async comments(ref) {
      const out = [];
      for (let page = 1;; page++) {
        if (page > COMMENT_PAGE_LIMIT)
          throw new Error(`GitHub comments for ${formatGithubIssueRef(ref)} exceed ${COMMENT_PAGE_LIMIT * PAGE}`);
        const params = new URLSearchParams({ per_page: String(PAGE), page: String(page) });
        const body = await get(`https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments?${params}`, "issue comments");
        if (!Array.isArray(body))
          throw new Error("GitHub issue comments returned an unexpected body");
        for (const c of body)
          out.push(mapComment2(c));
        if (body.length < PAGE)
          return out;
      }
    }
  };
}
function mapComment2(c) {
  return {
    id: String(c.id),
    author: typeof c.user?.login === "string" ? c.user.login : null,
    body: typeof c.body === "string" ? c.body : "",
    created: typeof c.created_at === "string" ? c.created_at : "",
    updated: typeof c.updated_at === "string" ? c.updated_at : ""
  };
}

// ../butchr/src/resources/github-pr-ref.ts
var formatGithubPrRef = (ref) => formatGithubIssueRef(ref);

// ../butchr/src/resources/github-pr.ts
function tokens2(query) {
  return query.match(/(?:[^\s"]+|"[^"]*"?)+/g) ?? [];
}
var unquoted2 = (token) => token.replace(/"[^"]*"?/g, "");
function githubPrQueryProblems(query) {
  const problems = [];
  for (const token of tokens2(query)) {
    const bare = unquoted2(token);
    if (/[()]/.test(bare))
      problems.push(`parentheses are not supported ("${token}")`);
    if (/^(AND|OR|NOT)$/.test(token))
      problems.push(`boolean operator ${token} is not supported`);
    const q = /^(-?)([A-Za-z-]+):(.*)$/.exec(token);
    if (!q)
      continue;
    const [, neg, rawKey, rawValue] = q;
    const key = rawKey.toLowerCase();
    const value = rawValue.replace(/^"|"$/g, "").toLowerCase();
    if (key === "org" || key === "user" || key === "owner")
      problems.push(`"${token}": scope comes from BUTCHR_GITHUB_ORGS; narrow with repo:owner/name`);
    if ((key === "is" || key === "type") && value === "issue")
      problems.push(`"${token}": github-pr rules match pull requests, never issues`);
    if (key === "is" && value === "pr" && neg)
      problems.push(`"${token}": github-pr rules match pull requests, never issues`);
    if (key === "repo" && !neg && !repoQualifier2(rawValue))
      problems.push(`"${token}" must name owner/name`);
  }
  return problems;
}
function repoQualifier2(value) {
  const [owner, repo, ...rest] = value.toLowerCase().split("/");
  return owner && repo && !rest.length && isGithubOwner(owner) && isGithubRepo(repo) ? { owner, repo } : null;
}
function scopedPrQuery(query, orgs) {
  const problems = githubPrQueryProblems(query);
  if (problems.length)
    throw new Error(`github-pr query rejected: ${problems.join("; ")}`);
  const allowed = new Set(orgs.map((o) => o.toLowerCase()));
  if (!allowed.size)
    throw new Error("github-pr search needs BUTCHR_GITHUB_ORGS");
  const repos = tokens2(query).flatMap((t) => {
    const m = /^repo:(.*)$/i.exec(t);
    return m ? [repoQualifier2(m[1])] : [];
  });
  for (const r of repos)
    if (!allowed.has(r.owner))
      throw new Error(`github-pr query names repo:${r.owner}/${r.repo} outside BUTCHR_GITHUB_ORGS`);
  const scope = repos.length ? [] : [...allowed].map((o) => `org:${o}`);
  return [query.trim(), "is:pr", ...scope].join(" ");
}
function mapGithubPr(item) {
  if (item.pull_request === undefined || item.pull_request === null)
    return null;
  const repoUrl = typeof item.repository_url === "string" ? /\/repos\/([^/]+)\/([^/]+)$/.exec(item.repository_url) : null;
  if (!repoUrl || typeof item.number !== "number" || !Number.isInteger(item.number) || item.number < 1)
    return null;
  let ref;
  try {
    ref = formatGithubPrRef({ owner: repoUrl[1], repo: repoUrl[2], number: item.number });
  } catch {
    return null;
  }
  const [owner, rest] = ref.split("/");
  return {
    ref,
    owner,
    repo: rest.split("#")[0],
    number: item.number,
    title: typeof item.title === "string" ? item.title : "",
    body: typeof item.body === "string" ? item.body : "",
    state: typeof item.state === "string" ? item.state : "unknown",
    merged: typeof item.pull_request.merged_at === "string",
    draft: typeof item.draft === "boolean" ? item.draft : false,
    labels: (item.labels ?? []).map((l) => typeof l === "string" ? l : typeof l.name === "string" ? l.name : "").filter(Boolean).sort(),
    comments: typeof item.comments === "number" ? item.comments : 0,
    updated: typeof item.updated_at === "string" ? item.updated_at : "",
    url: typeof item.html_url === "string" ? item.html_url : ""
  };
}
function mapGithubPrFromPull(ref, item) {
  const canonical = formatGithubPrRef(ref);
  return {
    ref: canonical,
    owner: ref.owner.toLowerCase(),
    repo: ref.repo.toLowerCase(),
    number: ref.number,
    title: typeof item.title === "string" ? item.title : "",
    body: typeof item.body === "string" ? item.body : "",
    state: typeof item.state === "string" ? item.state : "unknown",
    merged: item.merged === true,
    draft: typeof item.draft === "boolean" ? item.draft : false,
    labels: (item.labels ?? []).map((l) => typeof l === "string" ? l : typeof l.name === "string" ? l.name : "").filter(Boolean).sort(),
    comments: typeof item.comments === "number" ? item.comments : 0,
    updated: typeof item.updated_at === "string" ? item.updated_at : "",
    url: typeof item.html_url === "string" ? item.html_url : ""
  };
}
var GITHUB_PR_SEARCH_LIMIT = 1000;
var PAGE2 = 100;
var COMMENT_PAGE_LIMIT2 = 30;
function createGithubPrClient(deps) {
  const allowed = new Set(deps.orgs.map((o) => o.toLowerCase()));
  const get = async (url, what) => {
    const res = await deps.fetchImpl(url, { headers: ghHeaders(deps.token) });
    if (!res.ok)
      throw new GithubHttpError(res.status, what);
    return res.json();
  };
  const pullUrl = (ref) => `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const commentsUrl = (ref) => `https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`;
  const getPr = async (ref) => {
    const want = formatGithubPrRef(ref);
    if (!allowed.has(ref.owner.toLowerCase()))
      throw new Error(`${want} is outside BUTCHR_GITHUB_ORGS`);
    const item = await get(pullUrl(ref), "pull request read");
    if (!item || typeof item !== "object")
      throw new Error(`GitHub pull request read for ${want} returned an unexpected body`);
    return mapGithubPrFromPull(ref, item);
  };
  return {
    get: getPr,
    async addComment(ref, body) {
      await getPr(ref);
      const res = await deps.fetchImpl(commentsUrl(ref), {
        method: "POST",
        headers: { ...ghHeaders(deps.token), "content-type": "application/json" },
        body: JSON.stringify({ body })
      });
      if (!res.ok)
        throw new GithubHttpError(res.status, "pull request comment");
      return mapComment3(await res.json());
    },
    async searchAll(query) {
      const q = scopedPrQuery(query, deps.orgs);
      const byRef = new Map;
      for (let page = 1;; page++) {
        const params = new URLSearchParams({ q, sort: "created", order: "asc", per_page: String(PAGE2), page: String(page) });
        const body = await get(`https://api.github.com/search/issues?${params}`, "pull request search");
        if (typeof body.total_count !== "number" || !Array.isArray(body.items))
          throw new Error("GitHub pull request search returned an unexpected body");
        if (body.incomplete_results === true)
          throw new Error("GitHub pull request search returned incomplete results");
        if (body.total_count > GITHUB_PR_SEARCH_LIMIT)
          throw new Error(`GitHub pull request search matched ${body.total_count} pull requests, over the ${GITHUB_PR_SEARCH_LIMIT} it can list`);
        for (const item of body.items) {
          const pr = mapGithubPr(item);
          if (!pr)
            continue;
          if (!allowed.has(pr.owner)) {
            deps.log?.(`[github-pr] dropped ${pr.ref}: owner outside BUTCHR_GITHUB_ORGS`);
            continue;
          }
          byRef.set(pr.ref, pr);
        }
        if (body.items.length < PAGE2 || page * PAGE2 >= body.total_count)
          break;
      }
      return [...byRef.values()];
    },
    async comments(ref) {
      const out = [];
      for (let page = 1;; page++) {
        if (page > COMMENT_PAGE_LIMIT2)
          throw new Error(`GitHub comments for ${formatGithubPrRef(ref)} exceed ${COMMENT_PAGE_LIMIT2 * PAGE2}`);
        const params = new URLSearchParams({ per_page: String(PAGE2), page: String(page) });
        const body = await get(`${commentsUrl(ref)}?${params}`, "pull request comments");
        if (!Array.isArray(body))
          throw new Error("GitHub pull request comments returned an unexpected body");
        for (const c of body)
          out.push(mapComment3(c));
        if (body.length < PAGE2)
          return out;
      }
    }
  };
}
function mapComment3(c) {
  return {
    id: String(c.id),
    author: typeof c.user?.login === "string" ? c.user.login : null,
    body: typeof c.body === "string" ? c.body : "",
    created: typeof c.created_at === "string" ? c.created_at : "",
    updated: typeof c.updated_at === "string" ? c.updated_at : ""
  };
}

// ../butchr/src/resources/zendesk-ticket.ts
import { readFileSync, statSync } from "fs";

// ../butchr/src/resources/zendesk-ticket-ref.ts
var SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
var ID_RE = /^[1-9][0-9]{0,15}$/;
var isZendeskSubdomain = (subdomain) => SUBDOMAIN_RE.test(subdomain);
function isZendeskTicketRef(id) {
  return parseZendeskTicketRef(id) !== null;
}
function formatZendeskTicketRef(ref) {
  const id = `${ref.subdomain}#${ref.id}`;
  if (!isZendeskTicketRef(id))
    throw new Error(`invalid Zendesk ticket reference: ${JSON.stringify(id)}`);
  return id;
}
function parseZendeskTicketRef(id) {
  const m = /^([^#]+)#([^#]+)$/.exec(id);
  if (!m || !isZendeskSubdomain(m[1]) || !ID_RE.test(m[2]))
    return null;
  const n = Number(m[2]);
  return Number.isSafeInteger(n) ? { subdomain: m[1], id: n } : null;
}

// ../butchr/src/resources/zendesk-ticket.ts
class ZendeskHttpError extends Error {
  status;
  constructor(status, what) {
    super(`Zendesk ${what} failed: HTTP ${status}`);
    this.status = status;
    this.name = "ZendeskHttpError";
  }
}
var realIo = { stat: (p) => statSync(p), readFile: (p) => readFileSync(p, "utf8"), uid: process.getuid?.() };
function tokens3(query) {
  return query.match(/(?:[^\s"]+|"[^"]*"?)+/g) ?? [];
}
function zendeskTicketQueryProblems(query) {
  const problems = [];
  for (const token of tokens3(query)) {
    const bare = token.replace(/"[^"]*"?/g, "");
    if (/[()]/.test(bare))
      problems.push(`parentheses are not supported ("${token}")`);
    if (/^(AND|OR|NOT)$/.test(token))
      problems.push(`boolean operator ${token} is not supported`);
    if (/^-?type:/i.test(token))
      problems.push(`"${token}": zendesk-ticket rules match tickets only; type:ticket is added to every search`);
  }
  return problems;
}
function scopedTicketQuery(query) {
  const problems = zendeskTicketQueryProblems(query);
  if (problems.length)
    throw new Error(`zendesk-ticket query rejected: ${problems.join("; ")}`);
  return `${query.trim()} type:ticket`;
}
var str = (v) => typeof v === "string" ? v : null;
function mapZendeskTicket(subdomain, item) {
  if (typeof item.id !== "number" || !Number.isSafeInteger(item.id) || item.id < 1)
    return null;
  let ref;
  try {
    ref = formatZendeskTicketRef({ subdomain, id: item.id });
  } catch {
    return null;
  }
  return {
    ref,
    id: item.id,
    subject: str(item.subject) ?? "",
    description: str(item.description) ?? "",
    status: str(item.status) ?? "unknown",
    priority: str(item.priority),
    ticketType: str(item.type),
    tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string").sort() : [],
    updated: str(item.updated_at) ?? "",
    url: `https://${subdomain}.zendesk.com/agent/tickets/${item.id}`
  };
}
var ZENDESK_SEARCH_LIMIT = 1000;
var PAGE3 = 100;
var COMMENT_PAGE_LIMIT3 = 30;
function createZendeskTicketClient(deps) {
  if (!isZendeskSubdomain(deps.subdomain))
    throw new Error("Zendesk client needs a valid ZENDESK_SUBDOMAIN");
  const base = `https://${deps.subdomain}.zendesk.com/api/v2`;
  const headers = { authorization: `Bearer ${deps.token}`, accept: "application/json" };
  const request = async (path, what, init = {}) => {
    const res = await deps.fetchImpl(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers }, redirect: "error" });
    if (!res.ok)
      throw new ZendeskHttpError(res.status, what);
    return res.json();
  };
  const getTicket = async (ref) => {
    const want = formatZendeskTicketRef(ref);
    if (ref.subdomain !== deps.subdomain)
      throw new Error(`${want} is outside ZENDESK_SUBDOMAIN`);
    const body = await request(`/tickets/${ref.id}.json`, "ticket read");
    const ticket = body && typeof body === "object" && body.ticket && typeof body.ticket === "object" ? mapZendeskTicket(deps.subdomain, body.ticket) : null;
    if (!ticket)
      throw new Error(`Zendesk ticket read for ${want} returned an unexpected body`);
    if (ticket.ref !== want)
      throw new Error(`Zendesk answered ${ticket.ref} for ${want}; refusing`);
    return ticket;
  };
  return {
    get: getTicket,
    async addInternalNote(ref, text) {
      const ticket = await getTicket(ref);
      if (ticket.status === "closed")
        throw new Error(`${ticket.ref} is closed; Zendesk accepts no notes on a closed ticket`);
      const body = await request(`/tickets/${ref.id}.json`, "internal note", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket: { comment: { body: text, public: false } } })
      });
      const events = Array.isArray(body?.audit?.events) ? body.audit.events : [];
      const comment = events.find((e) => e?.type === "Comment");
      if (events.some((e) => e?.type === "Comment" && e.public === true)) {
        deps.log?.(`ERROR: [zendesk-ticket] Zendesk recorded the note on ${ticket.ref} as PUBLIC`);
        throw new Error(`Zendesk recorded the note on ${ticket.ref} as public; check the ticket and the agent account's role now`);
      }
      return {
        id: comment && comment.id !== undefined ? String(comment.id) : null,
        confirmedPrivate: comment?.public === false,
        updated: str(body?.ticket?.updated_at)
      };
    },
    async searchAll(query) {
      const q = scopedTicketQuery(query);
      const byRef = new Map;
      for (let page = 1;; page++) {
        const params = new URLSearchParams({ query: q, sort_by: "created_at", sort_order: "asc", per_page: String(PAGE3), page: String(page) });
        const body = await request(`/search.json?${params}`, "ticket search");
        if (!body || typeof body.count !== "number" || !Array.isArray(body.results))
          throw new Error("Zendesk ticket search returned an unexpected body");
        if (body.count > ZENDESK_SEARCH_LIMIT)
          throw new Error(`Zendesk ticket search matched ${body.count} tickets, over the ${ZENDESK_SEARCH_LIMIT} it can list`);
        for (const item of body.results) {
          if (item?.result_type !== "ticket")
            continue;
          const ticket = mapZendeskTicket(deps.subdomain, item);
          if (ticket)
            byRef.set(ticket.ref, ticket);
        }
        if (body.results.length < PAGE3 || page * PAGE3 >= body.count)
          break;
      }
      return [...byRef.values()];
    },
    async comments(ref) {
      if (ref.subdomain !== deps.subdomain)
        throw new Error(`${formatZendeskTicketRef(ref)} is outside ZENDESK_SUBDOMAIN`);
      const out = [];
      let after = null;
      for (let page = 1;; page++) {
        if (page > COMMENT_PAGE_LIMIT3)
          throw new Error(`Zendesk comments for ${formatZendeskTicketRef(ref)} exceed ${COMMENT_PAGE_LIMIT3 * PAGE3}`);
        const params = new URLSearchParams({ "page[size]": String(PAGE3), sort_order: "asc", ...after ? { "page[after]": after } : {} });
        const body = await request(`/tickets/${ref.id}/comments.json?${params}`, "ticket comments");
        if (!body || !Array.isArray(body.comments))
          throw new Error("Zendesk ticket comments returned an unexpected body");
        for (const c of body.comments)
          out.push(mapComment4(c));
        if (body.meta?.has_more !== true)
          return out;
        if (typeof body.meta.after_cursor !== "string" || !body.meta.after_cursor)
          throw new Error("Zendesk ticket comments claimed more pages without a cursor");
        after = body.meta.after_cursor;
      }
    }
  };
}
function mapComment4(c) {
  return {
    id: String(c.id),
    authorId: typeof c.author_id === "number" ? c.author_id : null,
    public: c.public !== false,
    body: str(c.body) ?? "",
    created: str(c.created_at) ?? ""
  };
}

// ../butchr/src/resources/trello-card.ts
import { readFileSync as readFileSync2, statSync as statSync2 } from "fs";

// ../butchr/src/resources/trello-card-ref.ts
var ID_RE2 = /^[0-9a-f]{24}$/;
var isTrelloId = (id) => ID_RE2.test(id);
function isTrelloCardRef(id) {
  return parseTrelloCardRef(id) !== null;
}
function formatTrelloCardRef(ref) {
  const id = `${ref.boardId}#${ref.cardId}`;
  if (!isTrelloCardRef(id))
    throw new Error(`invalid Trello card reference: ${JSON.stringify(id)}`);
  return id;
}
function parseTrelloCardRef(id) {
  const m = /^([^#]+)#([^#]+)$/.exec(id);
  if (!m || !isTrelloId(m[1]) || !isTrelloId(m[2]))
    return null;
  return { boardId: m[1], cardId: m[2] };
}

// ../butchr/src/resources/trello-card.ts
class TrelloHttpError extends Error {
  status;
  constructor(status, what) {
    super(`Trello ${what} failed: HTTP ${status}`);
    this.status = status;
    this.name = "TrelloHttpError";
  }
}
var realIo2 = { stat: (p) => statSync2(p), readFile: (p) => readFileSync2(p, "utf8"), uid: process.getuid?.() };
function trelloCardQueryProblems(query) {
  const problems = [];
  if (/[()]/.test(query))
    problems.push("parentheses are not supported");
  if (/\b(AND|OR|NOT)\b/.test(query))
    problems.push("boolean operators are not supported");
  return problems;
}
function scopedCardQuery(query) {
  const problems = trelloCardQueryProblems(query);
  if (problems.length)
    throw new Error(`trello-card query rejected: ${problems.join("; ")}`);
  return query.trim().toLowerCase();
}
var str2 = (v) => typeof v === "string" ? v : null;
function mapTrelloCard(item) {
  if (typeof item.id !== "string" || typeof item.idBoard !== "string" || !isTrelloId(item.id) || !isTrelloId(item.idBoard))
    return null;
  let ref;
  try {
    ref = formatTrelloCardRef({ boardId: item.idBoard, cardId: item.id });
  } catch {
    return null;
  }
  const labels = Array.isArray(item.labels) ? item.labels.map((l) => l && typeof l === "object" && typeof l.name === "string" ? l.name : null).filter((n) => !!n).sort() : [];
  return {
    ref,
    id: item.id,
    boardId: item.idBoard,
    name: str2(item.name) ?? "",
    desc: str2(item.desc) ?? "",
    closed: item.closed === true,
    listId: typeof item.idList === "string" && isTrelloId(item.idList) ? item.idList : null,
    labels,
    due: str2(item.due),
    updated: str2(item.dateLastActivity) ?? "",
    url: str2(item.shortUrl) ?? `https://trello.com/c/${item.id}`
  };
}
var PAGE_LIMIT = 1000;
var COMMENT_PAGE_LIMIT4 = 5;
function createTrelloCardClient(deps) {
  if (!isTrelloId(deps.boardId))
    throw new Error("Trello client needs a valid TRELLO_BOARD_ID");
  const base = "https://api.trello.com/1";
  const auth = { key: deps.apiKey, token: deps.token };
  const request = async (path, what, params = {}, init = {}) => {
    const qs = new URLSearchParams({ ...auth, ...params });
    deps.log?.(`${init.method ?? "GET"} ${path}`);
    const res = await deps.fetchImpl(`${base}${path}?${qs}`, { ...init, redirect: "error" });
    if (!res.ok)
      throw new TrelloHttpError(res.status, what);
    return res.json();
  };
  const getCard = async (ref) => {
    const want = formatTrelloCardRef(ref);
    if (ref.boardId !== deps.boardId)
      throw new Error(`${want} is outside TRELLO_BOARD_ID`);
    const body = await request(`/cards/${ref.cardId}`, "card read", { fields: "id,idBoard,name,desc,closed,idList,labels,due,dateLastActivity,shortUrl" });
    const card = body && typeof body === "object" ? mapTrelloCard(body) : null;
    if (!card)
      throw new Error(`Trello card read for ${want} returned an unexpected body`);
    if (card.ref !== want)
      throw new Error(`Trello answered ${card.ref} for ${want}; refusing`);
    return card;
  };
  return {
    get: getCard,
    async addComment(ref, text) {
      const card = await getCard(ref);
      const body = await request(`/cards/${ref.cardId}/actions/comments`, "card comment", { text }, { method: "POST" });
      if (!body || typeof body.id !== "string" || !body.id)
        throw new Error(`Trello comment on ${card.ref} WAS posted, but its id could not be confirmed (the response carried no usable id) \u2014 do not retry, it would duplicate the comment`);
      return { id: body.id, created: str2(body.date) };
    },
    async searchAll(query) {
      const q = scopedCardQuery(query);
      const body = await request(`/boards/${deps.boardId}/cards/open`, "board cards", { fields: "id,idBoard,name,desc,closed,idList,labels,due,dateLastActivity,shortUrl" });
      if (!Array.isArray(body))
        throw new Error("Trello board cards returned an unexpected body");
      const out = [];
      for (const item of body) {
        const card = mapTrelloCard(item);
        if (!card)
          continue;
        if (q && !card.name.toLowerCase().includes(q) && !card.desc.toLowerCase().includes(q))
          continue;
        out.push(card);
      }
      return out;
    },
    async lists() {
      const body = await request(`/boards/${deps.boardId}/lists`, "board lists", { filter: "all", fields: "id,name,closed" });
      if (!Array.isArray(body))
        throw new Error("Trello board lists returned an unexpected body");
      const out = [];
      for (const item of body) {
        if (typeof item?.id !== "string" || !isTrelloId(item.id) || typeof item.name !== "string")
          continue;
        out.push({ id: item.id, name: item.name, closed: item.closed === true });
      }
      return out;
    },
    async comments(ref) {
      await getCard(ref);
      const out = [];
      let before;
      for (let page = 1;; page++) {
        if (page > COMMENT_PAGE_LIMIT4)
          throw new Error(`Trello comments for ${formatTrelloCardRef(ref)} exceed ${COMMENT_PAGE_LIMIT4 * PAGE_LIMIT}`);
        const body = await request(`/cards/${ref.cardId}/actions`, "card comments", { filter: "commentCard", limit: String(PAGE_LIMIT), ...before ? { before } : {} });
        if (!Array.isArray(body))
          throw new Error("Trello card comments returned an unexpected body");
        const items = body;
        for (const a of items) {
          const comment = mapComment5(a);
          if (!comment)
            throw new Error(`Trello comments for ${formatTrelloCardRef(ref)} included a malformed comment action (missing or non-string id/text)`);
          out.push(comment);
        }
        if (items.length < PAGE_LIMIT)
          break;
        const last = items[items.length - 1];
        if (typeof last?.id !== "string")
          throw new Error(`Trello card comments for ${formatTrelloCardRef(ref)} claimed a full page without a usable id to page from`);
        before = last.id;
      }
      return out.reverse();
    }
  };
}
function mapComment5(a) {
  if (typeof a.id !== "string" || !a.id)
    return null;
  const data = a.data && typeof a.data === "object" ? a.data : {};
  if (typeof data.text !== "string")
    return null;
  return {
    id: a.id,
    authorId: typeof a.idMemberCreator === "string" ? a.idMemberCreator : null,
    body: data.text,
    created: str2(a.date) ?? ""
  };
}

// ../butchr/src/providers/read-protocol.ts
var MAX_PROVIDER_RESULT_BYTES = 4000000;
var providerReadOperations = {
  "jira-work": ["searchAll", "comments", "remoteLinks", "issue", "allComments", "pollExternal"],
  "jira-idea": ["searchAll", "comments", "remoteLinks", "issue", "allComments", "pollExternal"],
  "jira-project": ["searchProjects", "searchAll", "comments", "remoteLinks", "issue", "allComments", "pollExternal"],
  "confluence-page": ["getChildPages", "getPageVersions", "getPageComments", "getPage", "confluencePageVersion"],
  "github-issue": ["searchAll", "comments", "get"],
  "github-pr": ["searchAll", "comments", "get"],
  "zendesk-ticket": ["searchAll", "comments", "get"],
  "trello-card": ["searchAll", "comments", "get", "lists"]
};
var plain = (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
function exact(v, keys) {
  if (Object.keys(v).sort().join(",") !== keys.sort().join(","))
    throw Error("Invalid provider fields");
}
function boundedString(value, max = 32000) {
  if (typeof value !== "string" || !value.length || value.length > max || value.includes("\x00"))
    throw Error("Invalid provider argument");
}
function decodeProviderRead(value) {
  if (!plain(value))
    throw Error("Invalid provider read");
  exact(value, ["provider", "method", "args"]);
  if (typeof value.provider !== "string" || !Object.hasOwn(providerReadOperations, value.provider) || typeof value.method !== "string" || !providerReadOperations[value.provider].includes(value.method) || !Array.isArray(value.args))
    throw Error("Unsupported provider read");
  const { provider, method, args } = value;
  if (method === "pollExternal") {
    const item = args[0];
    if (args.length !== 2 || !plain(item) || Object.keys(item).some((k) => !["kind", "target", "origin"].includes(k)) || !["confluence", "github-issue", "github-pr", "webpage"].includes(item.kind) || typeof item.target !== "string" || !item.target || item.target.length > 4096 || item.origin !== undefined && item.origin !== "ticket-pr" || args[1] !== null && typeof args[1] !== "string")
      throw Error("Invalid external read");
    if (typeof args[1] === "string" && args[1].length > 32000)
      throw Error("External fingerprint too long");
  } else if (method === "lists") {
    if (args.length)
      throw Error("Unexpected provider arguments");
  } else if (method === "getPageVersions") {
    if (args.length !== 1 || !Array.isArray(args[0]) || args[0].length > 1000 || args[0].some((v) => typeof v !== "string" || !/^\d{1,100}$/.test(v)))
      throw Error("Invalid page IDs");
  } else if (method === "getChildPages") {
    if (args.length < 1 || args.length > 2)
      throw Error("Invalid child-page arguments");
    boundedString(args[0], 100);
    if (!/^\d+$/.test(args[0]))
      throw Error("Invalid page ID");
    if (args.length === 2)
      boundedString(args[1], 4096);
  } else if ((provider === "github-issue" || provider === "github-pr") && method !== "searchAll") {
    const ref = args[0];
    if (args.length !== 1 || !plain(ref))
      throw Error("Invalid GitHub ref");
    exact(ref, ["owner", "repo", "number"]);
    if (typeof ref.owner !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(ref.owner) || typeof ref.repo !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(ref.repo) || !Number.isSafeInteger(ref.number) || ref.number < 1)
      throw Error("Invalid GitHub ref");
  } else if ((provider === "zendesk-ticket" || provider === "trello-card") && method !== "searchAll" && method !== "lists") {
    const ref = args[0];
    if (args.length !== 1 || !plain(ref))
      throw Error("Invalid provider ref");
    if (provider === "zendesk-ticket") {
      exact(ref, ["subdomain", "id"]);
      if (typeof ref.subdomain !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(ref.subdomain) || !Number.isSafeInteger(ref.id) || ref.id < 1)
        throw Error("Invalid Zendesk ref");
    } else {
      exact(ref, ["boardId", "cardId"]);
      if (typeof ref.boardId !== "string" || typeof ref.cardId !== "string" || !/^[a-f0-9]{24}$/.test(ref.boardId) || !/^[a-f0-9]{24}$/.test(ref.cardId))
        throw Error("Invalid Trello ref");
    }
  } else {
    if (args.length !== 1)
      throw Error("Invalid provider arguments");
    if ((method === "searchAll" || method === "searchProjects") && args[0] === "") {} else
      boundedString(args[0]);
    if (provider === "confluence-page" && !/^\d{1,100}$/.test(args[0]))
      throw Error("Invalid page ID");
  }
  return structuredClone({ provider, method, args });
}
function jsonClone(value, max) {
  let nodes = 0;
  const visit = (v, depth) => {
    if (++nodes > 200000 || depth > 32)
      throw Error("Provider result too complex");
    if (v === null || typeof v === "boolean" || typeof v === "string")
      return;
    if (v instanceof Date && Number.isFinite(v.getTime()))
      return;
    if (typeof v === "number" && Number.isFinite(v))
      return;
    if (Array.isArray(v)) {
      for (const x of v)
        visit(x, depth + 1);
      return;
    }
    if (plain(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (["__proto__", "constructor", "prototype"].includes(k))
          throw Error("Unsafe provider field");
        if (x !== undefined)
          visit(x, depth + 1);
      }
      return;
    }
    throw Error("Provider result must be JSON");
  };
  visit(value, 0);
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > max)
    throw Error("Provider result exceeds bound");
  return JSON.parse(text);
}
function decodeProviderValue(read, value) {
  const copy = jsonClone(value, MAX_PROVIDER_RESULT_BYTES);
  if (read.method === "pollExternal") {
    if (!plain(copy) || !["ok", "not-modified", "unreadable", "error"].includes(copy.status) || copy.status === "ok" && typeof copy.fingerprint !== "string")
      throw Error("Invalid external verdict");
    return copy;
  }
  const list = ["searchAll", "searchProjects", "comments", "allComments", "remoteLinks", "lists"].includes(read.method);
  if (list && !Array.isArray(copy))
    throw Error("Invalid provider collection");
  if (["get", "issue", "getPage", "getChildPages", "getPageComments", "getPageVersions", "confluencePageVersion"].includes(read.method) && !plain(copy))
    throw Error("Invalid provider resource");
  if (read.method === "getChildPages" || read.method === "getPageComments") {
    if (!plain(copy) || !Array.isArray(copy.results))
      throw Error("Invalid page collection");
  }
  const strings = (v, keys) => {
    if (!plain(v) || keys.some((k) => typeof v[k] !== "string"))
      throw Error("Invalid provider DTO");
  };
  const resource = (v) => {
    if (read.provider.startsWith("jira-"))
      strings(v, ["key", "summary", "status", "issuetype", "updated"]);
    else if (read.provider.startsWith("github-"))
      strings(v, ["ref", "owner", "repo", "title", "body", "state", "updated", "url"]);
    else if (read.provider === "zendesk-ticket")
      strings(v, ["ref", "subject", "description", "status", "updated", "url"]);
    else if (read.provider === "trello-card")
      strings(v, ["ref", "id", "boardId", "name", "desc", "updated", "url"]);
  };
  if (read.method === "searchAll")
    for (const item of copy)
      resource(item);
  if (read.method === "get" || read.method === "issue")
    resource(copy);
  if (read.method === "searchProjects")
    for (const item of copy)
      strings(item, ["id", "key", "name"]);
  if (read.method === "comments" || read.method === "allComments")
    for (const item of copy)
      strings(item, ["id", "body", "created"]);
  if (read.method === "getChildPages" || read.method === "getPageComments")
    for (const item of copy.results)
      strings(item, ["id"]);
  if (read.method === "getPageVersions") {
    for (const [id, version] of Object.entries(copy))
      if (!/^\d+$/.test(id) || !Number.isSafeInteger(version) || version < 1)
        throw Error("Invalid page version");
  }
  return copy;
}

// ../butchr/src/setup/github-token-write.ts
var GITHUB_API = "https://api.github.com";
function githubHeaders(token) {
  return { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "butchr" };
}

// ../butchr/src/web/github-connection-test.ts
var TIMEOUT_MS = 1e4;
var MAX_ORGS = 20;
function classify(status) {
  if (status >= 200 && status < 300)
    return "2xx";
  if (status === 401 || status === 403)
    return "401/403";
  return "other";
}
async function call(url, token, fetchFn) {
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { method: "GET", headers: githubHeaders(token), redirect: "manual", signal: controller.signal });
    return { httpStatusClass: classify(res.status), res };
  } catch {
    return { httpStatusClass: "network" };
  } finally {
    clearTimeout(timer);
  }
}
function fixedErrorFor(httpStatusClass) {
  switch (httpStatusClass) {
    case "401/403":
      return "GitHub rejected this token (401/403).";
    case "network":
      return "could not reach GitHub (network error or timeout).";
    default:
      return "GitHub returned an unexpected response.";
  }
}
async function testGithubConnection(token, orgs, fetchFn = fetch) {
  if (!token)
    return { ok: false, httpStatusClass: "other", error: "No GitHub token is set.", orgs: [] };
  const user = await call(`${GITHUB_API}/user`, token, fetchFn);
  if (user.httpStatusClass !== "2xx" || !user.res)
    return { ok: false, httpStatusClass: user.httpStatusClass, error: fixedErrorFor(user.httpStatusClass), orgs: [] };
  let login;
  try {
    const body = await user.res.json();
    login = body && typeof body === "object" ? body.login : undefined;
  } catch {}
  if (typeof login !== "string" || !login)
    return { ok: false, httpStatusClass: "2xx", error: "GitHub answered without a login, so this doesn't look like a GitHub token.", orgs: [] };
  const orgResults = [];
  for (const org of orgs.slice(0, MAX_ORGS)) {
    const result = await call(`${GITHUB_API}/orgs/${encodeURIComponent(org)}`, token, fetchFn);
    orgResults.push({ org, ok: result.httpStatusClass === "2xx", httpStatusClass: result.httpStatusClass });
  }
  const failedOrgs = orgResults.filter((o) => !o.ok).map((o) => o.org);
  return {
    ok: failedOrgs.length === 0,
    login,
    httpStatusClass: "2xx",
    ...failedOrgs.length ? { error: `This token can't see ${failedOrgs.join(", ")}.` } : {},
    orgs: orgResults
  };
}
// ../butchr/src/web/jira-connection-test.ts
var TIMEOUT_MS2 = 1e4;
function classify2(status) {
  if (status >= 200 && status < 300)
    return "2xx";
  if (status === 401 || status === 403)
    return "401/403";
  return "other";
}
async function testJiraConnection(creds, fetchFn = fetch) {
  const url = `${creds.site.replace(/\/+$/, "")}/rest/api/3/myself`;
  const basic = Buffer.from(`${creds.email}:${creds.token}`).toString("base64");
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS2);
  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { authorization: `Basic ${basic}`, accept: "application/json" },
      redirect: "manual",
      signal: controller.signal
    });
    const httpStatusClass = classify2(res.status);
    if (httpStatusClass !== "2xx") {
      return { ok: false, site: creds.site, httpStatusClass, error: fixedErrorFor2(httpStatusClass) };
    }
    let body;
    try {
      body = await res.json();
    } catch {
      return { ok: false, site: creds.site, httpStatusClass, error: NOT_JIRA_ERROR };
    }
    const hasAccountId = !!body && typeof body === "object" && typeof body.accountId === "string";
    return hasAccountId ? { ok: true, site: creds.site, httpStatusClass } : { ok: false, site: creds.site, httpStatusClass, error: NOT_JIRA_ERROR };
  } catch {
    return { ok: false, site: creds.site, httpStatusClass: "network", error: fixedErrorFor2("network") };
  } finally {
    clearTimeout(timer);
  }
}
function fixedErrorFor2(httpStatusClass) {
  switch (httpStatusClass) {
    case "401/403":
      return "Jira rejected these credentials (401/403).";
    case "other":
      return "Jira returned an unexpected response.";
    case "network":
      return "could not reach Jira (network error or timeout).";
    default:
      return "unknown error";
  }
}
var NOT_JIRA_ERROR = "Jira returned a 2xx response that doesn't look like Jira (no accountId in the body).";
// ../butchr/src/setup/provider-secrets.ts
var TIMEOUT_MS3 = 1e4;
async function getJson(url, headers, fetchFn) {
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS3);
  try {
    const res = await fetchFn(url, { method: "GET", headers, redirect: "error", signal: controller.signal });
    if (res.status === 401 || res.status === 403)
      return { ok: false, reason: "unauthorized" };
    if (res.status < 200 || res.status >= 300)
      return { ok: false, reason: "other" };
    return { ok: true, body: await res.json() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: /redirect/i.test(message) ? "redirect" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
function field(obj, key) {
  return obj && typeof obj === "object" ? obj[key] : undefined;
}
async function testZendeskToken(subdomain, token, fetchFn = fetch) {
  const result = await getJson(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": "butchr" }, fetchFn);
  if (!result.ok)
    return result;
  const user = field(result.body, "user");
  const id = field(user, "id");
  if (typeof id !== "number" && (typeof id !== "string" || !id))
    return { ok: false, reason: "unauthorized" };
  const email = field(user, "email");
  const name = field(user, "name");
  return { ok: true, id: String(id), label: typeof email === "string" && email ? email : typeof name === "string" && name ? name : String(id) };
}
async function testTrelloCredentials(apiKey, token, fetchFn = fetch) {
  const query = new URLSearchParams({ key: apiKey, token, fields: "id,username" });
  const result = await getJson(`https://api.trello.com/1/members/me?${query}`, { accept: "application/json", "user-agent": "butchr" }, fetchFn);
  if (!result.ok)
    return result;
  const id = field(result.body, "id");
  if (typeof id !== "string" || !id)
    return { ok: false, reason: "other" };
  const username = field(result.body, "username");
  return { ok: true, id, label: typeof username === "string" && username ? username : id };
}
async function testTrelloBoard(boardId, apiKey, token, fetchFn = fetch) {
  const query = new URLSearchParams({ key: apiKey, token, fields: "name" });
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS3);
  try {
    const res = await fetchFn(`https://api.trello.com/1/boards/${encodeURIComponent(boardId)}?${query}`, { method: "GET", headers: { accept: "application/json", "user-agent": "butchr" }, redirect: "error", signal: controller.signal });
    if (res.status === 404)
      return { ok: false, reason: "not-found" };
    if (res.status === 401 || res.status === 403)
      return { ok: false, reason: "unauthorized" };
    if (res.status < 200 || res.status >= 300)
      return { ok: false, reason: "other" };
    const name = field(await res.json(), "name");
    return { ok: true, name: typeof name === "string" ? name : boardId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: /redirect/i.test(message) ? "redirect" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

// ../butchr/src/providers/readers.ts
function createProviderReader(credentials, fetchImpl = fetch, linkedGithubToken, sdkTransports, webpageTransport) {
  const table = new Map;
  const put = (provider, method, fn) => table.set(provider + ":" + method, fn);
  if (credentials.family === "atlassian") {
    const url = new URL(credentials.site);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".atlassian.net") || url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw Error("Atlassian cloud origin required");
    const client = new AtlassianClient(url.origin, credentials.email, credentials.token, fetchImpl);
    const ops = fetchImpl === globalThis.fetch || sdkTransports ? realAtlassian({ ...credentials, site: url.origin }, sdkTransports) : null;
    const sdk = () => {
      if (!ops)
        throw Error("Injected Confluence SDK transport required");
      return ops;
    };
    for (const provider of ["jira-work", "jira-idea", "jira-project"]) {
      put(provider, "searchAll", (q) => client.searchAll(q));
      put(provider, "comments", (key) => client.comments(key));
      put(provider, "allComments", (key) => client.allComments(key));
      put(provider, "remoteLinks", (key) => client.remoteLinks(key));
      put(provider, "issue", (key) => client.issue(key));
      put(provider, "pollExternal", (item, prior) => pollExternalItem(item, prior ?? undefined, { confluenceVersion: (id) => client.confluencePageVersion(id), webpage: webpageTransport ?? (fetchImpl === globalThis.fetch ? { fetchImpl: createPinnedWebpageFetch() } : { fetchImpl: async () => {
        throw Error("Injected pinned webpage transport required");
      }, isBlockedHost: async () => true }), ...linkedGithubToken ? { github: { fetchImpl, token: linkedGithubToken } } : {} }));
    }
    put("jira-project", "searchProjects", (q) => client.searchProjects(q));
    put("confluence-page", "getChildPages", (id, cursor) => sdk().getChildPages(id, cursor));
    put("confluence-page", "getPageVersions", (ids) => sdk().getPageVersions(ids));
    put("confluence-page", "getPageComments", (id) => sdk().getPageComments(id));
    put("confluence-page", "getPage", (id) => sdk().getPage(id));
    put("confluence-page", "confluencePageVersion", (id) => client.confluencePageVersion(id));
  } else if (credentials.family === "github") {
    const deps = { token: credentials.token, orgs: credentials.orgs, fetchImpl };
    const issue = createGithubIssueClient(deps), pr = createGithubPrClient(deps);
    put("github-issue", "searchAll", (q) => issue.searchAll(q));
    put("github-issue", "comments", (ref) => issue.comments(ref));
    put("github-issue", "get", (ref) => issue.get(ref));
    put("github-pr", "searchAll", (q) => pr.searchAll(q));
    put("github-pr", "comments", (ref) => pr.comments(ref));
    put("github-pr", "get", (ref) => pr.get(ref));
  } else if (credentials.family === "zendesk") {
    const client = createZendeskTicketClient({ ...credentials, fetchImpl });
    put("zendesk-ticket", "searchAll", (q) => client.searchAll(q));
    put("zendesk-ticket", "comments", (ref) => client.comments(ref));
    put("zendesk-ticket", "get", (ref) => client.get(ref));
  } else {
    const client = createTrelloCardClient({ ...credentials, fetchImpl });
    put("trello-card", "searchAll", (q) => client.searchAll(q));
    put("trello-card", "comments", (ref) => client.comments(ref));
    put("trello-card", "get", (ref) => client.get(ref));
    put("trello-card", "lists", () => client.lists());
  }
  return async (input) => {
    const read = decodeProviderRead(input);
    const method = table.get(read.provider + ":" + read.method);
    if (!method)
      throw Error("Provider not configured");
    return decodeProviderValue(read, await method(...read.args));
  };
}
function linkedWebpageTargets(read, value) {
  if (!["searchAll", "issue", "get", "getPage"].includes(read.method))
    return [];
  const resources = Array.isArray(value) ? value : [value], out = new Set;
  for (const resource of resources) {
    if (!resource || typeof resource !== "object")
      continue;
    const r = resource;
    for (const body of [r.description, r.body, read.method === "getPage" ? r.body?.storage?.value : undefined])
      if (typeof body === "string") {
        for (const item of descriptionItems(body))
          if (item.kind === "webpage")
            out.add(item.target);
      }
  }
  return [...out];
}
export {
  testZendeskToken,
  testTrelloCredentials,
  testTrelloBoard,
  testJiraConnection,
  testGithubConnection,
  linkedWebpageTargets,
  createProviderReader
};
