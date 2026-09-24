"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useFetch from "@/lib/useFetch";
import CommandK from "@/components/CommandK";
import AlertBanner from "@/components/AlertBanner";

const NAV = [
  { href: "/", label: "Overview", exact: true },
  { href: "/contacts", label: "Contacts" },
  { href: "/segments", label: "Segments" },
  { href: "/templates", label: "Templates" },
  { href: "/content", label: "Content" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/journeys", label: "Journeys" },
  { href: "/calendar", label: "Calendar" },
  { href: "/logs", label: "Logs" },
  { href: "/account", label: "Account" },
  { href: "/settings", label: "Settings", adminOnly: true },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useFetch<{ email: string; role: "ADMIN" | "USER" }>("/api/auth/me");

  const items = NAV.filter((n) => !n.adminOnly || me?.role === "ADMIN");

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen">
      <CommandK />
      <aside className="w-56 shrink-0 border-r border-line-strong bg-paper-raised/70 backdrop-blur-sm flex flex-col sticky top-0 h-screen">
        <div className="px-5 pt-6 pb-5 border-b border-line">
          <Link href="/" className="block group">
            <div className="font-display text-[26px] leading-none tracking-tight">
              Dispatch<span className="text-accent group-hover:animate-pulse">.</span>
            </div>
            <div className="figure text-[10px] uppercase tracking-[0.25em] text-ink-faint mt-1.5">
              {me?.role === "ADMIN" ? "admin console" : "engagement console"}
            </div>
          </Link>
        </div>
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
          className="mx-5 mt-4 flex items-center justify-between border border-line px-3 py-1.5 text-xs text-ink-faint hover:border-line-strong hover:text-ink-soft transition-colors"
        >
          <span>Search…</span>
          <span className="figure text-[10px]">⌘K</span>
        </button>
        <nav className="flex-1 py-3">
          {items.map((item, i) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-5 py-2.5 text-sm transition-colors ${
                  active
                    ? "text-ink font-medium border-r-2 border-accent bg-accent-wash/50"
                    : "text-ink-soft hover:text-ink hover:bg-paper-sunken/60"
                }`}
              >
                <span className={`figure text-[10px] ${active ? "text-accent" : "text-ink-faint"}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-line space-y-2">
          {me && (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs truncate">{me.email}</div>
                <div className="figure text-[9px] uppercase tracking-[0.2em] text-ink-faint">{me.role}</div>
              </div>
              <button onClick={logout} className="text-xs text-ink-faint hover:text-accent transition-colors shrink-0">
                Sign out
              </button>
            </div>
          )}
          <Link href="/demo/push" className="block text-xs text-ink-faint hover:text-accent transition-colors">
            ↗ Push demo page
          </Link>
        </div>
      </aside>
      <main className="flex-1 min-w-0 px-10 py-8 max-w-6xl">
        {me && <AlertBanner isAdmin={me.role === "ADMIN"} />}
        {children}
      </main>
    </div>
  );
}
