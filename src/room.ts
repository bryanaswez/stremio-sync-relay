// A room forwards every message from one device to all the others in it.
// It uses the WebSocket Hibernation API: while nobody is sending, the object
// sleeps with the connections still open, and isn't billed for that time.

import { DurableObject } from 'cloudflare:workers';

const MAX_MESSAGE_LENGTH = 4096;
const MAX_DEVICE_NAME_LENGTH = 40;

// Message types only the relay may send, so a device can't fake them.
const RELAY_ONLY_TYPES = new Set(['welcome', 'device-joined', 'device-left', 'error']);

// Stored on each connection; survives the object hibernating.
type Device = {
    id: string,
    name: string,
};

export class Room extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        // Keepalive pings get an automatic reply without waking the object.
        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const name = (url.searchParams.get('device') ?? '').trim().slice(0, MAX_DEVICE_NAME_LENGTH);
        const device: Device = { id: crypto.randomUUID(), name: name || 'Unnamed device' };

        const others = this.devices();
        const { 0: client, 1: server } = new WebSocketPair();
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment(device);

        send(server, { type: 'welcome', you: device, devices: others });
        this.broadcast({ type: 'device-joined', device }, device.id);

        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        if (typeof message !== 'string') {
            return send(ws, { type: 'error', message: 'Only text messages are supported.' });
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            return send(ws, { type: 'error', message: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` });
        }

        let data: unknown;
        try {
            data = JSON.parse(message);
        } catch {
            return send(ws, { type: 'error', message: 'Messages must be JSON.' });
        }
        if (!isObject(data) || typeof data.type !== 'string') {
            return send(ws, { type: 'error', message: 'Messages need a "type" field.' });
        }
        if (RELAY_ONLY_TYPES.has(data.type)) {
            return send(ws, { type: 'error', message: `"${data.type}" can only be sent by the relay.` });
        }

        // The relay sets "from", so a device can't claim to be another one.
        const sender = ws.deserializeAttachment() as Device;
        this.broadcast({ ...data, from: sender }, sender.id);
    }

    async webSocketClose(ws: WebSocket, code: number): Promise<void> {
        this.leave(ws, code);
    }

    async webSocketError(ws: WebSocket): Promise<void> {
        this.leave(ws, 1011);
    }

    private leave(ws: WebSocket, code: number): void {
        const device = ws.deserializeAttachment() as Device;
        try {
            // 1005 and 1006 are reserved and can't be sent back.
            ws.close(code === 1005 || code === 1006 ? 1000 : code, 'Goodbye');
        } catch {
            // Already closed.
        }
        this.broadcast({ type: 'device-left', device }, device.id);
    }

    private devices(): Device[] {
        return this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() as Device);
    }

    private broadcast(data: object, exceptId: string): void {
        for (const ws of this.ctx.getWebSockets()) {
            const device = ws.deserializeAttachment() as Device;
            if (device.id !== exceptId) {
                send(ws, data);
            }
        }
    }
}

function send(ws: WebSocket, data: object): void {
    try {
        ws.send(JSON.stringify(data));
    } catch {
        // The connection closed in the meantime; its close handler cleans up.
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
