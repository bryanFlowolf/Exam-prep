import type { Scoring } from '../lib/examInfo';

/** Collapsible "how the real exam is scored" explanation. */
export default function ScoringInfo({ s }: { s: Scoring }) {
  return (
    <details className="scoring">
      <summary>Cómo se calcula la nota en el examen real: {s.summary}</summary>
      <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
    </details>
  );
}
