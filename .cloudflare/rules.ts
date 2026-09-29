/**
 * The Cloudflare configuration for ReShare, as data. `cloudflare.ts` turns it into Cloudflare's
 * API calls (`plan` / `apply`); `rules.test.ts` checks the same lists against the paths the server
 * serves and against scanner probes. Path lists are kept as data, and the rule expressions are
 * generated from them, so the tests exercise exactly what gets deployed.
 *
 * The zone holds other hostnames, so every rule is scoped to `HOST` and zone-wide settings are
 * limited to ones that can't break another site.
 */

export const ZONE = 'arthur-resende.com.br';
export const HOST = 'reshare.arthur-resende.com.br';

/**
 * Rules `apply` owns start with this; any other rule in the same phase (another hostname's) is
 * kept as it is.
 */
export const MANAGED_PREFIX = '[reshare] ';

/** Zone-wide settings: only WebSockets, which `/signaling` needs and nothing else is hurt by. */
export const SETTINGS = { websockets: 'on' } as const;

// --- Bots ----------------------------------------------------------------------------------------

/**
 * Bot Fight Mode: Cloudflare challenges traffic it recognises as automated (verified crawlers
 * pass). It is zone-wide and, on the Free plan, no rule can exempt anything from it. Turned on in
 * the dashboard (the API's update fails on Free zones); `plan` / `apply` check it.
 */
export const BOT_MANAGEMENT = { fight_mode: true } as const;

// --- Paths the server serves ---------------------------------------------------------------------
//
// An allowlist: the server has a fixed set of routes (`server/index.ts`), so anything else is a
// scanner guessing (`/.env`, `/wp-login.php`, `/actuator/env`) and gets Cloudflare's 403 without
// reaching Railway. The tests fail if a route in `server/index.ts` is missing here.

/** Exact paths: `routes` in `server/index.ts`, plus `/signaling` from its `fetch`. */
export const SERVED_PATHS = [
  '/',
  '/manifest.webmanifest',
  '/service-worker.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/health',
  '/client-errors',
  '/config.json',
  '/realtime/session',
  '/realtime/tracks/new',
  '/realtime/renegotiate',
  '/realtime/tracks/close',
  '/signaling',
];

/** HTTP-01 certificate challenges, so a certificate for the host can renew behind Cloudflare. */
export const ACME_CHALLENGE_PREFIX = '/.well-known/acme-challenge/';

/** `/room/:roomId`: one segment after the prefix, without dots (room IDs are UUIDs). */
export const ROOM_PREFIX = '/room/';

/**
 * Bun's bundle of `src/client/index.html`, served from the root with a hash in the name
 * (`/index-jwx617f2.js`, `/app-icon-deas12w5.svg`): one segment, a `-`, and one of these
 * extensions. Unhashed names scanners try (`/config.js`, `/env.js`, `/sw.js`) have no `-`.
 */
export const ASSET_EXTENSIONS = ['js', 'css', 'svg', 'png', 'webmanifest'];

/** The only methods other than GET / HEAD the server handles (`src/client/**`, `server/index.ts`). */
export const WRITE_PATHS = {
  POST: ['/client-errors', '/realtime/session', '/realtime/tracks/new'],
  PUT: ['/realtime/renegotiate', '/realtime/tracks/close'],
};

// --- Crawlers scanners pretend to be ----------------------------------------------------------

/**
 * What a crawler's user agent says about itself: a contact URL (`+https://…`) or the words
 * "spider" / "crawler", compared lowercased. Real crawlers are on Cloudflare's verified-bots list
 * (`cf.client.bot`); one that calls itself a crawler without being verified is a scanner in
 * disguise. Browsers never send these.
 */
export const CRAWLER_USER_AGENT_MARKERS = ['+http', 'spider', 'crawler'];

/**
 * User-agent names of verified crawlers, checked as well since some don't carry a marker. Only list
 * crawlers on Cloudflare's verified-bots list, or the real one gets blocked too.
 */
export const VERIFIED_CRAWLER_NAMES = [
  'Googlebot',
  'bingbot',
  'Amazonbot',
  'ClaudeBot',
  'GPTBot',
  'Meta-ExternalAgent',
  'CCBot',
  'DuckAssistBot',
];

// --- Rate limit ----------------------------------------------------------------------------------

/**
 * The endpoints the rate limit counts: the ones that cost something per request (the Cloudflare
 * Realtime API behind `/realtime/*`, the deploy log behind `/client-errors`, a WebSocket per
 * `/signaling`). On the Free plan a rate limit expression can only use the path (no host, no
 * functions), so the rule covers every hostname in the zone; these paths are ReShare's own, and
 * `/` and the assets stay out so other sites on the zone aren't counted.
 */
