import JSZip from "jszip";
import type {
  ActionElement,
  Attrib,
  BaseElement,
  Bind,
  ConfigElement,
  ElementFile,
  EnvironmentElement,
  GenericElement,
  PackageInfo,
  Param,
  PkgElement,
  ResourceElement,
  WfItem,
  WorkflowElement,
} from "./types";

/* ------------------------------------------------------------------ */
/* Text + XML helpers (DOM-API subset so the parser also runs in Node */
/* with @xmldom/xmldom for tests)                                      */
/* ------------------------------------------------------------------ */

let parseXmlImpl: (text: string) => Document = (text) =>
  new DOMParser().parseFromString(text, "application/xml");

/** Allow a non-browser DOMParser (used by the Node test script). */
export function setXmlParser(fn: (text: string) => Document) {
  parseXmlImpl = fn;
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    // UTF-16 without BOM: '<' encoded as 00 3C (BE) or 3C 00 (LE)
    if (bytes[0] === 0x00 && bytes[1] !== 0x00) return new TextDecoder("utf-16be").decode(bytes);
    if (bytes[0] !== 0x00 && bytes[1] === 0x00) return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  return new TextDecoder("utf-8").decode(bytes);
}

/** Heuristic: does this byte buffer look like text? */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return false; // zip
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return false; // %PDF
  const n = Math.min(bytes.length, 2048);
  const utf16 = (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0 && bytes[1] !== 0) || (bytes[0] !== 0 && bytes[1] === 0);
  if (utf16) return true;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) bad++;
  }
  return bad / n < 0.02;
}

function parseXml(text: string): Document | null {
  try {
    const doc = parseXmlImpl(text);
    if (!doc || !doc.documentElement) return null;
    if (doc.getElementsByTagName("parsererror").length) return null;
    return doc;
  } catch {
    return null;
  }
}

const localName = (n: Node) => (n.nodeName || "").replace(/^.*:/, "");

function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  const cn = el.childNodes;
  for (let i = 0; i < cn.length; i++) {
    const c = cn[i];
    if (c.nodeType === 1 && (!name || localName(c) === name)) out.push(c as Element);
  }
  return out;
}
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0];
const txt = (el: Element | null | undefined) => (el ? el.textContent ?? "" : undefined);
const attr = (el: Element | null | undefined, name: string) => {
  if (!el || !el.hasAttribute(name)) return undefined;
  return el.getAttribute(name) ?? undefined;
};
const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

/** Parse a java.util.Properties XML document (info, dunes-meta-inf). */
function parseProps(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const doc = parseXml(text);
  if (doc) {
    const entries = doc.getElementsByTagName("entry");
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const k = e.getAttribute("key");
      if (k) out[k] = e.textContent ?? "";
    }
    return out;
  }
  // fallback regex
  for (const m of text.matchAll(/<entry key="([^"]+)">([\s\S]*?)<\/entry>/g)) out[m[1]] = m[2];
  return out;
}

function parseCategories(text: string | undefined): string[] {
  if (!text) return [];
  const doc = parseXml(text);
  if (!doc) return [];
  return kids(doc.documentElement, "category").map(
    (c) => txt(kid(c, "name")) || c.getAttribute("name") || "",
  );
}

function langForRuntime(runtime?: string): string {
  const r = (runtime || "").toLowerCase();
  if (r.startsWith("python")) return "python";
  if (r.startsWith("powershell") || r.startsWith("powercli")) return "powershell";
  if (r.startsWith("node")) return "javascript";
  return "javascript";
}

/* ------------------------------------------------------------------ */
/* Element parsers                                                     */
/* ------------------------------------------------------------------ */

function parseParams(parent: Element | undefined): Param[] {
  return kids(parent, "param").map((p) => ({
    name: attr(p, "name") ?? attr(p, "n") ?? "",
    type: attr(p, "type") ?? attr(p, "t") ?? "",
    description: txt(kid(p, "description")) || undefined,
  }));
}

function parseAttribs(parent: Element | undefined, tag: string): Attrib[] {
  return kids(parent, tag).map((a) => {
    const v = kid(a, "value");
    return {
      name: attr(a, "name") ?? "",
      type: attr(a, "type") ?? "",
      readOnly: attr(a, "read-only") === "true",
      value: v ? txt(v) : undefined,
      encoded: attr(v, "encoded"),
      confId: attr(a, "conf-id"),
      confKey: attr(a, "conf-key"),
      description: txt(kid(a, "description")) || undefined,
    };
  });
}

