import { z } from 'zod';
import { isoDate, optionalText } from '../../lib/http';
import { nonNegativeMoney } from '../../lib/money';

/** Accepts any IANA zone the runtime knows, including aliases such as Asia/Kolkata. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const profileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    displayName: optionalText(60),
    dateOfBirth: isoDate.nullable().refine((d) => !d || d < new Date().toISOString().slice(0, 10), 'Date of birth must be in the past'),
    occupation: optionalText(120),
    employmentType: z.enum(['salaried', 'self_employed', 'business', 'student', 'retired', 'homemaker', 'other']).nullable(),
    city: optionalText(80),
    state: optionalText(80),
    country: z.string().regex(/^[A-Z]{2}$/, 'Use a 2-letter ISO country code'),
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    timezone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone'),
    monthlyIncomeEstimate: nonNegativeMoney.nullable(),
    financialYearStartMonth: z.number().int().min(1).max(12),
  })
  .partial();

const notificationToggles = z
  .object({
    unusualSpending: z.boolean(),
    budgetThreshold: z.boolean(),
    emiDue: z.boolean(),
    billDue: z.boolean(),
    subscriptionRenewal: z.boolean(),
    goalMilestone: z.boolean(),
    accountActivity: z.boolean(),
    securityAlert: z.boolean(),
  })
  .partial();

export const preferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    compactNumbers: z.boolean(),
    weekStartsOn: z.enum(['monday', 'sunday']),
    emailNotifications: notificationToggles,
    inAppNotifications: notificationToggles,
    weeklySummaryEmail: z.boolean(),
  })
  .partial();

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
  confirmation: z.literal('DELETE MY ACCOUNT', { message: 'Type DELETE MY ACCOUNT to confirm' }),
  code: z.string().regex(/^\d{6}$/).optional(),
});
