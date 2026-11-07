import {
  ArrowLeftRight,
  Bell,
  Bot,
  Building2,
  FileText,
  Landmark,
  LayoutDashboard,
  LineChart,
  PieChart,
  Receipt,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const NAV: Array<{ section: string; items: NavItem[] }> = [
  { section: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    section: 'Money',
    items: [
      { href: '/accounts', label: 'Accounts', icon: Wallet },
      { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
      { href: '/income', label: 'Income', icon: TrendingUp },
      { href: '/expenses', label: 'Expenses', icon: TrendingDown },
      { href: '/budgets', label: 'Budgets', icon: PieChart },
    ],
  },
  {
    section: 'Wealth',
    items: [
      { href: '/goals', label: 'Savings goals', icon: Target },
      { href: '/loans', label: 'Loans & EMIs', icon: Landmark },
      { href: '/investments', label: 'Investments', icon: LineChart },
      { href: '/assets', label: 'Assets & liabilities', icon: Building2 },
    ],
  },
  {
    section: 'Plan',
    items: [
      { href: '/bills', label: 'Bills & subscriptions', icon: Receipt },
      { href: '/assistant', label: 'AI assistant', icon: Bot },
      { href: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    section: 'Account',
    items: [
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/settings/security', label: 'Security', icon: ShieldCheck },
      { href: '/settings/profile', label: 'Profile', icon: UserRound },
      { href: '/admin', label: 'Administration', icon: Users, adminOnly: true },
    ],
  },
];
