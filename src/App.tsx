import { useCallback, useEffect, useRef, useState } from "react";
import { parsePackage } from "./lib/parser";
import type { PackageInfo } from "./lib/types";
import { Sidebar } from "./components/Sidebar";
import { Overview } from "./components/Overview";
import { ElementView } from "./components/ElementView";
import { SearchView } from "./components/SearchView";
import { Landing } from "./components/Landing";
import { BackToTop } from "./components/BackToTop";

type View = { kind: "overview" } | { kind: "search" } | { kind: "element"; id: string; term?: string };

function readHash(): View {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === "/search") return { kind: "search" };
  const m = /^\/el\/([^?]+)(?:\?q=(.*))?$/.exec(h);
  if (m) return { kind: "element", id: m[1], term: m[2] || undefined };
  return { kind: "overview" };
}
function writeHash(v: View) {
  const h = v.kind === "search" ? "#/search" : v.kind === "element" ? `#/el/${v.id}${v.term ? `?q=${encodeURIComponent(v.term)}` : ""}` : "#/";
  if (location.hash !== h) history.pushState(null, "", h);
}

type Theme = "system" | "light" | "dark";

/** The front page's own <title>, restored when going back home. */
const HOME_TITLE = typeof document !== "undefined" ? document.title : "vRO Peekage";

export default function App() {
  const [pkg, setPkg] = useState<PackageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "overview" });
  const [drag, setDrag] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const landingRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const go = useCallback((v: View) => {
    setView(v);
    writeHash(v);
    setNavOpen(false);
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  /** Close the open package and return to the front page. */
  const goHome = useCallback(() => {
    setPkg(null);
    setError(null);
    setNavOpen(false);
    setView({ kind: "overview" });
    document.title = HOME_TITLE;
    if (location.hash) history.pushState(null, "", location.pathname + location.search);
  }, []);

  useEffect(() => {
    const onPop = () => setView(readHash());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const load = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const p = await parsePackage(buf, file.name);
      if (!p.elements.length && !Object.keys(p.meta).length) throw new Error("This doesn't look like a vRO package (no dunes-meta-inf or elements/ found).");
      setPkg(p);
      document.title = `${p.meta["pkg-name"] || file.name} · vRO Peekage`;
      const h = readHash();
      if (h.kind === "element" && !p.byId.has(h.id.toLowerCase())) go({ kind: "overview" });
      else if (h.kind !== "overview") setView(h);
      else go({ kind: "overview" });
    } catch (e) {
      setError(
        (e as Error).message.includes("end of central directory")
          ? "That file isn't a valid .package (zip) archive."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }, [go]);

  // Global drag & drop
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      depth++;
      setDrag(true);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDrag(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDrag(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) load(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [load]);

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept=".package,.zip,application/zip"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) load(f);
        e.target.value = "";
      }}
    />
  );

  const themeBtn = (
    <button
      className="btn-ghost"
      title={`Theme: ${theme}`}
      onClick={() => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}
    >
      {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}
    </button>
  );

  const el = view.kind === "element" && pkg ? pkg.byId.get(view.id.toLowerCase()) : undefined;

  return (
    <div className="app">
      {picker}
      {drag && (
        <div className="drop-overlay">
          <div>Drop your .package file</div>
        </div>
      )}
      <header className="topbar">
        {pkg && (
          <button className="btn-ghost only-mobile" onClick={() => setNavOpen(!navOpen)} aria-label="Toggle navigation">☰</button>
        )}
        <button className="brand" onClick={() => pkg && go({ kind: "overview" })}>
          <Logo /> <span className="brand-name"><b>vRO</b> Peekage</span>
        </button>
        {pkg && (
          <>
            <span className="pkg-name ellipsis" title={pkg.fileName}>{pkg.meta["pkg-name"] || pkg.fileName}</span>
            <div className="spacer" />
            <button className="btn-ghost home-btn" onClick={goHome} aria-label="Home" title="Close this package and go to the front page">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9" />
              </svg>
              <span>Home</span>
            </button>
            <button className={`btn-ghost ${view.kind === "overview" ? "on" : ""}`} onClick={() => go({ kind: "overview" })}>Overview</button>
            <button className={`btn-ghost ${view.kind === "search" ? "on" : ""}`} onClick={() => go({ kind: "search" })}>Search</button>
            <button className="btn" onClick={() => inputRef.current?.click()}>Open…</button>
          </>
        )}
        {!pkg && (
          <>
            <div className="spacer" />
            <a className="btn-ghost" href="https://github.com/imtrinity94/vRO-Package-Viewer" target="_blank" rel="noreferrer">GitHub</a>
          </>
        )}
        {themeBtn}
      </header>

      {!pkg ? (
        <Landing scrollRef={landingRef} onPick={() => inputRef.current?.click()} busy={busy} error={error} dragging={drag} />
      ) : (
        <div className={`shell ${navOpen ? "nav-open" : ""}`}>
          <Sidebar pkg={pkg} selected={view.kind === "element" ? el?.id : undefined} onSelect={(id) => go({ kind: "element", id })} />
          <main className="main" ref={mainRef}>
            {busy && <div className="callout">Reading package…</div>}
            {error && <div className="callout warn">{error}</div>}
            {view.kind === "overview" && <Overview pkg={pkg} onNav={(id) => go({ kind: "element", id })} />}
            {view.kind === "search" && <SearchView pkg={pkg} onOpen={(id, term) => go({ kind: "element", id, term })} />}
            {view.kind === "element" && el && <ElementView key={el.id + (view.term ?? "")} el={el} pkg={pkg} onNav={(id) => go({ kind: "element", id })} term={view.term} />}
            {view.kind === "element" && !el && <p className="muted">Element not found in this package.</p>}
          </main>
        </div>
      )}
      <BackToTop key={pkg ? "app" : "home"} target={pkg ? mainRef : landingRef} />
    </div>
  );
}

/** Peek Box mark. `size` <= 32 uses the simplified small-size drawing. */
function Logo({ size = 24 }: { size?: number }) {
  const small = size <= 32;
  return (
    <svg className="logo" width={size} height={size} viewBox={small ? "5 11 54 50" : "0 0 64 64"} fill="none" aria-hidden>
      {small ? (
        <>
          <path d="M12.5 27.5 Q23.5 16.5 34.5 27.5 Q23.5 35 12.5 27.5z" fill="var(--brand-amber)" />
          <circle cx="24" cy="27" r="4" fill="var(--brand-ink)" />
        </>
      ) : (
        <>
          <path d="M14 28 Q24 18.5 34 28 Q24 34.5 14 28z" fill="var(--brand-amber)" />
          <circle cx="25" cy="27.6" r="3.4" fill="var(--brand-ink)" />
        </>
      )}
      <path d="M9 33h46v19a5 5 0 0 1-5 5H14a5 5 0 0 1-5-5z" fill="var(--brand-fg)" />
      {!small && <path d="M32 33v24" stroke="var(--bg)" strokeWidth="2.5" opacity=".35" />}
      <g transform="rotate(17 55 33)">
        <rect x="9" y="24.5" width="48" height="8.5" rx="3" fill="var(--brand-fg)" />
      </g>
    </svg>
  );
}
