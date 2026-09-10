// Fila serial: toda renegociação com o SFU (estabelecer sessão, publicar, assinar,
// encerrar) roda uma de cada vez para não haver setLocal/setRemote sobrepostos.
export class FifoQueue {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.catch(() => {});
    return result;
  }
}

// O Cloudflare Realtime não usa trickle ICE: a SDP precisa levar os candidatos antes
// de ser enviada. Resolve quando a coleta termina ou após o timeout.
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

// Espera o PC ficar realmente conectado. O SFU só aceita "pull" de uma track depois
// que o publicador completou ICE/DTLS e está enviando pacotes — anunciar antes disso
// leva a "Track not found on remote peer". Resolve no timeout (best effort);
// rejeita se a conexão falhar.
export function waitForConnected(pc: RTCPeerConnection, timeoutMs = 15_000): Promise<void> {
  const isUp = () =>
    pc.connectionState === 'connected' ||
    pc.iceConnectionState === 'connected' ||
    pc.iceConnectionState === 'completed';
  if (isUp()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      pc.removeEventListener('connectionstatechange', check);
      pc.removeEventListener('iceconnectionstatechange', check);
      clearTimeout(timer);
    };
    const check = () => {
      if (isUp()) {
        cleanup();
        resolve();
      } else if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
        cleanup();
        reject(new Error('media connection failed'));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    pc.addEventListener('connectionstatechange', check);
    pc.addEventListener('iceconnectionstatechange', check);
  });
}
