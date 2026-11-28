import { OFFICIAL_GUIDES, SCORING } from '../lib/examInfo';
import ScoringInfo from '../components/ScoringInfo';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { useExam } from '../lib/useExam';
import { buildExamFor, fmtDate, freshFirst, shuffle, toItem, usableScenarios } from '../lib/exam';
import { scText } from '../lib/lang';
import { resetSeen, saveTargetDate } from '../lib/data';
import type { Mode, Question } from '../lib/types';
import { guideFor } from '../lib/registration';
import { MIN_ANSWERS, READY_WINDOW, calibrate, pct, readiness, recentTotals, targetedPool, verdict, weakestDomains } from '../lib/readiness';
import { dueForecast, dueQueue, isMastered } from '../lib/srs';
import StudyPlanPanel from '../components/StudyPlanPanel';
import OfficialResult from '../components/OfficialResult';

const MODE_LABEL: Record<Mode, string> = {
  sim: 'Simulacro', mini: 'Mini-examen', practice: 'Práctica', review: 'Repaso', team: 'Equipo', last_wrong: 'Falladas', targeted: 'Práctica dirigida', daily: 'Sesión del plan', spaced: 'Repaso espaciado',
};

export default function ExamHome() {
  const { slug = '' } = useParams();
  const { userId, session, setSession, lang } = useApp();
  const { data, error, update } = useExam(slug, userId);
  const nav = useNavigate();
  const [practice, setPractice] = useState<Set<string> | null>(null);
  const [scPick, setScPick] = useState<Set<string> | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dateMsg, setDateMsg] = useState('');
  const [readyOpen, setReadyOpen] = useState(loadReadyOpen);
  const toggleReady = () => setReadyOpen((o) => { saveReadyOpen(!o); return !o; });

  const stats = useMemo(() => {
    if (!data) return null;
    const bank = data.questions.filter((q) => q.source !== 'team');
    const team = data.questions.filter((q) => q.source === 'team');
    const unseen = bank.filter((q) => !data.seen.has(q.id)).length;
    const reviewIds = new Set([...data.review.keys()].filter((id) => data.questions.some((q) => q.id === id)));
    const lastScored = data.attempts.find((a) => a.mode === 'sim' || a.mode === 'mini' || a.mode === 'practice');
    const ready = calibrate(readiness(data.domains, recentTotals(data.attempts), data.exam.passing_note), data.calibration);
    const weak = weakestDomains(ready);
    const trend = data.attempts.filter((a) => (a.mode === 'sim' || a.mode === 'mini') && a.total).slice(0, 8).reverse();
    const due = dueQueue(data.questions, data.review, data.domains);
    const forecast = dueForecast(data.questions, data.review, 7);
    const mastered = [...data.review.values()].filter((r) => reviewIds.has(r.question_id) && isMastered(r)).length;
    return { bank, team, unseen, reviewIds, lastScored, ready, weak, trend, due, forecast, mastered };
  }, [data]);

  if (error) return <main className="wrap"><div className="msg err" style={{ marginTop: 24 }}>{error}</div></main>;
  if (!data || !stats) return <div className="center">Cargando…</div>;
  const { exam, domains } = data;
  const scs = usableScenarios(exam, stats.bank);
  const scCount = Math.min(exam.scenario_count || 4, scs.length);
  const scIds = scPick ?? new Set(scs.map((x) => x.code));
  const domainIds = practice ?? new Set(domains.map((d) => d.id));

  const start = (mode: Mode, items: ReturnType<typeof toItem>[], title: string, seconds = 0) => {
    if (!items.length) return;
    setSession({ examSlug: slug, mode, title, items, seconds, startedAt: Date.now() });
    nav(`/e/${slug}/examen`);
  };
  const practiceItems = (pool: Question[]) => freshFirst(pool, data.seen).map(toItem);
  const lastWrongIds = new Set(stats.lastScored?.wrong_question_ids || []);
  const r = stats.ready;
  const v = verdict(r.probability);
  const weakIds = new Set(stats.weak.map((w) => w.domain.id));
  const daysLeft = data.targetDate ? Math.ceil((new Date(data.targetDate + 'T12:00:00').getTime() - Date.now()) / 86400000) : null;
  const onDate = async (value: string) => {
    const date = value || null;
    update((d) => ({ ...d, targetDate: date }));
    try { await saveTargetDate(exam.id, date); setDateMsg(''); } catch { setDateMsg('No se ha podido guardar la fecha.'); }
  };

  const readinessPanel = () => (
    <section className={`panel ready${readyOpen ? '' : ' compact'}`} aria-labelledby="ready-h">
      <div className="ready-head">
        <button className="ready-toggle" aria-expanded={readyOpen} aria-controls="ready-body" onClick={toggleReady}>
          <span className="chev" aria-hidden="true">{readyOpen ? '▾' : '▸'}</span>
          <h2 id="ready-h">Tu preparación</h2>
        </button>
        <span className={`verdict ${v.cls}`}>{v.text}</span>
      </div>
      {!readyOpen && (
        <p className="ready-summary">
          Nota estimada <b>{pct(r.estimate)}</b> · probabilidad de aprobar <b>{pct(r.probability)}</b> · {r.answered} respuestas
          {daysLeft !== null && daysLeft >= 0 && <> · examen {daysLeft === 0 ? 'hoy' : daysLeft === 1 ? 'mañana' : `en ${daysLeft} días`}</>}
        </p>
      )}
      {readyOpen && <div id="ready-body">
      <div className="ready-kpis">
        <div><b>{pct(r.estimate)}</b><span>nota estimada · aprobado {pct(r.pass)}</span></div>
        <div><b>{pct(r.probability)}</b><span>probabilidad de aprobar</span></div>
        <div><b>{r.answered}</b><span>respuestas en tus últimos intentos</span></div>
        <div><b>{pct(r.coverage)}</b><span>del temario con 5+ respuestas</span></div>
        <div className="datecell">
          <label htmlFor="target-date">Fecha de tu examen</label>
          <input id="target-date" type="date" value={data.targetDate || ''} onChange={(e) => onDate(e.target.value)} />
          <span>{daysLeft === null ? 'sin fecha' : daysLeft > 1 ? `faltan ${daysLeft} días` : daysLeft === 1 ? 'mañana' : daysLeft === 0 ? 'hoy' : 'fecha pasada'}</span>
        </div>
      </div>
      {dateMsg && <div className="msg err">{dateMsg}</div>}
      {r.answered < MIN_ANSWERS && (
        <p className="note">Responde al menos {MIN_ANSWERS} preguntas en simulacros, mini-exámenes o práctica para ver la probabilidad de aprobar. Llevas {r.answered}.</p>
      )}
      {stats.trend.length > 1 && (
        <div className="trend" aria-label="Evolución de tus simulacros y mini-exámenes">
          <span className="eyebrow">Simulacros y mini-exámenes</span>
          <div className="trend-bars">
            {stats.trend.map((a) => {
              const p = a.correct / a.total;
              return <i key={a.id} title={`${fmtDate(a.finished_at)} · ${Math.round(p * 100)}%`} className={p >= r.pass ? 'ok' : 'bad'} style={{ height: `${Math.max(6, p * 100)}%` }} />;
            })}
            <b className="passline" style={{ bottom: `${r.pass * 100}%` }} />
          </div>
        </div>
      )}
      <div className="eyebrow" style={{ margin: '14px 0 4px' }}>Por dominio · peso oficial · tu acierto</div>
      {r.domains.map(({ domain: d, ok, total, acc }) => {
        const col = acc === null ? 'var(--muted)' : acc >= Math.max(0.8, r.pass + 0.08) ? 'var(--ok)' : acc >= r.pass ? 'var(--flag)' : 'var(--bad)';
        return (
          <div className="wrow" key={d.id}>
            <span>{d.code} · {d.name}{weakIds.has(d.id) && <span className="tag multi" style={{ marginLeft: 6 }}>Prioridad</span>}</span>
            <span className="mono" style={{ textAlign: 'right' }}>{Number(d.weight).toFixed(0)}%</span>
            <span className="mono" style={{ textAlign: 'right', color: col, fontWeight: 600 }} title={total ? `${ok}/${total}` : 'Sin respuestas'}>{acc === null ? '—' : Math.round(acc * 100) + '%'}</span>
            <div className="bar pass" style={{ ['--pass' as string]: `${r.pass * 100}%` }}><i style={{ width: `${(acc ?? 0) * 100}%`, background: col }} /></div>
          </div>
        );
      })}
      {r.calibration && (
        <p className="note calib">
          Ajustada con <b>{r.calibration.scored} resultados oficiales reales</b>{r.calibration.source === 'all' ? ' de todos los exámenes' : ' de este examen'}:
          {Math.abs(r.calibration.shift) < 0.005 ? ' la predicción ya coincidía con las notas reales.' : <> la app {r.calibration.shift > 0 ? 'sobrestimaba' : 'infravaloraba'} la nota, así que se {r.calibration.shift > 0 ? 'restan' : 'suman'} {Math.abs(r.calibration.shift * 100).toFixed(1)} puntos (sin ajustar: {pct(r.raw.estimate)}).</>}
        </p>
      )}
      <div className="eyebrow" style={{ margin: '14px 0 6px' }}>Resultado oficial</div>
      <OfficialResult data={data} update={update} />
      <p className="note" style={{ marginTop: 10 }}>Se calcula con tus últimos {READY_WINDOW} intentos de simulacro, mini-examen y práctica por dominio (los repasos y la práctica dirigida no cuentan porque se centran en lo que fallaste). Cada dominio pesa como en el examen oficial y los dominios con pocas respuestas cuentan como un 50 % hasta que tengas datos. Es una orientación, no una garantía.</p>
      </div>}
    </section>
  );

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
        {session?.examSlug === slug && (
          <div className="resume">
            <span><b>Tienes un examen a medias:</b> {session.title}.</span>
            <span className="row">
              <button className="btn solid small" onClick={() => nav(`/e/${slug}/examen`)}>Continuar</button>
              <button className="btn small" onClick={() => setSession(null)}>Descartar</button>
            </span>
          </div>
        )}
        <p className="note">Tu progreso se guarda en tu cuenta y solo lo ves tú. Cada modo te muestra primero las preguntas que aún no has respondido.</p>
        {OFFICIAL_GUIDES[exam.slug] && (
          <p className="note">
            <a href={OFFICIAL_GUIDES[exam.slug].url} target="_blank" rel="noopener noreferrer">{OFFICIAL_GUIDES[exam.slug].label} ↗</a>
            {OFFICIAL_GUIDES[exam.slug].note && <> · {OFFICIAL_GUIDES[exam.slug].note}</>}
          </p>
        )}
        {SCORING[exam.vendor] && <ScoringInfo s={SCORING[exam.vendor]} />}
        {guideFor(exam.vendor) && <p className="note"><Link to={`/registro#${exam.vendor.toLowerCase()}`}>Cómo registrarte en el examen oficial de {guideFor(exam.vendor)!.label} →</Link></p>}
      </header>

      {readinessPanel()}

      <StudyPlanPanel data={data} bank={stats.bank} ready={r} start={start} update={update} />

      <section className="grid-cards">
        <div className="card primary">
          <div className="eyebrow">Condiciones de examen</div>
          <h2>Simulacro completo</h2>
          <p>{scs.length
            ? <>{exam.sim_questions} preguntas sobre {scCount} escenarios elegidos al azar entre {scs.length}, como en el examen real: el escenario a la izquierda y sus preguntas a la derecha. Con cronómetro; se corrige al terminar.</>
            : <>{exam.sim_questions} preguntas con el reparto por dominios del examen y cronómetro. Se corrige al terminar.</>}</p>
          <div className="meta">{exam.sim_questions} preguntas · {exam.sim_minutes}:00</div>
          <button className="btn solid" onClick={() => start('sim', buildExamFor(exam, domains, stats.bank, exam.sim_questions, data.seen), 'Simulacro completo', exam.sim_minutes * 60)}>Empezar simulacro</button>
        </div>
        <div className="card">
          <div className="eyebrow">Diagnóstico</div>
          <h2>Mini-examen</h2>
          <p>{scs.length ? `${exam.mini_questions} preguntas sobre ${scCount} escenarios al azar.` : `${exam.mini_questions} preguntas con el mismo reparto proporcional.`}</p>
          <div className="meta">{exam.mini_questions} preguntas · {exam.mini_minutes}:00</div>
          <button className="btn" onClick={() => start('mini', buildExamFor(exam, domains, stats.bank, exam.mini_questions, data.seen), 'Mini-examen', exam.mini_minutes * 60)}>Empezar mini-examen</button>
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
        {scs.length > 0 && (
          <div className="card">
            <div className="eyebrow">Sin reloj</div>
            <h2>Práctica por escenario</h2>
            <p>Elige escenarios y corrige cada pregunta al momento, con el escenario siempre a la vista.</p>
            <div className="row" style={{ gap: 6 }}>
              {scs.map((x) => (
                <button key={x.code} className="chip" aria-pressed={scIds.has(x.code)} onClick={() => {
                  const n = new Set(scIds); if (n.has(x.code)) n.delete(x.code); else n.add(x.code); setScPick(n);
                }}>{scText(x, lang).title}</button>
              ))}
            </div>
            <button className="btn" disabled={!scIds.size} onClick={() => {
              const pool = stats.bank.filter((q) => q.scenario && scIds.has(q.scenario));
              // Keep each scenario's questions together, unseen first.
              const items = scs.filter((x) => scIds.has(x.code)).flatMap((x) => freshFirst(pool.filter((q) => q.scenario === x.code), data.seen)).map(toItem);
              start('practice', items, 'Práctica por escenario');
            }}>Empezar práctica</button>
          </div>
        )}
        <div className="card targeted">
          <div className="eyebrow">Tus puntos débiles</div>
          <h2>Práctica dirigida</h2>
          <p>{stats.ready.answered
            ? <>Los dominios donde más puntos puedes ganar según tu acierto y su peso en el examen: <b>{stats.weak.map((w) => w.domain.code).join(' y ') || '—'}</b>. Empieza por las preguntas que fallaste.</>
            : <>Todavía no hay resultados tuyos: empieza por los dominios que más pesan, <b>{stats.weak.map((w) => w.domain.code).join(' y ')}</b>.</>}</p>
          <div className="meta">20 preguntas · corrección al momento</div>
          <button className="btn" disabled={!stats.weak.length} onClick={() => start('targeted', targetedPool(stats.weak.map((w) => w.domain), stats.bank, data.review, data.seen).map(toItem), `Práctica dirigida: ${stats.weak.map((w) => w.domain.code).join(' y ')}`)}>Practicar puntos débiles</button>
        </div>
        <div className="card spaced">
          <div className="eyebrow">Repaso espaciado</div>
          <h2>Lo que toca repasar hoy</h2>
          <p>Cada pregunta que fallas vuelve mañana; si la aciertas, vuelve cada vez más tarde (3, 7, 15 días…). Los dominios flojos y las preguntas difíciles vuelven antes, y todo pasa una última vez antes de tu examen.</p>
          <div className="forecast" aria-label="Repasos de los próximos 7 días">
            {stats.forecast.map((n, i) => {
              const max = Math.max(1, ...stats.forecast);
              return <i key={i} title={`${i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : `En ${i} días`}: ${n}`} className={i === 0 ? 'now' : ''} style={{ height: `${Math.max(4, (n / max) * 100)}%` }} />;
            })}
          </div>
          <div className="meta">{stats.due.length} para hoy · {stats.forecast[1]} mañana · {stats.mastered} dominadas</div>
          <button className={`btn ${stats.due.length ? 'solid' : ''}`} disabled={!stats.due.length} onClick={() => start('spaced', stats.due.slice(0, 40).map(toItem), 'Repaso espaciado')}>
            {stats.due.length ? `Repasar ${Math.min(40, stats.due.length)} preguntas` : 'Nada pendiente hoy'}
          </button>
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

/** Whether "Tu preparación" is expanded; one preference for every exam, kept in this browser. */
const READY_KEY = 'exam-prep-readiness-open';
function loadReadyOpen(): boolean {
  try { return localStorage.getItem(READY_KEY) !== '0'; } catch { return true; }
}
function saveReadyOpen(open: boolean) {
  try { localStorage.setItem(READY_KEY, open ? '1' : '0'); } catch { /* private window: keep it for this visit only */ }
}
