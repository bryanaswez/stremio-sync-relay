# stremio-sync-relay

A small WebSocket relay on Cloudflare Workers that passes messages between your Stremio devices: playback sync (play, pause, seek) and short chat messages. It stores nothing. Each room is one [Durable Object](https://developers.cloudflare.com/durable-objects/) that holds the connected devices and forwards each message to the others.

The client side lives in the `feature/sync` branch of the stremio-web fork.

## Run it locally

```bash
npm install
npm run dev
```

The relay runs at `http://127.0.0.1:8787`, with no Cloudflare login needed.

In a second terminal, check it end to end:

```bash
npm test
```

To try it by hand, open `test/client.html` in two browser windows, connect both to the same room, and send a message.

## Connecting

```
ws://127.0.0.1:8787/room/<room>?device=<device name>
```

- `<room>`: 1–64 letters, digits, `-` or `_`.
- `device`: the name other devices see, up to 40 characters.

Rooms aren't protected yet. The Stremio login check comes in phase 6.

## Messages

Every message is a JSON object with a `type`. The relay forwards any type to the other devices in the room and adds `from` itself, so a device can't pretend to be another one.

| Type | Sent by | Contents |
|---|---|---|
| `welcome` | relay, to a device that just connected | `you` (its id and name), `devices` (who's already here) |
| `device-joined` | relay | `device` |
| `device-left` | relay | `device` |
| `error` | relay, to the sender only | `message` explaining what was wrong |
| anything else, e.g. `chat` | device | Forwarded with `from: { id, name }` added |

The relay rejects messages that aren't JSON, are longer than 4096 characters, have no `type`, or use one of the relay-only types above.

Sending the plain text `ping` gets the plain text `pong` back. It's answered without waking the room, so keepalives cost nothing.

## Other commands

| Command | Does |
|---|---|
| `npm run check` | Type-checks the TypeScript |
| `npm run types` | Regenerates `worker-configuration.d.ts` after changing `wrangler.jsonc` |
| `npm run deploy` | Publishes to Cloudflare (phase 7) |
