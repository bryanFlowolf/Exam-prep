import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useApp } from '../App';
import { listExams, listReports, loadQuality, resolveReport, setQuestionActive, type ReportRow } from '../lib/data';
import { LETTERS, fmtDate } from '../lib/exam';
import { QL } from '../lib/lang';
import type { Domain, Exam, Question, QuestionReport, QuestionStat } from '../lib/types';
import { MIN_STAT } from '../components/QuestionExtras';
import { AdminTabs } from './Admin';
import Stem from '../components/Stem';

const REASON = QL.es.reasons;

export default function AdminQuality() {
  const { profile } = useApp();
  if (!profile) return <div className="center">Cargando…</div>;
  if (!profile.is_admin) return <Navigate to="/" replace />;
  return (
    <main className="wrap">
      <header className="hero">
        <div className="eyebrow">Solo administradores</div>
        <h1>Calidad del banco</h1>
        <p>Los reportes que envían los usuarios y las estadísticas anónimas de cada pregunta: cuántas personas la aciertan a la primera y qué opciones eligen. Una pregunta que casi nadie acierta suele tener un problema de redacción.</p>
      </header>
      <AdminTabs />
      <Reports />
      <Quality />
    </main>
  );
}

function Reports() {
  const [status, setStatus] = useState<QuestionReport['status'] | 'all'>('abierto');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = async () => {
    try { setRows(await listReports(status)); setErr(''); }
    catch { setErr('No se han podido cargar los reportes. ¿Está aplicada la migración 20261124000000_insights.sql?'); setRows([]); }
  };
  useEffect(() => { setRows(null); load(); }, [status]);

  const act = async (r: ReportRow, s: QuestionReport['status']) => {
    try { await resolveReport(r.id, s, notes[r.id] ?? r.admin_note); load(); }
    catch { setErr('No se ha podido actualizar el reporte.'); }
  };

  return (
    <section className="panel">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 className="ph">Reportes de preguntas</h2>
        <span className="spacer" />
        {(['abierto', 'resuelto', 'descartado', 'all'] as const).map((s) => (
          <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{s === 'all' ? 'Todos' : s[0].toUpperCase() + s.slice(1) + 's'}</button>
        ))}
      </div>
      {err && <div className="msg err">{err}</div>}
      {!rows && <p className="note">Cargando…</p>}
      {rows && !rows.length && !err && <p className="note">No hay reportes {status === 'all' ? '' : status + 's'}.</p>}
      <div className="list">
        {rows?.map((r) => {
          const q = r.question;
          const tr = q && r.lang !== 'es' ? q.i18n?.[r.lang] : undefined;
          return (
            <article key={r.id} className={`ritem ${r.status === 'abierto' ? 'flagged' : ''}`}>
              <div className="qhead">
                <span className="tag">{r.exam?.code || r.exam?.name}</span>
                <span className="tag multi">{REASON[r.reason]}</span>
                {r.lang !== 'es' && <span className="tag">Leída en {r.lang.toUpperCase()}</span>}
                <span className="tag">{r.reporter} · {fmtDate(r.created_at)}</span>
                {r.status !== 'abierto' && <span className="tag">{r.status}{r.resolved_at ? ` · ${fmtDate(r.resolved_at)}` : ''}</span>}
              </div>
              {r.comment && <p className="quote">“{r.comment}”</p>}
              {q ? (
                <>
                  <Stem text={q.stem} />
                  <ul>{q.options.map((o, i) => <li key={i} className={q.correct.includes(i) ? 'c' : ''}>{LETTERS[i]}. {o}{tr ? <span className="muted"> · {tr.options[i]}</span> : null}</li>)}</ul>
                  {tr && <p className="note" style={{ marginTop: 6 }}>{tr.stem}</p>}
                  {q.explanation && <div className="expl">{q.explanation}</div>}
                  {!q.is_active && <p className="note">Esta pregunta está desactivada.</p>}
                </>
              ) : <p className="note">La pregunta ya no existe.</p>}
              <div className="form" style={{ marginTop: 10 }}>
                <label className="fl" htmlFor={`note-${r.id}`}>Nota de resolución</label>
                <input id={`note-${r.id}`} type="text" maxLength={1000} value={notes[r.id] ?? r.admin_note} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} placeholder="Qué se ha hecho (opcional)" />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                {r.status === 'abierto' ? (
                  <>
                    <button className="btn small solid" onClick={() => act(r, 'resuelto')}>Marcar resuelto</button>
                    <button className="btn small" onClick={() => act(r, 'descartado')}>Descartar</button>
                  </>
                ) : <button className="btn small" onClick={() => act(r, 'abierto')}>Reabrir</button>}
                {q && q.is_active && <button className="btn small danger" onClick={async () => { await setQuestionActive(q.id, false); load(); }}>Desactivar la pregunta</button>}
                {q && !q.is_active && <button className="btn small" onClick={async () => { await setQuestionActive(q.id, true); load(); }}>Reactivar la pregunta</button>}
              </div>
            </article>
          );
        })}
      </div>
      <p className="note" style={{ marginTop: 10 }}>Corregir el texto de una pregunta del banco se hace en su fichero de <code>content/exams/</code> y reimportando; desactivarla la retira de inmediato sin borrar el progreso de nadie.</p>
    </section>
  );
}

