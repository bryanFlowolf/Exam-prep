import type { ReactNode } from 'react';

/**
 * Small, safe Markdown renderer for lesson text (no raw HTML):
 * # headings, - / 1. lists, > quotes, **bold**, *italic*, `code` and [links](https://…).
 */
export default function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return <div className="md">{blocks.map((b, i) => block(b.trim(), i)).filter(Boolean)}</div>;
}

function block(b: string, key: number): ReactNode {
  if (!b) return null;
  const lines = b.split('\n');
  const h = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
  if (h && lines.length === 1) {
    const level = h[1].length;
    return level === 1 ? <h3 key={key}>{inline(h[2])}</h3> : level === 2 ? <h4 key={key}>{inline(h[2])}</h4> : <h5 key={key}>{inline(h[2])}</h5>;
  }
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return <ul key={key}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul>;
  if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return <ol key={key}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>)}</ol>;
  if (lines.every((l) => l.startsWith('>'))) return <blockquote key={key}>{inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '))}</blockquote>;
  return <p key={key}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
}

const TOKEN = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    const t = m[0];
    if (m.index! > last) out.push(s.slice(last, m.index));
    const k = out.length;
    if (t.startsWith('**')) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const label = t.slice(1, t.indexOf(']('));
      out.push(<a key={k} href={m[2]} target="_blank" rel="noopener noreferrer">{label}</a>);
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
