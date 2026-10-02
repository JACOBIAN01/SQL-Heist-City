import { fileURLToPath } from 'node:url';
import { createAdminApp } from './http/app';

// Composition root: the only place that wires concrete dependencies.
const port = Number(process.env.PORT ?? 8081);
const uiDistDir = fileURLToPath(new URL('../ui/dist', import.meta.url));
const logger = {
  error: (message: string, meta?: Record<string, unknown>) => console.error(message, meta ?? ''),
};
const app = createAdminApp({ logger, uiDistDir });

app.listen(port, () => {
  console.log(`admin listening on http://localhost:${port}`);
});
