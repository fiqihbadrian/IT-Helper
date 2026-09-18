"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";

import { TICKET_PRIORITIES, TICKET_STATUSES, STATUS_META, PRIORITY_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Category, Profile } from "@/types";

interface TicketFilterBarProps {
  categories: Category[];
  technicians: Profile[];
  departments: { id: string; name: string }[];
  /** Employee view: filters are hidden, only search is offered. */
  compact?: boolean;
}

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "updated", label: "Recently updated" },
  { value: "priority", label: "Highest priority" },
];

export function TicketFilterBar({
  categories,
  technicians,
  departments,
  compact = false,
}: TicketFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSearch(searchParams.get("q") ?? "");
  }, [searchParams]);

  const apply = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "" || value === "ALL") params.delete(key);
        else params.set(key, value);
      });
      params.delete("page");
      const query = params.toString();
      startTransition(() => {
        router.push(query ? `${pathname}?${query}` : pathname);
      });
    },
    [pathname, router, searchParams],
  );

  const activeFilterCount = [
    "status",
    "priority",
    "category",
    "technician",
    "department",
    "from",
    "to",
  ].filter((key) => searchParams.get(key)).length;

  const value = (key: string) => searchParams.get(key) ?? "ALL";

  return (
    <div className={cn("border-b border-surface-border", pending && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <form
          className="relative min-w-0 flex-1 sm:max-w-xs"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ q: search.trim() || null });
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search number, title, employee…"
            className="input pl-9"
            aria-label="Search tickets"
          />
        </form>

        <select
          value={searchParams.get("sort") ?? "newest"}
          onChange={(event) => apply({ sort: event.target.value })}
          className="input w-auto"
          aria-label="Sort tickets"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {!compact ? (
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="btn-secondary ml-auto"
            aria-expanded={open}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {!compact && open ? (
        <div className="grid gap-3 border-t border-surface-border bg-surface-muted/60 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            label="Status"
            value={value("status")}
            onChange={(next) => apply({ status: next })}
            options={TICKET_STATUSES.map((status) => ({
              value: status,
              label: STATUS_META[status].label,
            }))}
          />
          <FilterSelect
            label="Priority"
            value={value("priority")}
            onChange={(next) => apply({ priority: next })}
            options={TICKET_PRIORITIES.map((priority) => ({
              value: priority,
              label: PRIORITY_META[priority].label,
            }))}
          />
          <FilterSelect
            label="Category"
            value={value("category")}
            onChange={(next) => apply({ category: next })}
            options={categories.map((category) => ({
              value: category.id,
              label: category.name,
            }))}
          />
          <FilterSelect
            label="Technician"
            value={value("technician")}
            onChange={(next) => apply({ technician: next })}
            options={technicians.map((technician) => ({
              value: technician.id,
              label: technician.full_name,
            }))}
          />
          <FilterSelect
            label="Department"
            value={value("department")}
            onChange={(next) => apply({ department: next })}
            options={departments.map((department) => ({
              value: department.id,
              label: department.name,
            }))}
          />
          <div>
            <label className="label" htmlFor="filter-from">
              Created from
            </label>
            <input
              id="filter-from"
              type="date"
              value={searchParams.get("from") ?? ""}
              onChange={(event) => apply({ from: event.target.value || null })}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="filter-to">
              Created to
            </label>
            <input
              id="filter-to"
              type="date"
              value={searchParams.get("to") ?? ""}
              onChange={(event) => apply({ to: event.target.value || null })}
              className="input"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="btn-secondary w-full"
              onClick={() =>
                apply({
                  status: null,
                  priority: null,
                  category: null,
                  technician: null,
                  department: null,
                  from: null,
                  to: null,
                  q: null,
                })
              }
            >
              <X className="h-4 w-4" />
              Clear filters
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input"
      >
        <option value="ALL">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
