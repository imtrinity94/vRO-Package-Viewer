import { useDeferredValue, useMemo, useState } from "react";
import type { PackageInfo } from "../lib/types";
import { KindIcon } from "./Icons";

interface Hit {
  elId: string;
  elName: string;
  kind: string;
  label: string;
  line: number;
  text: string;
}

const MAX_HITS = 1000;

export function SearchView({ pkg, onOpen, initial }: { pkg: PackageInfo; onOpen: (id: string, term: string) => void; initial?: string }) {
  const [q, setQ] = useState(initial ?? "");
  const [cs, setCs] = useState(false);
  const [rx, setRx] = useState(false);
  const [includeRaw, setIncludeRaw] = useState(false);
  const dq = useDeferredValue(q);

  const { hits, error, truncated } = useMemo(() => {
    const out: Hit[] = [];
    if (dq.trim().length < 2) return { hits: out, error: null as string | null, truncated: false };
    let re: RegExp;
    try {
      re = new RegExp(rx ? dq : dq.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), cs ? "" : "i");
    } catch (e) {
      return { hits: out, error: (e as Error).message, truncated: false };
    }
    let truncated = false;
    outer: for (const e of pkg.elements) {
      const sources = e.scripts.map((s) => ({ label: s.label, code: s.code }));
      if (includeRaw) {
        for (const f of e.files) if (f.text) sources.push({ label: `raw: ${f.name}`, code: f.text });
      } else if (e.kind === "config") {
        sources.push(...e.attributes.map((a) => ({ label: `attribute ${a.name}`, code: `${a.name} = ${a.type === "SecureString" ? "••••" : a.value ?? ""}  ${a.description ?? ""}` })));
      }
      for (const s of sources) {
        const lines = s.code.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            out.push({ elId: e.id, elName: e.name, kind: e.kind, label: s.label, line: i + 1, text: lines[i] });
            if (out.length >= MAX_HITS) {
              truncated = true;
              break outer;
            }
          }
        }
      }
    }
    return { hits: out, error: null, truncated };
  }, [dq, cs, rx, includeRaw, pkg]);

  const grouped = useMemo(() => {
    const m = new Map<string, Hit[]>();
    for (const h of hits) {
      if (!m.has(h.elId)) m.set(h.elId, []);
      m.get(h.elId)!.push(h);
    }
    return [...m.entries()];
  }, [hits]);

  const hl = (t: string) => {
    let re: RegExp;
    try {
      re = new RegExp(rx ? dq : dq.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), cs ? "g" : "gi");
    } catch {
      return t;
    }
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(t)) && n++ < 20) {
      if (m[0] === "") { re.lastIndex++; continue; }
      parts.push(t.slice(last, m.index), <mark key={m.index}>{m[0]}</mark>);
      last = m.index + m[0].length;
    }
    parts.push(t.slice(last));
    return parts;
  };

  const suggestions = ["System.getModule", "Server.", "RESTHost", "System.log", "throw", "password", "handler("];

  return (
    <div className="stack">
      <header className="el-head">
        <div className="el-kind">Search</div>
        <h1>Search all scripts</h1>
      </header>
      <div className="search-bar">
        <input autoFocus className="input big" placeholder="Search workflow tasks, actions, text resources…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Match case</label>
        <label><input type="checkbox" checked={rx} onChange={(e) => setRx(e.target.checked)} /> Regex</label>
        <label><input type="checkbox" checked={includeRaw} onChange={(e) => setIncludeRaw(e.target.checked)} /> Include raw XML/JSON</label>
      </div>
      {!q && (
        <p className="small muted">
          Try:{" "}
          {suggestions.map((s) => (
            <button key={s} className="pill" onClick={() => setQ(s)}>{s}</button>
          ))}
        </p>
      )}
      {error && <div className="callout warn">Invalid regex: {error}</div>}
      {dq.trim().length >= 2 && !error && (
        <p className="small">
          {hits.length}{truncated ? "+" : ""} matching lines in {grouped.length} elements
        </p>
      )}
      {grouped.map(([id, hs]) => (
        <section key={id} className="card">
          <div className="card-head">
            <button className="link strong" onClick={() => onOpen(id, rx ? "" : dq)}>
              <KindIcon kind={hs[0].kind as never} /> {hs[0].elName}
            </button>
            <span className="muted small">{hs.length} matches</span>
          </div>
          <div className="hits">
            {hs.slice(0, 50).map((h, i) => (
              <button key={i} className="hit" onClick={() => onOpen(id, rx ? "" : dq)}>
                <span className="hit-label">{h.label}</span>
                <span className="hit-line">{h.line}</span>
                <code>{hl(h.text.trim().slice(0, 300))}</code>
              </button>
            ))}
            {hs.length > 50 && <p className="muted small">…and {hs.length - 50} more</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
