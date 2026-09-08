"use client";

import Link from "next/link";
import { ReactNode } from "react";

export function PageHeader({ kicker, title, actions }: { kicker?: string; title: string; actions?: ReactNode }) {
  return (
    <div className="rise flex items-end justify-between gap-4 border-b border-line-strong pb-5 mb-8">
      <div>
        {kicker && (
          <div className="figure text-[11px] uppercase tracking-[0.2em] text-accent mb-1.5">{kicker}</div>
        )}
        <h1 className="text-4xl leading-none tracking-tight">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  href,
  variant = "primary",
  disabled,
  type,
  small,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "submit" | "button";
  small?: boolean;
}) {
  const base = `inline-flex items-center gap-1.5 font-medium transition-all duration-150 ${
    small ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
  } ${
    variant === "primary"
      ? "bg-ink text-paper hover:bg-accent-deep hover:-translate-y-px active:translate-y-0"
      : variant === "danger"
        ? "border border-accent text-accent hover:bg-accent hover:text-paper"
        : "border border-line-strong text-ink-soft hover:border-ink hover:text-ink"
  } ${disabled ? "opacity-40 pointer-events-none" : ""}`;
  if (href) return <Link href={href} className={base}>{children}</Link>;
  return (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled} className={base}>
      {children}
    </button>
  );
}

const badgeTones: Record<string, string> = {
  DRAFT: "bg-paper-sunken text-ink-soft",
  SCHEDULED: "bg-amber-wash text-amber",
  RUNNING: "bg-teal-wash text-teal",
  ACTIVE: "bg-teal-wash text-teal",
  COMPLETED: "bg-good-wash text-good",
  DELIVERED: "bg-good-wash text-good",
  SENT: "bg-teal-wash text-teal",
  QUEUED: "bg-paper-sunken text-ink-soft",
  SENDING: "bg-amber-wash text-amber",
  PAUSED: "bg-amber-wash text-amber",
  CANCELED: "bg-paper-sunken text-ink-faint",
  ARCHIVED: "bg-paper-sunken text-ink-faint",
  FAILED: "bg-accent-wash text-accent-deep",
  BOUNCED: "bg-accent-wash text-accent-deep",
  SUPPRESSED: "bg-paper-sunken text-ink-faint",
};

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const cls = (tone && badgeTones[tone]) || badgeTones[String(children)] || "bg-paper-sunken text-ink-soft";
  return (
    <span className={`figure inline-block px-2 py-0.5 text-[11px] uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="figure text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-xs text-ink-faint mt-1">{hint}</div>}
    </label>
  );
}

export const inputCls =
  "w-full border border-line-strong px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function Stat({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="card p-5">
      <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft">{label}</div>
      <div className={`figure text-4xl mt-2 ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
      {sub && <div className="text-xs text-ink-faint mt-1">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rise border border-dashed border-line-strong bg-paper-sunken/40 py-16 text-center">
      <div className="font-display text-2xl text-ink-soft">{title}</div>
      {hint && <div className="text-sm text-ink-faint mt-2 max-w-md mx-auto">{hint}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line-strong">
            {head.map((h) => (
              <th key={h} className="figure text-left text-[11px] uppercase tracking-[0.15em] text-ink-soft font-normal px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
