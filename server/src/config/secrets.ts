/** Values used in development and tests; never acceptable in production. */
const PLACEHOLDERS = new Set(['dev-ticket-secret', 'not-configured', 'changeme', 'secret']);

/** Shortest acceptable shared secret: 32 characters, e.g. `openssl rand -base64 32`. */
export const MIN_SECRET_LENGTH = 32;

/**
 * What is wrong with a service's secrets in production (Phase 18.5): a required one missing,
 * one too short or a known placeholder, or two that are the same (one leak would open both).
 * Outside production nothing is checked. Messages never include a secret's value.
 */
export function secretProblems(
  env: Readonly<Record<string, string | undefined>>,
  names: { readonly required: readonly string[]; readonly optional?: readonly string[] },
): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const name of [...names.required, ...(names.optional ?? [])]) {
    const value = env[name];
    if (value === undefined || value === '') {
      if (names.required.includes(name)) problems.push(`${name} is required in production`);
      continue;
    }
    if (PLACEHOLDERS.has(value)) problems.push(`${name} is a development placeholder`);
    else if (value.length < MIN_SECRET_LENGTH)
      problems.push(`${name} is shorter than ${MIN_SECRET_LENGTH} characters`);
    const twin = seen.get(value);
    if (twin) problems.push(`${name} is the same as ${twin}; use a different secret for each`);
    seen.set(value, name);
  }
  return problems;
}

/** Stops the process at startup when the secrets are not fit for production. */
export function assertSecrets(
  env: Readonly<Record<string, string | undefined>>,
  names: Parameters<typeof secretProblems>[1],
): void {
  const problems = secretProblems(env, names);
  if (problems.length > 0)
    throw new Error(
      `Refusing to start:\n  ${problems.join('\n  ')}\n(see docs/deployment.md, "Secrets")`,
    );
}
