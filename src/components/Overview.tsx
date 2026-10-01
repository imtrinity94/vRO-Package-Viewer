import { useMemo, useState } from "react";
import type { PackageInfo, PkgElement } from "../lib/types";
import { formatBytes, kindLabel } from "../lib/parser";
import { KindIcon } from "./Icons";

function csvCell(v: unknown) {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dl(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function summary(e: PkgElement): string {
  switch (e.kind) {
    case "workflow": return `${e.inputs.length} in · ${e.outputs.length} out · ${e.items.filter((i) => i.type !== "end").length} steps`;
    case "action": return `(${e.params.map((p) => p.type).join(", ")}) → ${e.resultType ?? "void"}${e.runtime ? ` · ${e.runtime}` : ""}`;
    case "config": return `${e.attributes.length} attributes`;
    case "resource": return `${e.mimeType ?? "?"} · ${formatBytes(e.size)}`;
    case "environment": return `${e.runtime ?? ""} · ${Object.keys(e.dependencies).length} deps`;
    default: return e.type;
  }
}

type SortKey = "kind" | "name" | "path" | "version";

export function Overview({ pkg, onNav }: { pkg: PackageInfo; onNav: (id: string) => void }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "kind", dir: 1 });
  const m = pkg.meta;
  const counts = pkg.elements.reduce<Record<string, number>>((a, e) => ((a[e.kind] = (a[e.kind] ?? 0) + 1), a), {});
  const loc = useMemo(() => {
    const byLang: Record<string, number> = {};
    for (const e of pkg.elements) {
      if (e.kind === "resource") continue;
      for (const s of e.scripts) byLang[s.lang] = (byLang[s.lang] ?? 0) + s.code.split("\n").length;
    }
    return byLang;
  }, [pkg]);
  const rows = useMemo(() => {
    const order: PkgElement["kind"][] = ["workflow", "action", "config", "resource", "environment", "generic"];
    const val = (e: PkgElement, k: SortKey) => (k === "kind" ? String(order.indexOf(e.kind)).padStart(2, "0") + e.name.toLowerCase() : k === "path" ? e.path.join("/").toLowerCase() : k === "version" ? e.version ?? "" : e.name.toLowerCase());
    return [...pkg.elements].sort((a, b) => (val(a, sort.k) < val(b, sort.k) ? -sort.dir : val(a, sort.k) > val(b, sort.k) ? sort.dir : 0));
  }, [pkg, sort]);

  const exportCsv = () => {
    const head = ["Type", "Name", "Folder/Module", "Version", "ID", "Summary", "Description", "Uses", "Used by"];
    const lines = [head.join(",")].concat(
      pkg.elements.map((e) => {
        const uses = [...(pkg.refs.get(e.id.toLowerCase()) ?? [])].map((i) => pkg.byId.get(i)?.name).join("; ");
        const usedBy = [...(pkg.usedBy.get(e.id.toLowerCase()) ?? [])].map((i) => pkg.byId.get(i)?.name).join("; ");
        return [kindLabel(e.kind, e.type), e.name, e.path.join("/"), e.version, e.id, summary(e), e.description, uses, usedBy].map(csvCell).join(",");
      }),
    );
    dl(`${m["pkg-name"] || "package"}-inventory.csv`, "﻿" + lines.join("\r\n"), "text/csv");
  };
  const exportMd = () => {
    const out: string[] = [`# ${m["pkg-name"] || pkg.fileName}`, "", `- vRO version: ${m["vso-version"] ?? "?"}`, `- Package ID: ${m["pkg-id"] ?? "?"}`, ""];
    const groups: [PkgElement["kind"], string][] = [["workflow", "Workflows"], ["action", "Actions"], ["config", "Configuration Elements"], ["resource", "Resource Elements"], ["environment", "Environments"], ["generic", "Other"]];
    for (const [k, label] of groups) {
      const els = pkg.elements.filter((e) => e.kind === k);
      if (!els.length) continue;
      out.push(`## ${label} (${els.length})`, "", "| Name | Folder / Module | Version | Summary | Description |", "|---|---|---|---|---|");
      for (const e of els) out.push(`| ${e.name} | ${e.path.join("/")} | ${e.version ?? ""} | ${summary(e)} | ${(e.description ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|")} |`);
      out.push("");
      if (k === "workflow") {
        for (const e of els) {
          if (e.kind !== "workflow") continue;
          out.push(`### ${e.name}`, "");
          if (e.description) out.push(e.description, "");
          if (e.inputs.length) {
            out.push("| Input | Type | Description |", "|---|---|---|");
            for (const p of e.inputs) out.push(`| ${p.name} | ${p.type} | ${(p.description ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|")} |`);
            out.push("");
          }
        }
      }
      if (k === "config") {
        for (const e of els) {
          if (e.kind !== "config") continue;
          out.push(`### ${e.name}`, "", "| Attribute | Type | Description |", "|---|---|---|");
          for (const a of e.attributes) out.push(`| ${a.name} | ${a.type} | ${(a.description ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|")} |`);
          out.push("");
        }
      }
    }
    dl(`${m["pkg-name"] || "package"}.md`, out.join("\n"), "text/markdown");
  };

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

      <div className="tiles">
        {([
          ["workflow", "Workflows"],
          ["action", "Actions"],
          ["config", "Config elements"],
          ["resource", "Resource elements"],
          ["environment", "Environments"],
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
