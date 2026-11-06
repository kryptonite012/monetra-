/** Shapes a user (and optional profile) for API responses. Secrets never leave the server. */
export function toPublicUser(user: Record<string, any>, profile?: Record<string, any> | null) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneLast4: user.phoneLast4 ?? null,
    phoneVerified: Boolean(user.phoneVerifiedAt),
    role: user.role,
    status: user.status,
    mfaEnabled: Boolean(user.mfaEnabled),
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    profile: profile
      ? {
          fullName: profile.fullName,
          displayName: profile.displayName,
          dateOfBirth: profile.dateOfBirth,
          occupation: profile.occupation,
          employmentType: profile.employmentType,
          city: profile.city,
          state: profile.state,
          country: profile.country,
          baseCurrency: profile.baseCurrency,
          locale: profile.locale,
          timezone: profile.timezone,
          monthlyIncomeEstimate: profile.monthlyIncomeEstimate,
          financialYearStartMonth: profile.financialYearStartMonth,
          onboardingCompleted: profile.onboardingCompleted,
          preferences: profile.preferences ?? {},
        }
      : null,
  };
}
