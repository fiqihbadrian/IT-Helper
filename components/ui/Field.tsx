import { cn } from "@/lib/utils";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-danger-ink">*</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-ink-subtle">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-danger-ink">{error}</p> : null}
    </div>
  );
}

export function Alert({
  tone = "error",
  children,
  className,
}: {
  tone?: "error" | "success" | "info" | "warning";
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    error: "border-danger-border bg-danger-soft text-danger-ink",
    success: "border-success-border bg-success-soft text-success-ink",
    info: "border-info-border bg-info-soft text-info-ink",
    warning: "border-warning-border bg-warning-soft text-warning-ink",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-3.5 py-2.5 text-[13px]", tones[tone], className)}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
