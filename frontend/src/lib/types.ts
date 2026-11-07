export interface Profile {
  fullName: string;
  displayName: string | null;
  dateOfBirth: string | null;
  occupation: string | null;
  employmentType: string | null;
  city: string | null;
  state: string | null;
  country: string;
  baseCurrency: string;
  locale: string;
  timezone: string;
  monthlyIncomeEstimate: string | null;
  financialYearStartMonth: number;
  onboardingCompleted: boolean;
  preferences: Record<string, any>;
}

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  phoneLast4: string | null;
  phoneVerified: boolean;
  role: 'user' | 'admin' | 'support';
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  profile: Profile | null;
}

export interface Account {
  id: string;
  name: string;
  nickname: string | null;
  type: string;
  institutionName: string | null;
  accountNumberLast4: string | null;
  ifsc: string | null;
  currency: string;
  openingBalance: string;
  openingDate: string;
  creditLimit: string | null;
  balance: string;
  outstanding: string;
  availableCredit: string | null;
  utilizationPercent: string | null;
  isLiability: boolean;
  isActive: boolean;
  includeInNetWorth: boolean;
  transactionCount: number;
  lastTransactionOn: string | null;
  dataSourceLabel: string;
  color: string | null;
  notes: string | null;
  closedOn: string | null;
}

export interface Category {
  id: string;
  parentId: string | null;
  slug: string | null;
  name: string;
  kind: 'income' | 'expense' | 'transfer';
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  children?: Category[];
}

export interface Transaction {
  id: string;
  accountId: string;
  accountName?: string;
  direction: 'credit' | 'debit';
  amount: string;
  signedAmount: string;
  kind: string;
  categoryId: string | null;
  categoryName?: string | null;
  categoryColor?: string | null;
  merchantName?: string | null;
  paymentMethodLabel?: string | null;
  paymentMethodType?: string | null;
  occurredOn: string;
  description: string;
  notes: string | null;
  reference: string | null;
  counterparty: string | null;
  status: 'posted' | 'reversed';
  tags: string[];
  metadata: Record<string, any>;
  transferGroupId: string | null;
  reversalOfId: string | null;
  supersedesId: string | null;
  warnings?: string[];
}

export interface PaymentMethod {
  id: string;
  type: string;
  label: string;
  upiVpa: string | null;
  cardNetwork: string | null;
  cardLast4: string | null;
  isDefault: boolean;
  isActive: boolean;
  linkedAccountName?: string | null;
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; [k: string]: any };
}