type QRow = { q: Question; d?: Domain; s?: QuestionStat; rate: number | null; reports: number; topWrong: { i: number; share: number } | null };

function Quality() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState('');
  const [data, setData] = useState<Awaited<ReturnType<typeof loadQuality>> | null>(null);
  const [sort, setSort] = useState<'hard' | 'easy' | 'reports' | 'answered'>('hard');
  const [err, setErr] = useState('');

  useEffect(() => { listExams().then((e) => { setExams(e); if (e[0]) setExamId(e[0].id); }).catch(() => setErr('No se han podido cargar los exámenes.')); }, []);
  useEffect(() => {
    if (!examId) return;
    setData(null);
    loadQuality(examId).then(setData).catch(() => setErr('No se han podido cargar las estadísticas.'));
  }, [examId]);

  const rows = useMemo<QRow[]>(() => {
    if (!data) return [];
    const dm = new Map(data.domains.map((d) => [d.id, d]));
    return data.questions.map((q) => {
      const s = data.stats.get(q.id);
      const rate = s && s.first_answered >= MIN_STAT ? s.first_correct / s.first_answered : null;
      let topWrong: QRow['topWrong'] = null;
      if (s && s.answered >= MIN_STAT) {
        q.options.forEach((_, i) => {
          if (q.correct.includes(i)) return;
          const share = (s.picks[i] || 0) / s.answered;
          if (!topWrong || share > topWrong.share) topWrong = { i, share };
        });
      }
      return { q, d: dm.get(q.domain_id), s, rate, reports: data.openReports.get(q.id) || 0, topWrong };
    });
  }, [data]);

  const measured = rows.filter((r) => r.rate !== null);
  const sorted = [...(sort === 'reports' ? rows.filter((r) => r.reports) : sort === 'answered' ? rows : measured)].sort((a, b) =>
    sort === 'hard' ? (a.rate! - b.rate!) : sort === 'easy' ? (b.rate! - a.rate!) : sort === 'reports' ? b.reports - a.reports : (b.s?.answered || 0) - (a.s?.answered || 0)).slice(0, 50);
  const totalAnswers = rows.reduce((n, r) => n + (r.s?.answered || 0), 0);

  return (
    <section className="panel">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 className="ph">Estadísticas por pregunta</h2>
        <span className="spacer" />
        <select aria-label="Examen" value={examId} onChange={(e) => setExamId(e.target.value)} className="select">
          {exams.map((e) => <option key={e.id} value={e.id}>{e.code || e.vendor} · {e.name}</option>)}
        </select>
      </div>
      {err && <div className="msg err">{err}</div>}
      {!data && !err && <p className="note">Cargando…</p>}
      {data && (
        <>
          <p className="note">{totalAnswers} respuestas registradas · {measured.length} de {rows.length} preguntas con al menos {MIN_STAT} respuestas a la primera. Las estadísticas son anónimas: no guardan quién respondió.</p>
          <div className="row" style={{ margin: '10px 0' }}>
            {([['hard', 'Más falladas'], ['easy', 'Más acertadas'], ['reports', 'Con reportes abiertos'], ['answered', 'Más respondidas']] as const).map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>
            ))}
          </div>
          {!sorted.length && <p className="note">Todavía no hay datos suficientes en este filtro.</p>}
          {sorted.length > 0 && <div className="table-wrap">
            <table className="simple quality">
              <thead><tr><th>Pregunta</th><th>Dominio</th><th>A la primera</th><th>Respuestas</th><th>Distractor más elegido</th><th>Reportes</th></tr></thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.q.id}>
                    <td><details><summary>{r.q.stem.length > 110 ? r.q.stem.slice(0, 110) + '…' : r.q.stem}</summary>
                      <ul>{r.q.options.map((o, i) => <li key={i} className={r.q.correct.includes(i) ? 'c' : ''}>{LETTERS[i]}. {o} <span className="muted mono">{r.s && r.s.answered ? Math.round(((r.s.picks[i] || 0) / r.s.answered) * 100) + '%' : ''}</span></li>)}</ul>
                    </details></td>
                    <td className="mono">{r.d?.code}</td>
                    <td className="mono" style={{ color: r.rate === null ? undefined : r.rate < 0.4 ? 'var(--bad)' : r.rate < 0.7 ? 'var(--flag)' : 'var(--ok)', fontWeight: 600 }}>{r.rate === null ? '—' : Math.round(r.rate * 100) + '%'}</td>
                    <td className="mono">{r.s?.answered || 0}</td>
                    <td>{r.topWrong ? <><span className="mono">{LETTERS[r.topWrong.i]}</span> · {Math.round(r.topWrong.share * 100)}%</> : '—'}</td>
                    <td className="mono">{r.reports || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </>
      )}
    </section>
  );
}
