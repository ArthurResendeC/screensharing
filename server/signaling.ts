import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { clientMessageSchema, type ServerMessage } from '../src/lib/signaling/messages';

type Subscription = { publisherId: string; sessionId: string };
type Client = {
  id: string;
  socket: WebSocket;
  roomId?: string;
  sharing: boolean;
  watching?: Subscription;
  alive: boolean;
  count: number;
  window: number;
};
type Room = { members: Map<string, Client> };

export function createSignalingServer(server: HttpServer, allowedOrigins: string[]) {
  const rooms = new Map<string, Room>();
  const clients = new Set<Client>();
  const wss = new WebSocketServer({
    server, maxPayload: 65536, perMessageDeflate: false,
    verifyClient: ({ origin }: { origin: string }) => allowedOrigins.includes(origin),
  });
  function send(client: Client, message: ServerMessage) {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    if (client.socket.bufferedAmount > 1024 * 1024) {
      client.socket.terminate();
      return;
    }
    client.socket.send(JSON.stringify(message));
  }
  const participants = (room: Room) => [...room.members.values()].map(client => ({ peerId: client.id, sharing: client.sharing }));
  function broadcast(room: Room) {
    const message: ServerMessage = { type: 'room-state', peers: participants(room) };
    for (const member of room.members.values()) send(member, message);
  }
  function unsubscribe(viewer: Client, room: Room) {
    const subscription = viewer.watching;
    if (!subscription) return;
    viewer.watching = undefined;
    send(viewer, { type: 'subscription-ended', peerId: subscription.publisherId, sessionId: subscription.sessionId });
    const publisher = room.members.get(subscription.publisherId);
    if (publisher) send(publisher, { type: 'subscription-ended', peerId: viewer.id, sessionId: subscription.sessionId });
  }
  function stopPublishing(publisher: Client, room: Room) {
    publisher.sharing = false;
    for (const viewer of room.members.values()) {
      if (viewer.watching?.publisherId === publisher.id) unsubscribe(viewer, room);
    }
  }
  function leave(client: Client) {
    clients.delete(client);
    const roomId = client.roomId;
    client.roomId = undefined;
    const room = roomId ? rooms.get(roomId) : undefined;
    if (!room || !roomId) return;
    unsubscribe(client, room);
    stopPublishing(client, room);
    room.members.delete(client.id);
    if (!room.members.size) rooms.delete(roomId);
    else broadcast(room);
  }
  wss.on('connection', socket => {
    if (clients.size >= 250) { socket.close(1013, 'Server full'); return; }
    const client: Client = { id: randomUUID(), socket, sharing: false, alive: true, count: 0, window: Date.now() };
    clients.add(client);
    socket.on('pong', () => { client.alive = true; });
    socket.on('error', () => { leave(client); socket.terminate(); });
    socket.on('close', () => leave(client));
    socket.on('message', (data, binary) => {
      const fail = (message: string) => send(client, { type: 'error', message });
      if (Date.now() - client.window > 1000) { client.window = Date.now(); client.count = 0; }
      if (++client.count > 150) { socket.close(1008, 'Rate limit'); return; }
      let input: unknown;
      try {
        if (binary) throw new Error();
        input = JSON.parse(data.toString());
      } catch { fail('Mensagem inválida.'); return; }
      const parsed = clientMessageSchema.safeParse(input);
      if (!parsed.success) { fail('Mensagem inválida.'); return; }
      const message = parsed.data;
      if (message.type === 'join-room') {
        if (client.roomId) { fail('Você já está em uma sala.'); return; }
        let room = rooms.get(message.roomId);
        if (!room) { room = { members: new Map() }; rooms.set(message.roomId, room); }
        if (room.members.size >= 5) { fail('Sala cheia: limite de cinco participantes.'); return; }
        client.roomId = message.roomId;
        room.members.set(client.id, client);
        send(client, { type: 'joined', roomId: message.roomId, peerId: client.id, peers: participants(room) });
        broadcast(room);
        return;
      }
      const room = client.roomId ? rooms.get(client.roomId) : undefined;
      if (!room) { fail('Entre em uma sala primeiro.'); return; }
      if (message.type === 'sharing-started' || message.type === 'sharing-stopped') {
        if (message.type === 'sharing-started') client.sharing = true;
        else stopPublishing(client, room);
        broadcast(room);
        return;
      }
      if (message.type === 'watch') {
        // Break the old subscription before authorizing a new one, even on failure.
        unsubscribe(client, room);
        const publisher = message.targetPeerId ? room.members.get(message.targetPeerId) : undefined;
        const duplicate = [...room.members.values()].some(member => member.watching?.sessionId === message.sessionId);
        if (message.targetPeerId && (!publisher?.sharing || publisher === client || duplicate)) {
          send(client, { type: 'watching', peerId: null, sessionId: message.sessionId });
          fail('Transmissão indisponível ou seleção inválida.');
          return;
        }
        send(client, { type: 'watching', peerId: publisher?.id ?? null, sessionId: message.sessionId });
        if (publisher) {
          client.watching = { publisherId: publisher.id, sessionId: message.sessionId };
          send(publisher, { type: 'subscriber-joined', peerId: client.id, sessionId: message.sessionId });
        }
        return;
      }
      const target = room.members.get(message.targetPeerId);
      if (!target || target === client) { fail('Destino inválido.'); return; }
      const sending = client.sharing && target.watching?.publisherId === client.id && target.watching.sessionId === message.sessionId;
      const receiving = target.sharing && client.watching?.publisherId === target.id && client.watching.sessionId === message.sessionId;
      const authorized = message.type === 'offer' ? sending : message.type === 'answer' ? receiving : sending || receiving;
      // Old packets can race an unsubscribe; silently discard them without affecting the new selection.
      if (!authorized) return;
      const { targetPeerId: _target, ...payload } = message;
      void _target;
      send(target, { ...payload, peerId: client.id });
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) { leave(client); client.socket.terminate(); continue; }
      client.alive = false;
      client.socket.ping();
    }
  }, 15000);
  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
