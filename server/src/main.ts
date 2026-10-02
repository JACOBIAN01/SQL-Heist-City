import { createHttpServer } from './http/httpServer';

// Composition root: the only place that wires concrete dependencies.
const port = Number(process.env.PORT ?? 8080);
const server = createHttpServer({ now: Date.now, startedAt: Date.now() });

server.listen(port, () => {
  console.log(`game server listening on http://localhost:${port}`);
});
