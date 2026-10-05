import type { PackageInfo, PkgElement } from "./types";
import { formatBytes, formatDuration, kindLabel } from "./parser";

/* Inventory exports (CSV and Markdown), shared by the Overview buttons and "Export everything". */

function csvCell(v: unknown) {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function elementSummary(e: PkgElement): string {
  switch (e.kind) {
    case "workflow": return `${e.inputs.length} in · ${e.outputs.length} out · ${e.items.filter((i) => i.type !== "end").length} steps`;
    case "action": return `(${e.params.map((p) => p.type).join(", ")}) → ${e.resultType ?? "void"}${e.runtime ? ` · ${e.runtime}` : ""}`;
    case "config": return `${e.attributes.length} attributes`;
    case "resource": return `${e.mimeType ?? "?"} · ${formatBytes(e.size)}`;
    case "environment": return `${e.runtime ?? ""} · ${Object.keys(e.dependencies).length} deps`;
    case "run": return `${e.globalState ?? "?"} · ${e.start && e.end ? formatDuration(e.end.getTime() - e.start.getTime()) : "–"}`;
    default: return e.type;
  }
}

export function inventoryCsv(pkg: PackageInfo): string {
  const summary = elementSummary;
    const head = ["Type", "Name", "Folder/Module", "Version", "ID", "Summary", "Description", "Uses", "Used by"];
    const lines = [head.join(",")].concat(
      pkg.elements.map((e) => {
        const uses = [...(pkg.refs.get(e.id.toLowerCase()) ?? [])].map((i) => pkg.byId.get(i)?.name).join("; ");
        const usedBy = [...(pkg.usedBy.get(e.id.toLowerCase()) ?? [])].map((i) => pkg.byId.get(i)?.name).join("; ");
        return [kindLabel(e.kind, e.type), e.name, e.path.join("/"), e.version, e.id, summary(e), e.description, uses, usedBy].map(csvCell).join(",");
      }),
    );
  return "\uFEFF" + lines.join("\r\n");
}

export function inventoryMarkdown(pkg: PackageInfo): string {
  const m = pkg.meta;
  const summary = elementSummary;
    const out: string[] = [`# ${m["pkg-name"] || pkg.fileName}`, "", `- vRO version: ${m["vso-version"] ?? "?"}`, `- Package ID: ${m["pkg-id"] ?? "?"}`, ""];
    const groups: [PkgElement["kind"], string][] = [["run", "Workflow runs"], ["workflow", "Workflows"], ["action", "Actions"], ["config", "Configuration Elements"], ["resource", "Resource Elements"], ["environment", "Environments"], ["generic", "Other"]];
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
  return out.join("\n");
}