function parseBinds(parent: Element | undefined): Bind[] {
  return kids(parent, "bind").map((b) => ({
    name: attr(b, "name") ?? "",
    type: attr(b, "type") ?? "",
    exportName: attr(b, "export-name"),
  }));
}

function parseWorkflow(base: BaseElement, doc: Document, inputForms: WorkflowElement["inputForms"]): WorkflowElement {
  const root = doc.documentElement;
  const pos = kid(root, "position");
  const items: WfItem[] = kids(root, "workflow-item").map((it) => {
    const p = kid(it, "position");
    const script = kid(it, "script");
    const conditionTargets = kids(it, "condition")
      .map((c) => attr(c, "label"))
      .filter((l): l is string => !!l && l !== "null");
    return {
      name: attr(it, "name") ?? "",
      type: attr(it, "type") ?? "",
      displayName: txt(kid(it, "display-name")) || undefined,
      description: txt(kid(it, "description")) || undefined,
      script: script ? txt(script) : undefined,
      runtime: txt(kid(it, "runtime")) || undefined,
      outName: attr(it, "out-name"),
      altOutName: attr(it, "alt-out-name"),
      catchName: attr(it, "catch-name"),
      linkedWorkflowId: attr(it, "linked-workflow-id"),
      scriptModule: attr(it, "script-module"),
      endMode: attr(it, "end-mode"),
      inBindings: parseBinds(kid(it, "in-binding")),
      outBindings: parseBinds(kid(it, "out-binding")),
      conditionTargets,
      x: num(attr(p, "x")),
      y: num(attr(p, "y")),
    };
  });

  const scripts: BaseElement["scripts"] = [];
  for (const it of items) {
    if (!it.script || !it.script.trim()) continue;
    if (it.script.startsWith("// Generated by the system, cannot be edited") && it.type === "condition") {
      // still useful, but label it
    }
    const env = it.runtime?.startsWith("environment:") ? "python" : langForRuntime(it.runtime);
    scripts.push({
      label: `${it.displayName || it.name} (${it.name})`,
      code: it.script,
      lang: it.runtime ? env : "javascript",
      itemName: it.name,
    });
  }

  return {
    ...base,
    kind: "workflow",
    name: txt(kid(root, "display-name")) || base.name,
    description: txt(kid(root, "description")) || base.description,
    version: attr(root, "version") ?? base.version,
    allowedOperations: attr(root, "allowed-operations"),
    rootName: attr(root, "root-name"),
    apiVersion: attr(root, "api-version"),
    inputs: parseParams(kid(root, "input")),
    outputs: parseParams(kid(root, "output")),
    attributes: parseAttribs(root, "attrib"),
    items,
    start: pos ? { x: Number(attr(pos, "x") ?? 0), y: Number(attr(pos, "y") ?? 0) } : undefined,
    inputForms,
    scripts,
  };
}

function parseAction(base: BaseElement, doc: Document): ActionElement {
  const root = doc.documentElement;
  const params: Param[] = kids(root, "param").map((p) => ({
    name: attr(p, "n") ?? attr(p, "name") ?? "",
    type: attr(p, "t") ?? attr(p, "type") ?? "",
    description: (p.textContent || "").trim() || undefined,
  }));
  const script = txt(kid(root, "script")) ?? "";
  const runtime = attr(root, "runtime") ?? txt(kid(root, "runtime")) ?? undefined;
  const module = base.path.join(".") || "(no module)";
  const name = attr(root, "name") ?? base.name;
  return {
    ...base,
    kind: "action",
    name,
    module,
    version: attr(root, "version") ?? base.version,
    allowedOperations: attr(root, "allowed-operations"),
    description: txt(kid(root, "description")) || base.description,
    resultType: attr(root, "result-type"),
    runtime,
    entryHandler: attr(root, "entry-point") ?? attr(root, "entry-handler"),
    memoryLimit: attr(root, "memory-limit"),
    timeout: attr(root, "timeout"),
    environmentId: runtime?.startsWith("environment:") ? runtime.slice(12) : attr(root, "environment"),
    params,
    script,
    hasBundle: base.files.some((f) => f.name === "bundle" || f.name.startsWith("bundle")),
    scripts: script.trim()
      ? [{ label: `${module}/${name}`, code: script, lang: langForRuntime(runtime) }]
      : [],
  };
}

