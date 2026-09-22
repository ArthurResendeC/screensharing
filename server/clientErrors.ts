import {
  CLIENT_ERROR_BODY_MAX,
  clientErrorReportSchema,
} from '../src/lib/clientErrors';

// Recebe os relatos de src/client/errorReporting.ts e escreve cada um como uma linha
// JSON no stdout, que é o que `railway logs` mostra. Não guarda nada: é só para um
// erro no navegador de alguém deixar rastro no log do deploy.
const WINDOW_MS = 60 * 1000;
// Teto global por minuto: o cliente já limita a 10 por página, isto segura o
// log se muitas abas quebrarem juntas ou alguém usar a rota de fora.
const MAX_PER_WINDOW = 60;

export type ClientErrorLoggerOptions = {
  // Identifica o deploy na linha do log (Railway: RAILWAY_DEPLOYMENT_ID).
  deployment?: string;
  log?: (line: string) => void;
  now?: () => number;
};

export function createClientErrorLogger({
  deployment,
  log = line => console.error(line),
  now = Date.now,
}: ClientErrorLoggerOptions = {}) {
  let windowStart = 0;
  let count = 0;
  let dropped = 0;

  return async (request: Request): Promise<Response> => {
    const length = Number(request.headers.get('content-length'));
    if (length > CLIENT_ERROR_BODY_MAX)
      return new Response(null, { status: 413 });
    const text = await request.text();
    if (text.length > CLIENT_ERROR_BODY_MAX)
      return new Response(null, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }
    const parsed = clientErrorReportSchema.safeParse(body);
    if (!parsed.success) return new Response(null, { status: 400 });

    const current = now();
    if (current - windowStart >= WINDOW_MS) {
      if (dropped)
        log(`[client-error] ${dropped} relato(s) descartado(s) pelo limite`);
      windowStart = current;
      count = 0;
      dropped = 0;
    }
    if (count >= MAX_PER_WINDOW) {
      dropped++;
      return new Response(null, { status: 429 });
    }
    count++;
    log(`[client-error] ${JSON.stringify({ deployment, ...parsed.data })}`);
    return new Response(null, { status: 204 });
  };
}
