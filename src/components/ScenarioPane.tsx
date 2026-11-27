import type { Scenario } from '../lib/types';
import { QL, scText, type Lang } from '../lib/lang';

/** Scenario text shown beside its questions (left half of the screen, or a collapsible block on phones). */
export default function ScenarioPane({ scenario, lang, index, count, collapsible, defaultOpen = true }: {
  scenario: Scenario; lang: Lang; index?: number; count?: number; collapsible?: boolean; defaultOpen?: boolean;
}) {
  const L = QL[lang];
  const t = scText(scenario, lang);
  const label = index && count ? L.scenarioOf(index, count) : L.scenario;
  const body = (
    <div className="scbody">
      {t.text.split(/\n{2,}/).map((p, k) => <p key={k}>{p}</p>)}
    </div>
  );
  if (collapsible) {
    return (
      <details className="scenario compact" open={defaultOpen}>
        <summary><span className="eyebrow">{label}</span><b>{t.title}</b></summary>
        {body}
      </details>
    );
  }
  return (
    <aside className="scenario" aria-label={`${label}: ${t.title}`}>
      <div className="eyebrow">{label}</div>
      <h2>{t.title}</h2>
      {body}
    </aside>
  );
}
