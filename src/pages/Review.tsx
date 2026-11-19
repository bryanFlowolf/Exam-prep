import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { useExam } from '../lib/useExam';
import { LETTERS, fmtDate, shuffle, toItem } from '../lib/exam';
import { removeReview } from '../lib/data';

type Filter = 'all' | 'wrong' | 'flag';

export default function Review() {
  const { slug = '' } = useParams();
  const { userId, setSession } = useApp();
  const { data, error, update } = useExam(slug, userId);
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [armed, setArmed] = useState<string | null>(null);

  if (error) return <main className="wrap"><div className="msg err" style={{ marginTop: 24 }}>{error}</div></main>;
  if (!data) return <div className="center">Cargando…</div>;

  const domains = Object.fromEntries(data.domains.map((d) => [d.id, d]));
  const entries = data.questions
    .filter((q) => data.review.has(q.id))
    .map((q) => ({ q, r: data.review.get(q.id)! }))
    .filter(({ r }) => filter === 'all' || (filter === 'wrong' ? r.wrong_count > 0 : r.flagged))
    .sort((a, b) => b.r.wrong_count - a.r.wrong_count || (domains[a.q.domain_id]?.code || '').localeCompare(domains[b.q.domain_id]?.code || ''));
  const all = [...data.review.values()].filter((r) => data.questions.some((q) => q.id === r.question_id));
  const wrong = all.filter((r) => r.wrong_count > 0).length;
  const flag = all.filter((r) => r.flagged).length;

  const practise = () => {
    const items = shuffle(entries.map((e) => e.q)).map(toItem);
    if (!items.length) return;
    setSession({ examSlug: slug, mode: 'review', title: 'Mi lista de repaso', items, seconds: 0, startedAt: Date.now() });
    nav(`/e/${slug}/examen`);
  };

  const remove = async (id: string) => {
    if (armed !== id) { setArmed(id); setTimeout(() => setArmed((a) => (a === id ? null : a)), 3000); return; }
    try {
      await removeReview(id);
      update((d) => { const review = new Map(d.review); review.delete(id); return { ...d, review }; });
    } finally { setArmed(null); }
  };

  return (
    <main className="wrap">
      <div className="crumbs" style={{ marginTop: 14 }}><Link to="/">Exámenes</Link> / <Link to={`/e/${slug}`}>{data.exam.name}</Link></div>
      <header className="hero" style={{ paddingTop: 12 }}>
        <div className="eyebrow">Guardada en tu cuenta · solo tú la ves</div>
        <h1>Mi lista de repaso</h1>
        <p>{wrong} falladas y {flag} marcadas para revisar. Cada pregunta muestra la respuesta correcta, la explicación y cómo te fue la última vez.</p>
      </header>
      <div className="row">
        <button className="btn solid" disabled={!entries.length} onClick={practise}>Practicar {filter === 'all' ? 'la lista' : 'este filtro'} ({entries.length})</button>
        <span className="spacer" />
        {([['all', 'Todas'], ['wrong', 'Falladas'], ['flag', 'Marcadas']] as [Filter, string][]).map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <section className="list">
        {entries.map(({ q, r }) => (
          <article key={q.id} className={`ritem ${r.wrong_count ? 'bad' : r.flagged ? 'flagged' : ''}`}>
            <div className="qhead">
              <span className="tag">{domains[q.domain_id]?.code} · {domains[q.domain_id]?.name}</span>
              {r.wrong_count > 0 && <span className="tag" style={{ color: 'var(--bad)' }}>Fallada {r.wrong_count} {r.wrong_count === 1 ? 'vez' : 'veces'}</span>}
              {r.flagged && <span className="tag multi">Marcada</span>}
              <span className="tag">Última vez: {r.last_result} · {fmtDate(r.last_at)}</span>
            </div>
            <p className="qtext">{q.stem}</p>
            <ul>{q.options.map((o, i) => <li key={i} className={q.correct.includes(i) ? 'c' : ''}>{LETTERS[i]}. {o}</li>)}</ul>
            {r.last_result === 'fallada' && r.last_pick.length > 0 && (
              <p style={{ fontSize: 13.5, margin: '8px 0 0', color: 'var(--bad)' }}>Tu respuesta: {r.last_pick.map((i) => q.options[i]).filter(Boolean).join(' / ')}</p>
            )}
            {q.explanation && <div className="expl">{q.explanation}</div>}
            <div className="row" style={{ marginTop: 10 }}>
              <button className={`btn small ${armed === q.id ? 'solid' : ''}`} onClick={() => remove(q.id)}>{armed === q.id ? 'Confirmar: quitar' : 'Quitar de la lista'}</button>
            </div>
          </article>
        ))}
        {!entries.length && <p className="note">No hay preguntas en este filtro. Las que falles o marques en cualquier modo aparecerán aquí.</p>}
      </section>
    </main>
  );
}
