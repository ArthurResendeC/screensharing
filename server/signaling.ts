import { clientMessageSchema, type ServerMessage } from '../src/lib/signaling/messages';

export type SignalingSocket = {
  send(message: string): number;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): number;
  getBufferedAmount(): number;
};

type Subscription = { publisherId: string; sessionId: string };
export type Client = {
  id: string;
  socket?: SignalingSocket;
  roomId?: string;
  alias?: string;
  sharing: boolean;
  watching?: Subscription;
  alive: boolean;
  count: number;
  window: number;
};
type Room = { members: Map<string, Client> };

export class SignalingHub {
  readonly rooms = new Map<string, Room>();
  readonly clients = new Set<Client>();

  createClient(): Client {
    return { id: crypto.randomUUID(), sharing: false, alive: true, count: 0, window: Date.now() };
  }

  open(client: Client, socket: SignalingSocket) {
    client.socket = socket;
    if (this.clients.size >= 250) {
      socket.close(1013, 'Server full');
      return;
    }
    this.clients.add(client);
  }

  private send(client: Client, message: ServerMessage) {
    if (!client.socket) return;
    if (client.socket.getBufferedAmount() > 1024 * 1024) {
      client.socket.terminate();
      this.leave(client);
      return;
    }
    client.socket.send(JSON.stringify(message));
  }

  private participants(room: Room) {
    return [...room.members.values()].map(client => ({
      peerId: client.id,
      sharing: client.sharing,
      alias: client.alias ?? null,
    }));
  }

  private broadcast(room: Room) {
    const message: ServerMessage = { type: 'room-state', peers: this.participants(room) };
    for (const member of room.members.values()) this.send(member, message);
  }

  private unsubscribe(viewer: Client, room: Room) {
    const subscription = viewer.watching;
    if (!subscription) return;
    viewer.watching = undefined;
    this.send(viewer, {
      type: 'subscription-ended',
      peerId: subscription.publisherId,
      sessionId: subscription.sessionId,
    });
    const publisher = room.members.get(subscription.publisherId);
    if (publisher)
      this.send(publisher, { type: 'subscription-ended', peerId: viewer.id, sessionId: subscription.sessionId });
  }

  private stopPublishing(publisher: Client, room: Room) {
    publisher.sharing = false;
    for (const viewer of room.members.values()) {
      if (viewer.watching?.publisherId === publisher.id) this.unsubscribe(viewer, room);
    }
  }

  leave(client: Client) {
    this.clients.delete(client);
    const roomId = client.roomId;
    client.roomId = undefined;
    client.socket = undefined;
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room || !roomId) return;
    this.unsubscribe(client, room);
    this.stopPublishing(client, room);
    room.members.delete(client.id);
    if (!room.members.size) this.rooms.delete(roomId);
    else this.broadcast(room);
  }

  pong(client: Client) {
    client.alive = true;
  }

  message(client: Client, data: string | BufferSource) {
    const fail = (message: string) => this.send(client, { type: 'error', message });
    if (Date.now() - client.window > 1000) {
      client.window = Date.now();
      client.count = 0;
    }
    if (++client.count > 150) {
      client.socket?.close(1008, 'Rate limit');
      return;
    }
    let input: unknown;
    try {
      if (typeof data !== 'string') throw new Error();
      input = JSON.parse(data);
    } catch {
      fail('Mensagem inválida.');
      return;
    }
    const parsed = clientMessageSchema.safeParse(input);
    if (!parsed.success) {
      fail('Mensagem inválida.');
      return;
    }
    const message = parsed.data;
    if (message.type === 'ping') {
      this.send(client, { type: 'pong' });
      return;
    }
    if (message.type === 'join-room') {
      if (client.roomId) {
        fail('Você já está em uma sala.');
        return;
      }
      let room = this.rooms.get(message.roomId);
      if (!room) {
        room = { members: new Map() };
        this.rooms.set(message.roomId, room);
      }
      if (room.members.size >= 5) {
        fail('Sala cheia: limite de cinco participantes.');
        return;
      }
      // A reconnecting client reclaims its previous identity (unless already taken)
      // so peers can resume their subscriptions after a redeploy drops every socket.
      if (message.clientId && !room.members.has(message.clientId)) client.id = message.clientId;
      client.roomId = message.roomId;
      room.members.set(client.id, client);
      this.send(client, { type: 'joined', roomId: message.roomId, peerId: client.id, peers: this.participants(room) });
      this.broadcast(room);
      return;
    }
    const room = client.roomId ? this.rooms.get(client.roomId) : undefined;
    if (!room) {
      fail('Entre em uma sala primeiro.');
      return;
    }
    if (message.type === 'sharing-started' || message.type === 'sharing-stopped') {
      if (message.type === 'sharing-started') client.sharing = true;
      else this.stopPublishing(client, room);
      this.broadcast(room);
      return;
    }
    if (message.type === 'set-alias') {
      const alias = message.alias || undefined;
      if (client.alias === alias) return;
      client.alias = alias;
      this.broadcast(room);
      return;
    }
    if (message.type === 'watch') {
      this.unsubscribe(client, room);
      const publisher = message.targetPeerId ? room.members.get(message.targetPeerId) : undefined;
      const duplicate = [...room.members.values()].some(member => member.watching?.sessionId === message.sessionId);
      if (message.targetPeerId && (!publisher?.sharing || publisher === client || duplicate)) {
        this.send(client, { type: 'watching', peerId: null, sessionId: message.sessionId });
        fail('Transmissão indisponível ou seleção inválida.');
        return;
      }
      this.send(client, { type: 'watching', peerId: publisher?.id ?? null, sessionId: message.sessionId });
      if (publisher) {
        client.watching = { publisherId: publisher.id, sessionId: message.sessionId };
        this.send(publisher, { type: 'subscriber-joined', peerId: client.id, sessionId: message.sessionId });
      }
      return;
    }
    const target = room.members.get(message.targetPeerId);
    if (!target || target === client) {
      fail('Destino inválido.');
      return;
    }
    const sending =
      client.sharing && target.watching?.publisherId === client.id && target.watching.sessionId === message.sessionId;
    const receiving =
      target.sharing && client.watching?.publisherId === target.id && client.watching.sessionId === message.sessionId;
    const authorized =
      message.type === 'offer' ? sending : message.type === 'answer' ? receiving : sending || receiving;
    if (!authorized) return;
    const { targetPeerId: _target, ...payload } = message;
    void _target;
    this.send(target, { ...payload, peerId: client.id });
  }

  heartbeat() {
    for (const client of this.clients) {
      if (!client.alive) {
        client.socket?.terminate();
        this.leave(client);
        continue;
      }
      client.alive = false;
      client.socket?.ping();
    }
  }

  close() {
    // 1012 = service restart: tells clients this is a redeploy, not a lost connection.
    for (const client of this.clients) client.socket?.close(1012, 'Server restarting');
    this.clients.clear();
    this.rooms.clear();
  }
}
