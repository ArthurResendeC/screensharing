import { expect, test } from 'bun:test';
import { createRoomAdminRoutes } from '../server/roomAdmin';
import { RoomDb } from '../server/roomDb';

const SECRET = 'test-room-token-secret-at-least-32-characters';
const HOST_TOKEN = 'host-token-aaaaaaaaaaaaaaaaaaaaaaaa';
const RECOVERY_CODE = 'recovery-code-bbbbbbbbbbbbbbbbbbbb';

function fixture() {
  const db = new RoomDb(SECRET);
  const revoked: Array<[string, string]> = [];
  const routes = createRoomAdminRoutes({
    db,
    onModeratorRevoked: (roomId, hash) => revoked.push([roomId, hash]),
  });
  const roomId = crypto.randomUUID();
  db.createRoom(roomId, HOST_TOKEN, RECOVERY_CODE);
  return { db, routes, roomId, revoked };
}

const authed = (token: string, ip = '203.0.113.9') =>
  new Request('http://localhost/rooms', {
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip },
  });

const recoverRequest = (code: unknown, ip = '203.0.113.9') =>
  new Request('http://localhost/recover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ recoveryCode: code }),
  });

test('the moderators listing needs the host token and exposes only opaque handles', async () => {
  const { db, routes, roomId } = fixture();
  const memberId = crypto.randomUUID();
  const id = db.grantModerator(roomId, memberId)!;

  const ok = routes.listModerators(authed(HOST_TOKEN), roomId);
  expect(ok.status).toBe(200);
  const body = (await ok.json()) as {
    moderators: Array<Record<string, unknown>>;
  };
  expect(body.moderators).toHaveLength(1);
  expect(body.moderators[0]!.id).toBe(id);
  // Nem o memberId nem seu hash podem sair daqui.
  expect(Object.keys(body.moderators[0]!).sort()).toEqual(['grantedAt', 'id']);
  expect(JSON.stringify(body)).not.toContain(memberId);

  expect(
    routes.listModerators(authed('wrong-token-cccccccccc'), roomId).status,
  ).toBe(401);
  expect(
    routes.listModerators(new Request('http://localhost/rooms'), roomId).status,
  ).toBe(401);
  db.close();
});

test('revoking over HTTP clears the grant and reports the member hash back', () => {
  const { db, routes, roomId, revoked } = fixture();
  const memberId = crypto.randomUUID();
  const id = db.grantModerator(roomId, memberId)!;

  const response = routes.revokeModerator(authed(HOST_TOKEN), roomId, id);
  expect(response.status).toBe(204);
  expect(db.isActiveModerator(roomId, memberId)).toBeFalse();
  // O hub usa isto para rebaixar a conexão ao vivo, que já resolveu o papel no join.
  expect(revoked).toEqual([[roomId, db.hashMemberId(memberId)]]);

  // Revogar de novo não encontra mais nada ativo.
  expect(routes.revokeModerator(authed(HOST_TOKEN), roomId, id).status).toBe(
    404,
  );
  db.close();
});

test('recovery rotates both secrets and is single use', async () => {
  const { db, routes, roomId } = fixture();
  const response = await routes.recover(recoverRequest(RECOVERY_CODE), roomId);
  expect(response.status).toBe(200);
  const secrets = (await response.json()) as {
    hostToken: string;
    recoveryCode: string;
  };
  expect(secrets.hostToken).not.toBe(HOST_TOKEN);
  expect(secrets.recoveryCode).not.toBe(RECOVERY_CODE);
  expect(db.verifyHostToken(roomId, secrets.hostToken)).toBeTrue();
  expect(db.verifyHostToken(roomId, HOST_TOKEN)).toBeFalse();

  // O código usado não vale mais: é o que limita o dano de um código vazado.
  expect(
    (await routes.recover(recoverRequest(RECOVERY_CODE), roomId)).status,
  ).toBe(401);
  db.close();
});

test('a wrong recovery code does not reveal whether the room exists', async () => {
  const { routes, roomId } = fixture();
  const wrong = await routes.recover(
    recoverRequest('wrong-code-dddddddddddddddddd'),
    roomId,
  );
  const missing = await routes.recover(
    recoverRequest(RECOVERY_CODE, '203.0.113.10'),
    crypto.randomUUID(),
  );
  expect(wrong.status).toBe(401);
  expect(missing.status).toBe(401);
  expect(await wrong.json()).toEqual(await missing.json());
});

test('recovery attempts are rate limited per IP and room', async () => {
  const { routes, roomId } = fixture();
  const ip = '198.51.100.7';
  for (let attempt = 0; attempt < 5; attempt++)
    expect(
      (
        await routes.recover(
          recoverRequest('bad-code-eeeeeeeeeeeeeeeee', ip),
          roomId,
        )
      ).status,
    ).toBe(401);
  // Estourado o limite, nem o código certo passa mais nesta janela — é o que torna
  // impraticável adivinhar um código de recuperação.
  expect(
    (await routes.recover(recoverRequest(RECOVERY_CODE, ip), roomId)).status,
  ).toBe(429);
  // Outro IP continua atendido normalmente.
  expect(
    (
      await routes.recover(
        recoverRequest(RECOVERY_CODE, '198.51.100.8'),
        roomId,
      )
    ).status,
  ).toBe(200);
});
