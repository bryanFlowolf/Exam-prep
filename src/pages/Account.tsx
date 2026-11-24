import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { updateDisplayName } from '../lib/data';
import { supabase } from '../lib/supabase';

export default function Account() {
  const { profile, refreshProfile, teamCount } = useApp();
  const [name, setName] = useState(profile?.display_name || '');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { setName(profile?.display_name || ''); }, [profile?.display_name]);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || '')); }, []);

  return (
    <main className="wrap" style={{ maxWidth: 560 }}>
      <header className="hero">
        <div className="eyebrow">Mi cuenta</div>
        <h1>{profile?.display_name || 'Mi cuenta'}</h1>
        <p>{email}</p>
      </header>
      <section className="panel form">
        <label className="fl" htmlFor="dn">Nombre visible</label>
        <p className="note">Es el nombre que verán los compañeros junto a las preguntas del equipo que publiques. Tu progreso y tus notas solo los ves tú.</p>
        <input id="dn" type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
        <div className="row">
          <button className="btn solid" disabled={!name.trim()} onClick={async () => {
            try { await updateDisplayName(name); await refreshProfile(); setMsg({ ok: true, text: 'Nombre guardado.' }); }
            catch { setMsg({ ok: false, text: 'No se ha podido guardar el nombre.' }); }
          }}>Guardar</button>
          <span className="spacer" />
          <button className="btn" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </section>
      {(teamCount > 0 || profile?.is_admin) && (
        <section className="panel">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Accesos</div>
          <div className="row">
            {(teamCount > 0 || profile?.is_admin) && <Link className="btn" to="/equipos">Mis equipos</Link>}
            {profile?.is_admin && <Link className="btn" to="/admin">Administración</Link>}
          </div>
          <p className="note" style={{ marginTop: 8 }}>En Mis equipos decides si compartes tu progreso con los responsables de cada equipo.</p>
        </section>
      )}
    </main>
  );
}
