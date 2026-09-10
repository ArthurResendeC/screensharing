// Falha cedo e com instruções claras quando não há credenciais do Cloudflare Realtime.
export default async function globalSetup() {
  if (!process.env.CLOUDFLARE_REALTIME_APP_ID || !process.env.CLOUDFLARE_REALTIME_APP_SECRET) {
    throw new Error(
      'Defina CLOUDFLARE_REALTIME_APP_ID e CLOUDFLARE_REALTIME_APP_SECRET. Crie um app em ' +
        'dash.cloudflare.com → Realtime → SFU e copie o App ID e o App Secret.',
    );
  }
}
