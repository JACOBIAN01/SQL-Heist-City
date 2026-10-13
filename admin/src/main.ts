import { fileURLToPath } from 'node:url';
import { openStores } from './openStores';
import { createRemoteJWKSet } from 'jose';
import { buildAdmin } from './composition';
import { GoogleOidc } from './players/GoogleOidc';

// Entry point: reads the environment, then delegates wiring to buildAdmin().
const port = Number(process.env.PORT ?? 8081);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../../data/dev.db', import.meta.url));
const logger = {
  error: (message: string, meta?: Record<string, unknown>) => console.error(message, meta ?? ''),
};

const opened = await openStores(dbPath);

// Google sign-in for players. Off until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set (docs/identity.md).
const production = process.env.NODE_ENV === 'production';
const ticketSecret = process.env.TICKET_SECRET ?? (production ? undefined : 'dev-ticket-secret');
const playerAuth =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && ticketSecret
    ? {
        oidc: new GoogleOidc({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          redirectUri:
            process.env.GOOGLE_REDIRECT_URI ?? `http://localhost:${port}/auth/google/callback`,
          keys: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
        }),
        ticketSecret,
        cookieSecret: process.env.COOKIE_SECRET ?? ticketSecret,
        gameOrigins: (process.env.GAME_ORIGINS ?? 'http://localhost:5173').split(','),
        allowedDomains: (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
          .split(',')
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean),
      }
    : undefined;
if (production && !ticketSecret) console.warn('TICKET_SECRET is not set: player sign-in is off.');
const admin = buildAdmin(
  opened.stores,
  {
    secureCookies: process.env.NODE_ENV === 'production',
    sessionTtlMs: 12 * 60 * 60 * 1000,
    uiDistDir: fileURLToPath(new URL('../ui/dist', import.meta.url)),
    ...(playerAuth ? { playerAuth } : {}),
    ...(process.env.INTERNAL_SECRET
      ? {
          gameServer: {
            url: process.env.GAME_SERVER_URL ?? 'http://localhost:8080',
            secret: process.env.INTERNAL_SECRET,
          },
        }
      : {}),
  },
  logger,
);

const created = await admin.auth.ensureInitialAdmin(
  process.env.ADMIN_EMAIL,
  process.env.ADMIN_PASSWORD,
);
if (created) console.log(`created initial admin ${created.email}`);
if ((await admin.auth.listUsers()).length === 0) {
  console.warn(
    'No admin accounts exist yet, so nobody can log in.\n' +
      "  Create one:  npm run user:create -w @heist/admin -- --email you@school.test --password '…'\n" +
      '  or restart with ADMIN_EMAIL and ADMIN_PASSWORD set.',
  );
}

admin.app.listen(port, () => {
  console.log(`admin listening on http://localhost:${port} (db: ${opened.label})`);
});
