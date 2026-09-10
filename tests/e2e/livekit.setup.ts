// Falha cedo e com instruções claras quando não há servidor LiveKit para os testes.
export default async function globalSetup() {
  const httpUrl = (process.env.LIVEKIT_URL ?? 'ws://localhost:7880').replace(/^ws/, 'http');
  try {
    const response = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
    // O LiveKit responde 200 em "/"; qualquer resposta HTTP significa que está de pé.
    if (!response.ok && response.status !== 404) throw new Error(`status ${response.status}`);
  } catch (error) {
    throw new Error(
      `Servidor LiveKit inacessível em ${httpUrl}. Suba um com "docker compose up -d livekit" ` +
        `ou defina LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET. Detalhe: ${(error as Error).message}`,
    );
  }
}
