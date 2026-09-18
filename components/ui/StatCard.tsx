import Link from "next/link";

import type { Tone } from "@/lib/constants";

export function StatCard({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number | string;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        {/* Same tone vocabulary as the badges, so a counter and the badge on
            the tickets it links to always read as the same colour. */}
        {tone ? (
          <span data-tone={tone} className="tone-dot h-2 w-2 rounded-full" />
        ) : null}
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="card block px-4 py-3.5 transition-colors hover:border-ink-subtle/60"
      >
        {body}
      </Link>
    );
  }

  return <div className="card px-4 py-3.5">{body}</div>;
}

export function Pagination({
  page,
  pageCount,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;

  const buildHref = (target: number) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    if (target > 1) search.set("page", String(target));
    else search.delete("page");
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <nav
      className="flex items-center justify-between gap-3 border-t border-surface-border px-4 py-3 text-sm"
      aria-label="Pagination"
    >
      <span className="text-[13px] text-ink-muted">
        Page {page} of {pageCount}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={buildHref(page - 1)} className="btn-secondary px-3 py-1.5">
            Previous
          </Link>
        ) : (
          <span className="btn-secondary px-3 py-1.5 opacity-40">Previous</span>
        )}
        {page < pageCount ? (
          <Link href={buildHref(page + 1)} className="btn-secondary px-3 py-1.5">
            Next
          </Link>
        ) : (
          <span className="btn-secondary px-3 py-1.5 opacity-40">Next</span>
        )}
      </div>
    </nav>
  );
}
