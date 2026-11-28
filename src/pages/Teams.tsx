import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { listTeamMembers, listTeams, loadCalibration, loadExamsWithDomains, setShareProgress, teamActivity, teamProgress } from '../lib/data';
import { fmtDate } from '../lib/exam';
import { MIN_ANSWERS, calibrate, pct, readiness, verdict, type CalibratedReadiness } from '../lib/readiness';
import type { Calibration, Domain, Exam, Team, TeamActivityRow, TeamMember, TeamProgressRow } from '../lib/types';

export default function Teams() {
  const { userId, profile } = useApp();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [mine, setMine] = useState<TeamMember[]>([]);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const [t, m] = await Promise.all([listTeams(), listTeamMembers()]);
      setTeams(t); setMine(m.filter((x) => x.user_id === userId));
    } catch { setErr('No se han podido cargar tus equipos.'); setTeams([]); }
  };
  useEffect(() => { load(); }, [userId]);

  const myTeams = (teams || []).filter((t) => mine.some((m) => m.team_id === t.id));

  return (
    <main className="wrap">
      <header className="hero">
        <div className="eyebrow">Equipos</div>
        <h1>Mis equipos</h1>
        <p>Tu progreso es privado. Si lo compartes con un equipo, sus responsables verán un resumen por examen: nota estimada, probabilidad de aprobar, preguntas respondidas, constancia (días que practicas), repasos pendientes, última actividad, último simulacro, la fecha de tu examen y el resultado oficial si lo registras. Nunca verán qué preguntas fallaste ni tus respuestas.</p>
      </header>
      {err && <div className="msg err">{err}</div>}
      {!teams && !err && <div className="center">Cargando…</div>}
      {teams && !myTeams.length && (
        <div className="panel"><p className="note">Todavía no perteneces a ningún equipo. {profile?.is_admin ? <>Puedes crearlos en <Link to="/admin/equipos">Administración → Equipos</Link>.</> : 'Un administrador puede añadirte a uno.'}</p></div>
      )}
      {myTeams.map((t) => {
        const me = mine.find((m) => m.team_id === t.id)!;
        return <TeamPanel key={t.id} team={t} me={me} onChange={load} />;
      })}
    </main>
  );
}

function TeamPanel({ team, me, onChange }: { team: Team; me: TeamMember; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <section className="panel">
      <div className="row">
        <h2 className="ph">{team.name}</h2>
        <span className="tag">{me.role === 'lead' ? 'Responsable' : 'Miembro'}</span>
      </div>
      <label className="sharetoggle">
        <input type="checkbox" checked={me.shares_progress} disabled={busy} onChange={async (e) => {
          setBusy(true); setErr('');
          try { await setShareProgress(team.id, e.target.checked); onChange(); }
          catch { setErr('No se ha podido cambiar. Inténtalo de nuevo.'); }
          finally { setBusy(false); }
        }} />
        <span><b>Compartir mi progreso con los responsables de {team.name}</b><br /><span className="muted">Puedes desactivarlo cuando quieras; dejarán de verlo al momento.</span></span>
      </label>
      {err && <div className="msg err">{err}</div>}
      {me.role === 'lead' && <LeadView team={team} />}
    </section>
  );
}

type Person = { user_id: string; name: string; role: TeamMember['role']; shares: boolean; rows: TeamProgressRow[] };
type Alert = { level: 'bad' | 'warn' | 'ok' | 'info'; who: string; exam: string; text: string; rank: number };

const DAY = 86400000;
const daysTo = (iso: string) => Math.ceil((new Date(iso + 'T12:00:00').getTime() - Date.now()) / DAY);
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY);

