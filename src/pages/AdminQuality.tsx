import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useApp } from '../App';
import { listExams, listReports, loadCalibration, loadQuality, resolveReport, setQuestionActive, type ReportRow } from '../lib/data';
import { LETTERS, fmtDate } from '../lib/exam';
import { QL } from '../lib/lang';
import type { Calibration, Domain, Exam, Question, QuestionReport, QuestionStat } from '../lib/types';
import { MIN_STAT } from '../components/QuestionExtras';
import { AdminTabs } from './Admin';
import Stem from '../components/Stem';
import QualityReview from '../components/QualityReview';

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
      <CalibrationPanel />
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
      <p className="note" style={{ marginTop: 10 }}>Una pregunta reportada aparece también en la <i>Revisión automática</i>, donde puedes corregirla o desactivarla sin borrar el progreso de nadie. Las correcciones hechas aquí se pierden si el banco se reimporta desde <code>content/exams/</code>: exporta las corregidas para incorporarlas.</p>
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
  const reload = () => loadQuality(examId).then(setData).catch(() => setErr('No se han podido cargar las estadísticas.'));
  useEffect(() => {
    if (!examId) return;
    setData(null);
    reload();
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
    <>
    <div className="row examsel">
      <label className="fl" htmlFor="q-exam" style={{ margin: 0 }}>Examen</label>
      <select id="q-exam" value={examId} onChange={(e) => setExamId(e.target.value)} className="select">
        {exams.map((e) => <option key={e.id} value={e.id}>{e.code || e.vendor} · {e.name}</option>)}
      </select>
    </div>
    {data && <QualityReview data={data} exam={exams.find((e) => e.id === examId)} reload={reload} />}
    <section className="panel">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 className="ph">Estadísticas por pregunta</h2>
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
    </>
  );
}

/** Prediction vs official results, anonymous and only with 3+ results per row. */
function CalibrationPanel() {
  const [rows, setRows] = useState<{ label: string; c: Calibration }[] | null>(null);
  useEffect(() => {
    (async () => {
      const exams = await listExams().catch(() => []);
      const all = await loadCalibration(null);
      const per = await Promise.all(exams.map(async (e) => ({ label: `${e.code || e.name}`, c: await loadCalibration(e.id) })));
      setRows([
        ...(all ? [{ label: 'Todos los exámenes', c: all }] : []),
        ...per.filter((x): x is { label: string; c: Calibration } => Boolean(x.c && x.c.n > 0)),
      ]);
    })();
  }, []);
  const p = (x: number | null, d = 0) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);
  return (
    <section className="panel">
      <h2 className="ph">Calibración de la predicción</h2>
      <p className="note">Cuando alguien registra su resultado oficial, se guarda con la nota estimada y la probabilidad que la app le daba ese día. Aquí se compara de forma anónima (sin cifras por debajo de 3 resultados). La app corrige la nota estimada con el sesgo medio en cuanto hay 3 resultados con nota: primero con los de cada examen y, si no hay bastantes, con los de todos.</p>
      {!rows && <p className="note">Cargando…</p>}
      {rows && !rows.length && <p className="note">Todavía no hay resultados oficiales registrados (o falta aplicar la migración 20261129000000_study.sql).</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="simple">
            <thead><tr><th>Examen</th><th>Resultados</th><th>Con nota</th><th>Sesgo medio</th><th>Desviación</th><th>Prob. media prevista</th><th>Aprobados reales</th><th>Brier</th><th>Por tramo de probabilidad</th></tr></thead>
            <tbody>
              {rows.map(({ label, c }) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="mono">{c.n}</td>
                  <td className="mono">{c.n_scored}</td>
                  <td className="mono" title="Nota estimada menos nota real: positivo = la app sobrestima">{c.mean_bias === null ? '—' : `${c.mean_bias > 0 ? '+' : ''}${(c.mean_bias * 100).toFixed(1)} pts`}</td>
                  <td className="mono">{c.sd_resid === null ? '—' : `${(c.sd_resid * 100).toFixed(1)} pts`}</td>
                  <td className="mono">{p(c.mean_prob)}</td>
                  <td className="mono">{p(c.pass_rate)}</td>
                  <td className="mono" title="0 = perfecto; 0,25 = como tirar una moneda">{c.brier === null ? '—' : c.brier.toFixed(3)}</td>
                  <td className="mono">{c.bins ? c.bins.map((b) => `${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%: ${b.passed}/${b.n}`).join(' · ') : n3(c.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
const n3 = (n: number) => (n < 3 ? `faltan ${3 - n} para ver cifras` : '—');
