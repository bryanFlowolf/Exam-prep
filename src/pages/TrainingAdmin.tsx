import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { CATEGORIES, catLabel, fmtDay, listCourses, saveCourse, type Category, type Course } from '../lib/training';

export default function TrainingAdmin() {
  const { profile } = useApp();
  const nav = useNavigate();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [err, setErr] = useState('');
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState<Category>('prl');
  const editor = !!(profile?.is_admin || profile?.is_editor);

  useEffect(() => { if (editor) listCourses().then(setCourses).catch((e) => setErr(e?.message || 'Error al cargar')); }, [editor]);
  if (!profile) return <div className="center">Cargando…</div>;
  if (!editor) return <Navigate to="/formacion" replace />;

  const create = async () => {
    setErr('');
    try { const c = await saveCourse({ title: title.trim(), category: cat }); nav(`/formacion/gestion/${c.id}`); }
    catch (e) { setErr((e as Error).message || 'No se ha podido crear el curso.'); }
  };

  return (
    <main className="wrap">
      <header className="hero">
        <div className="eyebrow"><Link to="/formacion">Formación</Link> · Gestión</div>
        <h1>Cursos internos</h1>
        <p>Crea cursos con lecciones y test, asígnalos a personas o equipos con fecha límite y consulta quién los ha completado.</p>
      </header>
      {err && <div className="msg err">{err}</div>}
      <section className="panel">
        <h2 style={{ fontSize: 18 }}>Nuevo curso</h2>
        <div className="form newcourse">
          <label className="fl" htmlFor="nc-title">Título</label>
          <input id="nc-title" type="text" value={title} maxLength={200} placeholder="Ej.: Prevención de riesgos en oficina 2027" onChange={(e) => setTitle(e.target.value)} />
          <label className="fl" htmlFor="nc-cat">Categoría</label>
          <select id="nc-cat" value={cat} onChange={(e) => setCat(e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <div><button className="btn solid" disabled={!title.trim()} onClick={create}>Crear y editar</button></div>
        </div>
      </section>
      <section className="panel">
        <h2 style={{ fontSize: 18 }}>Cursos</h2>
        {!courses ? <p className="note">Cargando…</p> : courses.length === 0 ? <p className="note">Aún no hay cursos.</p> : (
          <div className="table-wrap">
            <table className="simple">
              <thead><tr><th>Curso</th><th>Categoría</th><th>Estado</th><th>Actualizado</th><th /></tr></thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/formacion/gestion/${c.id}`}>{c.title}</Link></td>
                    <td>{catLabel(c.category)}</td>
                    <td>{c.is_published ? <span className="tag accent">Publicado</span> : <span className="tag multi">Borrador</span>}</td>
                    <td>{fmtDay(c.updated_at)}</td>
                    <td><Link className="btn small" to={`/formacion/gestion/${c.id}?tab=cumplimiento`}>Cumplimiento</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
