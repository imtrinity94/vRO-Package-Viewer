import { useMemo, useState } from "react";
import type { PackageInfo, PkgElement } from "../lib/types";
import { formatBytes, formatDuration, kindLabel } from "../lib/parser";
import { KindIcon } from "./Icons";
import { StateChip } from "./RunView";
import type { ExportState } from "../App";
import { elementSummary as summary, inventoryCsv, inventoryMarkdown } from "../lib/inventory";

function dl(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

type SortKey = "kind" | "name" | "path" | "version";

export function Overview({
  pkg,
  onNav,
  onExport,
  exporting,
}: {
  pkg: PackageInfo;
  onNav: (id: string) => void;
  onExport: () => void;
  exporting: ExportState | null;
}) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "kind", dir: 1 });
  const m = pkg.meta;
  const runs = pkg.elements.filter((e) => e.kind === "run");
  const counts = pkg.elements.reduce<Record<string, number>>((a, e) => ((a[e.kind] = (a[e.kind] ?? 0) + 1), a), {});
  const loc = useMemo(() => {
    const byLang: Record<string, number> = {};
    for (const e of pkg.elements) {
      if (e.kind === "resource" || e.kind === "run") continue;
      for (const s of e.scripts) byLang[s.lang] = (byLang[s.lang] ?? 0) + s.code.split("\n").length;
    }
    return byLang;
  }, [pkg]);
  const rows = useMemo(() => {
    const order: PkgElement["kind"][] = ["run", "workflow", "action", "config", "resource", "environment", "generic"];
    const val = (e: PkgElement, k: SortKey) => (k === "kind" ? String(order.indexOf(e.kind)).padStart(2, "0") + e.name.toLowerCase() : k === "path" ? e.path.join("/").toLowerCase() : k === "version" ? e.version ?? "" : e.name.toLowerCase());
    return [...pkg.elements].sort((a, b) => (val(a, sort.k) < val(b, sort.k) ? -sort.dir : val(a, sort.k) > val(b, sort.k) ? sort.dir : 0));
  }, [pkg, sort]);

  const exportCsv = () => dl(`${m["pkg-name"] || "package"}-inventory.csv`, inventoryCsv(pkg), "text/csv");
  const exportMd = () => dl(`${m["pkg-name"] || "package"}.md`, inventoryMarkdown(pkg), "text/markdown");

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th>
      <button className="th-sort" onClick={() => setSort({ k, dir: sort.k === k ? (-sort.dir as 1 | -1) : 1 })}>
        {children} {sort.k === k ? (sort.dir === 1 ? "▲" : "▼") : ""}
      </button>
    </th>
  );

  return (
    <div className="stack">
      <header className="el-head">
        <div className="el-kind">Package</div>
        <h1>{m["pkg-name"] || pkg.fileName}</h1>
        <div className="chips">
          {m["vso-version"] && <span className="chip">vRO {m["vso-version"]}</span>}
          {runs.length > 0 && <span className="chip accent">run export</span>}
          {m["pkg-id"] && <span className="chip mono">{m["pkg-id"]}</span>}
          <span className="chip">{formatBytes(pkg.fileSize)}</span>
          {pkg.signed ? <span className="chip ok">signed</span> : <span className="chip warn">unsigned</span>}
        </div>
      </header>

      {pkg.warnings.length > 0 && (
        <div className="callout warn">
          {pkg.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {runs.length > 0 && (
        <section className="card run-card">
          <h3><KindIcon kind="run" size={16} /> {runs.length === 1 ? "This package contains a recorded workflow run" : `Recorded workflow runs`} <span className="count">{runs.length}</span></h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Status</th><th>Workflow</th><th>Started</th><th>Duration</th><th></th></tr></thead>
              <tbody>
                {runs.map((r) => r.kind === "run" && (
                  <tr key={r.id} className="clickable-row" onClick={() => onNav(r.id)}>
                    <td><StateChip state={r.globalState} /></td>
                    <td className="strong">{r.title}</td>
                    <td className="small nowrap">{r.start?.toLocaleString() ?? "–"}</td>
                    <td className="mono small">{r.start && r.end ? formatDuration(r.end.getTime() - r.start.getTime()) : "–"}</td>
                    <td><button className="link">Open run →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="tiles">
        {([
          ["workflow", "Workflows"],
          ["action", "Actions"],
          ["config", "Config elements"],
          ["resource", "Resource elements"],
          ["environment", "Environments"],
          ["run", "Workflow runs"],
          ["generic", "Other"],
        ] as const).filter(([k]) => counts[k] || k === "workflow" || k === "action").map(([k, label]) => (
          <div key={k} className="tile">
            <div className="tile-top"><KindIcon kind={k} size={16} /> {label}</div>
            <div className="tile-num">{counts[k] ?? 0}</div>
          </div>
        ))}
        <div className="tile">
          <div className="tile-top">Lines of script</div>
          <div className="tile-num">{Object.values(loc).reduce((a, b) => a + b, 0).toLocaleString()}</div>
          <div className="tile-sub">{Object.entries(loc).map(([l, n]) => `${l} ${n.toLocaleString()}`).join(" · ")}</div>
        </div>
      </div>

      <section className="card export-card">
        <div className="export-copy">
          <h3>Export everything</h3>
          <p className="small muted">
            One zip with a full report you can open offline or save as PDF, every workflow diagram as PNG and SVG, all scripts as
            .js / .py / .ps1 files, configuration elements, resource files and the inventory. SecureString values are never included.
          </p>
          {exporting?.running && (
            <div className="export-progress" role="status">
              <progress max={exporting.total} value={exporting.done} />
              <span className="small muted">{exporting.label}…</span>
            </div>
          )}
          {!exporting?.running && exporting?.label && !exporting.error && <p className="small export-ok" role="status">{exporting.label}</p>}
          {exporting?.error && <p className="small export-err" role="alert">{exporting.error}</p>}
        </div>
        <button className="btn primary" onClick={onExport} disabled={!!exporting?.running}>
          {exporting?.running ? "Exporting…" : "Download .zip"}
        </button>
      </section>

      <section className="card">
        <h3>Package metadata</h3>
        <dl className="kv">
          <dt>File</dt><dd className="mono">{pkg.fileName}</dd>
          {Object.entries(m).map(([k, v]) => (
            <FragmentKV key={k} k={k} v={v} />
          ))}
          <dt>Certificates</dt><dd className="mono small">{pkg.certificates.join(", ") || "—"}</dd>
        </dl>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Inventory</h3>
          <div className="spacer" />
          <button className="btn" onClick={exportCsv}>⬇ CSV</button>
          <button className="btn" onClick={exportMd}>⬇ Markdown</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <Th k="kind">Type</Th>
                <Th k="name">Name</Th>
                <Th k="path">Folder / module</Th>
                <Th k="version">Version</Th>
                <th>Summary</th>
                <th title="uses / used by">Refs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="clickable-row" onClick={() => onNav(e.id)}>
                  <td className="nowrap"><KindIcon kind={e.kind} /> {kindLabel(e.kind, e.type)}</td>
                  <td className="strong">{e.name}</td>
                  <td className="mono small">{e.path.join("/")}</td>
                  <td className="mono small">{e.version}</td>
                  <td className="small">{summary(e)}</td>
                  <td className="small nowrap">{pkg.refs.get(e.id.toLowerCase())?.size ?? 0} / {pkg.usedBy.get(e.id.toLowerCase())?.size ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const META_LABELS: Record<string, string> = {
  "pkg-name": "Name",
  "pkg-id": "Package ID",
  "vso-version": "Exported from vRO",
  "vso-build-nb": "Build",
  "pkg-signer": "Signer",
  "pkg-owner": "Owner",
  "used-plugins": "Used plug-ins",
  "pkg-description": "Description",
};

function FragmentKV({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{META_LABELS[k] ?? k}</dt>
      <dd className="mono small">{v || <span className="muted">—</span>}</dd>
    </>
  );
}
