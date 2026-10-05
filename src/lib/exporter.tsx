import JSZip from "jszip";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ActionElement, PackageInfo, WfItem, WorkflowElement } from "./types";
import { decodeText, isTextMime, langForMime } from "./parser";
import { inventoryCsv, inventoryMarkdown } from "./inventory";
import { ReportDocument, langOf, maskedValue, runOverlay } from "../components/Report";
import { SchemaSvg, computeLayout, type RunOverlay } from "../components/SchemaDiagram";
import cityRegular from "@cds/city/Webfonts/WOFF2/ClarityCity-Regular.woff2?inline";
import cityBold from "@cds/city/Webfonts/WOFF2/ClarityCity-Bold.woff2?inline";

/*
 * "Export everything": builds one zip per package, entirely in the browser.
 *
 *   report.html            self-contained report (open offline, Save as PDF from the browser)
 *   inventory.csv / .md    element inventory
 *   diagrams/              every workflow schema (and run path) as SVG + PNG
 *   scripts/               every scriptable task and action as .js / .py / .ps1
 *   workflows-xml/         raw workflow XML (also opens in wdt4vro)
 *   configurations/        configuration elements as JSON (SecureStrings masked)
 *   resources/             resource element files as stored in the package
 *   environments/, runs/   environment definitions and recorded runs as JSON
 */

export type Progress = (done: number, total: number, label: string) => void;

const EXT: Record<string, string> = { javascript: "js", python: "py", powershell: "ps1" };
const FONT_CSS = `@font-face{font-family:"Clarity City";font-weight:400;src:url(${cityRegular}) format("woff2")}@font-face{font-family:"Clarity City";font-weight:700;src:url(${cityBold}) format("woff2")}`;

/** Render a React tree to static markup in the browser (no server renderer in the bundle). */
function renderStatic(node: ReactNode): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(node));
  const html = host.innerHTML;
  root.unmount();
  return html;
}

/** File-system safe name segment. */
export function safeName(s: string, max = 80): string {
  const out = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, max)
    .trim();
  return out || "unnamed";
}
const safePath = (parts: string[]) => parts.map((p) => safeName(p)).join("/");

/** Keeps generated paths unique inside the zip. */
function uniquePaths() {
  const seen = new Set<string>();
  return (path: string) => {
    let p = path;
    let n = 2;
    const dot = path.lastIndexOf(".");
    const [stem, ext] = dot > path.lastIndexOf("/") ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
    while (seen.has(p.toLowerCase())) p = `${stem} (${n++})${ext}`;
    seen.add(p.toLowerCase());
    return p;
  };
}

function schemaSvg(wf: WorkflowElement, run?: RunOverlay): { svg: string; width: number; height: number } | null {
  const layout = computeLayout(wf);
  if (!layout) return null;
  let svg = renderStatic(<SchemaSvg wf={wf} layout={layout} run={run} />);
  svg = svg
    .replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${Math.ceil(layout.width)}" height="${Math.ceil(layout.height)}"`)
    .replace(/^<svg([^>]*)>/, `<svg$1><style>${FONT_CSS}</style>`);
  return { svg, width: layout.width, height: layout.height };
}

function rasterize(svg: string, width: number, height: number, scale = 2): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => resolve(b), "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function comment(lang: string, lines: string[]): string {
  const c = lang === "javascript" ? "//" : "#";
  return lines.map((l) => `${c} ${l}`.trimEnd()).join("\n") + "\n\n";
}

function stepScriptFile(wf: WorkflowElement, it: WfItem, lang: string): string {
  const lines = [
    `Workflow: ${wf.name}${wf.path.length ? `  (${wf.path.join(" / ")})` : ""}`,
    `Step:     ${it.displayName || it.name}  [${it.name}, ${it.type}${it.runtime ? `, ${it.runtime}` : ""}]`,
    ...it.inBindings.map((b) => `in:       ${b.name} (${b.type}) <- ${b.exportName ?? "not bound"}`),
    ...it.outBindings.map((b) => `out:      ${b.name} (${b.type}) -> ${b.exportName ?? "not bound"}`),
    "Exported by vRO Peekage",
  ];
  return comment(lang, lines) + it.script!.replace(/^\n+/, "");
}

