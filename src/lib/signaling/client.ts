import {
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from './messages';

// App-level heartbeat: a backgrounded or half-open socket can stay "open" for minutes
// after the server is gone. Ping regularly and treat a missing reply as a disconnect.
const PING_INTERVAL_MS = 12_000;
const PONG_TIMEOUT_MS = 20_000;

export function connectSignaling(
  roomId: string,
  credential: string,
  password: string | undefined,
  accessToken: string | undefined,
  clientId: string,
  onMessage: (message: ServerMessage) => void,
  onState: (state: string) => void,
) {
  const url = new URL('/signaling', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const send = (message: ClientMessage) => {
    if (socket.readyState !== WebSocket.OPEN)
      throw new Error('Signaling desconectado.');
    socket.send(JSON.stringify(message));
  };

  let lastActivity = Date.now();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  };
  const startHeartbeat = () => {
    stopHeartbeat();
    lastActivity = Date.now();
    heartbeat = setInterval(() => {
      if (Date.now() - lastActivity > PONG_TIMEOUT_MS) {
        stopHeartbeat();
        onState('disconnected');
        socket.close();
        return;
      }
      try {
        send({ type: 'ping' });
      } catch {
        /* Not open yet or already closing; the timeout above will catch a dead socket. */
      }
    }, PING_INTERVAL_MS);
  };

  socket.onopen = () => {
    onState('connected');
    send({
      type: 'join-room',
      roomId,
      credential,
      ...(password ? { password } : {}),
      ...(accessToken ? { accessToken } : {}),
      ...(clientId ? { clientId } : {}),
    });
    startHeartbeat();
  };
  socket.onmessage = (event: MessageEvent<unknown>) => {
    lastActivity = Date.now();
    try {
      if (typeof event.data !== 'string') throw new Error();
      const message = serverMessageSchema.parse(JSON.parse(event.data));
      if (message.type === 'pong') return;
      onMessage(message);
    } catch {
      onState('invalid-message');
      socket.close();
    }
  };
  socket.onerror = () => onState('error');
  socket.onclose = event => {
    stopHeartbeat();
    onState(
      event.code === 1012 || event.code === 1001
        ? 'restarting'
        : 'disconnected',
    );
  };
  return {
    send,
    close: () => {
      stopHeartbeat();
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    },
  };
}

export function createRoom(name: string, password?: string) {
  return new Promise<Extract<ServerMessage, { type: 'room-created' }>>(
    (resolve, reject) => {
      const url = new URL('/signaling', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url);
      const finish = (
        error?: Error,
        room?: Extract<ServerMessage, { type: 'room-created' }>,
      ) => {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
        if (error) reject(error);
        else if (room) resolve(room);
      };
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            type: 'create-room',
            name,
            ...(password ? { password } : {}),
          }),
        );
      socket.onmessage = event => {
        try {
          if (typeof event.data !== 'string') throw new Error();
          const message = serverMessageSchema.parse(JSON.parse(event.data));
          if (message.type === 'room-created') finish(undefined, message);
          else if (message.type === 'error') finish(new Error(message.message));
        } catch {
          finish(new Error('O servidor retornou uma resposta inválida.'));
        }
      };
      socket.onerror = () =>
        finish(new Error('Não foi possível conectar ao servidor.'));
      socket.onclose = () =>
        finish(new Error('A conexão foi encerrada antes da criação da sala.'));
    },
  );
}
