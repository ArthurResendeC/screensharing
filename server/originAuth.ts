import { createHash, timingSafeEqual } from 'node:crypto';

// A Cloudflare acrescenta este cabeçalho, com o segredo, a toda requisição para o host
// (.cloudflare/rules.ts). O edge da Railway também atende o domínio próprio a quem se
// conecta direto no IP dela, sem passar pelo WAF e pelo rate limit; sem o cabeçalho, a
// requisição veio por esse caminho. A Cloudflare sobrescreve o valor que o cliente mandar.
export const ORIGIN_AUTH_HEADER = 'x-reshare-origin-auth';

const digest = (value: string) => createHash('sha256').update(value).digest();

// Sem segredo (desenvolvimento, e2e, ou antes de configurar a Cloudflare) tudo passa.
export function createOriginAuth(secret: string | undefined) {
  if (!secret) return (_request: Request) => true;
  const expected = digest(secret);
  return (request: Request) => {
    const received = request.headers.get(ORIGIN_AUTH_HEADER);
    // Compara os hashes: tamanho fixo e tempo constante, sem vazar o segredo por timing.
    return received !== null && timingSafeEqual(digest(received), expected);
  };
}
