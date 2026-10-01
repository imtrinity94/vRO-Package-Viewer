// Usage: npm run test:parse -- path/to/file.package
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { tsImport } from "tsx/esm/api";

const { parsePackage, setXmlParser } = await tsImport("../src/lib/parser.ts", import.meta.url);
setXmlParser((t) => new DOMParser({ onError: () => {} }).parseFromString(t, "application/xml"));

const file = process.argv[2];
if (!file) { console.error("usage: parse-test <file.package>"); process.exit(1); }
const pkg = await parsePackage(new Uint8Array(readFileSync(file)), file);
console.log("meta:", pkg.meta);
console.log("signed:", pkg.signed, "certs:", pkg.certificates.length, "warnings:", pkg.warnings);
for (const e of pkg.elements) {
  const extra =
    e.kind === "workflow" ? `in=${e.inputs.length} out=${e.outputs.length} attr=${e.attributes.length} items=${e.items.length} forms=${e.inputForms.length}` :
    e.kind === "action" ? `${e.module} -> ${e.resultType} params=${e.params.length} runtime=${e.runtime ?? "js"}` :
    e.kind === "config" ? `atts=${e.attributes.length}` :
    e.kind === "resource" ? `${e.mimeType} ${e.size}B` :
    e.kind === "environment" ? `${e.runtime} deps=${Object.keys(e.dependencies).join(",")}` : "";
  const refs = [...(pkg.refs.get(e.id.toLowerCase()) ?? [])].map((id) => pkg.byId.get(id)?.name);
  console.log(`[${e.kind}] ${e.path.join("/")} :: ${e.name} v${e.version ?? "?"} scripts=${e.scripts.length} ${extra}${refs.length ? "  refs→ " + refs.join(", ") : ""}`);
}
