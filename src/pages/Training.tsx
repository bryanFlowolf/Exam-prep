import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { CATEGORIES, catLabel, fmtDay, listCourses, myTraining, STATE_LABEL, type Course, type MyTraining } from '../lib/training';

export default function Training() {
  const { profile, setPending } = useApp();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [mine, setMine] = useState<MyTraining[]>([]);
  const [error, setError] = useState('');
  const editor = !!(profile?.is_admin || profile?.is_editor);

  useEffect(() => {
    Promise.all([listCourses(), myTraining()])
      .then(([c, m]) => { setCourses(c); setMine(m); setPending(m.filter((x) => x.state !== 'completado').length); })
      .catch((e: { message?: string }) => setError(/courses|my_training|schema cache/i.test(e?.message || '')
        ? 'La formación interna aún no está activada: falta ejecutar la migración de formación en Supabase.'
        : `No se ha podido cargar la formación. Detalle: ${e?.message || 'error desconocido'}`));
  }, []);

  const byId = new Map((courses || []).map((c) => [c.id, c]));
  const assigned = mine.filter((m) => byId.has(m.course_id))
    .sort((a, b) => rank(a.state) - rank(b.state) || (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const visible = (courses || []).filter((c) => c.is_published);
  const pending = assigned.filter((m) => m.state !== 'completado').length;

  return (
    <main className="wrap">
      <header className="hero">
        <div className="eyebrow">Formación interna</div>
        <h1>Tus formaciones</h1>
        <p>Cursos de la empresa: prevención de riesgos laborales, onboarding y tecnologías. Cada curso tiene lecciones y un test final; al aprobarlo obtienes un certificado.</p>
        {editor && <p style={{ marginTop: 8 }}><Link to="/formacion/gestion">Gestionar cursos, asignaciones y cumplimiento →</Link></p>}
      </header>
      {error && <div className="msg err">{error}</div>}
      {!courses && !error && <div className="center">Cargando formación…</div>}

      {courses && (
        <section className="panel">
          <div className="row"><h2 style={{ fontSize: 20 }}>Asignadas a ti</h2><span className="spacer" />
            {assigned.length > 0 && <span className="note">{pending ? `${pending} pendiente${pending === 1 ? '' : 's'}` : 'Todo al día'}</span>}
          </div>
          {assigned.length === 0 ? (
            <p className="note">No tienes formaciones asignadas ahora mismo.</p>
          ) : (
            <ul className="tlist">
              {assigned.map((m) => {
                const c = byId.get(m.course_id)!;
                return (
                  <li key={m.course_id}>
                    <Link to={`/formacion/${c.id}`} className="tlink">
                      <span className={`state ${m.state}`}>{STATE_LABEL[m.state]}</span>
                      <span className="ttitle">{c.title}<small>{catLabel(c.category)}</small></span>
                      <span className="tdue">{stateLine(m)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {courses && CATEGORIES.map((cat) => {
        const list = visible.filter((c) => c.category === cat.id);
        if (!list.length) return null;
        return (
          <section key={cat.id} className="vendor">
            <h2 className="cat-title">{cat.label}</h2>
            <div className="grid-cards exams">
              {list.map((c) => (
                <Link key={c.id} className="card exam-card" to={`/formacion/${c.id}`}>
                  {c.validity_months && <div className="row"><span className="tag">Renovar cada {c.validity_months} meses</span></div>}
                  <h2 title={c.title}>{c.title}</h2>
                  <p>{c.summary}</p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      {courses && visible.length === 0 && !error && (
        <div className="panel"><p className="note">Todavía no hay cursos publicados.{editor ? ' Créalos desde Gestionar cursos.' : ''}</p></div>
      )}
    </main>
  );
}

function rank(s: MyTraining['state']) { return { vencido: 0, caducado: 1, pendiente: 2, completado: 3 }[s]; }

export function stateLine(m: { state: MyTraining['state']; due_date: string | null; expires_at: string | null; last_passed_at: string | null }) {
  if (m.state === 'completado') return m.expires_at ? `Válida hasta ${fmtDay(m.expires_at)}` : `Completada el ${fmtDay(m.last_passed_at)}`;
  if (m.state === 'caducado') return `Caducó el ${fmtDay(m.expires_at)}: hay que renovarla`;
  if (m.state === 'vencido') return `Fecha límite: ${fmtDay(m.due_date)}`;
  return m.due_date ? `Antes del ${fmtDay(m.due_date)}` : 'Sin fecha límite';
}
