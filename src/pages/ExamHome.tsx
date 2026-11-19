import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { useExam } from '../lib/useExam';
import { buildExam, fmtDate, freshFirst, shuffle, toItem } from '../lib/exam';
import { resetSeen } from '../lib/data';
import type { Mode, Question } from '../lib/types';

const MODE_LABEL: Record<Mode, string> = {
  sim: 'Simulacro', mini: 'Mini-examen', practice: 'Práctica', review: 'Repaso', team: 'Equipo', last_wrong: 'Falladas',
};

export default function ExamHome() {
  const { slug = '' } = useParams();
  const { userId, setSession } = useApp();
  const { data, error, update } = useExam(slug, userId);
  const nav = useNavigate();
  const [practice, setPractice] = useState<Set<string> | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const stats = useMemo(() => {
    if (!data) return null;
    const bank = data.questions.filter((q) => q.source !== 'team');
    const team = data.questions.filter((q) => q.source === 'team');
    const unseen = bank.filter((q) => !data.seen.has(q.id)).length;
    const reviewIds = new Set([...data.review.keys()].filter((id) => data.questions.some((q) => q.id === id)));
    const lastScored = data.attempts.find((a) => a.mode === 'sim' || a.mode === 'mini' || a.mode === 'practice');
    const perDomain: Record<string, { ok: number; total: number }> = {};
    for (const a of data.attempts) for (const [code, v] of Object.entries(a.by_domain || {})) {
      perDomain[code] = perDomain[code] || { ok: 0, total: 0 };
      perDomain[code].ok += v.ok; perDomain[code].total += v.total;
    }
    return { bank, team, unseen, reviewIds, lastScored, perDomain };
  }, [data]);

  if (error) return <main className="wrap"><div className="msg err" style={{ marginTop: 24 }}>{error}</div></main>;
  if (!data || !stats) return <div className="center">Cargando…</div>;
  const { exam, domains } = data;
  const domainIds = practice ?? new Set(domains.map((d) => d.id));

  const start = (mode: Mode, items: ReturnType<typeof toItem>[], title: string, seconds = 0) => {
    if (!items.length) return;
    setSession({ examSlug: slug, mode, title, items, seconds, startedAt: Date.now() });
    nav(`/e/${slug}/examen`);
  };
  const practiceItems = (pool: Question[]) => freshFirst(pool, data.seen).map(toItem);
  const lastWrongIds = new Set(stats.lastScored?.wrong_question_ids || []);

  return (
    <main className="wrap">
      <div className="crumbs" style={{ marginTop: 14 }}><Link to="/">Exámenes</Link> / {exam.vendor}</div>
      <header className="hero" style={{ paddingTop: 12 }}>
        <div className="eyebrow">{exam.vendor}{exam.code ? ` · ${exam.code}` : ''}</div>
        <h1>{exam.name}</h1>
        {exam.description && <p>{exam.description}</p>}
        <div className="specs">
          <div><b>{exam.sim_questions}</b><span>preguntas en el examen</span></div>
          <div><b>{exam.sim_minutes} min</b><span>duración</span></div>
          {exam.passing_note && <div><b>{exam.passing_note.split(' ')[0]}</b><span>aprobado {exam.passing_note.split(' ').slice(1).join(' ')}</span></div>}
          <div><b>{stats.bank.length}</b><span>preguntas en el banco</span></div>
          <div><b>{stats.unseen}</b><span>sin ver todavía</span></div>
        </div>
        <p className="note">Tu progreso se guarda en tu cuenta y solo lo ves tú. Cada modo te muestra primero las preguntas que aún no has respondido.</p>
      </header>

      <section className="grid-cards">
        <div className="card primary">
          <div className="eyebrow">Condiciones de examen</div>
          <h2>Simulacro completo</h2>
          <p>{exam.sim_questions} preguntas con el reparto por dominios del examen y cronómetro. Se corrige al terminar.</p>
          <div className="meta">{exam.sim_questions} preguntas · {exam.sim_minutes}:00</div>
          <button className="btn solid" onClick={() => start('sim', buildExam(domains, stats.bank, exam.sim_questions, data.seen), 'Simulacro completo', exam.sim_minutes * 60)}>Empezar simulacro</button>
        </div>
        <div className="card">
          <div className="eyebrow">Diagnóstico</div>
          <h2>Mini-examen</h2>
          <p>{exam.mini_questions} preguntas con el mismo reparto proporcional.</p>
          <div className="meta">{exam.mini_questions} preguntas · {exam.mini_minutes}:00</div>
          <button className="btn" onClick={() => start('mini', buildExam(domains, stats.bank, exam.mini_questions, data.seen), 'Mini-examen', exam.mini_minutes * 60)}>Empezar mini-examen</button>
        </div>
        <div className="card">
          <div className="eyebrow">Sin reloj</div>
          <h2>Práctica por dominio</h2>
          <p>Elige dominios y corrige cada pregunta al momento.</p>
          <div className="row" style={{ gap: 6 }}>
            {domains.map((d) => (
              <button key={d.id} className="chip" aria-pressed={domainIds.has(d.id)} onClick={() => {
                const n = new Set(domainIds); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); setPractice(n);
              }}>{d.code} {d.name}</button>
            ))}
          </div>
          <button className="btn" disabled={!domainIds.size} onClick={() => start('practice', practiceItems(stats.bank.filter((q) => domainIds.has(q.domain_id))), 'Práctica por dominio')}>Empezar práctica</button>
        </div>
        <div className="card">
          <div className="eyebrow">Solo tú la ves</div>
          <h2>Mi lista de repaso</h2>
          <p>Las preguntas que fallas o marcas se guardan aquí hasta que las quites.</p>
          <div className="meta">{stats.reviewIds.size} preguntas{lastWrongIds.size ? ` · ${lastWrongIds.size} falladas en el último intento` : ''}</div>
          <div className="row">
            <Link className="btn solid" to={`/e/${slug}/repaso`}>Ver la lista</Link>
            <button className="btn" disabled={!stats.reviewIds.size} onClick={() => start('review', shuffle(data.questions.filter((q) => stats.reviewIds.has(q.id))).map(toItem), 'Mi lista de repaso')}>Practicarlas</button>
            <button className="btn" disabled={!lastWrongIds.size} onClick={() => start('last_wrong', shuffle(data.questions.filter((q) => lastWrongIds.has(q.id))).map(toItem), 'Falladas del último intento')}>Último intento</button>
          </div>
        </div>
        <div className="card">
          <div className="eyebrow">Compartidas</div>
          <h2>Preguntas del equipo</h2>
          <p>Preguntas de práctica escritas por los compañeros a partir del temario.</p>
          <div className="meta">{stats.team.length} preguntas · {new Set(stats.team.map((q) => q.author_id)).size} autores</div>
          <div className="row">
            <Link className="btn solid" to={`/e/${slug}/equipo`}>Ver y añadir</Link>
            <button className="btn" disabled={!stats.team.length} onClick={() => start('team', practiceItems(stats.team), 'Preguntas del equipo')}>Practicarlas</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Peso de cada dominio · tu acierto acumulado</div>
        {domains.map((d) => {
          const s = stats.perDomain[d.code];
          const pct = s && s.total ? Math.round((s.ok / s.total) * 100) : null;
          const col = pct === null ? 'var(--muted)' : pct >= 80 ? 'var(--ok)' : pct >= 65 ? 'var(--flag)' : 'var(--bad)';
          return (
            <div className="wrow" key={d.id}>
              <span>{d.code} · {d.name}</span>
              <span className="mono" style={{ textAlign: 'right' }}>{Number(d.weight).toFixed(1)}%</span>
              <span className="mono" style={{ textAlign: 'right', color: col, fontWeight: 600 }}>{pct === null ? '—' : pct + '%'}</span>
              <div className="bar"><i style={{ width: `${Math.min(100, (Number(d.weight) / Math.max(...domains.map((x) => Number(x.weight)))) * 100)}%` }} /></div>
            </div>
          );
        })}
      </section>

      <section className="panel">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Tus últimos intentos</div>
        {data.attempts.length ? (
          <div className="table-wrap">
            <table className="simple">
              <thead><tr><th>Fecha</th><th>Modo</th><th>Aciertos</th><th>%</th></tr></thead>
              <tbody>
                {data.attempts.slice(0, 10).map((a) => (
                  <tr key={a.id}><td className="mono">{fmtDate(a.finished_at)}</td><td>{MODE_LABEL[a.mode]}</td><td className="mono">{a.correct}/{a.total}</td><td className="mono">{a.total ? Math.round((a.correct / a.total) * 100) : 0}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="note">Aún no has terminado ningún intento en este examen.</p>}
        {stats.unseen < stats.bank.length && (
          <div className="row" style={{ marginTop: 12 }}>
            {confirmReset ? (
              <>
                <span className="note">Todas las preguntas volverán a contar como no vistas.</span>
                <button className="btn small danger" onClick={async () => { await resetSeen(exam.id); update((d) => ({ ...d, seen: new Set() })); setConfirmReset(false); }}>Confirmar</button>
                <button className="btn small" onClick={() => setConfirmReset(false)}>Cancelar</button>
              </>
            ) : <button className="btn small" onClick={() => setConfirmReset(true)}>Marcar todas como no vistas</button>}
          </div>
        )}
      </section>
    </main>
  );
}
