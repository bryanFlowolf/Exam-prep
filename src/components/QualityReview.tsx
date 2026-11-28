import { useMemo, useState } from 'react';
import type { loadQuality } from '../lib/data';
import { deleteQualityReview, listExams, loadQuality as load, resetQuestionStats, saveQualityReview, setQuestionActive, updateBankQuestion } from '../lib/data';
import { LETTERS, fmtDate } from '../lib/exam';
import type { Exam, Question } from '../lib/types';
import {
  FLAG_LABEL, SEVERITY_RANK, chooseN, detectFlags, findDuplicates, openFlags, score, topSeverity,
  type Flag, type FlagCode, type QualityReview, type Severity,
} from '../lib/quality';
import Stem from './Stem';

type QData = Awaited<ReturnType<typeof loadQuality>>;
type Row = { q: Question; all: Flag[]; open: Flag[]; review?: QualityReview };

/** Flags for every active question of an exam. */
export function analyse(data: QData): Row[] {
  const dups = findDuplicates(data.questions);
  const withEn = data.questions.filter((q) => q.i18n?.en).length;
  const expectTranslation = withEn >= data.questions.length * 0.5;
  return data.questions.map((q) => {
    const s = data.stats.get(q.id);
    const all = detectFlags(q, s, { reports: data.openReports.get(q.id) || 0, duplicateOf: dups.get(q.id), expectTranslation });
    const review = data.reviews.get(q.id);
    return { q, all, open: openFlags(all, review, s), review };
  });
}

const PAGE = 25;