function parseConfig(base: BaseElement, doc: Document): ConfigElement {
  const root = doc.documentElement;
  const atts = parseAttribs(kid(root, "atts"), "att");
  return {
    ...base,
    kind: "config",
    name: txt(kid(root, "display-name")) || attr(root, "name") || base.name,
    description: txt(kid(root, "description")) || base.description,
    version: attr(root, "version") ?? base.version,
    allowedOperations: attr(root, "allowed-operations"),
    attributes: atts,
  };
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

const UUIDISH = /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})\b/gi;
const GETMODULE = /System\.getModule\(\s*["']([\w.$-]+)["']\s*\)\s*\.\s*([\w$]+)/g;

export async function parsePackage(data: ArrayBuffer | Uint8Array, fileName: string): Promise<PackageInfo> {
  const zip = await JSZip.loadAsync(data);
  const warnings: string[] = [];
  const fileSize = data instanceof Uint8Array ? data.byteLength : data.byteLength;

  const metaFile = zip.file("dunes-meta-inf");
  let meta: Record<string, string> = {};
  if (metaFile) meta = parseProps(decodeText(await metaFile.async("uint8array")));
  else warnings.push("No dunes-meta-inf found – this may not be a vRO package.");

  const certificates = Object.keys(zip.files)
    .filter((p) => p.startsWith("certificates/") && !zip.files[p].dir)
    .map((p) => p.slice("certificates/".length));
  const signed = Object.keys(zip.files).some((p) => p.startsWith("signatures/"));

  // Group files by element folder
  const groups = new Map<string, JSZip.JSZipObject[]>();
  zip.forEach((path, f) => {
    const m = /^elements\/([^/]+)\/(.+)$/.exec(path);
    if (!m || f.dir) return;
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1])!.push(f);
  });
  if (groups.size === 0) warnings.push("No elements/ folder found in the archive.");

  const elements: PkgElement[] = [];
  for (const [folderId, files] of groups) {
    try {
      elements.push(await parseElement(folderId, files, signed));
    } catch (e) {
      warnings.push(`Element ${folderId}: ${(e as Error).message}`);
    }
  }

  const byId = new Map<string, PkgElement>();
  for (const e of elements) byId.set(e.id.toLowerCase(), e);

  const actionIndex = new Map<string, string>();
  for (const e of elements) if (e.kind === "action") actionIndex.set(`${e.module}/${e.name}`, e.id.toLowerCase());

  // References: any known element id mentioned in the element text, plus System.getModule(...) calls
  const refs = new Map<string, Set<string>>();
  const usedBy = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    if (from === to) return;
    if (!refs.has(from)) refs.set(from, new Set());
    if (!usedBy.has(to)) usedBy.set(to, new Set());
    refs.get(from)!.add(to);
    usedBy.get(to)!.add(from);
  };
  for (const e of elements) {
    const self = e.id.toLowerCase();
    const texts = [e.raw ?? "", ...e.files.filter((f) => f.name !== "data").map((f) => f.text ?? "")];
    for (const t of texts) {
      for (const m of t.matchAll(UUIDISH)) {
        const id = m[0].toLowerCase();
        if (byId.has(id)) link(self, id);
      }
    }
    for (const s of e.scripts) {
      for (const m of s.code.matchAll(GETMODULE)) {
        const target = actionIndex.get(`${m[1]}/${m[2]}`);
        if (target) link(self, target);
      }
    }
    if (e.kind === "workflow") {
      for (const it of e.items) {
        if (it.scriptModule) {
          const t = actionIndex.get(it.scriptModule);
          if (t) link(self, t);
        }
      }
    }
  }

  elements.sort((a, b) => a.name.localeCompare(b.name));
  return { fileName, fileSize, meta, certificates, signed, elements, byId, refs, usedBy, warnings, actionIndex };
}

