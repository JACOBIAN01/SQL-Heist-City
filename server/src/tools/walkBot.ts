import { WebSocket } from 'ws';
import {
  Button,
  PROTOCOL_VERSION,
  SIM_DT,
  SnapshotDecoder,
  decodeServerMessage,
  encodeClientMessage,
  quantiseYaw,
  type InputCommand,
} from '@heist/shared';

/**
 * Dev tool: a bot that joins the match and walks in circles (jumping now and
 * then), so a second browser tab has someone to see. Phase 6's load harness
 * generalises this. Usage: npm run bot -w @heist/server -- [count] [ws-url]
 */
const count = Number(process.argv[2] ?? 1);
const url = process.argv[3] ?? 'ws://localhost:8080/ws/game';

for (let n = 0; n < count; n++) {
  const ws = new WebSocket(url);
  const snapshots = new SnapshotDecoder(); // snapshots are deltas: every one must be decoded, in order
  let seq = 0;
  let tick = 0;
  ws.on('open', () =>
    ws.send(encodeClientMessage({ t: 'join', protocol: PROTOCOL_VERSION, name: `Bot ${n + 1}` })),
  );
  ws.on('message', (data: Buffer) => {
    if (decodeServerMessage(new Uint8Array(data), snapshots).t !== 'welcome') return;
    console.log(`bot ${n + 1} joined`);
    setInterval(
      () => {
        const commands: InputCommand[] = [];
        // Three 60 Hz commands per 50 ms, like a real client.
        for (let i = 0; i < 3; i++) {
          tick++;
          seq = (seq + 1) & 0xffff;
          commands.push({
            seq,
            moveX: 0,
            moveY: 127,
            yaw: quantiseYaw(tick * 0.012 + n),
            pitch: 0,
            buttons: tick % 240 === 0 ? Button.Jump : 0,
            viewLagMs: 0,
          });
        }
        ws.send(encodeClientMessage({ t: 'input', commands }));
      },
      3 * SIM_DT * 1000,
    );
    setInterval(() => ws.send(encodeClientMessage({ t: 'ping', clientTime: Date.now() })), 1000);
  });
  ws.on('close', (code) => console.log(`bot ${n + 1} closed (${code})`));
}
