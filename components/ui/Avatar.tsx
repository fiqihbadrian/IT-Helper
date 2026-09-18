import { cn, initials } from "@/lib/utils";

const SIZES = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
};

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-semibold text-ink-muted ring-1 ring-inset ring-surface-border",
        SIZES[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
