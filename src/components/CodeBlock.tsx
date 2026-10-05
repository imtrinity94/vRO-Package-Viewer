import { useMemo, useState } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import powershell from "highlight.js/lib/languages/powershell";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("plaintext", plaintext);

const MAX_HL = 400_000;

function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/** Syntax-highlighted HTML for a code string (used by the report export). */
export function highlightCode(code: string, lang: string): string {
  if (code.length > MAX_HL || !hljs.getLanguage(lang)) return escapeHtml(code);
  return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
}

export function CodeBlock({
  code,
  lang = "javascript",
  title,
  highlightTerm,
  maxHeight,
}: {
  code: string;
  lang?: string;
  title?: string;
  highlightTerm?: string;
  maxHeight?: number;
}) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const trimmed = code.replace(/^\n+/, "").replace(/\s+$/, "");
  const html = useMemo(() => {
    let out: string;
    if (trimmed.length > MAX_HL || !hljs.getLanguage(lang)) out = escapeHtml(trimmed);
    else out = hljs.highlight(trimmed, { language: lang, ignoreIllegals: true }).value;
    if (highlightTerm && highlightTerm.length > 1) {
      // mark matches only inside text nodes (not inside tags)
      const re = new RegExp(`(${highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      out = out.replace(/(^|>)([^<]+)/g, (_m, a: string, b: string) => a + b.replace(re, "<mark>$1</mark>"));
    }
    return out;
  }, [trimmed, lang, highlightTerm]);
  const lines = trimmed.split("\n").length;

  return (
    <div className="code">
      <div className="code-head">
        <span className="code-title">{title}</span>
        <span className="code-meta">
          {lang} · {lines} lines
        </span>
        <button className="btn-ghost sm" onClick={() => setWrap((w) => !w)}>
          {wrap ? "No wrap" : "Wrap"}
        </button>
        <button
          className="btn-ghost sm"
          onClick={() => {
            navigator.clipboard?.writeText(trimmed).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="code-body" style={maxHeight ? { maxHeight } : undefined}>
        {!wrap && (
          <pre className="gutter" aria-hidden>
            {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
          </pre>
        )}
        <pre className={`hljs src ${wrap ? "wrap" : ""}`}>
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  );
}
