import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowElement, WfItem } from "../lib/types";
import { formatDuration } from "../lib/parser";
import { VRO_ICONS } from "../lib/vroIcons";

/*
 * Workflow schema drawn the way the Orchestrator client draws it.
 * Layout, icon choice and arrow styling follow wdt4vro (github.com/imtrinity94/wdt4vro):
 * saved canvas positions scaled 1.5x horizontally and 3x vertically, a 120x100 cell per item
 * (40px icon, bold label below), a Start node 180px left of the root item, error handlers
 * 200px left of their item, blue "next" arrows, green out of decisions, red dashed for the
 * alternative path and the error path.
 */

export interface RunOverlay {
  /** items that executed, with profiler timings when available */
  ran: Map<string, { ms?: number; count?: number }>;
  /** item the token stopped on */
  current?: string;
  failed?: boolean;
}

const NODE_W = 120;
const NODE_H = 100;
const ICON = 40;
const SCALE_X = 1.5;
const SCALE_Y = 3;
const MARGIN = 60;

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
  if (it.type === "end") return "End";
  return it.displayName || it.name;
}

/** Wrap a label into at most 3 lines of ~17 characters (12px bold in a 120px cell). */
function wrap(text: string, max = 17, lines = 3): string[] {
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

/** wdt4vro's createArrowPath: centre to centre, trimmed by half a cell, nudged up 10%. */
function arrow(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!len) return "";
  const ux = dx / len;
  const uy = dy / len;
  const off = NODE_H * 0.1;
  const sx = x1 + ux * (NODE_W / 2);
  const sy = y1 - off + uy * (NODE_H / 2);
  const ex = x2 - ux * (NODE_W / 2);
  const ey = y2 - off - uy * (NODE_H / 2);
  return `M${sx.toFixed(1)},${sy.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}`;
}

type Box = { x: number; y: number };
type Edge = { from: string; to: string; color: string; marker: string; dash?: string; width: number };
type Extra = { key: string; label: string; icon: string; pos: Box; target?: string };

export type SchemaLayout = NonNullable<ReturnType<typeof computeLayout>>;

