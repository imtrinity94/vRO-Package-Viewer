import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowElement, WfItem } from "../lib/types";
import { formatDuration } from "../lib/parser";
import { VRO_ICONS } from "../lib/vroIcons";

/*
 * Workflow schema drawn the way the Orchestrator client draws it: every item sits at the
 * position saved in the workflow XML, 1:1, with the same per-type anchor offsets the client
 * uses (measured against the 8.x/9.x client). The Start node sits at the workflow's own saved
 * position. Labels are plain 12px text under the icon; Start and End have no label. Arrows are
 * thin straight lines from icon centre to icon centre, trimmed 40px at each end.
 * Icon set and colours come from wdt4vro (github.com/imtrinity94/wdt4vro).
 */

export interface RunOverlay {
  /** items that executed, with profiler timings when available */
  ran: Map<string, { ms?: number; count?: number }>;
  /** item the token stopped on */
  current?: string;
  failed?: boolean;
}

/** Width of the label column under an icon (Orchestrator wraps at roughly this). */
const LABEL_W = 116;
const ICON = 40;
const ICON_DECISION = 44;
/** Arrows stop this far from each icon centre. */
const TRIM = 40;
const MARGIN = 40;

/** Icon centre relative to the item's saved (x, y), per item type, as the Orchestrator client places them. */
function anchor(kind: string): { dx: number; dy: number } {
  if (kind === "start") return { dx: -10, dy: 38 };
  if (kind === "end") return { dx: -10, dy: 128 };
  if (DECISIONS.has(kind)) return { dx: 30, dy: 70 };
  return { dx: 30, dy: 48 };
}

const C = {
  canvas: "#fafcfd",
  dot: "#cbd4d8",
  text: "#21333b",
  muted: "#565656",
  blue: "#0079ad",
  green: "#2e8540",
  switchDefault: "#4CAF50",
  red: "#c92100",
  ran: "#2e8540",
  ranFill: "rgba(46, 133, 64, 0.10)",
  time: "#1d6b2f",
  failFill: "rgba(201, 33, 0, 0.10)",
  select: "rgba(0, 124, 187, 0.16)",
};

