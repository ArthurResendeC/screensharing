import { expect, test } from '@playwright/test';

test('exposes the manifest and required installation assets', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#16181b');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).not.toBeNull();
  const manifestResponse = await request.get(manifestHref!);
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
  const manifest = (await manifestResponse.json()) as {
    name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({ name: 'ReShare', start_url: '/', scope: '/', display: 'standalone' });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: '/icons/icon-192.png', sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ src: '/icons/icon-512.png', sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ src: '/icons/icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' }),
    ]),
  );

  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toBe('image/png');
    const png = await response.body();
    const expectedSize = Number(icon.sizes.split('x')[0]);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(expectedSize);
    expect(png.readUInt32BE(20)).toBe(expectedSize);
  }
});

test('opens a room shell offline and reconnects when the network returns', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.reload();

  const cachedPaths = await page.evaluate(async () => {
    const cache = await caches.open('reshare-shell-v1');
    return (await cache.keys()).map(request => new URL(request.url).pathname);
  });
  expect(cachedPaths).toContain('/');
  expect(cachedPaths.some(path => path.endsWith('.js'))).toBe(true);
  expect(cachedPaths.some(path => path.endsWith('.css'))).toBe(true);
  expect(cachedPaths).not.toContain('/config.json');

  await page.getByLabel('Nome da sala').fill('Sala offline');
  await page.getByLabel('Senha (opcional)', { exact: true }).fill('password-for-e2e');
  await page.getByRole('button', { name: 'Criar sala' }).click();
  await expect(page).toHaveURL(/\/room\//);
  const roomUrl = page.url();

  await context.setOffline(true);
  await page.goto(roomUrl);
  await expect(page.getByRole('status')).toContainText('Você está offline');
  await page.getByLabel('Senha da sala').fill('password-for-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Sala de transmissão', { exact: true })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('[data-participants]')).toHaveText('1 / 5');

  await page.goto('/');
  await page.evaluate(async () => {
    await Promise.all(
      (await navigator.serviceWorker.getRegistrations()).map(registration => registration.unregister()),
    );
    await Promise.all((await caches.keys()).map(name => caches.delete(name)));
  });
});
