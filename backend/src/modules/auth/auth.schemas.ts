import { z } from 'zod';
import { passwordSchema } from '../../lib/password-policy';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Enter a valid email address'));

/** Indian mobile numbers (+91XXXXXXXXXX) or other E.164 numbers. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .transform((v) => (/^[6-9]\d{9}$/.test(v) ? `+91${v}` : v))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid mobile number with country code'));

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(120),
  phone: phoneSchema.optional(),
  acceptTerms: z.literal(true, { message: 'You must accept the terms to continue' }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
