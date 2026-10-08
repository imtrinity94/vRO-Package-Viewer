import { useMemo, useState } from "react";
import type { PackageInfo, RunElement, RunValue, WorkflowElement } from "../lib/types";
import { formatDuration } from "../lib/parser";
import { FilesPanel, Header, RefsPanel, Tabs, tryPretty } from "./ElementView";
import { CodeBlock } from "./CodeBlock";
import { ValueView } from "./ValueView";
import { SchemaDiagram, type RunOverlay } from "./SchemaDiagram";
import { KindIcon } from "./Icons";

type Nav = (id: string) => void;

const STATE_CLASS: Record<string, string> = {
  completed: "ok",
  failed: "bad",
  canceled: "muted-chip",
  cancelled: "muted-chip",
  waiting: "warn",
  "waiting-signal": "warn",
  running: "accent",
  suspended: "warn",
};

export function StateChip({ state }: { state?: string }) {
  if (!state) return null;
  return <span className={`chip state ${STATE_CLASS[state] ?? ""}`}>{state}</span>;
}

function fmtDate(d?: Date) {
  if (!d) return "–";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Pull an element id out of a dunes:// reference so we can link to it. */
function refId(v?: string) {
  const m = v && /^dunes:\/\/service\.dunes\.ch\/[^?]+\?id='([^']*)'/.exec(v);
  return m ? m[1].toLowerCase() : undefined;
}

function isLongText(v?: string) {
  return !!v && (v.includes("\n") || v.length > 160);
}

function ValueCell({ v, pkg, onNav }: { v: RunValue; pkg: PackageInfo; onNav: Nav }) {
  const [copied, setCopied] = useState(false);
  if (v.value === undefined || v.value === "") return <span className="muted">empty</span>;
  if (v.value === "__NULL__") return <span className="muted">null</span>;
  if (v.type === "SecureString") return <span className="muted">•••••• (secure)</span>;
  const target = refId(v.value);
  const linked = target ? pkg.byId.get(target) : undefined;
  if (linked)
    return (
      <button className="link" onClick={() => onNav(linked.id)}>
        <KindIcon kind={linked.kind} /> {linked.name}
      </button>
    );
  if (isLongText(v.value) && v.type.toLowerCase() === "string")
    return (
      <div className="console-wrap">
        <button
          className="btn-ghost sm console-copy"
          onClick={() =>
            navigator.clipboard?.writeText(v.value!).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              },
              () => undefined,
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <pre className="console">{v.value.replace(/\s+$/, "")}</pre>
      </div>
    );
  if (v.type === "boolean") return <span className={`chip ${v.value === "true" ? "ok" : ""}`}>{v.value}</span>;
  return <ValueView value={v.value} />;
}

