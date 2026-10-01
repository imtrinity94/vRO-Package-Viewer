import { CodeBlock } from "./CodeBlock";
import { KindIcon } from "./Icons";
import type { PkgElement } from "../lib/types";

const REPO = "https://github.com/imtrinity94/vRO-Package-Viewer";

/** Example contents that peek out of the box. Purely illustrative. */
const SLIPS: { kind: PkgElement["kind"]; type: string; name: string }[] = [
  { kind: "workflow", type: "Workflow", name: "Provision VM with tags" },
  { kind: "action", type: "Action", name: "getVmGuestFamily" },
  { kind: "config", type: "Configuration", name: "Environment settings" },
  { kind: "resource", type: "Resource", name: "cloud-init.yaml" },
  { kind: "run", type: "Workflow run", name: "completed in 7.0 s" },
];

const SNIPPET = `var vm = System.getModule("com.acme.vcenter").getVmByName(vmName);
var family = System.getModule("com.acme.vcenter.guest").getVmGuestFamily(vm);
System.log("Guest family: " + family);
if (family === "windowsGuest") {
    scriptType = "powershell";
}`;

function PeekBox() {
  return (
    <div className="pb-frame" aria-hidden>
      <div className="pb-stage">
        <svg className="pb-eye" viewBox="12 17 24 18" width="120" height="90">
          <path d="M13 27.5 Q24 17 35 27.5 Q24 35 13 27.5z" fill="var(--brand-amber)" />
          <circle cx="25" cy="27" r="4.2" fill="var(--brand-ink)" />
          <circle cx="26.6" cy="25.6" r="1.2" fill="#fff" />
        </svg>
        <div className="pb-slips">
          {SLIPS.map((s, i) => (
            <div key={s.name} className={`pb-slip pb-slip-${i}`}>
              <KindIcon kind={s.kind} size={16} />
              <span className="pb-slip-type">{s.type}</span>
              <span className="pb-slip-name">{s.name}</span>
            </div>
          ))}
        </div>
        <div className="pb-body">
          <span className="pb-tape" />
          <span className="pb-label">.package</span>
        </div>
        <div className="pb-lid" />
      </div>
    </div>
  );
}

function MiniSchema() {
  return (
    <svg className="schema mini-schema" viewBox="0 0 520 120" role="img" aria-label="Example workflow schema: start, a script task, a decision, and two ends">
      <defs>
        <marker id="mini-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrow-ran" />
        </marker>
        <marker id="mini-arr-alt" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrow-alt" />
        </marker>
      </defs>
      <line x1="42" y1="46" x2="86" y2="46" className="edge edge-ran" markerEnd="url(#mini-arr)" />
      <line x1="226" y1="46" x2="270" y2="46" className="edge edge-ran" markerEnd="url(#mini-arr)" />
      <line x1="390" y1="46" x2="456" y2="46" className="edge edge-ran" markerEnd="url(#mini-arr)" />
      <line x1="330" y1="68" x2="330" y2="96" className="edge edge-alt" markerEnd="url(#mini-arr-alt)" />
      <circle cx="28" cy="46" r="12" className="n-start" />
      <g className="node n-poly run-ok" transform="translate(88,24)">
        <rect width="136" height="44" rx="7" />
        <text x="68" y="19" textAnchor="middle" className="n-label">Run guest script</text>
        <text x="68" y="35" textAnchor="middle" className="n-sub n-time">5.96 s</text>
      </g>
      <g className="node n-decision run-ok" transform="translate(272,24)">
        <rect width="116" height="44" rx="20" />
        <text x="58" y="19" textAnchor="middle" className="n-label">Exit code 0?</text>
        <text x="58" y="35" textAnchor="middle" className="n-sub">decision</text>
      </g>
      <g className="node n-end run-ok" transform="translate(456,24)">
        <circle cx="16" cy="22" r="13" />
      </g>
      <g className="node n-end n-throw run-skip" transform="translate(314,92)">
        <circle cx="16" cy="12" r="10" />
      </g>
    </svg>
  );
}

function FlowSteps() {
  const steps = [
    { title: "Export from Orchestrator", body: "Export a package from the client, or a workflow run from its run history." },
    { title: "Drop it here", body: "The .package is unzipped and read right in this tab." },
    { title: "Browse and share", body: "Read every script, search across them, and export the inventory to CSV or Markdown." },
  ];
  return (
    <ol className="flow">
      <li className="flow-start" aria-hidden />
      {steps.map((s) => (
        <li key={s.title} className="flow-step">
          <strong>{s.title}</strong>
          <span>{s.body}</span>
        </li>
      ))}
      <li className="flow-end" aria-hidden />
    </ol>
  );
}

export function Landing({ onPick, busy, error, dragging }: { onPick: () => void; busy: boolean; error: string | null; dragging: boolean }) {
  return (
    <main className={`lp ${dragging ? "lp-dragging" : ""}`}>
      <section className="lp-hero">
        <div className="lp-copy">
          <h1 className="lp-title">
            Your <code>.package</code> files, opened up. No Orchestrator needed.
          </h1>
          <p className="lp-lede">
            Drop a package exported from vRealize Orchestrator 7.x, Aria Automation Orchestrator 8.x or VCF Operations Orchestrator 9.x. Its workflows, actions, configuration and resource elements, scripts and recorded runs open right here in your browser.
          </p>
          <div className="lp-cta">
            <button className="btn primary lp-btn" onClick={onPick} disabled={busy}>
              {busy ? "Reading package…" : "Choose a .package file"}
            </button>
            <span className="lp-hint">or drop it anywhere on this page</span>
          </div>
          {error && <div className="callout warn">{error}</div>}
          <p className="lp-trust">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Parsed in this tab. The package is never uploaded.
          </p>
        </div>
        <button className="lp-art" onClick={onPick} aria-label="Choose a .package file" disabled={busy}>
          <PeekBox />
        </button>
      </section>

      <section className="lp-show" aria-labelledby="lp-show-title">
        <h2 id="lp-show-title" className="lp-h2">What you'll see</h2>
        <div className="lp-show-grid">
          <figure className="lp-panel lp-panel-wide">
            <MiniSchema />
            <figcaption>
              <strong>Workflow schemas, drawn from the package.</strong> Bindings, inputs, outputs, input forms, and for recorded runs the path that actually ran, with timings.
            </figcaption>
          </figure>
          <figure className="lp-panel lp-panel-refs">
            <ul className="lp-refs">
              <li><KindIcon kind="workflow" /> Provision VM with tags <span className="muted">uses</span></li>
              <li className="lp-ref-in"><KindIcon kind="action" /> getVmGuestFamily</li>
              <li className="lp-ref-in"><KindIcon kind="config" /> Environment settings</li>
              <li className="lp-ref-in"><KindIcon kind="environment" /> Python 3.10 environment</li>
            </ul>
            <figcaption>
              <strong>What uses what.</strong> Actions, configuration elements and environments linked both ways.
            </figcaption>
          </figure>
          <figure className="lp-panel lp-panel-code">
            <CodeBlock code={SNIPPET} lang="javascript" title="Run guest script" highlightTerm="getModule" maxHeight={170} />
            <figcaption>
              <strong>Every script, searchable.</strong> JavaScript, Python and PowerShell, with search across the whole package.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="lp-how" aria-labelledby="lp-how-title">
        <h2 id="lp-how-title" className="lp-h2">How it works</h2>
        <FlowSteps />
      </section>

      <footer className="lp-foot">
        <span>
          vRO Peekage is an independent community tool and is not affiliated with or endorsed by Broadcom or VMware.
        </span>
        <a href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a>
      </footer>
    </main>
  );
}
