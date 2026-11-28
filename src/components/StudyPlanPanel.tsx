import { useMemo, useState } from 'react';
import type { ExamData } from '../lib/data';
import { savePlanPrefs } from '../lib/data';
import type { Readiness } from '../lib/readiness';
import type { Item, Mode, Question } from '../lib/types';
import { buildExamFor, toItem } from '../lib/exam';
import { DAY_KIND, WEEKDAYS, WEEKDAY_NAMES, sessionQuestions, studyPlan } from '../lib/plan';

const MINUTES = [15, 20, 30, 45, 60, 90, 120];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

type Props = {
  data: ExamData;
  bank: Question[];
  ready: Readiness;
  start: (mode: Mode, items: Item[], title: string, seconds?: number) => void;
  update: (fn: (d: ExamData) => ExamData) => void;
};

export default function StudyPlanPanel({ data, bank, ready, start, update }: Props) {
  const [msg, setMsg] = useState('');
  const [prefsOpen, setPrefsOpen] = useState(false);
  const p = useMemo(
    () => studyPlan({ exam: data.exam, domains: data.domains, bank, seen: data.seen, review: data.review, attempts: data.attempts, plan: { ...data.plan, target_date: data.targetDate }, ready }),
    [data, bank, ready],
  );
  const { exam } = data;
  const t = p.today;
  const savePrefs = async (patch: Partial<typeof data.plan>) => {
    const next = { ...data.plan, ...patch };
    update((d) => ({ ...d, plan: next }));
    try { await savePlanPrefs(exam.id, { daily_minutes: next.daily_minutes, study_days: next.study_days }); setMsg(''); }
    catch { setMsg('No se han podido guardar tus preferencias. Si persiste, pide a un administrador que aplique la última actualización de la base de datos.'); }
  };

  const go = () => {
    if (t.kind === 'mini') return start('mini', buildExamFor(exam, data.domains, bank, exam.mini_questions, data.seen), 'Mini-examen de control', exam.mini_minutes * 60);
    if (t.kind === 'sim') return start('sim', buildExamFor(exam, data.domains, bank, exam.sim_questions, data.seen), 'Simulacro del plan', exam.sim_minutes * 60);
    const qs = sessionQuestions(p, data.domains, bank, data.seen, data.review);
    start('daily', qs.map(toItem), t.kind === 'light' ? 'Repaso ligero' : 'Sesión de hoy');
  };

  const remaining = Math.max(0, t.target - t.done);
  const doneToday = t.target > 0 && t.done >= t.target;
  const headline = t.kind === 'exam' ? 'Hoy es tu examen'
    : !t.isStudyDay && t.kind === 'rest' ? 'Hoy es día libre'
    : doneToday ? 'Sesión de hoy completada'
    : DAY_KIND[t.kind].label;
  const mixText = [
    t.mix.due && `${t.mix.due} repasos que tocan hoy`,
    t.mix.focus && `${t.mix.focus} de ${t.focus.map((d) => d.code).join(' y ')}`,
    t.mix.fresh && `${t.mix.fresh} nuevas de todo el temario`,
  ].filter(Boolean).join(' · ');
  const desc = t.kind === 'mini' ? `Toca medir: ${exam.mini_questions} preguntas en ${exam.mini_minutes} min con el reparto del examen. Actualiza tu nota estimada.`
    : t.kind === 'sim' ? `Simulacro completo en condiciones reales: ${exam.sim_questions} preguntas, ${exam.sim_minutes} min.`
    : t.kind === 'exam' ? 'Mucha suerte. Cuando tengas la nota, regístrala en tu panel de preparación.'
    : t.kind === 'light' ? (t.target ? `Solo los ${t.target} repasos más urgentes. Nada nuevo.` : 'No tienes repasos pendientes: descansa.')
    : t.kind === 'rest' ? `Si te apetece, puedes hacer una sesión opcional: ${mixText}.`
    : `${t.target} preguntas, unos ${data.plan.daily_minutes} min: ${mixText}.`;
  const btn = t.kind === 'mini' ? 'Hacer el mini-examen' : t.kind === 'sim' ? 'Empezar el simulacro' : t.kind === 'rest' ? 'Sesión opcional' : doneToday ? 'Otra sesión' : 'Empezar la sesión de hoy';

  return (
    <section className="panel plan" aria-labelledby="plan-h">
      <div className="ready-head">
        <h2 id="plan-h">Tu plan de estudio</h2>
        <span className={`phase ${p.phase.key}`}>{p.phase.title}{p.daysLeft !== null && p.daysLeft > 0 ? ` · ${p.daysLeft} días` : ''}</span>
      </div>
      <p className="note" style={{ marginTop: 4 }}>{p.phase.text}</p>

      <div className="today">
        <div className="today-main">
          <div className="eyebrow">Hoy · {WEEKDAY_NAMES[new Date().getDay()]}</div>
          <h3>{headline}</h3>
          <p>{desc}</p>
          {t.target > 0 && t.kind !== 'exam' && (
            <div className="todaybar" aria-label={`Hoy llevas ${t.done} de ${t.target} preguntas`}>
              <i style={{ width: `${Math.min(100, (t.done / t.target) * 100)}%` }} />
              <span>{doneToday ? `${t.done} preguntas hoy · objetivo de ${t.target} cumplido` : `${t.done} / ${t.target} preguntas hoy · faltan ${remaining}`}</span>
            </div>
          )}
        </div>
        {t.kind !== 'exam' && !(t.kind === 'light' && !t.target) && (
          <button className={`btn ${doneToday || t.kind === 'rest' ? '' : 'solid'}`} onClick={go}>{btn}</button>
        )}
      </div>

      <div className="week" role="list" aria-label="Próximos 7 días">
        {p.week.map((d) => (
          <div role="listitem" key={d.date.getTime()} className={`wday ${d.kind}${d.isToday ? ' now' : ''}`} title={`${WEEKDAY_NAMES[d.date.getDay()]} ${d.date.getDate()}: ${DAY_KIND[d.kind].label}`}>
            <span className="wd">{WEEKDAYS[d.date.getDay()]} {d.date.getDate()}</span>
            <span className="wk">{DAY_KIND[d.kind].short}</span>
          </div>
        ))}
      </div>

      {p.warnings.map((w) => <p key={w} className="msg warn">{w}</p>)}

      <div className="planfoot">
        <span className="muted">
          {p.streak > 1 ? <>Racha: <b>{p.streak} días de estudio seguidos</b> · </> : null}
          {data.plan.daily_minutes} min · {ORDER.filter((d) => data.plan.study_days.includes(d)).map((d) => WEEKDAYS[d]).join(' ')}
          {p.studyDaysLeft !== null ? ` · ${p.studyDaysLeft} días de estudio hasta el examen` : ''}
        </span>
        <button className="btn small" aria-expanded={prefsOpen} onClick={() => setPrefsOpen((o) => !o)}>{prefsOpen ? 'Cerrar' : 'Ajustar mi plan'}</button>
      </div>
      {prefsOpen && (
        <div className="planprefs">
          <label className="fl" htmlFor="plan-min">Tiempo al día</label>
          <select id="plan-min" value={data.plan.daily_minutes} onChange={(e) => savePrefs({ daily_minutes: Number(e.target.value) })}>
            {[...new Set([...MINUTES, data.plan.daily_minutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
          <div className="fl">Días que estudias</div>
          <div className="row" style={{ gap: 6 }}>
            {ORDER.map((d) => {
              const on = data.plan.study_days.includes(d);
              return (
                <button key={d} className="chip" aria-pressed={on} aria-label={WEEKDAY_NAMES[d]} onClick={() => {
                  const next = on ? data.plan.study_days.filter((x) => x !== d) : [...data.plan.study_days, d];
                  if (next.length) savePrefs({ study_days: next.sort() });
                }}>{WEEKDAYS[d]}</button>
              );
            })}
          </div>
          <p className="note">La fecha del examen se cambia en <i>Tu preparación</i>. Cada sesión dura unas {p.perSession} preguntas (≈{Math.round(p.secondsPerQuestion / 6) / 10} min por pregunta con la explicación).</p>
        </div>
      )}
      {msg && <div className="msg err">{msg}</div>}
    </section>
  );
}
