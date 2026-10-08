import type { ReactNode } from "react";
import { parseSerialized, prettyValue, serTypeName, type SerNode } from "../lib/parser";

/** Renders an attribute / run value. Arrays and composite types are decoded into small tables. */
export function ValueView({ value }: { value: string }) {
  const node = parseSerialized(value);
  if (!node) return <code className="wrapcode">{prettyValue(value)}</code>;
  return <div className="ser">{renderNode(node)}</div>;
}

function scalar(n: Extract<SerNode, { t: "scalar" }>) {
  if (n.value === "__NULL__") return <span className="muted">(null)</span>;
  if (n.value === "") return <span className="muted">""</span>;
  return <code className="wrapcode">{prettyValue(n.value)}</code>;
}

function renderNode(n: SerNode): ReactNode {
  if (n.t === "scalar") return scalar(n);
  if (n.t === "object") {
    return (
      <table className="ser-table">
        {n.type && (
          <caption>{serTypeName(n.type)}</caption>
        )}
        <tbody>
          {n.fields.map(([k, f]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{renderNode(f)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  // array
  if (!n.items.length) return <span className="muted">[ ] empty</span>;
  const objects = n.items.every((i) => i.t === "object");
  if (objects) {
    const cols: string[] = [];
    for (const it of n.items) for (const [k] of (it as Extract<SerNode, { t: "object" }>).fields) if (!cols.includes(k)) cols.push(k);
    const typeName = serTypeName((n.items[0] as Extract<SerNode, { t: "object" }>).type);
    return (
      <table className="ser-table">
        <caption>
          {typeName ? `${typeName} · ` : ""}
          {n.items.length} {n.items.length === 1 ? "item" : "items"}
        </caption>
        <thead>
          <tr>
            <th className="ser-idx">#</th>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {n.items.map((it, i) => {
            const map = new Map((it as Extract<SerNode, { t: "object" }>).fields);
            return (
              <tr key={i}>
                <td className="ser-idx">{i + 1}</td>
                {cols.map((c) => {
                  const f = map.get(c);
                  return <td key={c}>{f ? renderNode(f) : <span className="muted">—</span>}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  return (
    <ol className="ser-list">
      {n.items.map((it, i) => (
        <li key={i}>{renderNode(it)}</li>
      ))}
    </ol>
  );
}

/** Type cell: "Array/CompositeType(a:string,b:number):MyType" shows as "Array/MyType" with its fields underneath. */
export function TypeLabel({ type }: { type: string }) {
  const m = /^(Array\/)?CompositeType\((.*)\):([^():]+)$/.exec(type);
  if (!m) return <>{type}</>;
  const fields = m[2].split(",").map((f) => f.split(":")[0]).filter(Boolean);
  return (
    <span className="type-composite" title={type}>
      {m[1] ?? ""}
      {m[3]}
      <span className="type-fields">{fields.join(", ")}</span>
    </span>
  );
}
