import { useEffect, useState } from 'react';
import { NavLink, Navigate } from 'react-router-dom';
import { useApp } from '../App';
import { addAllow, importExam, listAllowlist, listExams, listProfiles, removeAllow, setAdmin, setExamPublished } from '../lib/data';
import type { Exam, Profile } from '../lib/types';

function validate(p: any): string | null {
  if (!p || typeof p !== 'object') return 'El fichero no contiene un objeto JSON.';
  for (const k of ['slug', 'vendor', 'name']) if (!p[k]) return `Falta el campo "${k}".`;
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(p.slug)) return 'El slug solo admite minúsculas, números y guiones.';
  if (!p.exam?.questions || !p.exam?.minutes || !p.exam?.mini?.questions || !p.exam?.mini?.minutes) return 'Faltan los datos del formato del examen (exam.questions, exam.minutes, exam.mini).';
  if (!Array.isArray(p.domains) || !p.domains.length) return 'Falta la lista de dominios.';
  if (!Array.isArray(p.questions)) return 'Falta la lista de preguntas.';
  const codes = new Set(p.domains.map((d: any) => d.code));
  for (const [i, q] of p.questions.entries()) {
    if (!codes.has(q.domain)) return `Pregunta ${i + 1}: dominio "${q.domain}" no definido.`;
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return `Pregunta ${i + 1}: necesita entre 2 y 6 opciones.`;
    if (!Array.isArray(q.correct) || !q.correct.length || q.correct.length >= q.options.length) return `Pregunta ${i + 1}: revisa las respuestas correctas.`;
    if (q.correct.some((c: number) => !Number.isInteger(c) || c < 0 || c >= q.options.length)) return `Pregunta ${i + 1}: índice de respuesta fuera de rango.`;
  }
  return null;
}

/** Navigation between the admin pages. */
export function AdminTabs() {
  return (
    <nav className="tabs" aria-label="Secciones de administración">
      <NavLink to="/admin" end>General</NavLink>
      <NavLink to="/admin/calidad">Calidad del banco</NavLink>
      <NavLink to="/admin/equipos">Equipos</NavLink>
    </nav>
  );
}

export default function Admin() {
  const { profile, userId } = useApp();
  const [exams, setExams] = useState<(Exam & { question_count: number })[]>([]);
  const [allow, setAllow] = useState<{ pattern: string; note: string }[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pattern, setPattern] = useState('');

  const load = async () => {
    try {
      const [e, a, p] = await Promise.all([listExams(), listAllowlist(), listProfiles()]);
      setExams(e); setAllow(a); setPeople(p);
    } catch { setMsg({ ok: false, text: 'No se han podido cargar los datos de administración.' }); }
  };
  useEffect(() => { if (profile?.is_admin) load(); }, [profile?.is_admin]);

  if (!profile) return <div className="center">Cargando…</div>;
  if (!profile.is_admin) return <Navigate to="/" replace />;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    let p: unknown;
    try { p = JSON.parse(await f.text()); } catch { return setMsg({ ok: false, text: 'El fichero no es un JSON válido.' }); }
    const err = validate(p);
    if (err) return setMsg({ ok: false, text: err });
    setBusy(true);
    try {
      const r = await importExam(p);
      setMsg({ ok: true, text: `Importado: ${r.questions} preguntas. Las preguntas del equipo se han conservado.` });
      load();
    } catch (e: any) { setMsg({ ok: false, text: `No se ha podido importar: ${e?.message || 'error desconocido'}` }); }
    finally { setBusy(false); }
  };

  return (
    <main className="wrap">
      <header className="hero">
        <div className="eyebrow">Solo administradores</div>
        <h1>Administración</h1>
        <p>Importa exámenes, controla quién puede registrarse y quién administra. Los administradores no pueden ver el progreso personal de nadie.</p>
      </header>
      <AdminTabs />
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      <section className="panel form">
        <div className="eyebrow">Importar o actualizar un examen</div>
        <p className="note">Sube un fichero JSON con el formato de <code>content/exams/</code> (ver README). Si el slug ya existe, se actualiza el examen y se sustituyen sus preguntas del banco; las del equipo se conservan. Usa solo preguntas propias o con permiso de su autor, nunca preguntas de exámenes reales.</p>
        <input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
        {busy && <span className="note">Importando…</span>}
      </section>

      <section className="panel">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Exámenes</div>
        <div className="table-wrap">
          <table className="simple">
            <thead><tr><th>Examen</th><th>Preguntas</th><th>Visible</th></tr></thead>
            <tbody>
              {exams.map((e) => (
                <tr key={e.id}>
                  <td>{e.vendor} · {e.name}<div className="muted mono" style={{ fontSize: 12 }}>{e.slug}</div></td>
                  <td className="mono">{e.question_count}</td>
                  <td><button className="btn small" onClick={async () => { await setExamPublished(e.id, !e.is_published); load(); }}>{e.is_published ? 'Visible · ocultar' : 'Oculto · publicar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel form">
        <div className="eyebrow">Lista de acceso</div>
        <p className="note">{allow.length ? 'Solo pueden registrarse los emails que encajen con esta lista.' : 'La lista está vacía: cualquier persona con email puede registrarse. Añade al menos tu dominio para restringir el acceso.'} Usa <code>@empresa.com</code> para un dominio entero o un email completo para una persona externa.</p>
        <div className="row">
          <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="@empresa.com o persona@otra.com" style={{ flex: '1 1 240px' }} aria-label="Dominio o email" />
          <button className="btn solid" disabled={pattern.trim().length < 3} onClick={async () => {
            try { await addAllow(pattern, ''); setPattern(''); load(); } catch { setMsg({ ok: false, text: 'No se ha podido añadir. ¿Ya estaba en la lista?' }); }
          }}>Añadir</button>
        </div>
        {allow.map((a) => (
          <div className="row" key={a.pattern}><span className="mono">{a.pattern}</span><span className="spacer" /><button className="btn small" onClick={async () => { await removeAllow(a.pattern); load(); }}>Quitar</button></div>
        ))}
      </section>

      <section className="panel">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Personas registradas</div>
        <div className="table-wrap">
          <table className="simple">
            <thead><tr><th>Nombre</th><th>Rol</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>{p.display_name || 'Sin nombre'}{p.id === userId ? ' (tú)' : ''}</td>
                  <td>{p.id === userId ? 'Administrador' : (
                    <button className="btn small" onClick={async () => { try { await setAdmin(p.id, !p.is_admin); load(); } catch { setMsg({ ok: false, text: 'No se ha podido cambiar el rol.' }); } }}>
                      {p.is_admin ? 'Administrador · quitar' : 'Usuario · hacer administrador'}
                    </button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
