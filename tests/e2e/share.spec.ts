import { test, expect, type Page, type BrowserContext } from '@playwright/test';

type TestWindow = Window & {
  testConnections: RTCPeerConnection[];
  testSockets: WebSocket[];
  testTrack: MediaStreamTrack;
};
const remoteVideo = (page: Page) => page.getByLabel('Transmissão selecionada', { exact: true });

async function instrument(context: BrowserContext) {
  await context.addInitScript(() => {
    const connections: RTCPeerConnection[] = [];
    const sockets: WebSocket[] = [];
    Object.assign(window, { testConnections: connections, testSockets: sockets });
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(configuration?: RTCConfiguration) { super(configuration); connections.push(this); }
    };
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this); }
    };
  });
}
async function capture(page: Page, color: string, withAudio = true) {
  await page.addInitScript(({ color, withAudio }) => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext('2d')!;
      const paint = () => { ctx.fillStyle = color; ctx.fillRect(0, 0, 640, 360); };
      paint();
      const timer = setInterval(paint, 50);
      const stream = canvas.captureStream(20);
      let audio: AudioContext | undefined;
      if (withAudio) {
        audio = new AudioContext();
        const oscillator = audio.createOscillator();
        const destination = audio.createMediaStreamDestination();
        oscillator.connect(destination); oscillator.start();
        await audio.resume();
        stream.addTrack(destination.stream.getAudioTracks()[0]);
      }
      const track = stream.getVideoTracks()[0];
      const originalStop = track.stop.bind(track);
      const cleanup = () => { clearInterval(timer); if (audio?.state !== 'closed') void audio?.close(); };
      track.stop = () => { originalStop(); cleanup(); };
      track.addEventListener('ended', cleanup);
      Object.assign(window, { testTrack: track });
      return stream;
    };
  }, { color, withAudio });
}
async function identity(page: Page) {
  return (await page.getByText(/^Você: Participante /).innerText()).replace('Você: ', '');
}
async function choose(viewer: Page, name: string) {
  await viewer.getByRole('button', { name: new RegExp(`^(Assistir a|Reconectar a) ${name}$`) }).click();
}
async function playing(page: Page, color: 'red' | 'blue', audio: number) {
  await expect.poll(() => remoteVideo(page).evaluate((video: HTMLVideoElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    if (video.videoWidth) ctx.drawImage(video, 0, 0, 1, 1);
    const [red, , blue] = ctx.getImageData(0, 0, 1, 1).data;
    return {
      color: red > 150 ? 'red' : blue > 150 ? 'blue' : 'none',
      audio: (video.srcObject as MediaStream | null)?.getAudioTracks().length,
      playing: !video.paused && video.currentTime > 0,
      muted: video.muted,
    };
  })).toEqual({ color, audio, playing: true, muted: false });
  await expect(page.getByText('Conexão: connected', { exact: true })).toBeVisible();
  if (audio) {
    await expect.poll(() => page.evaluate(async () => {
      let bytes = 0;
      for (const pc of (window as unknown as TestWindow).testConnections.filter(pc => pc.connectionState === 'connected')) {
        (await pc.getStats()).forEach((stat: RTCStats & { kind?: string; bytesReceived?: number }) => {
          if (stat.type === 'inbound-rtp' && stat.kind === 'audio') bytes += stat.bytesReceived ?? 0;
        });
      }
      return bytes;
    })).toBeGreaterThan(0);
  }
}
async function activeCounts(page: Page) {
  return page.evaluate(() => {
    const active = (window as unknown as TestWindow).testConnections.filter(pc => pc.connectionState !== 'closed');
    return {
      sending: active.filter(pc => pc.getTransceivers().some(t => t.direction === 'sendonly')).length,
      receiving: active.filter(pc => pc.getTransceivers().some(t => t.currentDirection === 'recvonly')).length,
      total: active.length,
    };
  });
}
async function cleared(page: Page) {
  await expect.poll(() => remoteVideo(page).evaluate((video: HTMLVideoElement) => video.srcObject === null)).toBe(true);
}

