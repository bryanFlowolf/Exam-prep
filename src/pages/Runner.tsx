import { useEffect, useMemo, useRef, useState } from 'react';
import { useMedia } from '../lib/useMedia';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { RUN_KEY, RUN_PROGRESS_KEY, useApp } from '../App';
import { useExam } from '../lib/useExam';
import { LETTERS, answered, clock, isRight } from '../lib/exam';
import { saveAttempt } from '../lib/data';
import type { Domain, Item } from '../lib/types';
import { QL, qText } from '../lib/lang';
import { DocLinks, ReportButton, StatLine } from '../components/QuestionExtras';

export default function Runner() {
  const { slug = '' } = useParams();
  const { userId, session, setSession, lang } = useApp();
  const L = QL[lang];
  const { data, update } = useExam(slug, userId);
  const nav = useNavigate();
  // Progress saved for this run (same startedAt), so a reload or a closed tab resumes where it was.
  const saved = useMemo(() => loadProgress(session?.startedAt), []);
  const [items, setItems] = useState<Item[]>(() => saved?.items || session?.items || []);
  const [i, setI] = useState(saved?.i || 0);
  // Active seconds spent (pauses don't count). The countdown is derived from it.
  const [used, setUsed] = useState(saved?.used || 0);
  const [paused, setPaused] = useState(!!saved);
  const [timerOff, setTimerOff] = useState(!!saved?.timerOff);
  const [timerMenu, setTimerMenu] = useState(false);
  const timed = !!session?.seconds && !timerOff;
  const left = (session?.seconds || 0) - used;
  const [confirming, setConfirming] = useState(false);
  const [quitArmed, setQuitArmed] = useState(false);
  const [done, setDone] = useState<null | { secondsUsed: number | null; saveError?: string; saving: boolean }>(null);
  const finishing = useRef(false);
  const narrow = useMedia('(max-width: 820px)');
  const touch = useRef<{ x: number; y: number } | null>(null);
  const practice = session ? !['sim', 'mini'].includes(session.mode) : false;

  const domainsById = useMemo(() => Object.fromEntries((data?.domains || []).map((d) => [d.id, d])) as Record<string, Domain>, [data]);

  const finish = async (current: Item[]) => {
    if (!session || !data || finishing.current) return;
    finishing.current = true;
    const secondsUsed = session.seconds && !timerOff ? Math.min(used, session.seconds) : used;
    setDone({ secondsUsed, saving: true });
    window.scrollTo(0, 0);
    // The attempt is graded now: drop the saved run so a reload can't submit it twice.
    try { localStorage.removeItem(RUN_PROGRESS_KEY); localStorage.removeItem(RUN_KEY); } catch { /* ignore */ }
    const title = session.seconds && timerOff ? `${session.title} (sin límite de tiempo)` : session.title;
    let res;
    try { res = await saveAttempt(data, session.mode, title, current, secondsUsed, domainsById); }
    catch (e) { setDone({ secondsUsed, saving: false, saveError: e instanceof Error ? e.message : 'error de conexión' }); return; }
    const seen = new Set(data.seen);
    current.filter(answered).forEach((it) => seen.add(it.q.id));
    update((d) => ({ ...d, review: res.review, seen, attempts: res.attempt ? [res.attempt, ...d.attempts] : d.attempts }));
    setDone({ secondsUsed, saving: false, saveError: res.error });
  };

  useEffect(() => {
    if (done || paused || !session) return;
    const t = setInterval(() => setUsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [done, paused, !!session]);
  useEffect(() => { if (timed && left <= 0 && !done) finish(items); }, [left, timed]);
  useEffect(() => {
    if (!session || done) return;
    try { localStorage.setItem(RUN_PROGRESS_KEY, JSON.stringify({ startedAt: session.startedAt, items, i, used, timerOff })); } catch { /* ignore */ }
  }, [items, i, timerOff, Math.floor(used / 5), done]);

  if (!session || session.examSlug !== slug) return <Navigate to={`/e/${slug}`} replace />;
  if (!data) return <div className="center">Cargando…</div>;
  if (done) return <Results items={items} title={session.title} practice={practice} slug={slug} domainsById={domainsById} done={done} onBack={() => { setSession(null); nav(`/e/${slug}`); }} />;

  const it = items[i];
  const t = qText(it.q, lang);
  const multi = it.q.correct.length > 1;
  const locked = practice && it.checked;
  const answeredCount = items.filter((x) => x.pick.length).length;
  const flagged = items.filter((x) => x.flag).length;
  const setItem = (patch: Partial<Item>) => setItems((arr) => arr.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const markReported = (id: string) => update((d) => ({ ...d, reported: new Set(d.reported).add(id) }));
  const author = it.q.source === 'team' && it.q.author_id ? (it.q.author_id === userId ? 'Tú' : data.authors[it.q.author_id] || 'Un compañero') : '';

  const toggle = (k: number) => {
    if (locked) return;
    const struck = (it.struck || []).filter((x) => x !== k);
    if (multi) setItem({ struck, pick: it.pick.includes(k) ? it.pick.filter((x) => x !== k) : [...it.pick, k] });
    else setItem({ struck, pick: [k] });
  };
  const strike = (k: number) => {
    if (locked) return;
    const struck = it.struck || [];
    if (struck.includes(k)) setItem({ struck: struck.filter((x) => x !== k) });
    else setItem({ struck: [...struck, k], pick: it.pick.filter((x) => x !== k) });
  };

  return (
    <>
      <div className="topbar runbar">
        <div className="wrap">
          <span className="runtitle">{session.title}</span>
          <span className="spacer" />
          <span className="mono muted">{i + 1} / {items.length}</span>
          <span className="timerbox">
            <button className={`timer ${timed && left < 600 ? 'low' : ''} ${paused ? 'paused' : ''}`} aria-haspopup="true" aria-expanded={timerMenu}
              aria-label={timed ? `Tiempo restante ${clock(left)}. Opciones del temporizador` : `Tiempo dedicado ${clock(used)}. Opciones del temporizador`}
              onClick={() => setTimerMenu(!timerMenu)}>
              {paused && <span aria-hidden="true">❚❚ </span>}{timed ? clock(left) : clock(used)}
            </button>
            {timerMenu && (
              <div className="timermenu" role="menu">
                <button role="menuitem" className="btn small" onClick={() => { setPaused(!paused); setTimerMenu(false); }}>{paused ? 'Reanudar' : 'Pausar'}</button>
                {!!session.seconds && <button role="menuitem" className="btn small" onClick={() => { setTimerOff(!timerOff); setTimerMenu(false); }}>{timerOff ? 'Volver a la cuenta atrás' : 'Quitar el límite de tiempo'}</button>}
                <p className="note">{session.seconds ? (timerOff ? 'Sin límite: se guarda el tiempo dedicado, sin contar las pausas.' : 'Al quitar el límite, el resultado se guarda marcado como «sin límite de tiempo».') : 'Las pausas no cuentan en el tiempo dedicado.'}</p>
              </div>
            )}
          </span>
          <button className={`btn small ${quitArmed ? 'solid' : ''}`} onClick={() => {
            if (quitArmed) { setSession(null); nav(`/e/${slug}`); } else { setQuitArmed(true); setTimeout(() => setQuitArmed(false), 3000); }
          }}>{quitArmed ? '¿Salir sin corregir?' : 'Salir'}</button>
        </div>
        <div className="progress"><i style={{ width: `${(answeredCount / items.length) * 100}%` }} /></div>
      </div>
      {paused ? (
        <main className="wrap">
          <section className="panel pausepanel">
            <div className="eyebrow">Examen en pausa</div>
            <h2>{session.title}</h2>
            <p className="note">{answeredCount} de {items.length} respondidas{timed ? ` · quedan ${clock(left)}` : ` · ${clock(used)} dedicados`}. El tiempo está parado y tu avance se guarda en este navegador: puedes cerrar la pestaña y seguir más tarde desde la página del examen.</p>
            <button className="btn solid" onClick={() => setPaused(false)}>Reanudar</button>
          </section>
        </main>
      ) : (
      <main className="wrap exam-layout">
        <article className={`qcard ${locked ? 'locked' : ''}`}
          onTouchStart={(e) => { const t0 = e.touches[0]; touch.current = { x: t0.clientX, y: t0.clientY }; }}
          onTouchEnd={(e) => {
            // Swipe left/right to move between questions on phones.
            const s0 = touch.current; touch.current = null;
            if (!s0) return;
            const t1 = e.changedTouches[0];
            const dx = t1.clientX - s0.x, dy = t1.clientY - s0.y;
            if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
            if (dx < 0 && i < items.length - 1) { setI(i + 1); setConfirming(false); window.scrollTo({ top: 0 }); }
            if (dx > 0 && i > 0) { setI(i - 1); setConfirming(false); window.scrollTo({ top: 0 }); }
          }}>
          <div className="qhead">
            <span className="tag">{domainsById[it.q.domain_id]?.code} · {domainsById[it.q.domain_id]?.name}</span>
            {it.q.source === 'official_sample' && <span className="tag accent">Ejemplo de la guía oficial</span>}
            {author && <span className="tag accent">Pregunta del equipo · {author}</span>}
            {multi && <span className="tag multi">{L.choose(it.q.correct.length)}</span>}
            {t.missing && <span className="tag">{L.missing}</span>}
          </div>
          <p className="qtext">{t.stem}</p>
          {!locked && <p className="note" style={{ margin: '0 0 8px' }}>{L.strikeHint}</p>}
          <div className="opts" role={multi ? 'group' : 'radiogroup'}>
            {it.order.map((oi, k) => {
              const sel = it.pick.includes(k);
              const struck = !!it.struck?.includes(k);
              let cls = sel ? 'sel' : '';
              if (locked) { if (it.correct.includes(k)) cls = 'right'; else if (sel) cls = 'wrong'; }
              return (
                <label key={k} className={`opt ${cls} ${struck ? 'struck' : ''}`}
                  onContextMenu={(e) => { e.preventDefault(); strike(k); }}>
                  <input type={multi ? 'checkbox' : 'radio'} name="opt" checked={sel} disabled={locked} onChange={() => toggle(k)} />
                  <span className="key">{LETTERS[k]}</span><span className="otext">{t.options[oi]}</span>
                  <button type="button" className="strikebtn" disabled={locked} aria-pressed={struck}
                    title={struck ? L.unstrike : L.strike} aria-label={`${struck ? L.unstrike : L.strike} ${LETTERS[k]}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); strike(k); }}>
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10h12M7 5.5c.6-1 1.7-1.5 3-1.5 2 0 3.2 1 3.2 2.3M13 14.2c-.5 1.1-1.7 1.8-3.2 1.8-1.9 0-3.1-.9-3.3-2.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                  </button>
                </label>
              );
            })}
          </div>
          {locked && (
            <>
              <div className="expl"><b>{isRight(it) ? L.correct : L.incorrect}</b> {L.answer}: {it.correct.map((k) => LETTERS[k]).join(', ')}. {t.explanation}</div>
              <StatLine stat={data.stats.get(it.q.id)} lang={lang} />
              <DocLinks domain={domainsById[it.q.domain_id]} lang={lang} />
            </>
          )}
          <div className="qfoot"><ReportButton key={it.q.id} questionId={it.q.id} lang={lang} reported={data.reported.has(it.q.id)} onReported={() => markReported(it.q.id)} /></div>
          <div className="row qactions">
            <button className="btn" disabled={i === 0} onClick={() => { setI(i - 1); setConfirming(false); if (narrow) window.scrollTo({ top: 0 }); }}>Anterior</button>
            {practice && <button className="btn solid" disabled={locked || !it.pick.length} onClick={() => setItem({ checked: true })}>Comprobar</button>}
            <button className="btn flagbtn" aria-pressed={it.flag} aria-label={it.flag ? 'Marcada para revisar' : 'Marcar para revisar'} onClick={() => setItem({ flag: !it.flag })}>
              <svg className="only-sm" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 17V3.5M5 4h9l-2 3.5 2 3.5H5" fill={it.flag ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>
              <span className="hide-sm">{it.flag ? 'Marcada para revisar' : 'Marcar para revisar'}</span>
            </button>
            <span className="spacer hide-sm" />
            {i < items.length - 1
              ? <button className={`btn ${practice && !locked ? '' : 'solid'}`} onClick={() => { setI(i + 1); setConfirming(false); if (narrow) window.scrollTo({ top: 0 }); }}>Siguiente</button>
              : narrow && <button className="btn solid" onClick={() => { const pending = items.length - answeredCount; if (!practice && (pending || flagged)) { setConfirming(true); document.getElementById('runside')?.scrollIntoView({ block: 'start' }); } else finish(items); }}>Terminar</button>}
          </div>
        </article>
        <aside className="side" id="runside">
          <details className="navdetails" open={!narrow}>
          <summary className="eyebrow">Navegación · {answeredCount} de {items.length}{flagged ? ` · ${flagged} marcadas` : ''}</summary>
          <div className="navgrid">
            {items.map((x, k) => {
              let c = 'cell';
              if (k === i) c += ' cur';
              if (practice && x.checked) c += isRight(x) ? ' r' : ' w'; else if (x.pick.length) c += ' ans';
              if (x.flag) c += ' flag';
              return <button key={k} className={c} aria-label={`Pregunta ${k + 1}`} onClick={() => { setI(k); setConfirming(false); if (narrow) window.scrollTo({ top: 0 }); }}>{k + 1}</button>;
            })}
          </div>
          </details>
          <div style={{ marginTop: 14 }}>
            <button className={`btn ${i === items.length - 1 ? 'solid' : ''}`} style={{ width: '100%' }} onClick={() => {
              const pending = items.length - answeredCount;
              if (!practice && (pending || flagged)) setConfirming(true); else finish(items);
            }}>{practice ? 'Terminar práctica' : 'Terminar y corregir'}</button>
          </div>
          {confirming && (
            <div className="confirm">
              <span>{items.length - answeredCount} sin responder{flagged ? ` y ${flagged} marcadas para revisar` : ''}. ¿Corregir de todos modos?</span>
              <div className="row"><button className="btn solid" onClick={() => finish(items)}>Corregir ahora</button><button className="btn" onClick={() => setConfirming(false)}>Seguir</button></div>
            </div>
          )}
        </aside>
      </main>
      )}
    </>
  );
}

function loadProgress(startedAt?: number): { items: Item[]; i: number; used: number; timerOff: boolean } | null {
  if (!startedAt) return null;
  try {
    const p = JSON.parse(localStorage.getItem(RUN_PROGRESS_KEY) || 'null');
    return p && p.startedAt === startedAt && Array.isArray(p.items) ? p : null;
  } catch { return null; }
}

function Results({ items, title, practice, slug, domainsById, done, onBack }: {
  items: Item[]; title: string; practice: boolean; slug: string; domainsById: Record<string, Domain>;
  done: { secondsUsed: number | null; saveError?: string; saving: boolean }; onBack: () => void;
}) {
  const { lang, userId } = useApp();
  const { data, update } = useExam(slug, userId);
  const [onlyWrong, setOnlyWrong] = useState(false);
  const graded = practice ? items.filter(answered) : items;
  const ok = graded.filter(isRight).length;
  const n = graded.length || 1;
  const pct = Math.round((ok / n) * 100);
  const byD: Record<string, { ok: number; total: number; d: Domain }> = {};
  for (const x of graded) {
    const d = domainsById[x.q.domain_id];
    if (!d) continue;
    byD[d.id] = byD[d.id] || { ok: 0, total: 0, d };
    byD[d.id].total++;
    if (isRight(x)) byD[d.id].ok++;
  }
  const v = pct >= 80 ? ['pass', 'Listo: por encima del objetivo del 80%'] : pct >= 72 ? ['edge', 'En la zona del aprobado, sin margen'] : ['fail', 'Por debajo del aprobado estimado'];
  const list = graded.filter((x) => !onlyWrong || !isRight(x));

  return (
    <main className="wrap">
      <section className="panel res-top">
        <div>
          <div className="score">{pct}<small>%</small></div>
          <div className="mono muted" style={{ marginTop: 6 }}>{ok} de {graded.length} correctas{done.secondsUsed !== null ? ` · ${clock(done.secondsUsed)}` : ''}</div>
        </div>
        <div>
          <div className="eyebrow">{title}</div>
          <span className={`verdict ${v[0]}`}>{v[1]}</span>
          <p className="note">Referencia práctica: apunta al 80% en el total y a no bajar del 65% en ningún dominio (línea vertical en las barras). {done.saving ? 'Guardando el resultado…' : done.saveError ? '' : 'Resultado guardado en tu cuenta.'}</p>
          {done.saveError && <div className="msg err" style={{ marginTop: 8 }}>No se ha podido guardar todo el resultado: {done.saveError}</div>}
        </div>
      </section>
      <section className="panel">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Resultado por dominio</div>
        {Object.values(byD).sort((a, b) => Number(b.d.weight) - Number(a.d.weight)).map(({ d, ok: o, total }) => {
          const p = Math.round((o / total) * 100);
          const col = p >= 80 ? 'var(--ok)' : p >= 65 ? 'var(--flag)' : 'var(--bad)';
          return (
            <div className="wrow" key={d.id}>
              <span>{d.code} · {d.name} <span className="muted">({Number(d.weight)}%)</span></span>
              <span className="mono" style={{ textAlign: 'right' }}>{o}/{total}</span>
              <span className="mono" style={{ textAlign: 'right', fontWeight: 600, color: col }}>{p}%</span>
              <div className="bar goal"><i style={{ width: `${p}%`, background: col }} /></div>
            </div>
          );
        })}
      </section>
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn solid" onClick={onBack}>Volver al examen</button>
        <Link className="btn" to={`/e/${slug}/repaso`}>Mi lista de repaso</Link>
        <button className="btn" aria-pressed={onlyWrong} onClick={() => setOnlyWrong(!onlyWrong)}>{onlyWrong ? 'Ver todas' : 'Ver solo falladas'}</button>
      </div>
      <section className="list">
        {list.map((x) => {
          const r = isRight(x);
          const k = graded.indexOf(x);
          const xt = qText(x.q, lang);
          return (
            <article key={x.q.id} className={`ritem ${r ? '' : 'bad'}`}>
              <div className="qhead">
                <span className="tag mono">{k + 1}</span>
                <span className="tag">{domainsById[x.q.domain_id]?.code} · {domainsById[x.q.domain_id]?.name}</span>
                <span className="tag" style={{ color: r ? 'var(--ok)' : 'var(--bad)' }}>{r ? 'Correcta' : x.pick.length ? 'Incorrecta' : 'Sin responder'}</span>
                {x.flag && <span className="tag multi">Marcada</span>}
              </div>
              <p className="qtext">{xt.stem}</p>
              <ul>{x.order.map((oi, j) => <li key={j} className={x.correct.includes(j) ? 'c' : x.pick.includes(j) ? 'x' : ''}>{LETTERS[j]}. {xt.options[oi]}</li>)}</ul>
              {xt.explanation && <div className="expl">{xt.explanation}</div>}
              <StatLine stat={data?.stats.get(x.q.id)} lang={lang} />
              <DocLinks domain={domainsById[x.q.domain_id]} lang={lang} />
              <div className="qfoot"><ReportButton questionId={x.q.id} lang={lang} reported={!!data?.reported.has(x.q.id)} onReported={() => update((d) => ({ ...d, reported: new Set(d.reported).add(x.q.id) }))} /></div>
            </article>
          );
        })}
        {!list.length && <p className="note">No hay preguntas falladas.</p>}
      </section>
    </main>
  );
}