/** Pure layout computation (also used by the export). */
export function computeLayout(wf: WorkflowElement) {
  {
    const items = wf.items.filter((i) => i.x !== undefined && i.y !== undefined);
    const pos = new Map<string, Box>();
    if (!items.length) return null;
    const minX = Math.min(...items.map((i) => i.x!));
    const minY = Math.min(...items.map((i) => i.y!));
    for (const it of items) pos.set(it.name, { x: (it.x! - minX) * SCALE_X + MARGIN, y: (it.y! - minY) * SCALE_Y + MARGIN });
    // leave room on the left for the Start node (and error handlers)
    const left = Math.min(...[...pos.values()].map((p) => p.x));
    const shift = MARGIN + NODE_W + 20 - left + (wf.errorHandlers.length ? 80 : 0);
    for (const p of pos.values()) p.x += shift;

    const extras: Extra[] = [];
    const root = wf.rootName ? pos.get(wf.rootName) : undefined;
    if (root) extras.push({ key: "__start", label: "Start", icon: "start", pos: { x: root.x - 180, y: root.y } });
    for (const t of wf.errorHandlers) {
      const p = pos.get(t);
      if (p) extras.push({ key: `__eh_${t}`, label: "Error handler", icon: "error-handler", pos: { x: p.x - 200, y: p.y }, target: t });
    }

    const edges: Edge[] = [];
    for (const it of items) {
      if (it.outName && pos.has(it.outName)) {
        const dec = DECISIONS.has(it.type);
        edges.push({ from: it.name, to: it.outName, color: it.type === "switch" ? C.switchDefault : dec ? C.green : C.blue, marker: dec || it.type === "switch" ? "green" : "blue", width: 1.5 });
      }
      if (it.altOutName && pos.has(it.altOutName)) edges.push({ from: it.name, to: it.altOutName, color: C.red, marker: "red", dash: "5,5", width: 2 });
      if (it.catchName && pos.has(it.catchName)) edges.push({ from: it.name, to: it.catchName, color: C.red, marker: "red", dash: "4,4", width: 2 });
      if (it.type === "switch") for (const t of it.conditionTargets) if (pos.has(t)) edges.push({ from: it.name, to: t, color: C.blue, marker: "blue", width: 1.5 });
    }

    const all = [...pos.values(), ...extras.map((e) => e.pos)];
    const minAllX = Math.min(...all.map((p) => p.x));
    if (minAllX < 20) {
      const d = 20 - minAllX;
      for (const p of all) p.x += d;
    }
    const width = Math.max(...all.map((p) => p.x)) + NODE_W + MARGIN;
    const height = Math.max(...all.map((p) => p.y)) + NODE_H + MARGIN / 2;
    return { items, pos, extras, edges, width, height };
  }
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
  const center = (p: Box) => ({ x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 });
  const ranEdge = (e: Edge) => !run || (run.ran.has(e.from) && run.ran.has(e.to));

  const node = (key: string, label: string, icon: string, p: Box, it?: WfItem) => {
    const r = it && run?.ran.get(it.name);
    const skipped = !!(run && it && !r);
    const failedHere = !!(run && it && run.failed && run.current === it.name);
    const lines = wrap(label);
    const time = r?.ms !== undefined ? `${formatDuration(r.ms)}${r.count && r.count > 1 ? ` ×${r.count}` : ""}` : undefined;
    const isSel = it && selected === it.name;
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
        aria-label={it ? `${label} (${it.type}${time ? `, ${time}` : ""})` : undefined}
      >
        {it && <title>{`${label} — ${it.type}${it.scriptModule ? ` · ${it.scriptModule}` : ""} (${it.name})${time ? ` — ${time}` : ""}`}</title>}
        {(r || failedHere) && <rect x={4} y={-4} width={NODE_W - 8} height={NODE_H} rx={8} fill={failedHere ? C.failFill : C.ranFill} stroke={failedHere ? C.red : C.ran} strokeWidth={1.2} />}
        {isSel && <rect data-ui x={2} y={-6} width={NODE_W - 4} height={NODE_H + 4} rx={9} fill={C.select} stroke={C.blue} strokeWidth={1.5} />}
        {it && onSelect && <rect data-ui className="wf-hit" x={4} y={-4} width={NODE_W - 8} height={NODE_H} rx={8} fill="transparent" />}
        <image href={iconUri(icon)} x={(NODE_W - ICON) / 2} y={0} width={ICON} height={ICON} />
        <text x={NODE_W / 2} y={ICON + 17} textAnchor="middle" fontSize={12} fontWeight={700} fill={C.text} fontFamily="'Clarity City', 'Metropolis', Arial, sans-serif">
          {lines.map((l, i) => (
            <tspan key={i} x={NODE_W / 2} dy={i === 0 ? 0 : 14}>{l}</tspan>
          ))}
        </text>
        {time && (
          <text x={NODE_W / 2} y={ICON + 17 + lines.length * 14 + 1} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.time} fontFamily="'Clarity City', 'Metropolis', Arial, sans-serif">
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
        <pattern id="wf-dots" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="9" cy="9" r="1" fill={C.dot} />
        </pattern>
        {([["blue", C.blue], ["green", C.green], ["red", C.red]] as const).map(([k, c]) => (
          <marker key={k} id={`wf-arr-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="6" orient="auto">
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
            d={arrow(a.x, a.y, b.x, b.y)}
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
        return <path key={`a${x.key}`} d={arrow(a.x, a.y, b.x, b.y)} stroke={C.blue} strokeWidth={run && !x.target ? 2.7 : 1.5} fill="none" markerEnd="url(#wf-arr-blue)" />;
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