export const RATE_LIMITED_PATHS = [
  '/config.json',
  '/client-errors',
  '/signaling',
  '/realtime/session',
  '/realtime/tracks/new',
  '/realtime/renegotiate',
  '/realtime/tracks/close',
];

/**
 * Requests per IP per 10 seconds (the only period on the Free plan). Joining a room is a few of
 * these (config, WebSocket, and in the Cloudflare media mode a session plus one per published or
 * watched track), so this leaves room for several people behind the same NAT joining at once.
 */
const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_PERIOD_SECONDS = 10;

// --- Expressions --------------------------------------------------------------------------------

const PATH = 'http.request.uri.path';

function quoted(value: string): string {
  return JSON.stringify(value);
}

function set(values: readonly string[]): string {
  return `{${values.map(quoted).join(' ')}}`;
}

const onHost = `http.host eq ${quoted(HOST)}`;

const roomPage = `(starts_with(${PATH}, ${quoted(ROOM_PREFIX)}) and len(${PATH}) > ${ROOM_PREFIX.length} and not substring(${PATH}, ${ROOM_PREFIX.length}) contains "/" and not ${PATH} contains ".")`;

const bundleAsset = `(not substring(${PATH}, 1) contains "/" and ${PATH} contains "-" and ${PATH}.extension in ${set(ASSET_EXTENSIONS)})`;

const servedPath = `(${PATH} in ${set(SERVED_PATHS)} or starts_with(${PATH}, ${quoted(ACME_CHALLENGE_PREFIX)}) or ${roomPage} or ${bundleAsset})`;

const writeAllowed = Object.entries(WRITE_PATHS)
  .map(
    ([method, paths]) =>
      `(http.request.method eq ${quoted(method)} and ${PATH} in ${set(paths)})`,
  )
  .join(' or ');

const fakeCrawler = [
  ...CRAWLER_USER_AGENT_MARKERS.map(
    marker => `lower(http.user_agent) contains ${quoted(marker)}`,
  ),
  ...VERIFIED_CRAWLER_NAMES.map(
    name => `http.user_agent contains ${quoted(name)}`,
  ),
].join(' or ');

// --- Rulesets (Cloudflare's Rulesets API shape) ------------------------------------------------

export interface Rule {
  action: string;
  action_parameters?: Record<string, unknown>;
  description: string;
  enabled: boolean;
  expression: string;
  ratelimit?: Record<string, unknown>;
}

/** The rules `apply` owns in each phase; other rules in the phase are kept. */
export const RULESETS: Record<string, Rule[]> = {
  http_config_settings: [
    {
      action: 'set_config',
      // Railway needs Full for proxied domains ("Full (Strict) will not work"). Browser Integrity
      // Check blocks requests whose headers no browser sends (a missing or abuse-tool user agent).
      action_parameters: { bic: true, ssl: 'full' },
      description: `${MANAGED_PREFIX}Full SSL to Railway and Browser Integrity Check`,
      enabled: true,
      expression: onHost,
    },
  ],
  http_request_firewall_custom: [
    {
      action: 'block',
      description: `${MANAGED_PREFIX}Block paths the server doesn't serve`,
      enabled: true,
      expression: `${onHost} and not ${servedPath}`,
    },
    {
      action: 'block',
      description: `${MANAGED_PREFIX}Block methods the server doesn't handle on the path`,
      enabled: true,
      expression: `${onHost} and not http.request.method in {"GET" "HEAD"} and not (${writeAllowed})`,
    },
    {
      action: 'block',
      description: `${MANAGED_PREFIX}Block requests that call themselves a crawler but aren't verified`,
      enabled: true,
      expression: `${onHost} and not cf.client.bot and (${fakeCrawler})`,
    },
  ],
  http_ratelimit: [
    {
      action: 'block',
      description: `${MANAGED_PREFIX}Rate limit: more than ${RATE_LIMIT_REQUESTS} requests in ${RATE_LIMIT_PERIOD_SECONDS} seconds from one IP to ReShare's endpoints`,
      enabled: true,
      expression: `${PATH} in ${set(RATE_LIMITED_PATHS)}`,
      ratelimit: {
        characteristics: ['cf.colo.id', 'ip.src'],
        mitigation_timeout: RATE_LIMIT_PERIOD_SECONDS,
        period: RATE_LIMIT_PERIOD_SECONDS,
        requests_per_period: RATE_LIMIT_REQUESTS,
      },
    },
  ],
};

/** The Free plan's limits per zone (for all hostnames together), checked by the tests. */
export const PLAN_LIMITS: Record<string, number> = {
  http_config_settings: 10,
  http_ratelimit: 1,
  http_request_firewall_custom: 5,
};
