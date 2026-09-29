/**
 * Checks the Cloudflare rules in `rules.ts` against the paths the server serves and against
 * scanner probes (`test-paths.ts`), by evaluating the rules' lists with the semantics of the
 * Cloudflare expressions generated from them: `in {…}` is an exact match, `starts_with` /
 * `contains` are case-sensitive string tests, `substring(s, n)` drops the first `n` characters,
 * and `.extension` is the last segment's extension, lowercased and without the dot. It can't prove
 * what Cloudflare does (`bun run cf:plan` and the Security Events log do), but it catches a rule
 * that would block the app or let a probe through.
 */
import { describe, expect, test } from 'bun:test';

import {
  ACME_CHALLENGE_PREFIX,
  ASSET_EXTENSIONS,
  CRAWLER_USER_AGENT_MARKERS,
  HOST,
  MANAGED_PREFIX,
  PLAN_LIMITS,
  RATE_LIMITED_PATHS,
  ROOM_PREFIX,
  RULESETS,
  SERVED_PATHS,
  VERIFIED_CRAWLER_NAMES,
  WRITE_PATHS,
} from './rules.ts';
import {
  ASSET_PATHS,
  SCANNER_PATHS,
  SERVER_ROUTES,
  SITE_PATHS,
} from './test-paths.ts';

// Cloudflare's limit on a rule expression's length.
const MAX_EXPRESSION_LENGTH = 4096;

function extension(path: string): string {
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');

  return dot === -1 ? '' : lastSegment.slice(dot + 1).toLowerCase();
}

function isBundleAsset(path: string): boolean {
  return (
    !path.slice(1).includes('/') &&
    path.includes('-') &&
    ASSET_EXTENSIONS.includes(extension(path))
  );
}

function isRoomPage(path: string): boolean {
  return (
    path.startsWith(ROOM_PREFIX) &&
    path.length > ROOM_PREFIX.length &&
    !path.slice(ROOM_PREFIX.length).includes('/') &&
    !path.includes('.')
  );
}

/** The first custom rule, inverted: whether a path reaches the server. */
function isServedPath(path: string): boolean {
  return (
    SERVED_PATHS.includes(path) ||
    path.startsWith(ACME_CHALLENGE_PREFIX) ||
    isRoomPage(path) ||
    isBundleAsset(path)
  );
}

/** The second custom rule, inverted: whether a method reaches the server on a path. */
function isMethodAllowed(method: string, path: string): boolean {
  const writePaths: Record<string, string[]> = WRITE_PATHS;

  return (
    ['GET', 'HEAD'].includes(method) ||
    (writePaths[method]?.includes(path) ?? false)
  );
}

/** The fake-crawler rule for a request Cloudflare didn't verify (`not cf.client.bot`). */
function isFakeCrawler(userAgent: string): boolean {
  const lowered = userAgent.toLowerCase();

  return (
    CRAWLER_USER_AGENT_MARKERS.some(marker => lowered.includes(marker)) ||
    VERIFIED_CRAWLER_NAMES.some(name => userAgent.includes(name))
  );
}

/** Unverified crawler user agents scanners send. */
const SCANNER_USER_AGENTS = [
  'Mozilla/5.0 (compatible; YiBot/1.0; +https://01.ai/)',
  'Mozilla/5.0 (compatible; GrokBot/1.0; +https://x.ai/)',
  'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com) AppleWebKit/537.36',
  'Mozilla/5.0 (compatible; cohere-ai; +https://cohere.com/crawler)',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
];

/** Browsers and link previews; none may look like a crawler. */
const BROWSER_USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  'WhatsApp/2.23.20.0',
];

