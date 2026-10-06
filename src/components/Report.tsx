import type {
  ActionElement,
  Attrib,
  ConfigElement,
  EnvironmentElement,
  PackageInfo,
  Param,
  PkgElement,
  ResourceElement,
  RunElement,
  WfItem,
  WorkflowElement,
} from "../lib/types";
import { formatBytes, formatDuration, kindLabel, prettyValue } from "../lib/parser";
import { elementSummary } from "../lib/inventory";
import { highlightCode } from "./CodeBlock";
import { SchemaSvg, computeLayout, type RunOverlay } from "./SchemaDiagram";

/*
 * Static, self-contained report of a whole package. Rendered to an HTML string by the
 * exporter; no state, no handlers. Styling lives in REPORT_CSS (exporter).
 */

export const KIND_ORDER: PkgElement["kind"][] = ["workflow", "action", "config", "resource", "environment", "run", "generic"];
export const KIND_TITLE: Record<PkgElement["kind"], string> = {
  workflow: "Workflows",
  action: "Actions",
  config: "Configuration elements",
  resource: "Resource elements",
  environment: "Environments",
  run: "Workflow runs",
  generic: "Other elements",
};

export const anchor = (e: PkgElement) => `el-${e.id.toLowerCase()}`;

export function langOf(runtime?: string): string {
  const r = (runtime || "").toLowerCase();
  if (r.startsWith("python") || r.startsWith("environment:")) return "python";
  if (r.includes("powershell") || r.includes("powercli")) return "powershell";
  return "javascript";
}

export function maskedValue(type: string, value?: string): string {
  if (value === undefined || value === "") return "";
  if (value === "__NULL__") return "(null)";
  if (type === "SecureString") return "•••••• (secure, not exported)";
  return prettyValue(value) ?? "";
}

function Code({ code, lang, title }: { code: string; lang: string; title?: string }) {
  const trimmed = code.replace(/^\n+/, "").replace(/\s+$/, "");
  return (
    <figure className="code">
      {title && <figcaption>{title} <span className="muted">· {lang} · {trimmed.split("\n").length} lines</span></figcaption>}
      <pre className="hljs"><code dangerouslySetInnerHTML={{ __html: highlightCode(trimmed, lang) }} /></pre>
    </figure>
  );
}