function ValueTable({ rows, pkg, onNav, empty }: { rows: (RunValue & { declared?: boolean })[]; pkg: PackageInfo; onNav: Nav; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="values">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Value at end of run</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.block}-${r.name}`}>
              <td className="mono strong nowrap">{r.name}</td>
              <td className="mono type nowrap">{r.type}</td>
              <td className="val">{r.declared === false ? <span className="muted">not recorded</span> : <ValueCell v={r} pkg={pkg} onNav={onNav} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExtensionView({ ext }: { ext: RunElement["extensions"][number] }) {
  // Best effort: an array of log-like objects becomes a log table.
  const arr = Array.isArray(ext.json)
    ? ext.json
    : ext.json && typeof ext.json === "object"
      ? (Object.values(ext.json as object).find((x) => Array.isArray(x)) as unknown[] | undefined)
      : undefined;
  const logs =
    arr && arr.length && typeof arr[0] === "object" && arr[0] !== null && Object.keys(arr[0] as object).some((k) => /message|msg|text/i.test(k))
      ? (arr as Record<string, unknown>[])
      : undefined;
  return (
    <section className="card">
      <h3>{ext.name}</h3>
      {logs ? (
        <div className="table-wrap">
          <table className="compact">
            <tbody>
              {logs.map((l, i) => {
                const msg = String(l.message ?? l.msg ?? l.text ?? "");
                const sev = String(l.severity ?? l.level ?? l.type ?? "");
                const ts = l.timestamp ?? l["time-stamp"] ?? l.time ?? l.date;
                return (
                  <tr key={i} className={`log log-${sev.toLowerCase()}`}>
                    <td className="mono small nowrap">{ts !== undefined ? fmtDate(new Date(typeof ts === "number" ? ts : String(ts))) : ""}</td>
                    <td className="mono small nowrap">{sev}</td>
                    <td className="mono small"><pre className="log-msg">{msg}</pre></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <CodeBlock code={ext.json !== undefined ? tryPretty(ext.text) : ext.text} lang={ext.json !== undefined ? "json" : "plaintext"} maxHeight={560} />
      )}
    </section>
  );
}

export function RunView({ el, pkg, onNav }: { el: RunElement; pkg: PackageInfo; onNav: Nav }) {
  type T = "values" | "execution" | "ext" | "refs" | "files";
  const [tab, setTab] = useState<T>("values");
  const wf = el.workflowId ? (pkg.byId.get(el.workflowId.toLowerCase()) as WorkflowElement | undefined) : undefined;
  const workflow = wf?.kind === "workflow" ? wf : undefined;
  const [sel, setSel] = useState<string | undefined>();

  const duration = el.start && el.end ? el.end.getTime() - el.start.getTime() : undefined;
  const m = el.profile?.metrics ?? {};
  const failed = el.globalState === "failed" || !!el.exception;

  // Split the token's values into the workflow's inputs / outputs / variables.
  const groups = useMemo(() => {
    const main = el.values.filter((v) => v.block === 0);
    const extra = el.values.filter((v) => v.block !== 0);
    if (!workflow) return { inputs: [], outputs: [], vars: main, extra, matched: false };
    const by = new Map(main.map((v) => [v.name, v]));
    const pick = (names: { name: string; type: string }[]) =>
      names.map((p) => {
        const v = by.get(p.name);
        by.delete(p.name);
        return v ? { ...v, declared: true } : { name: p.name, type: p.type, block: 0, declared: false };
      });
    const inputs = pick(workflow.inputs);
    const outputs = pick(workflow.outputs);
    const declaredVars = pick(workflow.attributes);
    const vars = [...declaredVars, ...by.values()];
    return { inputs, outputs, vars, extra, matched: true };
  }, [el, workflow]);

  const overlay: RunOverlay | undefined = useMemo(() => {
    if (!workflow) return undefined;
    const ran = new Map<string, { ms?: number; count?: number }>();
    for (const p of el.profile?.items ?? []) if (p.depth === 0) ran.set(p.id, { ms: p.totalTime, count: p.executions });
    const current = el.itemStack[0];
    if (current && !ran.has(current)) ran.set(current, {});
    // The start item always ran when anything did
    if (workflow.rootName && ran.size && !ran.has(workflow.rootName)) ran.set(workflow.rootName, {});
    return { ran, current, failed };
  }, [el, workflow, failed]);

  const steps = useMemo(() => {
    const total = Math.max(1, ...(el.profile?.items ?? []).map((p) => p.totalTime ?? 0));
    return (el.profile?.items ?? []).map((p) => {
      const it = workflow?.items.find((i) => i.name === p.id);
      return { ...p, label: it?.displayName || p.id, type: it?.type, share: (p.totalTime ?? 0) / total };
    });
  }, [el, workflow]);

  const traceId = el.tags.find((t) => t.name === "trace-id")?.value;
  const facts: [string, string][] = [
    ["Started", fmtDate(el.start)],
    ["Ended", fmtDate(el.end)],
    ["Duration", formatDuration(duration)],
  ];
  if (m.totalTime !== undefined) facts.push(["Engine time", formatDuration(m.totalTime)]);
  if (m.wait !== undefined) facts.push(["Waiting", formatDuration(m.wait)]);
  if (m.user !== undefined || m.system !== undefined) facts.push(["CPU (user + sys)", formatDuration((m.user ?? 0) + (m.system ?? 0))]);
  if (m.totalNumberOfTransitions !== undefined) facts.push(["Transitions", String(m.totalNumberOfTransitions)]);
  if (m.tokenSize !== undefined) facts.push(["Token size", `${m.tokenSize.toLocaleString()} B`]);

  return (
    <>
      <Header el={el}>
        <StateChip state={el.globalState} />
        {workflow ? (
          <button className="chip clickable" onClick={() => onNav(workflow.id)}>
            <KindIcon kind="workflow" /> {workflow.name}
          </button>
        ) : (
          el.workflowId && <span className="chip mono" title="Workflow not included in this package">workflow {el.workflowId}</span>
        )}
        {traceId && <span className="chip mono" title="trace-id">trace {traceId}</span>}
      </Header>

      <div className="facts">
        {facts.map(([k, v]) => (
          <div key={k} className="fact">
            <div className="fact-k">{k}</div>
            <div className="fact-v">{v}</div>
          </div>
        ))}
      </div>

      {el.exception && (
        <div className="callout bad">
          <strong>Run failed with an exception</strong>
          <pre className="console">{el.exception}</pre>
        </div>
      )}

      <Tabs<T>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "values", label: "Inputs & outputs", count: el.values.length },
          { id: "execution", label: "Execution", count: steps.length || undefined },
          ...(el.extensions.length ? [{ id: "ext" as T, label: "Logs & extensions", count: el.extensions.length }] : []),
          { id: "refs", label: "References" },
          { id: "files", label: "Raw", count: el.files.length },
        ]}
      />

      {tab === "values" && (
        <div className="stack">
          {groups.matched ? (
            <>
              <section className="card"><h3>Inputs <span className="count">{groups.inputs.length}</span></h3><ValueTable rows={groups.inputs} pkg={pkg} onNav={onNav} empty="The workflow has no inputs." /></section>
              <section className="card"><h3>Outputs <span className="count">{groups.outputs.length}</span></h3><ValueTable rows={groups.outputs} pkg={pkg} onNav={onNav} empty="The workflow has no outputs." /></section>
              {groups.vars.length > 0 && (
                <section className="card"><h3>Variables <span className="count">{groups.vars.length}</span></h3><ValueTable rows={groups.vars} pkg={pkg} onNav={onNav} empty="" /></section>
              )}
            </>
          ) : (
            <section className="card">
              <h3>Values <span className="count">{groups.vars.length}</span></h3>
              <p className="small muted">The workflow isn't in this package, so inputs and outputs can't be told apart.</p>
              <ValueTable rows={groups.vars} pkg={pkg} onNav={onNav} empty="No values recorded." />
            </section>
          )}
          {groups.extra.length > 0 && (
            <section className="card"><h3>Other recorded values <span className="count">{groups.extra.length}</span></h3><ValueTable rows={groups.extra} pkg={pkg} onNav={onNav} empty="" /></section>
          )}
        </div>
      )}

      {tab === "execution" && (
        <div className="stack">
          {workflow ? (
            <section className="card">
              <SchemaDiagram wf={workflow} run={overlay} selected={sel} onSelect={setSel} />
            </section>
          ) : (
            <p className="muted">The workflow isn't in this package, so its schema can't be drawn.</p>
          )}
          <section className="card">
            <h3>Time per step</h3>
            {steps.length ? (
              <div className="table-wrap">
                <table className="steps">
                  <thead>
                    <tr><th>Step</th><th>Type</th><th className="num">Total</th><th className="num">Max</th><th className="num">Runs</th><th className="bar-col"></th></tr>
                  </thead>
                  <tbody>
                    {steps.map((s, i) => (
                      <tr key={i} className={sel === s.id ? "on" : ""} onClick={() => setSel(s.id)}>
                        <td style={{ paddingLeft: 10 + s.depth * 16 }}><span className="strong">{s.label}</span> <span className="muted mono small">{s.id}</span></td>
                        <td className="small">{s.type ?? ""}</td>
                        <td className="num mono">{formatDuration(s.totalTime)}</td>
                        <td className="num mono">{formatDuration(s.maxTime)}</td>
                        <td className="num mono">{s.executions ?? ""}</td>
                        <td className="bar-col"><span className="bar" style={{ width: `${Math.max(2, s.share * 100)}%` }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No profiler data in this export.</p>
            )}
            <p className="small muted">
              Stopped at <code>{el.itemStack.join(" / ") || "–"}</code> ({el.currentItemState ?? "?"})
              {el.transitionType ? <>, transition <code>{el.transitionType}</code></> : null}.
              {el.workflowStack.length > 1 && <> Nested workflow stack: <code>{el.workflowStack.join(" → ")}</code>.</>}
            </p>
          </section>
        </div>
      )}

      {tab === "ext" && <div className="stack">{el.extensions.map((x) => <ExtensionView key={x.name} ext={x} />)}</div>}
      {tab === "refs" && <RefsPanel el={el} pkg={pkg} onNav={onNav} />}
      {tab === "files" && <FilesPanel el={el} />}
    </>
  );
}