function actionFile(a: ActionElement, lang: string): string {
  if (lang === "javascript") {
    const doc = [
      "/**",
      ` * Action: ${a.module}/${a.name}${a.version ? `  v${a.version}` : ""}`,
      ...(a.description ? a.description.split("\n").map((l) => ` * ${l}`) : []),
      ...a.params.map((p) => ` * @param {${p.type}} ${p.name}${p.description ? ` - ${p.description.replace(/\s*\n\s*/g, " ")}` : ""}`),
      ` * @returns {${a.resultType ?? "void"}}`,
      " * Exported by vRO Peekage",
      " */",
    ];
    return doc.join("\n") + "\n" + a.script.replace(/^\n+/, "");
  }
  const lines = [
    `Action: ${a.module}/${a.name}${a.version ? `  v${a.version}` : ""}  (${a.runtime ?? ""})`,
    ...a.params.map((p) => `param:  ${p.name} (${p.type})`),
    `returns: ${a.resultType ?? "void"}`,
    "Exported by vRO Peekage",
  ];
  return comment(lang, lines) + a.script.replace(/^\n+/, "");
}

const README = (pkgName: string, when: Date) => `vRO Peekage export: ${pkgName}
Generated ${when.toISOString()}

report.html           Full report. Open in any browser; use "Save as PDF / Print" for a PDF.
inventory.csv / .md   Every element with type, folder, version and summary.
diagrams/             Workflow schemas (and run execution paths) as SVG and PNG.
scripts/              Scriptable tasks (scripts/workflows/...) and actions (scripts/actions/...)
                      as .js / .py / .ps1 files, with bindings or parameters in a header comment.
workflows-xml/        Raw workflow XML, e.g. to open in wdt4vro.
configurations/       Configuration elements as JSON.
resources/            Resource element files exactly as stored in the package.
environments/         Polyglot environment definitions (dependencies, runtime). Bundles are not included.
runs/                 Recorded workflow runs (values and timings) as JSON.

SecureString values are never exported.
`;