const iconUri = (name: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(VRO_ICONS[name] ?? VRO_ICONS.workflow)}`;

const DECISIONS = new Set(["condition", "decision", "custom-condition", "decision-activity"]);
const PROTOTYPE_ICONS = new Set([
  "change-credential", "sleep", "wait-until-date", "wait-custom-event", "send-custom-event",
  "increase-counter", "decrease-counter", "system-log", "system-warning", "system-error",
  "server-log", "server-warning", "server-error", "system-server-log", "system-server-warning",
  "system-server-error", "http-post", "http-get",
]);

/** Same icon rules as wdt4vro's getIconForNode. */
function iconFor(it: WfItem): string {
  const type = it.type;
  if (type === "end") return it.endMode === "1" ? "exception" : "end";
  if (type === "task" && it.launchedWorkflowId !== undefined && it.outBindings.some((b) => b.type === "WorkflowToken" && b.name === "wfToken"))
    return "workflow-async";
  const isTask = type === "task" || type === "scriptable-task";
  if (isTask && it.scriptModule !== undefined) return "action";
  if (isTask) {
    const sched = it.inBindings.some((b) => b.name === "workflowScheduleDate") && it.outBindings.some((b) => b.name === "scheduledTask");
    if (sched || (it.displayName ?? "").includes("Schedule")) return "workflow-schedule";
  }
  if (it.prototypeId && PROTOTYPE_ICONS.has(it.prototypeId)) return it.prototypeId;
  if (type === "task") return "scriptable-task";
  if (type === "link") return "workflow";
  if (type === "custom-condition") return "condition";
  return VRO_ICONS[type] ? type : "workflow";
}

function labelFor(it: WfItem): string {
  if (it.type === "end") return "";
  return it.displayName || it.name;
}

/** Wrap a label into at most 3 lines of ~19 characters (12px regular in a ~116px column). */
function wrap(text: string, max = 19, lines = 3): string[] {
  if (!text) return [];
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    let w = word;
    while (w.length > max) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(w.slice(0, max));
      w = w.slice(max);
    }
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = kept[lines - 1].slice(0, max - 1) + "…";
    return kept;
  }
  return out;
}

/** Label area under an icon, relative to the icon centre (estimated from the wrapped text). */
type LabelRect = { hw: number; top: number; bottom: number };
function labelRect(label: string, size = ICON): LabelRect | undefined {
  const lines = wrap(label);
  if (!lines.length) return undefined;
  const longest = Math.max(...lines.map((l) => l.length));
  return { hw: Math.min(LABEL_W, longest * 6.4) / 2, top: size / 2 + 4, bottom: size / 2 + 6 + lines.length * 15 };
}

/** How far along direction (ux, uy) a ray from the icon centre travels before leaving the label area. */
function exitLabel(ux: number, uy: number, r?: LabelRect): number {
  if (!r) return 0;
  let tmin = -Infinity, tmax = Infinity;
  const slab = (u: number, lo: number, hi: number) => {
    if (Math.abs(u) < 1e-9) {
      if (0 < lo || 0 > hi) { tmin = Infinity; }
      return;
    }
    const t1 = lo / u, t2 = hi / u;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  };
  slab(ux, -r.hw, r.hw);
  slab(uy, r.top, r.bottom);
  return tmax > Math.max(tmin, 0) ? tmax + 6 : 0;
}

/**
 * Straight line between two icon centres, trimmed so it floats between the icons like the client's:
 * 40px off each icon, or past the label when the line would otherwise run through it.
 */
function arrow(x1: number, y1: number, x2: number, y2: number, fromLabel?: LabelRect, toLabel?: LabelRect): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!len) return "";
  const ux = dx / len;
  const uy = dy / len;
  const t1 = Math.max(TRIM, exitLabel(ux, uy, fromLabel));
  const t2 = Math.max(TRIM, exitLabel(-ux, -uy, toLabel));
  if (len <= t1 + t2 + 8) {
    // icons very close together: keep a short visible stub in the middle
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return `M${(mx - ux * 4).toFixed(1)},${(my - uy * 4).toFixed(1)} L${(mx + ux * 4).toFixed(1)},${(my + uy * 4).toFixed(1)}`;
  }
  return `M${(x1 + ux * t1).toFixed(1)},${(y1 + uy * t1).toFixed(1)} L${(x2 - ux * t2).toFixed(1)},${(y2 - uy * t2).toFixed(1)}`;
}

type Box = { x: number; y: number };
type Edge = { from: string; to: string; color: string; marker: string; dash?: string; width: number };
type Extra = { key: string; label: string; icon: string; pos: Box; target?: string };

export type SchemaLayout = NonNullable<ReturnType<typeof computeLayout>>;

/** Centre-to-centre distance a label-carrying item needs above the next icon in its column. */
const STACK_GAP = 88;

/** Smallest vertical stretch (>= 1) that keeps stacked items from touching; 1 for typical layouts. */
function verticalStretch(items: WfItem[]): number {
  let f = 1;
  for (const a of items) {
    for (const b of items) {
      const dyRaw = b.y! - a.y!;
      if (dyRaw <= 0) continue;
      const aa = anchor(a.type), ab = anchor(b.type);
      if (Math.abs(b.x! + ab.dx - (a.x! + aa.dx)) >= LABEL_W) continue; // not in the same column
      const need = (STACK_GAP - (ab.dy - aa.dy)) / dyRaw;
      if (need > f) f = need;
    }
  }
  return Math.min(f, 2.5);
}

/** Pure layout computation (also used by the export). Positions are icon centres. */
export function computeLayout(wf: WorkflowElement) {
  const items = wf.items.filter((i) => i.x !== undefined && i.y !== undefined);
  if (!items.length) return null;
  const pos = new Map<string, Box>();
  // Horizontal positions are always 1:1. Vertically, items stacked in the same column can sit
  // closer than an icon plus its label; stretch the vertical axis just enough to clear them.
  const fy = verticalStretch(items);
  const minY0 = Math.min(...items.map((i) => i.y!));
  for (const it of items) {
    const a = anchor(it.type);
    pos.set(it.name, { x: it.x! + a.dx, y: minY0 + (it.y! - minY0) * fy + a.dy });
  }

  const extras: Extra[] = [];
  const root = wf.rootName ? pos.get(wf.rootName) : undefined;
  if (root) {
    const a = anchor("start");
    // the workflow's saved start position; older packages without one get the client's default spot
    const sp = wf.start ? { x: wf.start.x + a.dx, y: wf.start.y + a.dy } : { x: root.x - 80, y: root.y - 40 };
    extras.push({ key: "__start", label: "", icon: "start", pos: sp });
  }
  for (const t of wf.errorHandlers) {
    const p = pos.get(t);
    if (p) extras.push({ key: `__eh_${t}`, label: "Error handler", icon: "error-handler", pos: { x: p.x - 130, y: p.y }, target: t });
  }

  const edges: Edge[] = [];
  for (const it of items) {
    if (it.outName && pos.has(it.outName)) {
      const dec = DECISIONS.has(it.type);
      edges.push({ from: it.name, to: it.outName, color: it.type === "switch" ? C.switchDefault : dec ? C.green : C.blue, marker: dec || it.type === "switch" ? "green" : "blue", width: 1 });
    }
    if (it.altOutName && pos.has(it.altOutName)) edges.push({ from: it.name, to: it.altOutName, color: C.red, marker: "red", dash: "6,4", width: 1 });
    if (it.catchName && pos.has(it.catchName)) edges.push({ from: it.name, to: it.catchName, color: C.red, marker: "red", dash: "6,4", width: 1 });
    if (it.type === "switch") for (const t of it.conditionTargets) if (pos.has(t)) edges.push({ from: it.name, to: t, color: C.blue, marker: "blue", width: 1 });
  }

  // Shift everything so the drawing starts MARGIN from the top-left, keeping relative positions 1:1
  const all = [...pos.values(), ...extras.map((e) => e.pos)];
  const minX = Math.min(...all.map((p) => p.x)) - LABEL_W / 2;
  const minY = Math.min(...all.map((p) => p.y)) - ICON_DECISION / 2;
  for (const p of all) {
    p.x += MARGIN - minX;
    p.y += MARGIN - minY;
  }
  const width = Math.max(...all.map((p) => p.x)) + LABEL_W / 2 + MARGIN;
  const height = Math.max(...all.map((p) => p.y)) + ICON / 2 + 3 * 15 + MARGIN;
  return { items, pos, extras, edges, width, height };
}

function useLayout(wf: WorkflowElement) {
  return useMemo(() => computeLayout(wf), [wf]);
}

/**
 * The schema drawing itself. Used interactively by SchemaDiagram and, without onSelect,
 * to produce static SVG for exports.
 */
export function SchemaSvg({
  wf,
  layout,
  run,
  selected,
  onSelect,
  isDragging,
  svgRef,
  zoom = 1,
}: {
  wf: WorkflowElement;
  layout: SchemaLayout;
  run?: RunOverlay;
  selected?: string;
  onSelect?: (name: string) => void;
  isDragging?: () => boolean;
  svgRef?: React.Ref<SVGSVGElement>;
  zoom?: number;
}) {
  const { items, pos, extras, edges, width, height } = layout;
  const center = (p: Box) => p;
  const byName = new Map(items.map((i) => [i.name, i]));
  const lrect = (name: string) => {
    const it = byName.get(name);
    return it ? labelRect(labelFor(it), DECISIONS.has(it.type) ? ICON_DECISION : ICON) : undefined;
  };
  const ranEdge = (e: Edge) => !run || (run.ran.has(e.from) && run.ran.has(e.to));
  const FONT = "'Clarity City', 'Metropolis', Arial, sans-serif";

  const node = (key: string, label: string, icon: string, p: Box, it?: WfItem) => {
    const r = it && run?.ran.get(it.name);
    const skipped = !!(run && it && !r);
    const failedHere = !!(run && it && run.failed && run.current === it.name);
    const lines = wrap(label);
    const time = r?.ms !== undefined ? `${formatDuration(r.ms)}${r.count && r.count > 1 ? ` ×${r.count}` : ""}` : undefined;
    const isSel = it && selected === it.name;
    const size = it && DECISIONS.has(it.type) ? ICON_DECISION : ICON;
    const textTop = size / 2 + 16;
    // highlight box: icon plus its label (and timing) underneath
    const boxH = size / 2 + 12 + Math.max(1, lines.length) * 15 + (time ? 15 : 0) + 6;
    const box = { x: -LABEL_W / 2 - 4, y: -size / 2 - 8, w: LABEL_W + 8, h: boxH + size / 2 + 2 };
    return (
      <g
        key={key}
        transform={`translate(${p.x},${p.y})`}
        className={it ? "wf-node" : undefined}
        opacity={skipped ? 0.35 : 1}
        onClick={it && onSelect ? () => !isDragging?.() && onSelect(it.name) : undefined}
        onKeyDown={it && onSelect ? (e) => (e.key === "Enter" || e.key === " ") && onSelect(it.name) : undefined}
        tabIndex={it && onSelect ? 0 : undefined}
        role={it && onSelect ? "button" : undefined}
        aria-label={it ? `${label || it.type} (${it.type}${time ? `, ${time}` : ""})` : undefined}
      >
        {it && <title>{`${label || it.type} — ${it.type}${it.scriptModule ? ` · ${it.scriptModule}` : ""} (${it.name})${time ? ` — ${time}` : ""}`}</title>}
        {(r || failedHere) && <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8} fill={failedHere ? C.failFill : C.ranFill} stroke={failedHere ? C.red : C.ran} strokeWidth={1.2} />}
        {isSel && <rect data-ui x={box.x - 2} y={box.y - 2} width={box.w + 4} height={box.h + 4} rx={9} fill={C.select} stroke={C.blue} strokeWidth={1.5} />}
        {it && onSelect && <rect data-ui className="wf-hit" x={box.x} y={box.y} width={box.w} height={box.h} rx={8} fill="transparent" />}
        <image href={iconUri(icon)} x={-size / 2} y={-size / 2} width={size} height={size} />
        {lines.length > 0 && (
          <text x={0} y={textTop} textAnchor="middle" fontSize={12} fontWeight={500} fill={C.text} fontFamily={FONT}>
            {lines.map((l, i) => (
              <tspan key={i} x={0} dy={i === 0 ? 0 : 15}>{l}</tspan>
            ))}
          </text>
        )}
        {time && (
          <text x={0} y={textTop + Math.max(1, lines.length) * 15} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.time} fontFamily={FONT}>
            {time}
          </text>
        )}
      </g>
    );
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      ref={svgRef}
      width={width * zoom}
      height={height * zoom}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Schema of workflow ${wf.name}`}
      style={{ display: "block" }}
    >
      <defs>
        <pattern id="wf-dots" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="1.2" fill={C.dot} />
        </pattern>
        {([["blue", C.blue], ["green", C.green], ["red", C.red]] as const).map(([k, c]) => (
          <marker key={k} id={`wf-arr-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={c} />
          </marker>
        ))}
      </defs>
      <rect width={width} height={height} fill={C.canvas} />
      <rect width={width} height={height} fill="url(#wf-dots)" />

      {edges.map((e, i) => {
        const a = center(pos.get(e.from)!);
        const b = center(pos.get(e.to)!);
        const lit = run && ranEdge(e);
        return (
          <path
            key={i}
            d={arrow(a.x, a.y, b.x, b.y, lrect(e.from), lrect(e.to))}
            stroke={e.color}
            strokeWidth={lit ? e.width + 1.2 : e.width}
            strokeDasharray={e.dash}
            fill="none"
            opacity={run && !lit ? 0.3 : 1}
            markerEnd={`url(#wf-arr-${e.marker})`}
          />
        );
      })}
      {extras.map((x) => {
        const to = x.target ? pos.get(x.target) : wf.rootName ? pos.get(wf.rootName) : undefined;
        if (!to) return null;
        const a = center(x.pos);
        const b = center(to);
        return <path key={`a${x.key}`} d={arrow(a.x, a.y, b.x, b.y, labelRect(x.label), x.target ? lrect(x.target) : wf.rootName ? lrect(wf.rootName) : undefined)} stroke={C.blue} strokeWidth={run && !x.target ? 2.2 : 1} fill="none" markerEnd="url(#wf-arr-blue)" />;
      })}

      {extras.map((x) => node(x.key, x.label, x.icon, x.pos))}
      {items.map((it) => node(it.name, labelFor(it), iconFor(it), pos.get(it.name)!, it))}
    </svg>
  );
}

