import { useEffect, useRef, type CSSProperties } from "react";
import { useInAppMessage } from "./react.js";
import type { InboxMessage } from "./types.js";

/**
 * Drop-in renderer for pop-up in-app messages on the web (React DOM). Inline
 * styles only — no CSS to import; override with `className` / `accentColor`.
 * React Native apps render `useInAppMessage().message` with their own views.
 *
 *   <DispatchProvider client={dispatch}>
 *     <DispatchInAppMessage onNavigate={(url) => router.push(url)} />
 *   </DispatchProvider>
 */
export function DispatchInAppMessage({
  onNavigate,
  accentColor = "#1d4ed8",
  className,
  pollMs,
}: {
  onNavigate?: (url: string) => void;
  accentColor?: string;
  className?: string;
  pollMs?: number;
}) {
  const { message, dismiss, click } = useInAppMessage({ pollMs });
  if (!message) return null;
  return <InAppCard key={message.id} message={message} dismiss={dismiss} click={click} onNavigate={onNavigate} accentColor={accentColor} className={className} />;
}

/**
 * Accessible by default (WCAG 2.2 AA): modal layouts are dialogs that take focus and hand it
 * back when closed, Escape dismisses, every action is a real button, colours meet 4.5:1.
 */
function InAppCard({
  message,
  dismiss,
  click,
  onNavigate,
  accentColor,
  className,
}: {
  message: InboxMessage;
  dismiss: () => void;
  click: (url?: string | null) => void;
  onNavigate?: (url: string) => void;
  accentColor: string;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const banner = message.layout === "BANNER";
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!banner) dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (!banner) previous?.focus?.();
    };
  }, [banner, dismiss]);

  const go = (url: string | null | undefined) => {
    click(url);
    if (url) (onNavigate ?? ((u: string) => window.location.assign(u)))(url);
  };
  const full = message.layout === "FULLSCREEN";

  const overlay: CSSProperties = banner
    ? { position: "fixed", top: 12, left: 12, right: 12, zIndex: 2147483000, display: "flex", justifyContent: "center" }
    : { position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(10,14,24,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
  const card: CSSProperties = {
    background: "#fff",
    color: "#131a2a",
    width: "100%",
    maxWidth: full ? "none" : banner ? 520 : 420,
    height: full ? "100%" : undefined,
    boxShadow: "0 12px 40px rgba(0,0,0,.25)",
    borderRadius: banner ? 10 : 14,
    overflow: "hidden",
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
    display: "flex",
    flexDirection: banner ? "row" : "column",
  };

  return (
    <div ref={dialogRef} style={overlay} className={className} role={banner ? "status" : "dialog"} aria-modal={!banner} aria-labelledby={`dispatch-iam-${message.id}`}>
      <div style={card}>
        {message.imageUrl && (
          <img
            src={message.imageUrl}
            alt=""
            style={banner ? { width: 88, objectFit: "cover" } : { width: "100%", maxHeight: full ? "50%" : 220, objectFit: "cover" }}
          />
        )}
        <div style={{ padding: banner ? "12px 14px" : 20, flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <strong id={`dispatch-iam-${message.id}`} style={{ fontSize: banner ? 15 : 18, lineHeight: 1.3 }}>
              {message.url ? (
                <button
                  onClick={() => go(message.url)}
                  style={{ all: "unset", cursor: "pointer", font: "inherit", color: "inherit", textDecoration: "underline", textUnderlineOffset: 3 }}
                >
                  {message.title}
                </button>
              ) : (
                message.title
              )}
            </strong>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              style={{ border: 0, background: "none", fontSize: 22, lineHeight: 1, cursor: "pointer", color: "#4a5366", minWidth: 32, minHeight: 32, flexShrink: 0 }}
            >
              ×
            </button>
          </div>
          {message.body && <div style={{ fontSize: 14, lineHeight: 1.5, color: "#4a5366", whiteSpace: "pre-line" }}>{message.body}</div>}
          {message.buttons.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {message.buttons.map((b, i) => (
                <button
                  key={i}
                  onClick={() => go(b.url)}
                  style={{
                    padding: "8px 14px",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    borderRadius: 8,
                    border: i === 0 ? "0" : "1px solid #b9c0cd",
                    background: i === 0 ? accentColor : "transparent",
                    color: i === 0 ? "#fff" : "#131a2a",
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
