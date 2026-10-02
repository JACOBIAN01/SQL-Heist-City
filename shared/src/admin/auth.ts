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
