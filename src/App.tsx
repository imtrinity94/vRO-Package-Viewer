import { useCallback, useEffect, useRef, useState } from "react";
import { parsePackage } from "./lib/parser";
import type { PackageInfo } from "./lib/types";
import { Sidebar } from "./components/Sidebar";
import { Overview } from "./components/Overview";
import { ElementView } from "./components/ElementView";
import { SearchView } from "./components/SearchView";

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
      document.title = `${p.meta["pkg-name"] || file.name} · vRO Package Viewer`;
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
          <Logo /> <span>vRO Package Viewer</span>
        </button>
        {pkg && (
          <>
            <span className="pkg-name ellipsis" title={pkg.fileName}>{pkg.meta["pkg-name"] || pkg.fileName}</span>
            <div className="spacer" />
            <button className={`btn-ghost ${view.kind === "overview" ? "on" : ""}`} onClick={() => go({ kind: "overview" })}>Overview</button>
            <button className={`btn-ghost ${view.kind === "search" ? "on" : ""}`} onClick={() => go({ kind: "search" })}>Search</button>
            <button className="btn" onClick={() => inputRef.current?.click()}>Open…</button>
          </>
        )}
        {!pkg && <div className="spacer" />}
        {themeBtn}
      </header>

      {!pkg ? (
        <main className="landing">
          <div className="drop" onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}>
            <Logo size={44} />
            <h1>Open a vRO package</h1>
            <p>Drop a <code>.package</code> exported from vRealize / Aria Orchestrator or VCF Automation Orchestrator, or click to choose one.</p>
            <button className="btn primary" disabled={busy}>{busy ? "Reading package…" : "Choose file"}</button>
            {error && <div className="callout warn">{error}</div>}
          </div>
          <ul className="features">
            <li><strong>Everything in one place</strong> Workflows, actions, configuration elements, resource elements and Python/Node/PowerShell environments, grouped by folder or module.</li>
            <li><strong>Read the code</strong> Every scriptable task and action with syntax highlighting, plus full-text search across the package.</li>
            <li><strong>See how it fits together</strong> Workflow schema diagrams, bindings, input forms, and what uses what.</li>
            <li><strong>Stays on your machine</strong> The package is parsed in your browser and never uploaded anywhere.</li>
          </ul>
        </main>
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
    </div>
  );
}

function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path d="M8 11l8-4 8 4v10l-8 4-8-4z M8 11l8 4 8-4M16 15v10" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
