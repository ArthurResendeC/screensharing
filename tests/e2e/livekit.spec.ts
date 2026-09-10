import { expect, type Page, test } from '@playwright/test';

// E2E do modo LiveKit: mídia real através do SFU, vídeo sintético (canvas) em abas
// separadas. Sem introspecção de RTCPeerConnection — o transporte é do LiveKit.
const remoteVideo = (page: Page) => page.getByLabel('Transmissão selecionada', { exact: true });
const shareButton = (page: Page) => page.locator('[data-share]');
const stopShareButton = (page: Page) => page.locator('[data-stop-share]');
const participantCount = (page: Page) => page.locator('[data-participants]');

async function stubDisplayMedia(page: Page, color: string) {
  await page.addInitScript(paintColor => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d')!;
      const paint = () => {
        ctx.fillStyle = paintColor;
        ctx.fillRect(0, 0, 640, 360);
      };
      paint();
      const timer = setInterval(paint, 50);
      const stream = canvas.captureStream(20);
      const track = stream.getVideoTracks()[0]!;
      const stop = track.stop.bind(track);
      track.stop = () => {
        clearInterval(timer);
        stop();
      };
      Object.assign(window, { testScreenTrack: track });
      return stream;
    };
  }, color);
}

async function enterRoom(page: Page, name: string) {
  const gate = page.locator('[data-name-gate]');
  await gate.waitFor({ state: 'attached' });
  if (await gate.isVisible()) {
    await page.getByLabel('Seu nome na sala', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Entrar na sala', exact: true }).click();
    await expect(gate).toBeHidden();
  }
}

async function createRoom(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Nome da sala').fill(name);
  await page.getByRole('button', { name: 'Criar sala' }).click();
  await expect(page).toHaveURL(/\/room\//);
}

async function showsColor(page: Page, color: 'red' | 'blue') {
  await expect
    .poll(
      () =>
        remoteVideo(page).evaluate((video: HTMLVideoElement) => {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d')!;
          if (video.videoWidth) ctx.drawImage(video, 0, 0, 1, 1);
          const [r, , b] = ctx.getImageData(0, 0, 1, 1).data;
          return {
            color: r > 150 ? 'red' : b > 150 ? 'blue' : 'none',
            playing: !video.paused && video.currentTime > 0,
          };
        }),
      { timeout: 20000 },
    )
    .toEqual({ color, playing: true });
}

test('two participants publish through the SFU and each sees the other automatically', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const errors: string[] = [];
  a.on('pageerror', error => errors.push(`A: ${error.message}`));
  b.on('pageerror', error => errors.push(`B: ${error.message}`));

  await stubDisplayMedia(a, '#ff0000');
  await stubDisplayMedia(b, '#0000ff');

  await createRoom(a, 'Sala LiveKit');
  await enterRoom(a, 'Alice');
  const invite = a.url();
  await b.goto(invite);
  await enterRoom(b, 'Bob');

  await expect(participantCount(a)).toHaveText('2', { timeout: 15000 });
  await expect(b.getByText('Alice', { exact: true })).toBeVisible();

  // No "choose a screen" step: shares appear for everyone as soon as they start.
  await shareButton(a).click();
  await shareButton(b).click();
  await showsColor(a, 'blue');
  await showsColor(b, 'red');

  // Stopping one share is detected and the other stays live.
  await stopShareButton(a).click();
  await expect(b.getByText('Transmissão encerrada', { exact: true })).toBeVisible({ timeout: 15000 });
  await showsColor(a, 'blue');

  // Renaming propagates to other participants.
  await b.getByRole('button', { name: 'Configurações' }).click();
  await b.getByLabel('Alterar seu nome na sala').fill('Bobby');
  await b.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(a.locator('#room-sidebar').getByText('Bobby', { exact: true })).toBeVisible({ timeout: 15000 });

  // A participant leaving is reflected in the roster.
  await b.close();
  await expect(participantCount(a)).toHaveText('1', { timeout: 15000 });

  expect(errors).toEqual([]);
  await contextA.close();
  await contextB.close();
});

test('a third participant sees two simultaneous shares with no watch cap', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [a, b, c] = await Promise.all(contexts.map(context => context.newPage()));
  await stubDisplayMedia(a!, '#ff0000');
  await stubDisplayMedia(b!, '#0000ff');

  await createRoom(a!, 'Sala multi-tela');
  await enterRoom(a!, 'Alice');
  const invite = a!.url();
  await b!.goto(invite);
  await enterRoom(b!, 'Bob');
  await c!.goto(invite);
  await enterRoom(c!, 'Carol');

  await expect(participantCount(c!)).toHaveText('3', { timeout: 15000 });
  await shareButton(a!).click();
  await shareButton(b!).click();

  // Carol watches both automatically — the "up to two" cap is gone in LiveKit mode.
  await expect(c!.locator('.remote-stream-cell')).toHaveCount(2, { timeout: 20000 });
  await expect
    .poll(
      () =>
        c!.locator('.remote-stream-cell video').evaluateAll(videos =>
          videos
            .map(el => {
              const video = el as HTMLVideoElement;
              const canvas = document.createElement('canvas');
              canvas.width = 1;
              canvas.height = 1;
              const ctx = canvas.getContext('2d')!;
              if (video.videoWidth) ctx.drawImage(video, 0, 0, 1, 1);
              const [r, , b] = ctx.getImageData(0, 0, 1, 1).data;
              return video.paused ? 'paused' : r > 150 ? 'red' : b > 150 ? 'blue' : 'none';
            })
            .sort(),
        ),
      { timeout: 25000 },
    )
    .toEqual(['blue', 'red']);

  await Promise.all(contexts.map(context => context.close()));
});