export async function exportEverything(pkg: PackageInfo, progress: Progress = () => {}): Promise<{ blob: Blob; fileName: string }> {
  const zip = new JSZip();
  const unique = uniquePaths();
  const now = new Date();
  const pkgName = pkg.meta["pkg-name"] || pkg.fileName.replace(/\.package$/i, "");
  const workflows = pkg.elements.filter((e): e is WorkflowElement => e.kind === "workflow");
  const runs = pkg.elements.filter((e) => e.kind === "run");
  const total = workflows.length * 2 + runs.length + pkg.elements.length + 3;
  let done = 0;
  const tick = (label: string) => progress(++done, total, label);
  const yieldUi = () => new Promise((r) => setTimeout(r, 0));

  // Resources first: the report links to and previews them.
  const resourceFiles = new Map<string, string>();
  const resourcePreviews = new Map<string, { text: string; lang: string }>();
  for (const e of pkg.elements) {
    if (e.kind === "resource") {
      const bytes = await e.getBytes();
      const path = unique(`resources/${e.path.length ? safePath(e.path) + "/" : ""}${safeName(e.name, 120)}`);
      zip.file(path, bytes);
      resourceFiles.set(e.id, path);
      if (bytes.length < 200 * 1024 && isTextMime(e.mimeType, e.name))
        resourcePreviews.set(e.id, { text: decodeText(bytes), lang: langForMime(e.mimeType, e.name) });
    }
  }

  // Elements: scripts, XML, JSON
  for (const e of pkg.elements) {
    tick(`Exporting ${e.name}`);
    const folder = e.path.length ? safePath(e.path) + "/" : "";
    switch (e.kind) {
      case "workflow": {
        const base = `scripts/workflows/${folder}${safeName(e.name)}`;
        let n = 0;
        for (const it of e.items) {
          if (!it.script || !it.script.trim()) continue;
          const lang = it.runtime ? langOf(it.runtime) : "javascript";
          n++;
          zip.file(unique(`${base}/${String(n).padStart(2, "0")} ${safeName(it.displayName || it.name)}.${EXT[lang] ?? "txt"}`), stepScriptFile(e, it, lang));
        }
        if (e.raw) zip.file(unique(`workflows-xml/${folder}${safeName(e.name)}.xml`), e.raw);
        break;
      }
      case "action": {
        if (!e.script.trim()) break;
        const lang = langOf(e.runtime);
        zip.file(unique(`scripts/actions/${safeName(e.module)}/${safeName(e.name)}.${EXT[lang] ?? "txt"}`), actionFile(e, lang));
        break;
      }
      case "config":
        zip.file(
          unique(`configurations/${folder}${safeName(e.name)}.json`),
          JSON.stringify(
            {
              name: e.name, id: e.id, version: e.version, path: e.path.join("/"), description: e.description,
              attributes: e.attributes.map((a) => ({ name: a.name, type: a.type, value: maskedValue(a.type, a.value), description: a.description })),
            },
            null,
            2,
          ),
        );
        break;
      case "environment":
        zip.file(unique(`environments/${safeName(e.name)}.json`), JSON.stringify({ ...e.meta, bundle: e.hasBundle ? "not included in export" : undefined }, null, 2));
        break;
      case "run":
        zip.file(
          unique(`runs/${safeName(e.title)} ${e.id.slice(0, 8)}.json`),
          JSON.stringify(
            {
              title: e.title, id: e.id, workflowId: e.workflowId, state: e.globalState, start: e.start, end: e.end,
              exception: e.exception, tags: e.tags, metrics: e.profile?.metrics, steps: e.profile?.items,
              values: e.values.map((v) => ({ name: v.name, type: v.type, value: maskedValue(v.type, v.value) })),
            },
            null,
            2,
          ),
        );
        break;
    }
  }
  await yieldUi();

  // Diagrams
  const diagramFor = async (wf: WorkflowElement, path: string, run?: RunOverlay) => {
    const s = schemaSvg(wf, run);
    if (!s) return;
    zip.file(unique(`${path}.svg`), s.svg);
    const png = await rasterize(s.svg, s.width, s.height);
    if (png) zip.file(unique(`${path}.png`), png);
  };
  for (const wf of workflows) {
    tick(`Drawing ${wf.name}`);
    await diagramFor(wf, `diagrams/${wf.path.length ? safePath(wf.path) + "/" : ""}${safeName(wf.name)}`);
    tick(`Drawing ${wf.name}`);
  }
  for (const r of runs) {
    if (r.kind !== "run") continue;
    tick(`Drawing run ${r.title}`);
    const wf = r.workflowId ? pkg.byId.get(r.workflowId.toLowerCase()) : undefined;
    if (wf?.kind === "workflow") await diagramFor(wf, `diagrams/runs/${safeName(r.title)} ${r.id.slice(0, 8)}`, runOverlay(r));
  }

  // Inventory + report
  tick("Writing inventory");
  zip.file("inventory.csv", inventoryCsv(pkg));
  zip.file("inventory.md", inventoryMarkdown(pkg));
  tick("Writing report");
  await yieldUi();
  const body = renderStatic(<ReportDocument pkg={pkg} generatedAt={now} resourceFiles={resourceFiles} resourcePreviews={resourcePreviews} />);
  zip.file("report.html", reportHtml(pkgName, body));
  zip.file("README.txt", README(pkgName, now));

  tick("Compressing");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { blob, fileName: `${safeName(pkgName)} - vRO Peekage export.zip` };
}

