import type { AdminUser, Role, UpdateUserRequest } from '@heist/shared';
import type { PasswordHasher } from './PasswordHasher';
import type { SessionStore } from './SessionStore';
import { toPublic, type UserRepository } from './UserRepository';

export type LoginOutcome =
  { readonly ok: true; readonly user: AdminUser; readonly token: string } | { readonly ok: false };

/** Hash of a random string: used to make "unknown email" take as long as "wrong password". */
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// Pattern: Facade — Why: routes call login/logout/userForToken; password
// hashing, session storage and user lookup stay hidden behind one service.
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionStore,
    private readonly hasher: PasswordHasher,
  ) {}

  async login(email: string, password: string): Promise<LoginOutcome> {
    const user = this.users.findByEmail(email);
    // Always run a hash so response time doesn't reveal whether the email exists.
    const valid = await this.hasher.verify(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid || user.disabled) return { ok: false };
    return { ok: true, user: toPublic(user), token: this.sessions.create(user.id) };
  }

  logout(token: string): void {
    this.sessions.revoke(token);
  }

  userForToken(token: string): AdminUser | undefined {
    const id = this.sessions.userIdFor(token);
    const user = id === undefined ? undefined : this.users.findById(id);
    return user && !user.disabled ? toPublic(user) : undefined;
  }

  async createUser(email: string, password: string, role: Role): Promise<AdminUser> {
    return this.users.create({ email, role, passwordHash: await this.hasher.hash(password) });
  }

  listUsers(): AdminUser[] {
    return this.users.list();
  }

  findUserByEmail(email: string): AdminUser | undefined {
    const user = this.users.findByEmail(email);
    return user && toPublic(user);
  }

  /** Disabling a user or changing their password signs them out everywhere. */
  async updateUser(id: number, changes: UpdateUserRequest): Promise<AdminUser | undefined> {
    const updated = this.users.update(id, {
      ...(changes.role === undefined ? {} : { role: changes.role }),
      ...(changes.disabled === undefined ? {} : { disabled: changes.disabled }),
      ...(changes.password === undefined
        ? {}
        : { passwordHash: await this.hasher.hash(changes.password) }),
    });
    if (updated && (changes.disabled === true || changes.password !== undefined)) {
      this.sessions.revokeAllFor(id);
    }
    return updated;
  }

  /** First run: create an admin from env if there are no users yet. */
  async ensureInitialAdmin(
    email: string | undefined,
    password: string | undefined,
  ): Promise<AdminUser | undefined> {
    if (this.users.count() > 0 || !email || !password) return undefined;
    return this.createUser(email, password, 'admin');
  }
}