function ParamTable({ rows, values, empty }: { rows: (Param | Attrib)[]; values?: boolean; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  const conf = rows.some((r) => (r as Attrib).confKey);
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          {values && <th>Value</th>}
          {conf && <th>Bound to config</th>}
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td className="mono strong">{r.name}</td>
            <td className="mono type">{r.type}</td>
            {values && <td className="mono wrap">{maskedValue(r.type, r.value)}</td>}
            {conf && <td className="mono">{(r as Attrib).confKey ?? ""}</td>}
            <td className="desc">{r.description ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Refs({ el, pkg }: { el: PkgElement; pkg: PackageInfo }) {
  const id = el.id.toLowerCase();
  const list = (ids?: Set<string>) =>
    [...(ids ?? [])].map((i) => pkg.byId.get(i)).filter(Boolean) as PkgElement[];
  const uses = list(pkg.refs.get(id));
  const usedBy = list(pkg.usedBy.get(id));
  if (!uses.length && !usedBy.length) return null;
  const links = (els: PkgElement[]) =>
    els.map((e, i) => (
      <span key={e.id}>
        {i > 0 && ", "}
        <a href={`#${anchor(e)}`}>{e.name}</a> <span className="muted">({kindLabel(e.kind, e.type)})</span>
      </span>
    ));
  return (
    <div className="refs">
      {uses.length > 0 && <p><strong>Uses:</strong> {links(uses)}</p>}
      {usedBy.length > 0 && <p><strong>Used by:</strong> {links(usedBy)}</p>}
    </div>
  );
}

function Head({ el, children }: { el: PkgElement; children?: React.ReactNode }) {
  return (
    <header className="el-head">
      <div className="kind">{kindLabel(el.kind, el.type)}{el.path.length > 0 && <span className="crumbs"> · {el.path.join(" / ")}</span>}</div>
      <h2>{el.name}</h2>
      <p className="meta">
        {el.version && <span>v{el.version}</span>}
        <span className="mono">{el.id}</span>
        {children}
      </p>
      {el.description && <p className="desc-block">{el.description}</p>}
    </header>
  );
}

function Schema({ wf, run }: { wf: WorkflowElement; run?: RunOverlay }) {
  const layout = computeLayout(wf);
  if (!layout) return <p className="muted">No schema layout information.</p>;
  return (
    <div className="schema">
      <SchemaSvg wf={wf} layout={layout} run={run} />
    </div>
  );
}

function Bindings({ it }: { it: WfItem }) {
  if (!it.inBindings.length && !it.outBindings.length) return null;
  return (
    <table className="compact">
      <tbody>
        {it.inBindings.map((b) => (
          <tr key={`in-${b.name}`}><td className="muted">in</td><td className="mono strong">{b.name}</td><td className="mono type">{b.type}</td><td className="mono">← {b.exportName ?? "not bound"}</td></tr>
        ))}
        {it.outBindings.map((b) => (
          <tr key={`out-${b.name}`}><td className="muted">out</td><td className="mono strong">{b.name}</td><td className="mono type">{b.type}</td><td className="mono">→ {b.exportName ?? "not bound"}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function WorkflowSection({ el, pkg }: { el: WorkflowElement; pkg: PackageInfo }) {
  const steps = el.items.filter((i) => i.type !== "end");
  const scripted = el.items.filter((i) => i.script && i.script.trim());
  const fieldRows: { form: string; id: string; label?: string; type?: string }[] = [];
  for (const f of el.inputForms) {
    const j = f.json as { schema?: Record<string, { label?: string; type?: { dataType?: string; isMultiple?: boolean } }> } | null;
    for (const [id, sc] of Object.entries(j?.schema ?? {}))
      fieldRows.push({ form: f.name === "input_form_" ? "Start form" : f.name.replace("input_form_", ""), id, label: sc.label, type: sc.type ? `${sc.type.dataType ?? ""}${sc.type.isMultiple ? "[]" : ""}` : undefined });
  }
  return (
    <>
      <Head el={el}>{el.apiVersion && <span>api {el.apiVersion}</span>}<span>{steps.length} steps</span></Head>
      <h3>Schema</h3>
      <Schema wf={el} />
      <h3>Inputs</h3>
      <ParamTable rows={el.inputs} empty="No inputs." />
      <h3>Outputs</h3>
      <ParamTable rows={el.outputs} empty="No outputs." />
      <h3>Variables</h3>
      <ParamTable rows={el.attributes} values empty="No variables." />
      {fieldRows.length > 0 && (
        <>
          <h3>Input form fields</h3>
          <table>
            <thead><tr><th>Form</th><th>Field</th><th>Label</th><th>Type</th></tr></thead>
            <tbody>{fieldRows.map((r, i) => <tr key={i}><td>{r.form}</td><td className="mono strong">{r.id}</td><td>{r.label ?? ""}</td><td className="mono type">{r.type ?? ""}</td></tr>)}</tbody>
          </table>
        </>
      )}
      <h3>Steps</h3>
      <table>
        <thead><tr><th>Item</th><th>Name</th><th>Type</th><th>Next</th><th>Calls</th></tr></thead>
        <tbody>
          {steps.map((it) => (
            <tr key={it.name}>
              <td className="mono">{it.name}</td>
              <td className="strong">{it.displayName ?? ""}</td>
              <td className="mono type">{it.type}{it.runtime ? ` (${it.runtime.startsWith("environment:") ? "polyglot" : it.runtime})` : ""}</td>
              <td className="mono">{[it.outName, it.altOutName && `alt ${it.altOutName}`, it.catchName && `catch ${it.catchName}`].filter(Boolean).join(", ")}</td>
              <td className="mono">{it.scriptModule ?? (it.linkedWorkflowId ? pkg.byId.get(it.linkedWorkflowId.toLowerCase())?.name ?? it.linkedWorkflowId : "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {scripted.length > 0 && <h3>Scripts</h3>}
      {scripted.map((it) => (
        <section key={it.name} className="step">
          <h4>{it.displayName || it.name} <span className="muted mono">{it.name} · {it.type}</span></h4>
          <Bindings it={it} />
          <Code code={it.script!} lang={it.runtime ? langOf(it.runtime) : "javascript"} />
        </section>
      ))}
      <Refs el={el} pkg={pkg} />
    </>
  );
}

function ActionSection({ el, pkg }: { el: ActionElement; pkg: PackageInfo }) {
  return (
    <>
      <Head el={el}><span>{el.runtime ? `runtime ${el.runtime}` : "JavaScript"}</span>{el.hasBundle && <span>has bundle</span>}</Head>
      <p className="signature mono">
        {el.module}/<strong>{el.name}</strong>({el.params.map((p) => `${p.name}: ${p.type}`).join(", ")}) : {el.resultType ?? "void"}
      </p>
      <h3>Parameters</h3>
      <ParamTable rows={el.params} empty="No parameters." />
      {el.script.trim() ? <Code code={el.script} lang={langOf(el.runtime)} title="Script" /> : <p className="muted">No inline script.</p>}
      <Refs el={el} pkg={pkg} />
    </>
  );
}

function ConfigSection({ el, pkg }: { el: ConfigElement; pkg: PackageInfo }) {
  return (
    <>
      <Head el={el}><span>{el.attributes.length} attributes</span></Head>
      <ParamTable rows={el.attributes} values empty="No attributes." />
      <Refs el={el} pkg={pkg} />
    </>
  );
}

function ResourceSection({ el, pkg, file, preview }: { el: ResourceElement; pkg: PackageInfo; file?: string; preview?: { text: string; lang: string } }) {
  return (
    <>
      <Head el={el}><span>{el.mimeType ?? "unknown type"}</span><span>{formatBytes(el.size)}</span></Head>
      {file && <p>Saved in this export as <a className="mono" href={file}>{file}</a>.</p>}
      {preview && <Code code={preview.text} lang={preview.lang} title="Content" />}
      <Refs el={el} pkg={pkg} />
    </>
  );
}

function EnvironmentSection({ el, pkg }: { el: EnvironmentElement; pkg: PackageInfo }) {
  const deps = Object.entries(el.dependencies);
  const vars = Object.entries(el.environmentVariables);
  return (
    <>
      <Head el={el}>{el.runtime && <span>{el.runtime}</span>}</Head>
      <h3>Dependencies</h3>
      {deps.length ? (
        <table><thead><tr><th>Package</th><th>Version</th></tr></thead><tbody>{deps.map(([k, v]) => <tr key={k}><td className="mono strong">{k}</td><td className="mono">{v}</td></tr>)}</tbody></table>
      ) : <p className="muted">None.</p>}
      {vars.length > 0 && (
        <>
          <h3>Environment variables</h3>
          <table><tbody>{vars.map(([k, v]) => <tr key={k}><td className="mono strong">{k}</td><td className="mono">{String(v)}</td></tr>)}</tbody></table>
        </>
      )}
      <p className="muted">The environment's code bundle is not included in this export.</p>
      <Refs el={el} pkg={pkg} />
    </>
  );
}

export function runOverlay(run: RunElement): RunOverlay {
  const ran = new Map<string, { ms?: number; count?: number }>();
  for (const p of run.profile?.items ?? []) if (p.depth === 0) ran.set(p.id, { ms: p.totalTime, count: p.executions });
  const current = run.itemStack[0];
  if (current && !ran.has(current)) ran.set(current, {});
  return { ran, current, failed: run.globalState === "failed" || !!run.exception };
}

function RunSection({ el, pkg }: { el: RunElement; pkg: PackageInfo }) {
  const wf = el.workflowId ? pkg.byId.get(el.workflowId.toLowerCase()) : undefined;
  const workflow = wf?.kind === "workflow" ? wf : undefined;
  const duration = el.start && el.end ? el.end.getTime() - el.start.getTime() : undefined;
  return (
    <>
      <Head el={el}>
        <span className={`state state-${el.globalState ?? "unknown"}`}>{el.globalState ?? "unknown state"}</span>
        <span>started {el.start?.toLocaleString() ?? "–"}</span>
        <span>duration {formatDuration(duration)}</span>
      </Head>
      {workflow && <p>Run of <a href={`#${anchor(workflow)}`}>{workflow.name}</a>.</p>}
      {el.exception && (
        <>
          <h3>Exception</h3>
          <pre className="plain">{el.exception}</pre>
        </>
      )}
      {workflow && (
        <>
          <h3>Execution path</h3>
          <Schema wf={workflow} run={runOverlay(el)} />
        </>
      )}
      <h3>Values at end of run</h3>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Value</th></tr></thead>
        <tbody>
          {el.values.map((v) => (
            <tr key={`${v.block}-${v.name}`}>
              <td className="mono strong">{v.name}</td>
              <td className="mono type">{v.type}</td>
              <td>{v.value && v.value.includes("\n") && v.type.toLowerCase() === "string" ? <pre className="plain">{v.value.replace(/\s+$/, "")}</pre> : <span className="mono wrap">{maskedValue(v.type, v.value)}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(el.profile?.items.length ?? 0) > 0 && (
        <>
          <h3>Time per step</h3>
          <table>
            <thead><tr><th>Step</th><th>Total</th><th>Max</th><th>Runs</th></tr></thead>
            <tbody>
              {el.profile!.items.map((p, i) => (
                <tr key={i}>
                  <td style={{ paddingLeft: 8 + p.depth * 16 }}>{workflow?.items.find((x) => x.name === p.id)?.displayName ?? p.id} <span className="muted mono">{p.id}</span></td>
                  <td className="mono">{formatDuration(p.totalTime)}</td>
                  <td className="mono">{formatDuration(p.maxTime)}</td>
                  <td className="mono">{p.executions ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <Refs el={el} pkg={pkg} />
    </>
  );
}

export function ReportDocument({
  pkg,
  generatedAt,
  resourceFiles,
  resourcePreviews,
}: {
  pkg: PackageInfo;
  generatedAt: Date;
  resourceFiles: Map<string, string>;
  resourcePreviews: Map<string, { text: string; lang: string }>;
}) {
  const m = pkg.meta;
  const title = m["pkg-name"] || pkg.fileName;
  const groups = KIND_ORDER.map((k) => ({ k, els: pkg.elements.filter((e) => e.kind === k) })).filter((g) => g.els.length);
  return (
    <div className="report">
      <div className="toolbar no-print">
        <span>{title} · package report</span>
        <button type="button" data-action="print">Save as PDF / Print</button>
      </div>
      <header className="cover">
        <p className="kind">vRO package report</p>
        <h1>{title}</h1>
        <dl className="kv">
          {m["pkg-description"] && <><dt>Description</dt><dd>{m["pkg-description"]}</dd></>}
          <dt>Exported from</dt><dd>vRO {m["vso-version"] ?? "unknown version"}</dd>
          {m["pkg-id"] && <><dt>Package ID</dt><dd className="mono">{m["pkg-id"]}</dd></>}
          <dt>Source file</dt><dd className="mono">{pkg.fileName} ({formatBytes(pkg.fileSize)})</dd>
          <dt>Signed</dt><dd>{pkg.signed ? "Yes" : "No"}</dd>
          <dt>Contents</dt><dd>{groups.map((g) => `${g.els.length} ${KIND_TITLE[g.k].toLowerCase()}`).join(", ")}</dd>
          <dt>Generated</dt><dd>{generatedAt.toLocaleString()}</dd>
        </dl>
      </header>

      <nav className="toc" id="top" aria-label="Contents">
        <h2>Contents</h2>
        {groups.map((g) => (
          <div key={g.k}>
            <h3><a href={`#sec-${g.k}`}>{KIND_TITLE[g.k]}</a> <span className="muted">({g.els.length})</span></h3>
            <ol>
              {g.els.map((e) => (
                <li key={e.id}><a href={`#${anchor(e)}`}>{e.name}</a>{e.path.length > 0 && <span className="muted"> · {e.path.join(" / ")}</span>}</li>
              ))}
            </ol>
          </div>
        ))}
      </nav>

      <section className="inventory">
        <h2>Inventory</h2>
        <table>
          <thead><tr><th>Type</th><th>Name</th><th>Folder / module</th><th>Version</th><th>Summary</th></tr></thead>
          <tbody>
            {groups.flatMap((g) => g.els).map((e) => (
              <tr key={e.id}>
                <td>{kindLabel(e.kind, e.type)}</td>
                <td className="strong"><a href={`#${anchor(e)}`}>{e.name}</a></td>
                <td className="mono">{e.path.join("/")}</td>
                <td className="mono">{e.version ?? ""}</td>
                <td>{elementSummary(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {groups.map((g) => (
        <section key={g.k} id={`sec-${g.k}`} className="group">
          <h2 className="group-title">{KIND_TITLE[g.k]}</h2>
          {g.els.map((e) => (
            <article key={e.id} id={anchor(e)} className="element">
              {e.kind === "workflow" && <WorkflowSection el={e} pkg={pkg} />}
              {e.kind === "action" && <ActionSection el={e} pkg={pkg} />}
              {e.kind === "config" && <ConfigSection el={e} pkg={pkg} />}
              {e.kind === "resource" && <ResourceSection el={e} pkg={pkg} file={resourceFiles.get(e.id)} preview={resourcePreviews.get(e.id)} />}
              {e.kind === "environment" && <EnvironmentSection el={e} pkg={pkg} />}
              {e.kind === "run" && <RunSection el={e} pkg={pkg} />}
              {e.kind === "generic" && <><Head el={e} /><Refs el={e} pkg={pkg} /></>}
              <p className="back no-print"><a href="#top">Back to contents</a></p>
            </article>
          ))}
        </section>
      ))}

      <footer className="foot">
        Generated {generatedAt.toLocaleString()} from {pkg.fileName}. SecureString values are not included.
      </footer>
    </div>
  );
}
