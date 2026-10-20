// End-to-end check against a running relay (npm run dev in another terminal).
// Usage: npm test            (defaults to http://127.0.0.1:8787)
//        RELAY_URL=https://... npm test

const base = (process.env.RELAY_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const wsBase = base.replace(/^http/, 'ws');
const room = `smoke-${Math.random().toString(36).slice(2, 10)}`;

let failures = 0;

function check(name, ok, detail = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`);
    if (!ok) failures += 1;
}

// Opens a connection and queues everything it receives.
function connect(device) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsBase}/room/${room}?device=${encodeURIComponent(device)}`);
        const queue = [];
        const waiters = [];
        ws.addEventListener('message', (event) => {
            let data = event.data;
            try { data = JSON.parse(event.data); } catch { /* raw text, e.g. "pong" */ }
            const waiter = waiters.shift();
            if (waiter) waiter(data); else queue.push(data);
        });
        ws.addEventListener('open', () => resolve({
            ws,
            send: (data) => ws.send(typeof data === 'string' ? data : JSON.stringify(data)),
            next: (timeoutMs = 2000) => new Promise((done) => {
                if (queue.length > 0) return done(queue.shift());
                const timer = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); done(null); }, timeoutMs);
                const waiter = (data) => { clearTimeout(timer); done(data); };
                waiters.push(waiter);
            }),
        }));
        ws.addEventListener('error', () => reject(new Error(`Could not connect to ${wsBase}. Is "npm run dev" running?`)));
    });
}

async function main() {
    const home = await fetch(`${base}/`);
    check('GET / answers', home.ok);

    const plain = await fetch(`${base}/room/${room}`);
    check('Room address refuses plain HTTP', plain.status === 426, `got ${plain.status}`);

    const pc = await connect('Windows PC');
    const pcWelcome = await pc.next();
    check('First device gets a welcome with an empty room',
        pcWelcome?.type === 'welcome' && pcWelcome.devices.length === 0, JSON.stringify(pcWelcome));

    const mac = await connect('MacBook');
    const macWelcome = await mac.next();
    check('Second device sees the first in its welcome',
        macWelcome?.type === 'welcome' && macWelcome.devices.some((d) => d.name === 'Windows PC'), JSON.stringify(macWelcome));

    const joined = await pc.next();
    check('First device is told the second joined',
        joined?.type === 'device-joined' && joined.device.name === 'MacBook', JSON.stringify(joined));

    pc.send({ type: 'chat', text: 'hello from the PC' });
    const chat = await mac.next();
    check('A message reaches the other device',
        chat?.type === 'chat' && chat.text === 'hello from the PC', JSON.stringify(chat));
    check('The relay stamps who sent it', chat?.from?.name === 'Windows PC', JSON.stringify(chat?.from));
    check('The sender does not get its own message back', (await pc.next(300)) === null);

    pc.send({ type: 'chat', text: 'spoof', from: { id: 'x', name: 'MacBook' } });
    const spoofed = await mac.next();
    check('A device cannot fake the sender', spoofed?.from?.name === 'Windows PC', JSON.stringify(spoofed?.from));

    pc.send({ type: 'welcome' });
    const fake = await pc.next();
    check('Relay-only message types are rejected', fake?.type === 'error', JSON.stringify(fake));

    pc.send('not json');
    const bad = await pc.next();
    check('Non-JSON messages are rejected', bad?.type === 'error', JSON.stringify(bad));

    pc.send('ping');
    check('Keepalive ping gets "pong"', (await pc.next()) === 'pong');

    mac.ws.close(1000);
    const left = await pc.next();
    check('Remaining device is told when one leaves',
        left?.type === 'device-left' && left.device.name === 'MacBook', JSON.stringify(left));

    pc.ws.close(1000);
}

main()
    .catch((error) => { console.error(error.message); failures += 1; })
    .finally(() => {
        console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
        process.exit(failures === 0 ? 0 : 1);
    });
