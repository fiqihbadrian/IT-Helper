import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-sm text-ink-subtle">404</p>
      <h1 className="mt-2 text-lg font-semibold text-ink">Not found</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">
        This page does not exist, or you do not have access to it. Tickets are only
        visible to their requester and the IT Support team.
      </p>
      <Link href="/dashboard" className="btn-primary mt-5">
        Back to dashboard
      </Link>
    </div>
  );
}
