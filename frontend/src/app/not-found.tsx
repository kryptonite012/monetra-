import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium text-brand">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">The page you are looking for does not exist.</p>
      <Link href="/dashboard" className="mt-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white dark:text-[#04201d]">
        Back to dashboard
      </Link>
    </main>
  );
}
