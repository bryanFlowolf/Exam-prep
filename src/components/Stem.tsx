/**
 * Question stem. Text between ``` fences is shown as an exhibit (config, log, trace, code…)
 * in a monospaced, scrollable block, like the artifacts the real exams present.
 */
export default function Stem({ text, className = 'qtext' }: { text: string; className?: string }) {
  if (!text.includes('```')) return <p className={className}>{text}</p>;
  const parts = text.split(/```[^\n]*\n?/);
  return (
    <div className={`${className} stem`}>
      {parts.map((p, k) => {
        const body = k % 2 === 1 ? p.replace(/\n$/, '') : p.trim();
        if (!body) return null;
        return k % 2 === 1
          ? <pre key={k} className="exhibit" tabIndex={0}><code>{body}</code></pre>
          : <p key={k}>{body}</p>;
      })}
    </div>
  );
}