describe('served paths rule', () => {
  // Guards the tests below: an empty list would make "let every site path through" pass vacuously.
  test("read the server's routes and build output", () => {
    expect(SERVER_ROUTES).toEqual(
      expect.arrayContaining(['/', '/config.json', '/signaling']),
    );
    expect(SERVER_ROUTES.some(path => path.startsWith(ROOM_PREFIX))).toBe(true);
    expect(ASSET_PATHS.some(path => path.endsWith('.js'))).toBe(true);
    expect(ASSET_PATHS.some(path => path.endsWith('.css'))).toBe(true);
  });

  test.each(SITE_PATHS)('let %s through', path => {
    expect(isServedPath(path)).toBe(true);
  });

  test.each(SCANNER_PATHS)('block %s', path => {
    expect(isServedPath(path)).toBe(false);
  });

  test('let certificate challenges through', () => {
    expect(isServedPath('/.well-known/acme-challenge/token')).toBe(true);
  });

  test('keep the path list free of routes the server dropped', () => {
    for (const path of SERVED_PATHS) {
      expect(SERVER_ROUTES).toContain(path);
    }
  });
});

describe('method rule', () => {
  test.each(Object.values(WRITE_PATHS).flat())(
    'serve writes to the route %s',
    path => {
      expect(SERVER_ROUTES).toContain(path);
    },
  );

  test.each([
    ['POST', '/client-errors'],
    ['POST', '/realtime/session'],
    ['POST', '/realtime/tracks/new'],
    ['PUT', '/realtime/renegotiate'],
    ['PUT', '/realtime/tracks/close'],
    ['GET', '/signaling'],
    ['HEAD', '/'],
  ])('let %s %s through', (method, path) => {
    expect(isMethodAllowed(method, path)).toBe(true);
  });

  test.each([
    ['POST', '/'],
    ['POST', '/config.json'],
    ['PUT', '/realtime/session'],
    ['DELETE', '/realtime/tracks/close'],
    ['OPTIONS', '/'],
    ['PATCH', '/client-errors'],
  ])('block %s %s', (method, path) => {
    expect(isMethodAllowed(method, path)).toBe(false);
  });
});

describe('fake crawler rule', () => {
  test.each(SCANNER_USER_AGENTS)('block unverified %s', userAgent => {
    expect(isFakeCrawler(userAgent)).toBe(true);
  });

  test.each(BROWSER_USER_AGENTS)('let %s through', userAgent => {
    expect(isFakeCrawler(userAgent)).toBe(false);
  });

  test('exempt crawlers Cloudflare verifies', () => {
    const [, , fakeCrawlerRule] = RULESETS.http_request_firewall_custom ?? [];

    expect(fakeCrawlerRule?.expression).toContain(
      'and not cf.client.bot and (',
    );
  });
});

describe('rulesets', () => {
  test("fit the Free plan's per-zone limits", () => {
    for (const [phase, rules] of Object.entries(RULESETS)) {
      expect(rules.length).toBeLessThanOrEqual(PLAN_LIMITS[phase] ?? 0);
    }
  });

  test("keep every expression within Cloudflare's length limit", () => {
    for (const rule of Object.values(RULESETS).flat()) {
      expect(rule.expression.length).toBeLessThanOrEqual(MAX_EXPRESSION_LENGTH);
    }
  });

  test('mark every rule as managed by apply', () => {
    for (const rule of Object.values(RULESETS).flat()) {
      expect(rule.description).toStartWith(MANAGED_PREFIX);
    }
  });

  // The zone serves other hostnames: a rule without the host would apply to them too.
  test('scope every rule but the rate limit to the app host', () => {
    const { http_ratelimit: _, ...scoped } = RULESETS;

    for (const rule of Object.values(scoped).flat()) {
      expect(rule.expression).toStartWith(`http.host eq "${HOST}"`);
    }
  });

  // Free-plan rate limits reject any field but the path and any function ("not entitled").
  test('build the rate limit from an exact path list only', () => {
    const [rateLimit] = RULESETS.http_ratelimit ?? [];

    expect(rateLimit?.expression).toBe(
      `http.request.uri.path in {${RATE_LIMITED_PATHS.map(path => JSON.stringify(path)).join(' ')}}`,
    );
  });

  test.each(RATE_LIMITED_PATHS)('rate limit the server route %s', path => {
    expect(SERVER_ROUTES).toContain(path);
  });
});
