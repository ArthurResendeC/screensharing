import { serverMessageSchema, type ClientMessage, type ServerMessage } from './messages';
export function connectSignaling(roomId: string, onMessage: (message: ServerMessage) => void, onState: (state: string) => void) {
  const url = process.env.NEXT_PUBLIC_SIGNALING_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname}:3001`;
  const socket = new WebSocket(url);
  const send = (message: ClientMessage) => {
    if (socket.readyState !== WebSocket.OPEN) throw new Error('Signaling desconectado.');
    socket.send(JSON.stringify(message));
  };
  socket.onopen = () => { onState('connected'); send({ type: 'join-room', roomId }); };
  socket.onmessage = (event: MessageEvent<unknown>) => {
    try {
      if (typeof event.data !== 'string') throw new Error();
      const message = serverMessageSchema.parse(JSON.parse(event.data));
      onMessage(message);
    } catch { onState('invalid-message'); socket.close(); }
  };
  socket.onerror = () => onState('error');
  socket.onclose = () => onState('disconnected');
  return { send, close: () => { socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close(); } };
}
