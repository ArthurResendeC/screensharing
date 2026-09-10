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
