import type { QuestionTemplate } from '@heist/shared';

export type QuestionAction =
  'create' | 'update' | 'enable' | 'disable' | 'delete' | 'duplicate' | 'rollback' | 'import';

export interface QuestionChanged {
  readonly type: 'question_changed';
  readonly action: QuestionAction;
  readonly questionId: number;
  readonly actor: { readonly id: number; readonly email: string };
  readonly before?: QuestionTemplate;
  readonly after?: QuestionTemplate;
  readonly detail?: Record<string, unknown>;
}

export interface SettingsChanged {
  readonly type: 'settings_changed';
  readonly key: string;
  readonly actor: { readonly id: number; readonly email: string };
  readonly before?: unknown;
  readonly after: unknown;
}

export interface UserChanged {
  readonly type: 'user_changed';
  readonly action: 'create' | 'update';
  readonly userId: number;
  readonly actor: { readonly id: number; readonly email: string };
  readonly detail: Record<string, unknown>;
}

export interface PoolChanged {
  readonly type: 'pool_changed';
  readonly action: 'create' | 'update' | 'delete';
  readonly poolId: number;
  readonly actor: { readonly id: number; readonly email: string };
  readonly detail: Record<string, unknown>;
}

export interface PlayerChanged {
  readonly type: 'player_changed';
  readonly action: 'rename';
  readonly playerId: number;
  readonly actor: { readonly id: number; readonly email: string };
  readonly detail: Record<string, unknown>;
}

export interface ClassChanged {
  readonly type: 'class_changed';
  readonly action:
    'create' | 'update' | 'archive' | 'questions' | 'code' | 'lock' | 'unlock' | 'live' | 'consent';
  readonly classId: number;
  readonly actor: { readonly id: number; readonly email: string };
  readonly detail: Record<string, unknown>;
}

export interface ConceptChanged {
  readonly type: 'concept_changed';
  readonly topic: string;
  readonly version: number;
  readonly actor: { readonly id: number; readonly email: string };
}

export interface BriefMarked {
  readonly type: 'brief_marked';
  readonly briefId: string;
  readonly actor: { readonly id: number; readonly email: string };
  readonly detail: Record<string, unknown>;
}

export type AdminEvent =
  | QuestionChanged
  | SettingsChanged
  | UserChanged
  | PoolChanged
  | PlayerChanged
  | ClassChanged
  | ConceptChanged
  | BriefMarked;
export type AdminEventListener = (event: AdminEvent) => void;

// Pattern: Observer — Why: audit logging and game-server reload both react to
// "a question changed" without the question service knowing they exist.
// Adding a new reaction (e.g. analytics) is one subscribe() call.
export class AdminEventBus {
  private readonly listeners = new Set<AdminEventListener>();

  subscribe(listener: AdminEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: AdminEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
