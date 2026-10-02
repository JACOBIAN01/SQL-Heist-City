import { z } from 'zod';

export const ROLES = ['admin', 'teacher'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Minimum password policy for admin/teacher accounts. */
export const passwordSchema = z.string().min(10, 'at least 10 characters').max(200);

export interface AdminUser {
  readonly id: number;
  readonly email: string;
  readonly role: Role;
  readonly disabled: boolean;
  readonly createdAt: string;
}

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
  role: roleSchema,
});
export type CreateUserRequest = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({ role: roleSchema, disabled: z.boolean(), password: passwordSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

export interface AuditEntry {
  readonly id: number;
  readonly actor: string | null;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string | null;
  readonly detail: Record<string, unknown> | null;
  readonly at: string;
}