export function SchemaDiagram({
  wf,
  selected,
  onSelect,
  run,
}: {
  wf: WorkflowElement;
  selected?: string;
  onSelect: (name: string) => void;
  run?: RunOverlay;
}) {
  const layout = useLayout(wf);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [fitted, setFitted] = useState(false);
  const drag = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);

  // Start "fit to width" for wide workflows, 100% otherwise
  useLayoutEffect(() => {
    if (!layout || !viewRef.current || fitted) return;
    const avail = viewRef.current.clientWidth - 2;
    setZoom(Math.min(1, Math.max(0.6, Math.round((avail / layout.width) * 100) / 100)));
    setFitted(true);
  }, [layout, fitted]);
  useEffect(() => setFitted(false), [wf]);

  // Ctrl/Cmd + wheel zooms the diagram (needs a non-passive native listener to stop page zoom)
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z = zoomRef.current * (e.deltaY < 0 ? 1.1 : 0.9);
      setZoom(Math.min(2.5, Math.max(0.25, Math.round(z * 100) / 100)));
    };
    v.addEventListener("wheel", onWheel, { passive: false });
    return () => v.removeEventListener("wheel", onWheel);
  }, [layout]);

  if (!layout) return <p className="muted">No schema layout information in this workflow.</p>;
  const { width, height } = layout;

  const setZ = (z: number) => setZoom(Math.min(2.5, Math.max(0.25, Math.round(z * 100) / 100)));
  const fit = () => setZ((viewRef.current?.clientWidth ?? width) / width);
  const fileBase = (wf.name || "workflow").replace(/[^\w.-]+/g, "_");

  const serialize = () => {
    const svg = svgRef.current!.cloneNode(true) as SVGSVGElement;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.querySelectorAll("[data-ui]").forEach((n) => n.remove());
    return new XMLSerializer().serializeToString(svg);
  };
  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const downloadSvg = () => save(new Blob([serialize()], { type: "image/svg+xml" }), `${fileBase}-schema.svg`);
  const downloadPng = () => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([serialize()], { type: "image/svg+xml" }));
    img.onload = () => {
      const k = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * k;
      canvas.height = height * k;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(k, k);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => b && save(b, `${fileBase}-schema.png`), "image/png");
    };
    img.src = url;
  };

  return (
    <div className="wf-schema">
      <div className="wf-toolbar">
        <div className="wf-zoom" role="group" aria-label="Zoom">
          <button className="btn-ghost sm" onClick={() => setZ(zoom - 0.15)} aria-label="Zoom out" title="Zoom out">−</button>
          <span className="wf-zoom-val">{Math.round(zoom * 100)}%</span>
          <button className="btn-ghost sm" onClick={() => setZ(zoom + 0.15)} aria-label="Zoom in" title="Zoom in">+</button>
          <button className="btn-ghost sm" onClick={fit} title="Fit to width">Fit</button>
          <button className="btn-ghost sm" onClick={() => setZ(1)} title="Actual size">100%</button>
        </div>
        <div className="spacer" />
        <button className="btn-ghost sm" onClick={downloadSvg}>Download SVG</button>
        <button className="btn-ghost sm" onClick={downloadPng}>Download PNG</button>
      </div>
      <div
        ref={viewRef}
        className="wf-view"
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest?.(".wf-node")) return;
          const v = viewRef.current!;
          drag.current = { x: e.clientX, y: e.clientY, sl: v.scrollLeft, st: v.scrollTop, moved: false };
          v.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const v = viewRef.current!;
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
          v.scrollLeft = d.sl - (e.clientX - d.x);
          v.scrollTop = d.st - (e.clientY - d.y);
        }}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
      >
        <SchemaSvg
          wf={wf}
          layout={layout}
          run={run}
          selected={selected}
          onSelect={onSelect}
          isDragging={() => !!drag.current?.moved}
          svgRef={svgRef}
          zoom={zoom}
        />
      </div>
      <div className="legend">
        {run && <span><i className="lg lg-wf-ran" /> ran in this run (time shown)</span>}
        <span><i className="lg lg-wf-blue" /> next</span>
        <span><i className="lg lg-wf-green" /> from a decision</span>
        <span><i className="lg lg-wf-red" /> false path / error handling</span>
        <span className="muted">Click a step for its details. Drag to pan, Ctrl + scroll to zoom.</span>
      </div>
    </div>
  );
}