/* ------------------------------ report document ------------------------------ */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function reportHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="vRO Peekage">
<title>${esc(title)} · vRO Peekage report</title>
<style>${FONT_CSS}${REPORT_CSS}</style>
</head>
<body>
${body}
<script>document.querySelector('[data-action="print"]').addEventListener("click",function(){window.print()});</script>
</body>
</html>
`;
}

const REPORT_CSS = `
:root{--ink:#1b2a32;--muted:#5b6b75;--line:#dde3e7;--soft:#f3f6f8;--navy:#0d233a;--blue:#0072a3;--purple:#6d3fc0}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--ink);font:14px/1.55 "Clarity City",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.report{max-width:1100px;margin:0 auto;padding:0 32px 48px}
a{color:var(--blue)}
.mono,code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.muted{color:var(--muted)}.strong{font-weight:700}.type{color:var(--purple)}.wrap{white-space:pre-wrap;word-break:break-word}
.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;margin:0 -32px;padding:10px 32px;background:var(--navy);color:#fff}
.toolbar button{font:inherit;color:#fff;background:transparent;border:1px solid rgba(255,255,255,.35);border-radius:8px;padding:6px 14px;cursor:pointer}
.toolbar button:hover{background:rgba(255,255,255,.1)}
.cover{padding:40px 0 16px;border-bottom:3px solid var(--navy)}
.cover h1{font-size:32px;line-height:1.15;margin:4px 0 18px;overflow-wrap:anywhere}
.kind{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.crumbs{text-transform:none;letter-spacing:0;font-weight:400}
.kv{display:grid;grid-template-columns:150px 1fr;gap:4px 16px;margin:0}.kv dt{color:var(--muted)}.kv dd{margin:0;overflow-wrap:anywhere}
.toc{padding:16px 0;border-bottom:1px solid var(--line)}.toc h3{font-size:15px;margin:14px 0 4px}.toc ol{margin:0;padding-left:22px;columns:2;column-gap:32px}.toc li{break-inside:avoid}
h2{font-size:24px;margin:28px 0 6px}h3{font-size:16px;margin:22px 0 8px}h4{font-size:14px;margin:16px 0 6px}
.group-title{margin-top:44px;padding-bottom:6px;border-bottom:3px solid var(--navy)}
.element{padding:8px 0 24px;border-bottom:1px solid var(--line)}
.element,.group,.toc,[id]{scroll-margin-top:64px}
.el-head h2{margin:2px 0 4px;overflow-wrap:anywhere}.meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--muted);margin:0}.desc-block{white-space:pre-wrap;color:var(--muted)}
.state{font-weight:700;text-transform:capitalize}.state-completed{color:#2e7d32}.state-failed{color:#c92100}
table{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:13px}th{text-align:left;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line);padding:5px 8px}td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
table.compact td{padding:3px 8px;font-size:12px}
td.desc{color:var(--muted);white-space:pre-wrap}
.signature{background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow-x:auto}
.schema{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:#fafcfd}.schema svg{display:block}
figure.code{margin:8px 0 14px;border:1px solid var(--line);border-radius:8px;overflow:hidden}
figure.code figcaption{font-size:12.5px;font-weight:700;padding:6px 12px;background:var(--soft);border-bottom:1px solid var(--line)}
pre.hljs,pre.plain{margin:0;padding:10px 12px;background:#fbfcfd;overflow-x:auto;line-height:1.5;tab-size:4}
pre.plain{background:var(--soft);border-radius:6px;white-space:pre-wrap}
.hljs-keyword,.hljs-built_in,.hljs-literal{color:#7c3aed}.hljs-string,.hljs-regexp{color:#0f7b3f}.hljs-number{color:#b45309}.hljs-comment,.hljs-meta{color:#8a94a6;font-style:italic}.hljs-title,.hljs-title.function_{color:#1d4ed8}.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-property{color:#b42318}
.refs p{margin:4px 0;font-size:13px}.back{font-size:12px;margin:10px 0 0}
.foot{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
@media (max-width:700px){.report{padding:0 16px 32px}.toolbar{margin:0 -16px;padding:10px 16px}.kv{grid-template-columns:1fr}.toc ol{columns:1}}
@media print{
  @page{margin:14mm 12mm}
  .no-print{display:none!important}
  body{font-size:11.5px}
  .report{max-width:none;padding:0}
  .group-title{break-before:page}
  .element{break-inside:auto}
  h2,h3,h4{break-after:avoid}
  table,figure.code,.schema{break-inside:auto}
  tr{break-inside:avoid}
  pre.hljs,pre.plain{white-space:pre-wrap;word-break:break-word;overflow:visible}
  .schema{overflow:visible;border:0}.schema svg{max-width:100%;height:auto}
  a{color:inherit;text-decoration:none}
}
`;