test('five participants: simultaneous publishing, reciprocal watching and one remote stream through switches', async ({ page: a, context }) => {
  await instrument(context);
  const errors: string[] = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  a.on('pageerror', error => errors.push(error.message));
  await capture(a, '#ff0000');
  await a.goto('/');
  await a.getByRole('button', { name: 'Criar sala' }).click();
  const aName = await identity(a);
  const url = a.url();
  const b = await context.newPage();
  await capture(b, '#0000ff', false);
  await b.goto(url);
  const bName = await identity(b);
  const viewers: Page[] = [];
  for (let i = 0; i < 3; i++) {
    const viewer = await context.newPage();
    await viewer.goto(url);
    await identity(viewer);
    viewers.push(viewer);
  }
  await expect(a.getByText('Participantes: 5 / 5', { exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Compartilhar tela', exact: true }).click();
  await b.getByRole('button', { name: 'Compartilhar tela', exact: true }).click();
  await expect(b.getByText(/Sem áudio disponível nesta captura/)).toBeVisible();
  // Publishing with no subscribers does not create any RTP connections.
  await expect.poll(() => activeCounts(a)).toEqual({ sending: 0, receiving: 0, total: 0 });
  await Promise.all([choose(a, bName), choose(b, aName)]);
  await playing(a, 'blue', 0);
  await playing(b, 'red', 1);
  for (const viewer of viewers) { await choose(viewer, aName); await playing(viewer, 'red', 1); }
  await expect.poll(() => activeCounts(a)).toEqual({ sending: 4, receiving: 1, total: 5 });
  const c = viewers[0];
  await choose(c, bName);
  await playing(c, 'blue', 0);
  await expect.poll(() => activeCounts(c)).toEqual({ sending: 0, receiving: 1, total: 1 });
  await expect.poll(() => activeCounts(a)).toEqual({ sending: 3, receiving: 1, total: 4 });
  await expect.poll(() => activeCounts(b)).toEqual({ sending: 2, receiving: 1, total: 3 });
  // Rapid changes discard pending negotiations without resurrecting an old selection.
  await choose(c, aName);
  await choose(c, bName);
  await choose(c, aName);
  await playing(c, 'red', 1);
  await expect.poll(() => activeCounts(c)).toEqual({ sending: 0, receiving: 1, total: 1 });
  await c.getByRole('button', { name: 'Parar de assistir', exact: true }).click();
  await cleared(c);
  await expect.poll(() => activeCounts(c)).toEqual({ sending: 0, receiving: 0, total: 0 });
  // Native stop only ends B's publication, preserving B's reception of A.
  await b.evaluate(() => {
    const track = (window as unknown as TestWindow).testTrack;
    track.stop(); track.dispatchEvent(new Event('ended'));
  });
  await cleared(a);
  await playing(b, 'red', 1);
  await b.getByRole('button', { name: 'Compartilhar tela', exact: true }).click();
  await choose(c, bName);
  await playing(c, 'blue', 0);
  await a.close(); // Creator leaving does not close the room or B's stream.
  await expect(b.getByText('Participantes: 4 / 5', { exact: true })).toBeVisible();
  await cleared(b);
  await playing(c, 'blue', 0);
  await choose(viewers[1], bName);
  await playing(viewers[1], 'blue', 0);
  await b.getByRole('button', { name: 'Parar compartilhamento', exact: true }).click();
  await cleared(c);
  await cleared(viewers[1]);
  expect(errors).toEqual([]);
});

test('signaling disconnect closes both directions and capture; reconnect rejoins the existing room', async ({ page: a, context }) => {
  await instrument(context);
  await capture(a, '#ff0000');
  await a.goto('/');
  await a.getByRole('button', { name: 'Criar sala' }).click();
  const aName = await identity(a);
  const b = await context.newPage();
  await capture(b, '#0000ff');
  await b.goto(a.url());
  const bName = await identity(b);
  await a.getByRole('button', { name: 'Compartilhar tela', exact: true }).click();
  await b.getByRole('button', { name: 'Compartilhar tela', exact: true }).click();
  await Promise.all([choose(a, bName), choose(b, aName)]);
  await playing(a, 'blue', 1);
  await playing(b, 'red', 1);
  await b.evaluate(() => (window as unknown as TestWindow).testSockets.find(socket => new URL(socket.url).port === '3001')!.close());
  await expect(b.getByRole('button', { name: 'Reconectar à sala' })).toBeVisible();
  await cleared(a);
  await cleared(b);
  expect(await b.evaluate(() => (window as unknown as TestWindow).testTrack.readyState)).toBe('ended');
  expect(await a.evaluate(() => (window as unknown as TestWindow).testTrack.readyState)).toBe('live');
  await expect.poll(() => activeCounts(b)).toEqual({ sending: 0, receiving: 0, total: 0 });
  await b.getByRole('button', { name: 'Reconectar à sala' }).click();
  await expect(b.getByText('Participantes: 2 / 5', { exact: true })).toBeVisible();
  await choose(b, aName);
  await playing(b, 'red', 1);
});