function LeadView({ team }: { team: Team }) {
  const [rows, setRows] = useState<TeamProgressRow[] | null>(null);
  const [activity, setActivity] = useState<Map<string, TeamActivityRow>>(new Map());
  const [meta, setMeta] = useState<{ exams: Map<string, Exam>; domains: Map<string, Domain[]> } | null>(null);
  const [cal, setCal] = useState<Map<string, { exam: Calibration | null; all: Calibration | null }>>(new Map());
  const [err, setErr] = useState('');
  const [examFilter, setExamFilter] = useState('all');

  useEffect(() => {
    Promise.all([teamProgress(team.id), loadExamsWithDomains(), teamActivity(team.id)]).then(async ([r, m, act]) => {
      setRows(r);
      setActivity(new Map(act.map((a) => [a.user_id + a.exam_id, a])));
      const domains = new Map<string, Domain[]>();
      for (const d of m.domains) domains.set(d.exam_id, [...(domains.get(d.exam_id) || []), d]);
      for (const [k, v] of domains) domains.set(k, v.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })));
      setMeta({ exams: new Map(m.exams.map((e) => [e.id, e])), domains });
      const ids = [...new Set(r.map((x) => x.exam_id).filter(Boolean) as string[])];
      const all = await loadCalibration(null);
      const per = await Promise.all(ids.map(async (id) => [id, { exam: await loadCalibration(id), all }] as const));
      setCal(new Map(per));
    }).catch(() => setErr('No se ha podido cargar el progreso del equipo.'));
  }, [team.id]);

  const people = useMemo<Person[]>(() => {
    const map = new Map<string, Person>();
    for (const r of rows || []) {
      const p = map.get(r.user_id) || { user_id: r.user_id, name: r.display_name || 'Sin nombre', role: r.role, shares: r.shares_progress, rows: [] };
      if (r.exam_id && (examFilter === 'all' || r.exam_id === examFilter)) p.rows.push(r);
      map.set(r.user_id, p);
    }
    return [...map.values()];
  }, [rows, examFilter]);

  if (err) return <div className="msg err" style={{ marginTop: 12 }}>{err}</div>;
  if (!rows || !meta) return <p className="note" style={{ marginTop: 12 }}>Cargando el progreso del equipo…</p>;

  const sharing = people.filter((p) => p.shares).length;
  const examIds = [...new Set(rows.map((r) => r.exam_id).filter(Boolean) as string[])];
  const scored = (r: TeamProgressRow) => {
    const e = meta.exams.get(r.exam_id!);
    return calibrate(readiness(meta.domains.get(r.exam_id!) || [], r.by_domain || {}, e?.passing_note || ''), cal.get(r.exam_id!));
  };
  const act = (r: TeamProgressRow) => activity.get(r.user_id + r.exam_id);
  const visible = people.flatMap((p) => (p.shares ? p.rows.map((r) => ({ p, r, s: scored(r), a: act(r) })) : []));
  const passedOfficial = (a?: TeamActivityRow) => Boolean(a?.result_passed);

  // What needs the lead's attention, most urgent first.
  const alerts: Alert[] = [];
  for (const { p, r, s, a } of visible) {
    const exam = meta.exams.get(r.exam_id!)?.code || '';
    if (a?.result_on) {
      if (a.result_passed && daysSince(a.result_on + 'T12:00:00') <= 30) alerts.push({ level: 'ok', who: p.name, exam, text: `aprobó el examen oficial el ${fmtDate(a.result_on + 'T12:00:00').split(',')[0]}`, rank: 5 });
      if (!a.result_passed && daysSince(a.result_on + 'T12:00:00') <= 30) alerts.push({ level: 'warn', who: p.name, exam, text: 'no aprobó el examen oficial: buen momento para hablar del plan para la siguiente convocatoria', rank: 1.5 });
      if (a.result_passed) continue;
    }
    const left = r.target_date ? daysTo(r.target_date) : null;
    if (left !== null && left >= 0 && left <= 21) {
      if (s.answered < MIN_ANSWERS) alerts.push({ level: 'bad', who: p.name, exam, text: `examen en ${left} días y casi sin práctica medible (${s.answered} respuestas)`, rank: 0 + left / 100 });
      else if ((s.probability ?? 0) < 0.5) alerts.push({ level: 'bad', who: p.name, exam, text: `examen en ${left} días con un ${pct(s.probability)} de probabilidad de aprobar`, rank: 0.5 + left / 100 });
      else if ((s.probability ?? 0) < 0.8) alerts.push({ level: 'warn', who: p.name, exam, text: `examen en ${left} días, cerca pero sin margen (${pct(s.probability)})`, rank: 2 + left / 100 });
    }
    if (r.last_at && daysSince(r.last_at) >= 7 && (left === null || left >= 0)) {
      alerts.push({ level: left !== null && left <= 30 ? 'bad' : 'warn', who: p.name, exam, text: `sin practicar desde hace ${daysSince(r.last_at)} días`, rank: left !== null && left <= 30 ? 1 : 3 });
    }
    if (a && a.due_reviews >= 30) alerts.push({ level: 'warn', who: p.name, exam, text: `${a.due_reviews} repasos acumulados sin hacer`, rank: 3.5 });
    if (!r.target_date && (r.answered ?? 0) >= 40) alerts.push({ level: 'info', who: p.name, exam, text: 'practica con regularidad pero no tiene fecha de examen', rank: 4 });
  }
  alerts.sort((a, b) => a.rank - b.rank);

  const ready = visible.filter(({ s, a }) => !passedOfficial(a) && (s.probability ?? 0) >= 0.8).length;
  const risk = alerts.filter((x) => x.level === 'bad').map((x) => x.who);
  const inactive = visible.filter(({ r, a }) => !passedOfficial(a) && r.last_at && daysSince(r.last_at) >= 7).length;
  const passed = visible.filter(({ a }) => passedOfficial(a)).length;

  const heatExams = (examFilter === 'all' ? examIds : [examFilter]).filter((id) => visible.some((v) => v.r.exam_id === id));

  const exportCsv = () => {
    const head = ['Persona', 'Examen', 'Preparación', 'Nota estimada', 'Probabilidad', 'Respuestas', 'Último simulacro', 'Días activos (14)', 'Respuestas (7 días)', 'Repasos pendientes', 'Última actividad', 'Fecha examen', 'Resultado oficial'];
    const lines = visible.map(({ p, r, s, a }) => [
      p.name, meta.exams.get(r.exam_id!)?.code || '', s.answered < MIN_ANSWERS ? 'Pocos datos' : verdict(s.probability).text, pct(s.estimate), pct(s.probability),
      String(r.answered ?? 0), r.last_sim_pct === null ? '' : r.last_sim_pct + '%', String(a?.active_days_14 ?? ''), String(a?.answered_7 ?? ''), String(a?.due_reviews ?? ''),
      r.last_at ? r.last_at.slice(0, 10) : '', r.target_date || '', a?.result_on ? `${a.result_passed ? 'Aprobado' : 'No aprobado'} (${a.result_on})` : '',
    ]);
    const csv = [head, ...lines].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const el = document.createElement('a'); el.href = url; el.download = `progreso-${team.name.replace(/\W+/g, '-').toLowerCase()}.csv`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="leadview">
      <div className="ready-kpis" style={{ marginTop: 14 }}>
        <div><b>{people.length}</b><span>personas · {sharing} comparten su progreso</span></div>
        <div><b>{ready}</b><span>preparadas para su examen</span></div>
        <div><b className={risk.length ? 'kbad' : ''}>{new Set(risk).size}</b><span>en riesgo</span></div>
        <div><b>{inactive}</b><span>sin practicar 7+ días</span></div>
        <div><b>{passed}</b><span>aprobados oficiales</span></div>
      </div>
      {examIds.length > 1 && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="chip" aria-pressed={examFilter === 'all'} onClick={() => setExamFilter('all')}>Todos los exámenes</button>
          {examIds.map((id) => <button key={id} className="chip" aria-pressed={examFilter === id} onClick={() => setExamFilter(id)}>{meta.exams.get(id)?.code || meta.exams.get(id)?.name}</button>)}
        </div>
      )}

      <div className="eyebrow" style={{ margin: '16px 0 6px' }}>Necesitan atención</div>
      {alerts.length ? (
        <ul className="alerts">
          {alerts.slice(0, 12).map((x, i) => <li key={i} className={x.level}><b>{x.who}</b>{x.exam ? <span className="muted"> · {x.exam}</span> : null}: {x.text}</li>)}
          {alerts.length > 12 && <li className="info">y {alerts.length - 12} avisos más en la tabla.</li>}
        </ul>
      ) : <p className="note">Nada urgente: nadie con examen cercano por debajo del 50 % ni parado más de una semana.</p>}

      {heatExams.map((id) => <TeamHeatmap key={id} exam={meta.exams.get(id)!} domains={meta.domains.get(id) || []} rows={visible.filter((v) => v.r.exam_id === id).map(({ p, s }) => ({ name: p.name, s }))} />)}

      <div className="row" style={{ marginTop: 16 }}>
        <div className="eyebrow">Por persona</div>
        <span className="spacer" />
        <button className="btn small" disabled={!visible.length} onClick={exportCsv}>Exportar CSV</button>
      </div>
      <div className="table-wrap" style={{ marginTop: 6 }}>
        <table className="simple teamtable">
          <thead><tr><th>Persona</th><th>Examen</th><th>Preparación</th><th>Nota estimada</th><th>Prob. aprobar</th><th title="Días con algún intento en las últimas dos semanas">Constancia</th><th title="Preguntas respondidas en los últimos 7 días">Esta semana</th><th title="Preguntas del repaso espaciado que ya tocaban">Repasos</th><th>Actividad</th><th>Fecha examen</th><th>Resultado oficial</th></tr></thead>
          <tbody>
            {people.map((p) => {
              if (!p.shares) return <tr key={p.user_id}><td>{p.name}{p.role === 'lead' ? ' · resp.' : ''}</td><td colSpan={10} className="muted">No comparte su progreso</td></tr>;
              if (!p.rows.length) return <tr key={p.user_id}><td>{p.name}{p.role === 'lead' ? ' · resp.' : ''}</td><td colSpan={10} className="muted">Sin actividad {examFilter === 'all' ? 'todavía' : 'en este examen'}</td></tr>;
              return p.rows.map((r, k) => {
                const e = meta.exams.get(r.exam_id!);
                const s = scored(r);
                const a = act(r);
                const v = verdict(s.probability);
                const days = r.target_date ? daysTo(r.target_date) : null;
                const quiet = r.last_at ? daysSince(r.last_at) : null;
                return (
                  <tr key={p.user_id + r.exam_id}>
                    <td>{k === 0 ? <>{p.name}{p.role === 'lead' ? ' · resp.' : ''}</> : ''}</td>
                    <td title={e?.name}>{e?.code || e?.name || '—'}</td>
                    <td><span className={`verdict sm ${a?.result_passed ? 'pass' : v.cls}`}>{a?.result_passed ? 'Certificado' : s.answered < MIN_ANSWERS ? 'Pocos datos' : v.text}</span></td>
                    <td className="mono" title={`${r.answered ?? 0} respuestas · último simulacro ${r.last_sim_pct === null ? '—' : r.last_sim_pct + '%'}${s.calibration ? ' · ajustada con resultados reales' : ''}`}>{pct(s.estimate)}</td>
                    <td className="mono">{pct(s.probability)}</td>
                    <td><Dots n={a?.active_days_14 ?? null} /></td>
                    <td className="mono">{a ? a.answered_7 : '—'}</td>
                    <td className="mono" style={a && a.due_reviews >= 30 ? { color: 'var(--flag)', fontWeight: 600 } : undefined}>{a ? a.due_reviews : '—'}</td>
                    <td className="mono" style={quiet !== null && quiet >= 7 ? { color: 'var(--bad)' } : undefined}>{r.last_at ? (quiet === 0 ? 'hoy' : quiet === 1 ? 'ayer' : `hace ${quiet} d`) : '—'}</td>
                    <td className="mono">{r.target_date ? <>{fmtDate(r.target_date + 'T12:00:00').split(',')[0]}{days !== null && days >= 0 ? <span className="muted"> · {days} d</span> : ''}</> : '—'}</td>
                    <td>{a?.result_on ? <span className={`verdict sm ${a.result_passed ? 'pass' : 'fail'}`} title={a.result_on}>{a.result_passed ? 'Aprobado' : 'No aprobado'}</span> : <span className="muted">—</span>}</td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 10 }}>La preparación se calcula igual que en el panel de cada persona (últimos 20 simulacros, mini-exámenes y prácticas, ponderados por el peso oficial de cada dominio) y, cuando hay al menos 3 resultados oficiales con nota, se corrige con ellos. Solo ves recuentos: nunca qué preguntas fallan ni sus respuestas.</p>
    </div>
  );
}

/** Active days in the last 14 as a compact meter. */
function Dots({ n }: { n: number | null }) {
  if (n === null) return <span className="muted">—</span>;
  const cls = n >= 8 ? 'ok' : n >= 4 ? 'mid' : 'low';
  return <span className={`dots ${cls}`} title={`${n} de los últimos 14 días`}><i style={{ width: `${(n / 14) * 100}%` }} /><b>{n}/14</b></span>;
}

/** Team accuracy by domain: where a team session would help most. */
function TeamHeatmap({ exam, domains, rows }: { exam: Exam; domains: Domain[]; rows: { name: string; s: CalibratedReadiness }[] }) {
  const withData = rows.filter((r) => r.s.answered >= MIN_ANSWERS);
  if (!withData.length || !domains.length) return null;
  const pass = withData[0].s.pass;
  const avg = domains.map((d) => {
    const vals = withData.map((r) => r.s.domains.find((x) => x.domain.id === d.id)).filter((x) => x && x.total >= 5).map((x) => x!.shrunk);
    return { d, acc: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, n: vals.length };
  });
  const target = Math.max(0.8, pass + 0.08);
  const focus = avg.filter((x) => x.acc !== null && x.acc < target).sort((a, b) => (target - b.acc!) * Number(b.d.weight) - (target - a.acc!) * Number(a.d.weight))[0];
  const col = (a: number | null) => (a === null ? 'none' : a >= target ? 'ok' : a >= pass ? 'mid' : 'low');
  return (
    <div className="heat">
      <div className="row">
        <div className="eyebrow">Acierto del equipo por dominio · {exam.code || exam.name}</div>
        <span className="spacer" />
        {focus && <span className="note" style={{ margin: 0 }}>Sesión de equipo sugerida: <b>{focus.d.code} · {focus.d.name}</b></span>}
      </div>
      <div className="table-wrap">
        <table className="simple heattable">
          <thead><tr><th>Persona</th>{domains.map((d) => <th key={d.id} title={`${d.name} · ${Number(d.weight)}%`}>{d.code}</th>)}</tr></thead>
          <tbody>
            {withData.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                {domains.map((d) => {
                  const x = r.s.domains.find((y) => y.domain.id === d.id);
                  const a = x && x.total >= 5 ? x.shrunk : null;
                  return <td key={d.id} className={`hc ${col(a)}`} title={x ? `${x.ok}/${x.total}` : ''}>{a === null ? '·' : Math.round(a * 100)}</td>;
                })}
              </tr>
            ))}
            <tr className="avg">
              <td>Media del equipo</td>
              {avg.map((x) => <td key={x.d.id} className={`hc ${col(x.acc)}`}>{x.acc === null ? '·' : Math.round(x.acc * 100)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note" style={{ margin: '4px 0 0' }}>Solo personas con al menos {MIN_ANSWERS} respuestas y dominios con 5 o más. Verde: por encima del objetivo ({Math.round(target * 100)} %); ámbar: aprueba sin margen; rojo: por debajo del aprobado.</p>
    </div>
  );
}