async function parseElement(folderId: string, files: JSZip.JSZipObject[], signed: boolean): Promise<PkgElement> {
  const byName = new Map<string, JSZip.JSZipObject>();
  for (const f of files) byName.set(f.name.replace(/^elements\/[^/]+\//, ""), f);

  const info = byName.get("info");
  const props = info ? parseProps(decodeText(await info.async("uint8array"))) : {};
  const type = props["type"] || "Unknown";
  const id = props["id"] || folderId;

  // Read small files as text; big binary ones (bundle, resource data) stay lazy.
  const elementFiles: ElementFile[] = [];
  const textByName: Record<string, string> = {};
  for (const [name, f] of byName) {
    // @ts-expect-error _data is internal to JSZip but holds sizes when available
    const size: number = f._data?.uncompressedSize ?? 0;
    let text: string | undefined;
    const lazy = name === "bundle" || (type === "ResourceElement" && name === "data");
    if (!lazy && size < 8 * 1024 * 1024) {
      const bytes = await f.async("uint8array");
      if (looksLikeText(bytes)) {
        text = decodeText(bytes);
        textByName[name] = text;
      }
      elementFiles.push({ name, size: size || bytes.length, text });
    } else {
      elementFiles.push({ name, size });
    }
  }
  elementFiles.sort((a, b) => a.name.localeCompare(b.name));

  const path = parseCategories(textByName["categories"]);
  const raw = textByName["data"];
  const base: BaseElement = {
    id,
    type,
    name: id,
    path,
    files: elementFiles,
    raw,
    scripts: [],
    signed,
    getFile: async (name: string) => {
      const f = byName.get(name);
      return f ? f.async("uint8array") : new Uint8Array();
    },
  };

  if (type === "Workflow" && raw) {
    const doc = parseXml(raw);
    if (doc) {
      const forms = elementFiles
        .filter((f) => f.name.startsWith("input_form_") && f.text)
        .map((f) => {
          let json: unknown = null;
          try {
            json = JSON.parse(f.text!);
          } catch {
            /* keep text */
          }
          return { name: f.name, json, text: f.text! };
        });
      return parseWorkflow(base, doc, forms);
    }
  }
  if (type === "ScriptModule" && raw) {
    const doc = parseXml(raw);
    if (doc) return parseAction(base, doc);
  }
  if (type === "ConfigurationElement" && raw) {
    const doc = parseXml(raw);
    if (doc) return parseConfig(base, doc);
  }
  if (type === "ResourceElement") return parseResource(base, byName.get("data"));
  if (type === "ActionEnvironment") return parseEnvironment(base, byName.get("bundle"));

  const g: GenericElement = { ...base, kind: "generic" };
  if (raw) {
    const doc = parseXml(raw);
    if (doc) {
      const root = doc.documentElement;
      g.name = txt(kid(root, "display-name")) || attr(root, "name") || g.name;
      g.description = txt(kid(root, "description")) || undefined;
      g.version = attr(root, "version");
    } else {
      try {
        const j = JSON.parse(raw);
        g.name = j.name || j.displayName || g.name;
        g.version = j.version;
        g.description = j.description;
      } catch {
        /* ignore */
      }
    }
  }
  return g;
}

async function parseResource(base: BaseElement, dataFile: JSZip.JSZipObject | undefined): Promise<ResourceElement> {
  const res: ResourceElement = {
    ...base,
    kind: "resource",
    fileName: base.name,
    getBytes: async () => new Uint8Array(),
  };
  if (!dataFile) return res;
  const outer = await dataFile.async("uint8array");
  let inner: JSZip | null = null;
  if (outer[0] === 0x50 && outer[1] === 0x4b) {
    try {
      inner = await JSZip.loadAsync(outer);
    } catch {
      inner = null;
    }
  }
  if (inner && inner.file("VSO-RESOURCE-INF/data")) {
    const readAttr = async (n: string) => {
      const f = inner!.file(`VSO-RESOURCE-INF/attribute_${n}`);
      return f ? decodeText(await f.async("uint8array")) : undefined;
    };
    res.name = (await readAttr("name")) || res.name;
    res.fileName = res.name;
    res.mimeType = await readAttr("mimetype");
    res.description = await readAttr("description");
    res.version = await readAttr("version");
    res.allowedOperations = await readAttr("allowedOperations");
    const d = inner.file("VSO-RESOURCE-INF/data")!;
    // @ts-expect-error internal
    res.size = d._data?.uncompressedSize;
    let cache: Uint8Array | null = null;
    res.getBytes = async () => (cache ??= await d.async("uint8array"));
    // Make small text resources searchable
    if ((res.size ?? 0) < 2 * 1024 * 1024 && isTextMime(res.mimeType, res.name)) {
      const bytes = await res.getBytes();
      const t = decodeText(bytes);
      res.scripts = [{ label: res.name, code: t, lang: langForMime(res.mimeType, res.name) }];
    }
  } else {
    res.size = outer.length;
    res.getBytes = async () => outer;
  }
  return res;
}

export function isTextMime(mime?: string, name?: string): boolean {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("text/") || /json|xml|javascript|yaml|x-sh|csv|x-python|powershell|sql/.test(m)) return true;
  return /\.(txt|json|xml|ya?ml|js|ts|py|ps1|psm1|sh|csv|md|html?|css|ini|conf|cfg|properties|sql|log|j2|tpl)$/i.test(name || "");
}
export function langForMime(mime?: string, name?: string): string {
  const s = `${mime || ""} ${name || ""}`.toLowerCase();
  if (/json/.test(s)) return "json";
  if (/xml|html?/.test(s)) return "xml";
  if (/ya?ml/.test(s)) return "yaml";
  if (/python|\.py\b/.test(s)) return "python";
  if (/powershell|\.ps1|\.psm1/.test(s)) return "powershell";
  if (/x-sh|\.sh\b/.test(s)) return "bash";
  if (/javascript|\.js\b|\.ts\b/.test(s)) return "javascript";
  if (/sql/.test(s)) return "sql";
  return "plaintext";
}

async function parseEnvironment(base: BaseElement, bundle: JSZip.JSZipObject | undefined): Promise<EnvironmentElement> {
  let meta: Record<string, unknown> = {};
  try {
    meta = base.raw ? JSON.parse(base.raw) : {};
  } catch {
    /* ignore */
  }
  let listCache: { name: string; size: number; dir: boolean }[] | null = null;
  return {
    ...base,
    kind: "environment",
    name: (meta.name as string) || base.name,
    version: (meta.version as string) || undefined,
    description: (meta.description as string) || undefined,
    runtime: meta.runtime as string | undefined,
    dependencies: (meta.dependencies as Record<string, string>) || {},
    environmentVariables: (meta.environmentVariables as Record<string, string>) || {},
    meta,
    hasBundle: !!bundle,
    getBundleBytes: async () => (bundle ? bundle.async("uint8array") : undefined),
    listBundle: async () => {
      if (listCache) return listCache;
      if (!bundle) return [];
      const z = await JSZip.loadAsync(await bundle.async("uint8array"));
      const out: { name: string; size: number; dir: boolean }[] = [];
      z.forEach((p, f) => {
        // @ts-expect-error internal
        out.push({ name: p, size: f._data?.uncompressedSize ?? 0, dir: f.dir });
      });
      out.sort((a, b) => a.name.localeCompare(b.name));
      return (listCache = out);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Value helpers                                                       */
/* ------------------------------------------------------------------ */

/** Best-effort pretty print of vRO's serialised attribute values. */
export function prettyValue(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (v === "__NULL__") return "(null)";
  // Arrays: #{#string#a#;#string#b#}#
  if (v.startsWith("#{#") && v.endsWith("#}#")) {
    const body = v.slice(3, -3);
    if (!body) return "[]";
    const items = body.split("#;#").map((s) => s.replace(/^[^#]+#/, ""));
    return "[" + items.map((s) => JSON.stringify(s)).join(", ") + "]";
  }
  // Properties: #[#key#+#type#value#]#
  if (v.startsWith("#[#") && v.endsWith("#]#")) {
    const body = v.slice(3, -3);
    const parts = body.split("#;#").map((p) => {
      const [k, rest] = p.split("#+#");
      return `${k}: ${(rest ?? "").replace(/^[^#]+#/, "")}`;
    });
    return "{ " + parts.join(", ") + " }";
  }
  const sdk = /^dunes:\/\/service\.dunes\.ch\/([^?]+)\?id='([^']*)'(?:&dunesName='([^']*)')?/.exec(v);
  if (sdk) return `${sdk[1]} → ${sdk[2]}${sdk[3] ? ` (${sdk[3]})` : ""}`;
  return v;
}

export function kindLabel(kind: PkgElement["kind"], type?: string): string {
  switch (kind) {
    case "workflow": return "Workflow";
    case "action": return "Action";
    case "config": return "Configuration Element";
    case "resource": return "Resource Element";
    case "environment": return "Environment";
    default: return type || "Other";
  }
}

export function formatBytes(n?: number): string {
  if (n === undefined || isNaN(n)) return "–";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
