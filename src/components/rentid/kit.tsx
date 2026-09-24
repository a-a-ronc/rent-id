/**
 * RentID design-system primitives.
 * All colors come from the semantic tokens in `src/styles.css`.
 */
import { Loader2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { Glass } from "@/components/rentid/Surface";
import { cn } from "@/lib/utils";

/* --------------------------------- buttons -------------------------------- */

type ButtonTone = "primary" | "secondary" | "ghost" | "danger";

const TONES: Record<ButtonTone, string> = {
  primary: "bg-brand text-brand-foreground hover:opacity-90",
  secondary: "bg-secondary text-foreground hover:bg-secondary/80",
  ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
  danger: "bg-destructive text-destructive-foreground hover:opacity-90",
};

export function Button({
  children,
  tone = "primary",
  size = "md",
  loading,
  className,
  type = "button",
  ...rest
}: {
  children: ReactNode;
  tone?: ButtonTone;
  size?: "sm" | "md";
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-display font-semibold transition-all disabled:pointer-events-none disabled:opacity-55",
        size === "sm" ? "px-3.5 py-1.5 text-[12px]" : "px-4 py-2.5 text-[13px]",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

/* ---------------------------------- forms --------------------------------- */

const CONTROL =
  "w-full rounded-xl border border-border bg-card/70 px-3 py-2.5 text-[13.5px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-brand/60 focus:ring-2 focus:ring-brand/15";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="label-eyebrow block">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11.5px] text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[11.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...rest} />;
}

export function TextArea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, "min-h-24 resize-y", className)} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, "appearance-none pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-3 sm:grid-cols-2", className)}>{children}</div>;
}

/* ---------------------------------- modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/25 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass animate-settle relative z-10 max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl sm:pb-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[16px] font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ---------------------------------- table --------------------------------- */

export function DataTable<T>({
  rows,
  columns,
  empty,
  onRowClick,
}: {
  rows: T[];
  columns: {
    key: string;
    header: string;
    cell: (row: T) => ReactNode;
    align?: "left" | "right";
    hideOnMobile?: boolean;
  }[];
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border/60">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "label-eyebrow px-4 py-2.5 font-medium",
                  c.align === "right" && "text-right",
                  c.hideOnMobile && "hidden sm:table-cell",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "transition-colors",
                onRowClick && "cursor-pointer hover:bg-secondary/60",
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-4 py-3 text-[13px] align-middle",
                    c.align === "right" && "text-right",
                    c.hideOnMobile && "hidden sm:table-cell",
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------- loading / error surfaces ----------------------- */

export function LoadingCard({ label = "Loading…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <Glass className="p-4" aria-busy="true" aria-live="polite">
      <p className="label-eyebrow flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" /> {label}
      </p>
      <div className="mt-3 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-xl bg-secondary/70" />
        ))}
      </div>
    </Glass>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Glass className="border border-destructive/25 p-4">
      <p className="font-display text-[13.5px] font-semibold text-destructive">
        Something went wrong
      </p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button tone="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Glass>
  );
}

export function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-accent/25 bg-accent/8 px-4 py-3 text-[12px] text-muted-foreground">
      {children}
    </div>
  );
}
