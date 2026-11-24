import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { listTeamMembers, listTeams, loadExamsWithDomains, setShareProgress, teamProgress } from '../lib/data';
import { fmtDate } from '../lib/exam';
import { MIN_ANSWERS, pct, readiness, verdict } from '../lib/readiness';
import type { Domain, Exam, Team, TeamMember, TeamProgressRow } from '../lib/types';

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
        <p>Tu progreso es privado. Si lo compartes con un equipo, sus responsables verán un resumen por examen: nota estimada, probabilidad de aprobar, preguntas respondidas, última actividad, último simulacro y la fecha de tu examen. Nunca verán qué preguntas fallaste ni tus respuestas.</p>
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

function LeadView({ team }: { team: Team }) {
  const [rows, setRows] = useState<TeamProgressRow[] | null>(null);
  const [meta, setMeta] = useState<{ exams: Map<string, Exam>; domains: Map<string, Domain[]> } | null>(null);
  const [err, setErr] = useState('');
  const [examFilter, setExamFilter] = useState('all');

  useEffect(() => {
    Promise.all([teamProgress(team.id), loadExamsWithDomains()]).then(([r, m]) => {
      setRows(r);
      const domains = new Map<string, Domain[]>();
      for (const d of m.domains) domains.set(d.exam_id, [...(domains.get(d.exam_id) || []), d]);
      setMeta({ exams: new Map(m.exams.map((e) => [e.id, e])), domains });
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
    return readiness(meta.domains.get(r.exam_id!) || [], r.by_domain || {}, e?.passing_note || '');
  };
  const ready = rows.filter((r) => r.exam_id && (examFilter === 'all' || r.exam_id === examFilter) && (scored(r).probability ?? 0) >= 0.8).length;

  return (
    <div className="leadview">
      <div className="ready-kpis" style={{ marginTop: 14 }}>
        <div><b>{people.length}</b><span>personas en el equipo</span></div>
        <div><b>{sharing}</b><span>comparten su progreso</span></div>
        <div><b>{ready}</b><span>preparadas para su examen</span></div>
      </div>
      {examIds.length > 1 && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="chip" aria-pressed={examFilter === 'all'} onClick={() => setExamFilter('all')}>Todos los exámenes</button>
          {examIds.map((id) => <button key={id} className="chip" aria-pressed={examFilter === id} onClick={() => setExamFilter(id)}>{meta.exams.get(id)?.code || meta.exams.get(id)?.name}</button>)}
        </div>
      )}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="simple teamtable">
          <thead><tr><th>Persona</th><th>Examen</th><th>Preparación</th><th>Nota estimada</th><th>Prob. aprobar</th><th>Respuestas</th><th>Último simulacro</th><th>Actividad</th><th>Fecha examen</th></tr></thead>
          <tbody>
            {people.map((p) => {
              if (!p.shares) return <tr key={p.user_id}><td>{p.name}{p.role === 'lead' ? ' · resp.' : ''}</td><td colSpan={8} className="muted">No comparte su progreso</td></tr>;
              if (!p.rows.length) return <tr key={p.user_id}><td>{p.name}{p.role === 'lead' ? ' · resp.' : ''}</td><td colSpan={8} className="muted">Sin actividad {examFilter === 'all' ? 'todavía' : 'en este examen'}</td></tr>;
              return p.rows.map((r, k) => {
                const e = meta.exams.get(r.exam_id!);
                const s = scored(r);
                const v = verdict(s.probability);
                const days = r.target_date ? Math.ceil((new Date(r.target_date + 'T12:00:00').getTime() - Date.now()) / 86400000) : null;
                return (
                  <tr key={p.user_id + r.exam_id}>
                    <td>{k === 0 ? <>{p.name}{p.role === 'lead' ? ' · resp.' : ''}</> : ''}</td>
                    <td title={e?.name}>{e?.code || e?.name || '—'}</td>
                    <td><span className={`verdict sm ${v.cls}`}>{s.answered < MIN_ANSWERS ? 'Pocos datos' : v.text}</span></td>
                    <td className="mono">{pct(s.estimate)}</td>
                    <td className="mono">{pct(s.probability)}</td>
                    <td className="mono">{r.answered ?? 0}</td>
                    <td className="mono">{r.last_sim_pct === null ? '—' : r.last_sim_pct + '%'}</td>
                    <td className="mono">{r.last_at ? fmtDate(r.last_at).split(',')[0] : '—'}</td>
                    <td className="mono">{r.target_date ? <>{fmtDate(r.target_date + 'T12:00:00').split(',')[0]}{days !== null && days >= 0 ? <span className="muted"> · {days} d</span> : ''}</> : '—'}</td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 10 }}>La preparación se calcula igual que en el panel de cada persona: últimos 20 simulacros, mini-exámenes y prácticas por dominio, ponderados por el peso oficial de cada dominio.</p>
    </div>
  );
}
