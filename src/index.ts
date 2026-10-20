// Entry point: routes WebSocket connections at /room/<name> to that room's
// Durable Object. Each room is one object that holds its connected devices.

export { Room } from './room';

const ROOM_PATH = /^\/room\/([A-Za-z0-9_-]{1,64})$/;

export default {
    async fetch(request, env): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/') {
            return new Response('stremio-sync-relay is running\n');
        }

        const match = url.pathname.match(ROOM_PATH);
        if (match === null) {
            return new Response('Not found. Connect to /room/<name>.\n', { status: 404 });
        }

        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
            return new Response('This address only accepts WebSocket connections.\n', { status: 426 });
        }

        const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
        return room.fetch(request);
    },
} satisfies ExportedHandler<Env>;
