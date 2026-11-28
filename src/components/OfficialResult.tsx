import { useState } from 'react';
import type { ExamData } from '../lib/data';
import { deleteExamResult, saveExamResult } from '../lib/data';
import { fmtDate } from '../lib/exam';
import { passMark, pct, readiness, recentTotals } from '../lib/readiness';

/** Scale of the official score from the exam's pass note: "720/1000" → 1000, otherwise a percentage. */
export function scoreScale(note: string): number {
  const ratio = note.match(/\d+(?:[.,]\d+)?\s*\/\s*(\d+)/);
  return ratio ? Number(ratio[1]) : 100;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * "¿Ya hiciste el examen?": records the official result with the app's raw prediction for that day
 * (computed only from attempts finished up to that date). The results feed the anonymous calibration.
 */
export default function OfficialResult({ data, update }: { data: ExamData; update: (fn: (d: ExamData) => ExamData) => void }) {
  const { exam } = data;
  const scale = scoreScale(exam.passing_note);
  const past = data.targetDate && data.targetDate <= todayIso();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(past ? data.targetDate! : todayIso());
  const [passed, setPassed] = useState<boolean | null>(null);
  const [score, setScore] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  const save = async () => {
    if (passed === null) return setMsg('Indica si aprobaste.');
    let s: number | null = null;
    if (score.trim()) {
      const v = Number(score.replace(',', '.'));
      if (!Number.isFinite(v) || v < 0 || v > scale) return setMsg(`La nota debe estar entre 0 y ${scale}.`);
      s = v / scale;
      const pm = passMark(exam.passing_note);
      if ((s >= pm) !== passed && Math.abs(s - pm) > 0.02) return setMsg(passed ? 'Esa nota está por debajo del aprobado. Revisa la nota o el resultado.' : 'Esa nota supera el aprobado. Revisa la nota o el resultado.');
    }
    // The prediction the app would have shown that day: raw (not calibrated) and only with earlier attempts.
    const end = new Date(date + 'T23:59:59').toISOString();
    const r = readiness(data.domains, recentTotals(data.attempts.filter((a) => a.finished_at <= end)), exam.passing_note);
    setBusy(true); setMsg('');
    try {
      const row = await saveExamResult(exam.id, {
        taken_on: date, passed, score: s, predicted_estimate: r.estimate, predicted_probability: r.probability,
        predicted_answers: r.answered, pass_mark: r.pass,
      });
      update((d) => ({ ...d, results: [row, ...d.results.filter((x) => x.id !== row.id && x.taken_on !== row.taken_on)].sort((a, b) => b.taken_on.localeCompare(a.taken_on)) }));
      setOpen(false); setPassed(null); setScore('');
    } catch {
      setMsg('No se ha podido guardar. Si persiste, pide a un administrador que aplique la última actualización de la base de datos.');
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (armed !== id) { setArmed(id); setTimeout(() => setArmed((a) => (a === id ? null : a)), 3000); return; }
    try { await deleteExamResult(id); update((d) => ({ ...d, results: d.results.filter((x) => x.id !== id) })); }
    catch { setMsg('No se ha podido borrar.'); }
    setArmed(null);
  };

  return (
    <div className="official">
      {data.results.length > 0 && (
        <div className="table-wrap">
          <table className="simple">
            <thead><tr><th>Examen oficial</th><th>Resultado</th><th>Nota</th><th>La app predijo</th><th /></tr></thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{fmtDate(r.taken_on + 'T12:00:00').split(',')[0]}</td>
                  <td><span className={`verdict sm ${r.passed ? 'pass' : 'fail'}`}>{r.passed ? 'Aprobado' : 'No aprobado'}</span></td>
                  <td className="mono">{r.score === null ? '—' : scale === 100 ? pct(r.score) : Math.round(r.score * scale)}</td>
                  <td className="mono">{r.predicted_estimate === null ? 'sin datos' : `${pct(r.predicted_estimate)} · ${pct(r.predicted_probability)} de aprobar`}</td>
                  <td><button className={`btn small ${armed === r.id ? 'solid' : ''}`} onClick={() => remove(r.id)}>{armed === r.id ? 'Confirmar' : 'Borrar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!open ? (
        <button className={`btn ${past && !data.results.some((r) => r.taken_on === data.targetDate) ? 'solid' : ''} small`} onClick={() => setOpen(true)}>
          {data.results.length ? 'Registrar otro resultado oficial' : '¿Ya hiciste el examen oficial? Registra tu resultado'}
        </button>
      ) : (
        <div className="form resultform">
          <div className="row">
            <label className="fl" htmlFor="res-date" style={{ margin: 0 }}>Fecha</label>
            <input id="res-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="chip" aria-pressed={passed === true} onClick={() => setPassed(true)}>Aprobado</button>
            <button className="chip" aria-pressed={passed === false} onClick={() => setPassed(false)}>No aprobado</button>
          </div>
          <div className="row">
            <label className="fl" htmlFor="res-score" style={{ margin: 0 }}>Nota (opcional)</label>
            <input id="res-score" type="number" inputMode="decimal" min={0} max={scale} step="any" style={{ width: 110 }} value={score} onChange={(e) => setScore(e.target.value)} placeholder={scale === 100 ? '%' : `de ${scale}`} />
            <span className="muted">{scale === 100 ? 'en %' : `sobre ${scale}`}</span>
          </div>
          <p className="note">Se guarda con la predicción que tenía la app ese día. Solo tú ves tu resultado; los demás solo ven, de forma anónima y con al menos 3 resultados, cuánto se desvía la predicción. Con la nota, la corrección es más precisa.</p>
          {msg && <div className="msg err">{msg}</div>}
          <div className="row">
            <button className="btn solid small" disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar resultado'}</button>
            <button className="btn small" onClick={() => { setOpen(false); setMsg(''); }}>Cancelar</button>
          </div>
        </div>
      )}
      {!open && msg && <div className="msg err">{msg}</div>}
    </div>
  );
}
