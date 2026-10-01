import type { WorkflowElement, WfItem } from "../lib/types";

const W = 150;
const H = 44;

type Edge = { from: string; to: string; kind: "out" | "alt" | "catch" | "switch" };

function nodeClass(it: WfItem) {
  switch (it.type) {
    case "end": return it.endMode === "1" ? "n-end n-throw" : "n-end";
    case "condition":
    case "custom-condition":
    case "switch": return "n-decision";
    case "link": return "n-link";
    case "input": return "n-input";
    case "waiting-event":
    case "waiting-timer": return "n-wait";
    case "foreach": return "n-loop";
    default: return it.runtime ? "n-poly" : "n-task";
  }
}

function typeLabel(it: WfItem) {
  if (it.type === "task" && it.scriptModule) return "action";
  if (it.type === "task" && it.runtime) return "polyglot task";
  if (it.type === "input") return "user interaction";
  if (it.type === "link") return "workflow";
  if (it.type === "condition" || it.type === "custom-condition") return "decision";
  return it.type;
}

export function SchemaDiagram({
  wf,
  selected,
  onSelect,
}: {
  wf: WorkflowElement;
  selected?: string;
  onSelect: (name: string) => void;
}) {
  const rawItems = wf.items.filter((i) => i.x !== undefined && i.y !== undefined);
  if (!rawItems.length) return <p className="muted">No schema layout information in this workflow.</p>;

  // vRO's canvas uses small icons; spread coordinates so our wider boxes don't overlap.
  let minDx = Infinity;
  let minDy = Infinity;
  for (let i = 0; i < rawItems.length; i++)
    for (let j = i + 1; j < rawItems.length; j++) {
      const dx = Math.abs(rawItems[i].x! - rawItems[j].x!);
      const dy = Math.abs(rawItems[i].y! - rawItems[j].y!);
      if (dy < H && dx > 1) minDx = Math.min(minDx, dx);
      if (dx < W && dy > 1) minDy = Math.min(minDy, dy);
    }
  const sx = minDx === Infinity ? 1 : Math.min(3, Math.max(1, (W + 24) / minDx));
  const sy = minDy === Infinity ? 1 : Math.min(3, Math.max(1, (H + 26) / minDy));
  const items = rawItems.map((i) => ({ ...i, x: i.x! * sx, y: i.y! * sy }));
  const start = wf.start ? { x: wf.start.x * sx, y: wf.start.y * sy } : undefined;

  const byName = new Map(items.map((i) => [i.name, i]));
  const edges: Edge[] = [];
  for (const it of items) {
    if (it.outName && byName.has(it.outName)) edges.push({ from: it.name, to: it.outName, kind: "out" });
    if (it.altOutName && byName.has(it.altOutName)) edges.push({ from: it.name, to: it.altOutName, kind: "alt" });
    if (it.catchName && byName.has(it.catchName)) edges.push({ from: it.name, to: it.catchName, kind: "catch" });
    for (const t of it.conditionTargets) if (byName.has(t)) edges.push({ from: it.name, to: t, kind: "switch" });
  }

  const xs = items.map((i) => i.x!).concat(start ? [start.x] : []);
  const ys = items.map((i) => i.y!).concat(start ? [start.y] : []);
  const minX = Math.min(...xs) - 30;
  const minY = Math.min(...ys) - 30;
  const maxX = Math.max(...xs) + W + 30;
  const maxY = Math.max(...ys) + H + 40;

  const center = (it: WfItem) => ({ x: it.x! + W / 2, y: it.y! + H / 2 });
  // Clip a line from center a->b to the border of box b
  const clip = (a: { x: number; y: number }, b: { x: number; y: number }, hw = W / 2, hh = H / 2) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx === 0 && dy === 0) return b;
    const s = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
    return { x: b.x + dx * Math.min(s, 1), y: b.y + dy * Math.min(s, 1) };
  };

  const root = wf.rootName ? byName.get(wf.rootName) : undefined;

  return (
    <div className="schema-wrap">
      <svg
        className="schema"
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        style={{ minWidth: Math.min(maxX - minX, 1400) }}
        role="img"
        aria-label={`Schema of workflow ${wf.name}`}
      >
        <defs>
          {(["out", "alt", "catch", "switch"] as const).map((k) => (
            <marker key={k} id={`arr-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`arrow-${k}`} />
            </marker>
          ))}
        </defs>

        {start && root && (() => {
          const s = { x: start.x + 20, y: start.y + H / 2 };
          const e = root.type === "end" ? clip(s, center(root), 16, 16) : clip(s, center(root));
          return (
            <g>
              <line x1={s.x + 12} y1={s.y} x2={e.x} y2={e.y} className="edge edge-out" markerEnd="url(#arr-out)" />
              <circle cx={s.x} cy={s.y} r={12} className="n-start" />
              <text x={s.x} y={s.y + 28} className="n-sub" textAnchor="middle">start</text>
            </g>
          );
        })()}

        {edges.map((e, i) => {
          const a = center(byName.get(e.from)!);
          const bIt = byName.get(e.to)!;
          const b = center(bIt);
          const aIt = byName.get(e.from)!;
          const s = aIt.type === "end" ? clip(b, a, 16, 16) : clip(b, a);
          const t = bIt.type === "end" ? clip(a, b, 16, 16) : clip(a, b);
          return (
            <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} className={`edge edge-${e.kind}`} markerEnd={`url(#arr-${e.kind})`} />
          );
        })}

        {items.map((it) => {
          const label = it.displayName || it.name;
          const short = label.length > 21 ? label.slice(0, 20) + "…" : label;
          return (
            <g
              key={it.name}
              className={`node ${nodeClass(it)} ${selected === it.name ? "sel" : ""}`}
              transform={`translate(${it.x},${it.y})`}
              onClick={() => onSelect(it.name)}
              tabIndex={0}
              onKeyDown={(ev) => ev.key === "Enter" && onSelect(it.name)}
            >
              <title>{`${label} — ${typeLabel(it)} (${it.name})`}</title>
              {it.type === "end" ? (
                <circle cx={W / 2} cy={H / 2} r={14} />
              ) : (
                <rect width={W} height={H} rx={it.type === "condition" || it.type === "custom-condition" || it.type === "switch" ? 20 : 7} />
              )}
              {it.type !== "end" && (
                <>
                  <text x={W / 2} y={18} textAnchor="middle" className="n-label">{short}</text>
                  <text x={W / 2} y={34} textAnchor="middle" className="n-sub">{typeLabel(it)}</text>
                </>
              )}
              {it.type === "end" && (
                <text x={W / 2} y={H / 2 + 30} textAnchor="middle" className="n-sub">{it.endMode === "1" ? "throw" : "end"}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><i className="lg lg-out" /> next</span>
        <span><i className="lg lg-alt" /> false / alternative</span>
        <span><i className="lg lg-catch" /> error handler</span>
        <span className="muted">Click a box to jump to its details.</span>
      </div>
    </div>
  );
}
