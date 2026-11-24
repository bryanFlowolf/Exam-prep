import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useApp } from '../App';
import { addTeamMember, createTeam, deleteTeam, listProfiles, listTeamMembers, listTeams, removeTeamMember, renameTeam, setTeamRole } from '../lib/data';
import type { Profile, Team, TeamMember } from '../lib/types';
import { AdminTabs } from './Admin';

export default function AdminTeams() {
  const { profile } = useApp();
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [armed, setArmed] = useState<string | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);

  const load = async () => {
    try {
      const [t, m, p] = await Promise.all([listTeams(), listTeamMembers(), listProfiles()]);
      setTeams(t); setMembers(m); setPeople(p);
    } catch { setMsg({ ok: false, text: 'No se han podido cargar los equipos. ¿Está aplicada la migración 20261124000000_insights.sql?' }); }
  };
  useEffect(() => { if (profile?.is_admin) load(); }, [profile?.is_admin]);

  if (!profile) return <div className="center">Cargando…</div>;
  if (!profile.is_admin) return <Navigate to="/" replace />;

  const nameOf = (id: string) => people.find((p) => p.id === id)?.display_name || 'Sin nombre';
  const run = async (f: () => Promise<void>, fail: string) => {
    try { await f(); setMsg(null); await load(); } catch { setMsg({ ok: false, text: fail }); }
  };

  return (
    <main className="wrap">
      <header className="hero">
        <div className="eyebrow">Solo administradores</div>
        <h1>Equipos</h1>
        <p>Crea equipos y nombra a sus responsables. Cada miembro decide en <Link to="/equipos">Equipos</Link> si comparte su progreso; los responsables solo ven el de quien lo comparte. Ser administrador no da acceso al progreso de nadie.</p>
      </header>
      <AdminTabs />
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      <section className="panel form">
        <div className="eyebrow">Nuevo equipo</div>
        <div className="row">
          <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Nombre del equipo" aria-label="Nombre del equipo" style={{ flex: '1 1 240px' }} />
          <button className="btn solid" disabled={!name.trim()} onClick={() => run(async () => { await createTeam(name); setName(''); }, 'No se ha podido crear. ¿Ya existe un equipo con ese nombre?')}>Crear equipo</button>
        </div>
      </section>

      {teams.map((t) => {
        const ms = members.filter((m) => m.team_id === t.id).sort((a, b) => (a.role === b.role ? nameOf(a.user_id).localeCompare(nameOf(b.user_id)) : a.role === 'lead' ? -1 : 1));
        const outside = people.filter((p) => !ms.some((m) => m.user_id === p.id));
        return (
          <section className="panel" key={t.id}>
            <div className="row" style={{ marginBottom: 8 }}>
              {rename?.id === t.id ? (
                <>
                  <input type="text" aria-label="Nuevo nombre" maxLength={80} value={rename.name} onChange={(e) => setRename({ id: t.id, name: e.target.value })} />
                  <button className="btn small solid" disabled={!rename.name.trim()} onClick={() => run(async () => { await renameTeam(t.id, rename.name); setRename(null); }, 'No se ha podido renombrar. ¿Ya existe ese nombre?')}>Guardar</button>
                  <button className="btn small" onClick={() => setRename(null)}>Cancelar</button>
                </>
              ) : <h2 className="ph">{t.name}</h2>}
              <span className="muted mono" style={{ fontSize: 12 }}>{ms.length} personas · {ms.filter((m) => m.shares_progress).length} comparten progreso</span>
              <span className="spacer" />
              {rename?.id !== t.id && <button className="btn small" onClick={() => setRename({ id: t.id, name: t.name })}>Renombrar</button>}
              <button className={`btn small ${armed === t.id ? 'danger' : ''}`} onClick={() => {
                if (armed !== t.id) { setArmed(t.id); setTimeout(() => setArmed((a) => (a === t.id ? null : a)), 3000); return; }
                run(() => deleteTeam(t.id), 'No se ha podido borrar el equipo.');
              }}>{armed === t.id ? 'Confirmar: borrar equipo' : 'Borrar'}</button>
            </div>
            <div className="table-wrap">
              <table className="simple">
                <thead><tr><th>Persona</th><th>Rol</th><th>Comparte progreso</th><th /></tr></thead>
                <tbody>
                  {ms.map((m) => (
                    <tr key={m.user_id}>
                      <td>{nameOf(m.user_id)}</td>
                      <td>
                        <select className="select" aria-label={`Rol de ${nameOf(m.user_id)}`} value={m.role} onChange={(e) => run(() => setTeamRole(t.id, m.user_id, e.target.value as TeamMember['role']), 'No se ha podido cambiar el rol.')}>
                          <option value="member">Miembro</option>
                          <option value="lead">Responsable</option>
                        </select>
                      </td>
                      <td>{m.shares_progress ? 'Sí' : 'No'}</td>
                      <td style={{ textAlign: 'right' }}><button className="btn small" onClick={() => run(() => removeTeamMember(t.id, m.user_id), 'No se ha podido quitar.')}>Quitar</button></td>
                    </tr>
                  ))}
                  {!ms.length && <tr><td colSpan={4} className="muted">Todavía no hay nadie en este equipo.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <select className="select" aria-label="Persona para añadir" value={pick[t.id] || ''} onChange={(e) => setPick({ ...pick, [t.id]: e.target.value })} style={{ flex: '1 1 220px' }}>
                <option value="">Añadir a una persona…</option>
                {outside.map((p) => <option key={p.id} value={p.id}>{p.display_name || 'Sin nombre'}</option>)}
              </select>
              <button className="btn" disabled={!pick[t.id]} onClick={() => run(async () => { await addTeamMember(t.id, pick[t.id], 'member'); setPick({ ...pick, [t.id]: '' }); }, 'No se ha podido añadir.')}>Añadir como miembro</button>
              <button className="btn" disabled={!pick[t.id]} onClick={() => run(async () => { await addTeamMember(t.id, pick[t.id], 'lead'); setPick({ ...pick, [t.id]: '' }); }, 'No se ha podido añadir.')}>Añadir como responsable</button>
            </div>
          </section>
        );
      })}
      {!teams.length && !msg && <p className="note" style={{ marginTop: 18 }}>Todavía no hay equipos.</p>}
    </main>
  );
}
