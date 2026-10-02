import { expect, test } from 'bun:test';
import { createOriginAuth, ORIGIN_AUTH_HEADER } from '../server/originAuth';

const SECRET = 'origin-auth-secret-with-at-least-32-characters';

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/config.json', { headers });

test('lets everything through without a secret', () => {
  expect(createOriginAuth(undefined)(request())).toBe(true);
  expect(createOriginAuth('')(request())).toBe(true);
});

test('accepts a request carrying the secret', () => {
  const allowed = createOriginAuth(SECRET);
  expect(allowed(request({ [ORIGIN_AUTH_HEADER]: SECRET }))).toBe(true);
});

test('rejects a request that skipped Cloudflare', () => {
  const allowed = createOriginAuth(SECRET);
  expect(allowed(request())).toBe(false);
  expect(allowed(request({ [ORIGIN_AUTH_HEADER]: '' }))).toBe(false);
  expect(allowed(request({ [ORIGIN_AUTH_HEADER]: `${SECRET}x` }))).toBe(false);
  expect(allowed(request({ [ORIGIN_AUTH_HEADER]: SECRET.slice(1) }))).toBe(
    false,
  );
});
