import { serverMessageSchema, type ClientMessage, type ServerMessage } from './messages';
export function connectSignaling(
  roomId: string,
  clientId: string,
  onMessage: (message: ServerMessage) => void,
  onState: (state: string) => void,
) {
  const url = new URL('/signaling', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const send = (message: ClientMessage) => {
    if (socket.readyState !== WebSocket.OPEN) throw new Error('Signaling desconectado.');
    socket.send(JSON.stringify(message));
  };
  socket.onopen = () => {
    onState('connected');
    send({ type: 'join-room', roomId, ...(clientId ? { clientId } : {}) });
  };
  socket.onmessage = (event: MessageEvent<unknown>) => {
    try {
      if (typeof event.data !== 'string') throw new Error();
      const message = serverMessageSchema.parse(JSON.parse(event.data));
      onMessage(message);
    } catch {
      onState('invalid-message');
      socket.close();
    }
  };
  socket.onerror = () => onState('error');
  socket.onclose = event => onState(event.code === 1012 || event.code === 1001 ? 'restarting' : 'disconnected');
  return {
    send,
    close: () => {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    },
  };
}
