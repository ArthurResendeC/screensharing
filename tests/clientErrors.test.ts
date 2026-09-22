import { expect, test } from 'bun:test';
import { createClientErrorLogger } from '../server/clientErrors';

const REPORT = {
  kind: 'render',
  message: 'TypeError: Cannot read properties of undefined',
  stack: 'TypeError: ...\n    at RoomSidebar (index.js:1:2)',
  componentStack: '\n    at RoomSidebar\n    at Room',
  path: '/room/11111111-1111-1111-1111-111111111111',
  userAgent: 'Mozilla/5.0',
  time: '2026-09-22T21:00:00.000Z',
};

const post = (body: unknown) =>
  new Request('http://localhost/client-errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function setup(now = () => 0) {
  const lines: string[] = [];
  const handle = createClientErrorLogger({
    deployment: 'dep-1',
    log: line => lines.push(line),
    now,
  });
  return { lines, handle };
}

test('logs a valid report as one JSON line tagged with the deployment', async () => {
  const { lines, handle } = setup();
  const response = await handle(post(REPORT));
  expect(response.status).toBe(204);
  expect(lines).toHaveLength(1);
  expect(lines[0].startsWith('[client-error] ')).toBe(true);
  expect(JSON.parse(lines[0].slice('[client-error] '.length))).toEqual({
    deployment: 'dep-1',
    ...REPORT,
  });
});

test('rejects malformed JSON, unknown fields and oversized bodies', async () => {
  const { lines, handle } = setup();
  expect((await handle(post('{nope'))).status).toBe(400);
  expect((await handle(post({ ...REPORT, extra: 1 }))).status).toBe(400);
  expect((await handle(post({ ...REPORT, kind: 'other' }))).status).toBe(400);
  expect(
    (await handle(post({ ...REPORT, stack: 'x'.repeat(40_000) }))).status,
  ).toBe(413);
  expect(lines).toHaveLength(0);
});

test('caps reports per minute and notes how many were dropped', async () => {
  let clock = 0;
  const { lines, handle } = setup(() => clock);
  for (let i = 0; i < 60; i++)
    expect((await handle(post(REPORT))).status).toBe(204);
  expect((await handle(post(REPORT))).status).toBe(429);
  expect((await handle(post(REPORT))).status).toBe(429);
  expect(lines).toHaveLength(60);

  clock = 60_000;
  expect((await handle(post(REPORT))).status).toBe(204);
  expect(lines[60]).toBe(
    '[client-error] 2 relato(s) descartado(s) pelo limite',
  );
  expect(lines).toHaveLength(62);
});
