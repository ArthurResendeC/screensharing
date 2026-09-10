// Limitador de tentativas em memória para GET /livekit/token. Espelha o
// `failedRoomAttempts >= 5` por socket do hub de signaling: como a rota HTTP é sem
// estado, a contagem fica na instância e zera a cada reinício — igual ao contador
// atual por conexão. É best-effort atrás de proxies; a credencial assinada continua
// sendo a barreira real.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

type Bucket = { count: number; resetAt: number };

export class TokenRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  private bucket(key: string): Bucket {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (existing && existing.resetAt > now) return existing;
    const fresh: Bucket = { count: 0, resetAt: now + WINDOW_MS };
    this.buckets.set(key, fresh);
    // Oportunisticamente descarta janelas expiradas para o mapa não crescer sem limite.
    if (this.buckets.size > 5000) for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    return fresh;
  }

  blocked(key: string): boolean {
    return this.bucket(key).count >= MAX_FAILURES;
  }

  fail(key: string): void {
    this.bucket(key).count++;
  }
}

export function clientKey(request: Request, roomId: string): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
  return `${ip}\0${roomId}`;
}