export default function QualityReview({ data, exam, reload }: { data: QData; exam: Exam | undefined; reload: () => void }) {
  const [sev, setSev] = useState<Severity | 'all'>('all');
  const [code, setCode] = useState<FlagCode | 'all'>('all');
  const [showClosed, setShowClosed] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [msg, setMsg] = useState('');
  const rows = useMemo(() => analyse(data), [data]);
  const domains = useMemo(() => new Map(data.domains.map((d) => [d.id, d])), [data]);

  const open = rows.filter((r) => r.open.length);
  const closed = rows.filter((r) => r.review && !r.open.length && r.all.length);
  const counts = { alta: 0, media: 0, baja: 0 } as Record<Severity, number>;
  for (const r of open) counts[topSeverity(r.open)!]++;
  const byCode = new Map<FlagCode, number>();
  for (const r of open) for (const c of new Set(r.open.map((f) => f.code))) byCode.set(c, (byCode.get(c) || 0) + 1);

  const list = (showClosed ? closed : open)
    .filter((r) => showClosed || sev === 'all' || topSeverity(r.open) === sev)
    .filter((r) => code === 'all' || (showClosed ? r.all : r.open).some((f) => f.code === code))
    .sort((a, b) => score(b.open) - score(a.open) || (data.stats.get(b.q.id)?.answered || 0) - (data.stats.get(a.q.id)?.answered || 0));

  const exportFixed = () => {
    const fixed = rows.filter((r) => r.review?.status === 'fixed').map((r) => ({
      id: r.q.id, domain: domains.get(r.q.domain_id)?.code, stem: r.q.stem, options: r.q.options, correct: r.q.correct,
      explanation: r.q.explanation, note: r.review!.note, fixed_at: r.review!.reviewed_at,
    }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exam: exam?.slug, questions: fixed }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `correcciones-${exam?.slug || 'banco'}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const nFixed = rows.filter((r) => r.review?.status === 'fixed').length;

  return (
    <section className="panel">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 className="ph">Revisión automática</h2>
        <span className="spacer" />
        <AllExamsSummary />
      </div>
      <p className="note">
        La app revisa sola cada pregunta: con las estadísticas anónimas (clave dudosa, casi nadie la acierta, distractores que atraen demasiado o que nadie elige)
        y con el propio texto (la correcta destaca por longitud, opciones repetidas, «Elige N» que no cuadra, duplicadas, sin explicación o sin traducción).
        Las señales de datos solo aparecen cuando hay respuestas suficientes para que no sea casualidad.
      </p>
      <div className="row" style={{ margin: '10px 0 6px' }}>
        <button className="chip" aria-pressed={!showClosed && sev === 'all'} onClick={() => { setShowClosed(false); setSev('all'); setLimit(PAGE); }}>Pendientes ({open.length})</button>
        {(['alta', 'media', 'baja'] as Severity[]).map((s) => (
          <button key={s} className={`chip sev-${s}`} aria-pressed={!showClosed && sev === s} onClick={() => { setShowClosed(false); setSev(s); setLimit(PAGE); }}>
            Prioridad {s} ({counts[s]})
          </button>
        ))}
        <button className="chip" aria-pressed={showClosed} onClick={() => { setShowClosed(true); setLimit(PAGE); }}>Revisadas ({closed.length})</button>
        <span className="spacer" />
        <select className="select" aria-label="Tipo de aviso" value={code} onChange={(e) => { setCode(e.target.value as FlagCode | 'all'); setLimit(PAGE); }}>
          <option value="all">Todos los tipos</option>
          {(Object.keys(FLAG_LABEL) as FlagCode[]).filter((c) => byCode.get(c) || code === c).map((c) => <option key={c} value={c}>{FLAG_LABEL[c]} ({byCode.get(c) || 0})</option>)}
        </select>
      </div>
      {msg && <div className="msg err">{msg}</div>}
      {!list.length && <p className="note">{showClosed ? 'Todavía no has revisado ninguna pregunta de este examen.' : 'Ninguna pregunta pendiente con este filtro.'}</p>}
      <div className="list">
        {list.slice(0, limit).map((r) => (
          <QCard key={r.q.id} row={r} data={data} domain={domains.get(r.q.domain_id)?.code} onChange={reload} onError={setMsg} />
        ))}
      </div>
      {list.length > limit && <button className="btn small" style={{ marginTop: 10 }} onClick={() => setLimit((l) => l + PAGE)}>Ver {Math.min(PAGE, list.length - limit)} más ({list.length - limit} restantes)</button>}
      <div className="row" style={{ marginTop: 12 }}>
        <p className="note" style={{ margin: 0, flex: '1 1 380px' }}>
          Las correcciones se guardan en la base de datos al momento. Si el banco se vuelve a cargar desde el repositorio, se sobrescriben:
          exporta las corregidas y pásamelas para incorporarlas al contenido.
        </p>
        <button className="btn small" disabled={!nFixed} onClick={exportFixed}>Exportar corregidas ({nFixed})</button>
      </div>
    </section>
  );
}

function QCard({ row, data, domain, onChange, onError }: { row: Row; data: QData; domain?: string; onChange: () => void; onError: (m: string) => void }) {
  const { q, review } = row;
  const flags = row.open.length ? row.open : row.all;
  const s = data.stats.get(q.id);
  const top = topSeverity(flags);
  const [mode, setMode] = useState<'view' | 'ok' | 'edit'>('view');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const N = s?.answered || 0;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); onError('');
    try { await fn(); onChange(); }
    catch { onError('No se ha podido guardar. Si persiste, comprueba que está aplicada la migración 20261130000000_quality.sql.'); }
    finally { setBusy(false); }
  };

  return (
    <article className={`ritem qcard sev-${top || 'none'}`}>
      <div className="qhead">
        <span className="tag">{domain}</span>
        {[...flags].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).map((f, i) => (
          <span key={i} className={`tag sevtag sev-${f.severity}`}>{FLAG_LABEL[f.code]}</span>
        ))}
        {s && <span className="tag mono">{s.first_answered ? `${Math.round((s.first_correct / s.first_answered) * 100)} % a la primera (${s.first_correct}/${s.first_answered})` : 'sin datos a la primera'} · {N} resp.</span>}
      </div>
      <ul className="flagdetail">{flags.map((f, i) => <li key={i} className={`sev-${f.severity}`}>{f.detail}</li>)}</ul>
      {mode !== 'edit' && (
        <details>
          <summary className="qsum">{q.stem.replace(/```[\s\S]*?```/g, '[material]').slice(0, 160)}{q.stem.length > 160 ? '…' : ''}</summary>
          <Stem text={q.stem} />
          <ul className="optstats">
            {q.options.map((o, i) => {
              const sh = N ? (s!.picks[i] || 0) / N : null;
              return (
                <li key={i} className={q.correct.includes(i) ? 'c' : ''}>
                  <span className="bar" style={{ width: sh === null ? 0 : `${sh * 100}%` }} />
                  <span className="txt">{LETTERS[i]}. {o}</span>
                  <span className="mono pct">{sh === null ? '' : `${Math.round(sh * 100)} %`}</span>
                </li>
              );
            })}
          </ul>
          {q.explanation && <div className="expl">{q.explanation}</div>}
        </details>
      )}
      {review && (
        <p className="note" style={{ margin: '6px 0 0' }}>
          {review.status === 'ok' ? 'Revisada: está bien' : 'Corregida'} el {fmtDate(review.reviewed_at).split(',')[0]}{review.note ? ` · ${review.note}` : ''}
          {row.open.length > 0 && row.open.some((f) => f.fromData) ? ' · vuelve a aparecer porque han llegado muchas respuestas nuevas y el problema sigue.' : ''}
        </p>
      )}
      {mode === 'ok' && (
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input" style={{ flex: '1 1 260px' }} placeholder="Nota (opcional): por qué está bien" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} aria-label="Nota de la revisión" />
          <button className="btn solid small" disabled={busy} onClick={() => act(() => saveQualityReview({ question_id: q.id, exam_id: q.exam_id, status: 'ok', note: note.trim(), answered_at_review: N }))}>Guardar</button>
          <button className="btn small" onClick={() => setMode('view')}>Cancelar</button>
        </div>
      )}
      {mode === 'edit' && <Editor q={q} N={N} busy={busy} onCancel={() => setMode('view')} onSave={(patch, reset, why) => act(async () => {
        await updateBankQuestion(q.id, patch);
        if (reset) await resetQuestionStats(q.id);
        await saveQualityReview({ question_id: q.id, exam_id: q.exam_id, status: 'fixed', note: why, answered_at_review: reset ? 0 : N });
      })} />}
      {mode === 'view' && (
        <div className="row" style={{ marginTop: 8 }}>
          {!review || row.open.length ? <button className="btn small" disabled={busy} onClick={() => setMode('ok')}>Está bien</button> : null}
          <button className="btn small" disabled={busy} onClick={() => setMode('edit')}>Corregir</button>
          <button className={`btn small ${armed ? 'danger' : ''}`} disabled={busy} onClick={() => {
            if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
            act(() => setQuestionActive(q.id, false));
          }}>{armed ? 'Confirmar: desactivar' : 'Desactivar'}</button>
          {review && <><span className="spacer" /><button className="btn small" disabled={busy} onClick={() => act(() => deleteQualityReview(q.id))}>Reabrir</button></>}
        </div>
      )}
    </article>
  );
}

function Editor({ q, N, busy, onCancel, onSave }: { q: Question; N: number; busy: boolean; onCancel: () => void; onSave: (p: { stem: string; options: string[]; correct: number[]; explanation: string }, reset: boolean, why: string) => void }) {
  const [stem, setStem] = useState(q.stem);
  const [options, setOptions] = useState([...q.options]);
  const [correct, setCorrect] = useState<number[]>([...q.correct]);
  const [explanation, setExplanation] = useState(q.explanation || '');
  const [why, setWhy] = useState('');
  const answersChanged = options.length !== q.options.length || options.some((o, i) => o.trim() !== q.options[i]) || [...correct].sort().join() !== [...q.correct].sort().join();
  const [reset, setReset] = useState<boolean | null>(null);
  const doReset = reset ?? answersChanged;
  const multi = q.correct.length > 1 || correct.length > 1;
  const n = chooseN(stem);
  const problems = [
    options.some((o) => !o.trim()) && 'Hay opciones vacías.',
    !correct.length && 'Marca la respuesta correcta.',
    correct.length > 1 && n !== correct.length && `Con ${correct.length} correctas, el enunciado debe decir «(Elige ${correct.length})».`,
    !stem.trim() && 'El enunciado está vacío.',
  ].filter(Boolean) as string[];

  return (
    <div className="form qedit">
      <label className="fl" htmlFor={`st-${q.id}`}>Enunciado</label>
      <textarea id={`st-${q.id}`} className="input" rows={Math.min(14, 3 + stem.split('\n').length)} value={stem} onChange={(e) => setStem(e.target.value)} />
      <div className="fl">Opciones · marca {multi ? 'las correctas' : 'la correcta'}</div>
      {options.map((o, i) => (
        <div key={i} className="row optrow">
          <input type={multi ? 'checkbox' : 'radio'} name={`c-${q.id}`} aria-label={`Opción ${LETTERS[i]} correcta`} checked={correct.includes(i)}
            onChange={() => setCorrect((c) => (multi ? (c.includes(i) ? c.filter((x) => x !== i) : [...c, i].sort()) : [i]))} />
          <span className="mono">{LETTERS[i]}</span>
          <input className="input" style={{ flex: 1, minWidth: 0 }} value={o} onChange={(e) => setOptions((os) => os.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`Texto de la opción ${LETTERS[i]}`} />
        </div>
      ))}
      <label className="fl" htmlFor={`ex-${q.id}`}>Explicación</label>
      <textarea id={`ex-${q.id}`} className="input" rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      <label className="fl" htmlFor={`why-${q.id}`}>Qué has corregido (se guarda con la revisión)</label>
      <input id={`why-${q.id}`} className="input" value={why} maxLength={1000} onChange={(e) => setWhy(e.target.value)} placeholder="p. ej. la opción C también era defendible; reescrita" />
      <label className="row" style={{ gap: 8, marginTop: 6 }}>
        <input type="checkbox" checked={doReset} onChange={(e) => setReset(e.target.checked)} />
        <span>Poner a cero sus estadísticas ({N} respuestas){answersChanged ? ' — recomendado: has cambiado opciones o la respuesta' : ''}</span>
      </label>
      {q.i18n?.en && <p className="note" style={{ margin: 0 }}>La versión en inglés no se modifica aquí{options.length !== q.options.length ? ' y dejará de usarse porque cambia el número de opciones' : ''}.</p>}
      {problems.map((p) => <div key={p} className="msg warn">{p}</div>)}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn solid small" disabled={busy || problems.length > 0}
          onClick={() => onSave({ stem: stem.trim(), options: options.map((o) => o.trim()), correct, explanation: explanation.trim() }, doReset, why.trim() || 'Corregida desde la revisión automática')}>
          {busy ? 'Guardando…' : 'Guardar corrección'}
        </button>
        <button className="btn small" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

/** Pending flags per exam across the whole catalogue, loaded on demand. */
function AllExamsSummary() {
  const [rows, setRows] = useState<{ e: Exam; c: Record<Severity, number>; total: number }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      const exams = await listExams();
      const out = [];
      for (const e of exams) {
        const r = analyse(await load(e.id)).filter((x) => x.open.length);
        const c = { alta: 0, media: 0, baja: 0 } as Record<Severity, number>;
        for (const x of r) c[topSeverity(x.open)!]++;
        out.push({ e, c, total: r.length });
      }
      setRows(out.sort((a, b) => b.c.alta - a.c.alta || b.total - a.total));
    } finally { setLoading(false); }
  };
  if (!rows) return <button className="btn small" disabled={loading} onClick={run}>{loading ? 'Revisando todos los exámenes…' : 'Resumen de todos los exámenes'}</button>;
  return (
    <div className="allsum">
      <div className="table-wrap">
        <table className="simple">
          <thead><tr><th>Examen</th><th>Alta</th><th>Media</th><th>Baja</th><th>Total pendientes</th></tr></thead>
          <tbody>{rows.map(({ e, c, total }) => (
            <tr key={e.id}><td>{e.code || e.name}</td><td className="mono" style={c.alta ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{c.alta}</td><td className="mono">{c.media}</td><td className="mono">{c.baja}</td><td className="mono">{total}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <button className="btn small" onClick={() => setRows(null)}>Cerrar resumen</button>
    </div>
  );
}
