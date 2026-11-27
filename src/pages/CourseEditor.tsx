import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import Markdown from '../components/Markdown';
import { listTeams } from '../lib/data';
import { LETTERS } from '../lib/exam';
import type { Team } from '../lib/types';
import {
  addAssignments, CATEGORIES, deleteCourse, deleteLesson, deleteQuestion, editorCourse, fmtDay, fmtDateTime, removeAssignment,
  saveCourse, saveLesson, saveQuestion, STATE_LABEL, trainingPeople, trainingStatus, uploadFile,
  type Assignment, type Category, type Course, type CourseQuestion, type Lesson, type LessonKind, type Person, type StatusRow, type TrainingState,
} from '../lib/training';

const TABS = [['datos', 'Datos'], ['lecciones', 'Lecciones'], ['test', 'Test'], ['asignaciones', 'Asignaciones'], ['cumplimiento', 'Cumplimiento']] as const;
type Tab = typeof TABS[number][0];

export default function CourseEditor() {
  const { id = '' } = useParams();
  const { profile } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.find(([k]) => k === sp.get('tab'))?.[0] || 'datos') as Tab;
  const [d, setD] = useState<{ course: Course | null; lessons: Lesson[]; questions: CourseQuestion[]; assignments: Assignment[] } | null>(null);
  const [err, setErr] = useState('');
  const editor = !!(profile?.is_admin || profile?.is_editor);
  const reload = () => editorCourse(id).then(setD).catch((e) => setErr(e?.message || 'Error al cargar'));
  useEffect(() => { if (editor) reload(); }, [id, editor]);

  if (!profile) return <div className="center">Cargando…</div>;
  if (!editor) return <Navigate to="/formacion" replace />;
  if (err) return <main className="wrap"><div className="msg err" style={{ marginTop: 24 }}>{err}</div></main>;
  if (!d) return <div className="center">Cargando curso…</div>;
  if (!d.course) return <main className="wrap"><div className="msg err" style={{ marginTop: 24 }}>Curso no encontrado.</div></main>;
  const course = d.course;

  return (
    <main className="wrap">
      <header className="hero" style={{ paddingBottom: 8 }}>
        <div className="eyebrow"><Link to="/formacion/gestion">Gestión de formación</Link> · {course.is_published ? 'Publicado' : 'Borrador'}</div>
        <h1>{course.title}</h1>
        <p><Link to={`/formacion/${course.id}`}>Ver como empleado →</Link></p>
      </header>
      <nav className="tabs" aria-label="Secciones del curso">
        {TABS.map(([k, l]) => (
          <a key={k} href={`?tab=${k}`} className={tab === k ? 'active' : ''} aria-current={tab === k ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); setSp({ tab: k }); }}>
            {l}{k === 'lecciones' ? ` (${d.lessons.length})` : k === 'test' ? ` (${d.questions.length})` : ''}
          </a>
        ))}
      </nav>
      {tab === 'datos' && <CourseForm course={course} lessons={d.lessons.length} questions={d.questions.length} onSaved={reload} />}
      {tab === 'lecciones' && <Lessons course={course} lessons={d.lessons} onChange={reload} />}
      {tab === 'test' && <Questions course={course} questions={d.questions} onChange={reload} />}
      {tab === 'asignaciones' && <Assignments course={course} assignments={d.assignments} onChange={reload} />}
      {tab === 'cumplimiento' && <Compliance course={course} />}
    </main>
  );
}

// ---------------------------------------------------------------------------
function CourseForm({ course, lessons, questions, onSaved }: { course: Course; lessons: number; questions: number; onSaved: () => void }) {
  const nav = useNavigate();
  const [f, setF] = useState(course);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => setF(course), [course]);
  const set = <K extends keyof Course>(k: K, v: Course[K]) => setF({ ...f, [k]: v });
  const save = async (extra: Partial<Course> = {}) => {
    setMsg(null);
    try {
      await saveCourse({ id: f.id, title: f.title.trim(), summary: f.summary, category: f.category, pass_pct: f.pass_pct, quiz_size: f.quiz_size,
        requires_ack: f.requires_ack, ack_text: f.ack_text, validity_months: f.validity_months, is_published: f.is_published, ...extra });
      setMsg({ ok: true, text: 'Guardado.' }); onSaved();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message || 'No se ha podido guardar.' }); }
  };
  const num = (v: string) => (v.trim() === '' ? null : Math.max(1, Math.round(Number(v)) || 1));

  return (
    <section className="panel">
      <div className="form two">
        <label className="fl" htmlFor="c-title">Título</label>
        <input id="c-title" type="text" maxLength={200} value={f.title} onChange={(e) => set('title', e.target.value)} />
        <label className="fl" htmlFor="c-sum">Descripción breve</label>
        <textarea id="c-sum" rows={3} maxLength={2000} value={f.summary} onChange={(e) => set('summary', e.target.value)} />
        <label className="fl" htmlFor="c-cat">Categoría</label>
        <select id="c-cat" value={f.category} onChange={(e) => set('category', e.target.value as Category)}>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <label className="fl" htmlFor="c-pass">Nota para aprobar el test (%)</label>
        <input id="c-pass" type="number" min={0} max={100} value={f.pass_pct} onChange={(e) => set('pass_pct', Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />
        <label className="fl" htmlFor="c-size">Preguntas por intento (vacío = todas, en orden; con número, una muestra aleatoria)</label>
        <input id="c-size" type="number" min={1} value={f.quiz_size ?? ''} onChange={(e) => set('quiz_size', num(e.target.value))} />
        <label className="fl" htmlFor="c-valid">Validez del certificado en meses (vacío = no caduca; p. ej. 12 para renovar cada año)</label>
        <input id="c-valid" type="number" min={1} max={120} value={f.validity_months ?? ''} onChange={(e) => set('validity_months', num(e.target.value))} />
        <label className="okline"><input type="checkbox" checked={f.requires_ack} onChange={(e) => set('requires_ack', e.target.checked)} /> Exigir firma de conformidad al aprobar (recomendado para PRL)</label>
        {f.requires_ack && (<>
          <label className="fl" htmlFor="c-ack">Texto de la declaración</label>
          <textarea id="c-ack" rows={3} maxLength={2000} value={f.ack_text} onChange={(e) => set('ack_text', e.target.value)} />
        </>)}
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>{msg.text}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn solid" disabled={!f.title.trim()} onClick={() => save()}>Guardar</button>
        {course.is_published
          ? <button className="btn" onClick={() => save({ is_published: false })}>Despublicar</button>
          : <button className="btn" disabled={!lessons} onClick={() => save({ is_published: true })}>Publicar</button>}
        {!course.is_published && !lessons && <span className="note">Añade al menos una lección para publicarlo.</span>}
        {!course.is_published && lessons > 0 && !questions && <span className="note">Sin preguntas, el curso se completa al terminar las lecciones (y firmar, si se exige).</span>}
        <span className="spacer" />
        <button className={`btn ${armed ? 'danger' : ''}`} onClick={async () => {
          if (!armed) return setArmed(true);
          try { await deleteCourse(course.id); nav('/formacion/gestion'); }
          catch (e) {
            setArmed(false);
            setMsg({ ok: false, text: (e as { code?: string }).code === '23503'
              ? 'No se puede borrar: ya hay personas que lo han hecho y sus registros son la evidencia de la formación. Despublícalo para retirarlo.'
              : (e as Error).message });
          }
        }}>{armed ? 'Confirmar: borrar curso' : 'Borrar curso'}</button>
      </div>
      {armed && <p className="note">Se borrarán sus lecciones, preguntas y asignaciones. Si alguien ya lo ha hecho, no se podrá borrar (sus registros se conservan): despublícalo.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
const KIND_LABEL: Record<LessonKind, string> = { text: 'Texto', video: 'Vídeo', pdf: 'PDF', link: 'Enlace externo' };

function Lessons({ course, lessons, onChange }: { course: Course; lessons: Lesson[]; onChange: () => void }) {
  const [editing, setEditing] = useState<Partial<Lesson> | null>(null);
  const [err, setErr] = useState('');
  const move = async (k: number, dir: -1 | 1) => {
    const a = lessons[k], b = lessons[k + dir];
    if (!b) return;
    try {
      await Promise.all(lessons.map((l, i) => {
        const pos = i === k ? k + dir : i === k + dir ? k : i;
        return l.position === pos ? null : saveLesson({ id: l.id, position: pos });
      }));
      onChange();
    } catch (e) { setErr((e as Error).message); }
    void a;
  };
  return (
    <section className="panel">
      {err && <div className="msg err">{err}</div>}
      {editing ? (
        <LessonForm course={course} draft={editing} onDone={() => { setEditing(null); onChange(); }} onCancel={() => setEditing(null)} />
      ) : (
        <>
          <ol className="edlist">
            {lessons.map((l, k) => (
              <li key={l.id}>
                <span className="tag">{KIND_LABEL[l.kind]}</span>
                <span className="edtitle">{l.title}</span>
                <span className="row">
                  <button className="btn small" disabled={k === 0} aria-label={`Subir ${l.title}`} onClick={() => move(k, -1)}>↑</button>
                  <button className="btn small" disabled={k === lessons.length - 1} aria-label={`Bajar ${l.title}`} onClick={() => move(k, 1)}>↓</button>
                  <button className="btn small" onClick={() => setEditing(l)}>Editar</button>
                </span>
              </li>
            ))}
          </ol>
          {!lessons.length && <p className="note">Todavía no hay lecciones.</p>}
          <button className="btn solid" onClick={() => setEditing({ course_id: course.id, kind: 'text', title: '', body: '', url: '', position: lessons.length })}>Añadir lección</button>
        </>
      )}
    </section>
  );
}

function LessonForm({ course, draft, onDone, onCancel }: { course: Course; draft: Partial<Lesson>; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(false);
  const [armed, setArmed] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { await saveLesson({ id: f.id, course_id: course.id, title: f.title!.trim(), kind: f.kind, body: f.body || '', url: (f.url || '').trim(), position: f.position ?? 0 }); onDone(); }
    catch (e) { setErr((e as Error).message || 'No se ha podido guardar.'); } finally { setBusy(false); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return setErr('El archivo supera 50 MB. Para vídeos largos, súbelos a vuestra plataforma de vídeo y usa el enlace.');
    setBusy(true); setErr('');
    try { setF({ ...f, url: await uploadFile(course.id, file) }); } catch (e) { setErr(`No se ha podido subir el archivo: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const needsUrl = f.kind !== 'text';
  return (
    <div className="form">
      <h2 style={{ fontSize: 18 }}>{f.id ? 'Editar lección' : 'Nueva lección'}</h2>
      <label className="fl" htmlFor="l-title">Título</label>
      <input id="l-title" type="text" maxLength={200} value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <label className="fl" htmlFor="l-kind">Tipo</label>
      <select id="l-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LessonKind })}>
        {(Object.keys(KIND_LABEL) as LessonKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select>
      {needsUrl && (<>
        <label className="fl" htmlFor="l-url">{f.kind === 'video' ? 'Enlace del vídeo (YouTube, Vimeo, Stream…) o sube un archivo' : f.kind === 'pdf' ? 'Enlace al PDF o sube el archivo' : 'Enlace al recurso'}</label>
        <input id="l-url" type="text" value={f.url?.startsWith('storage:') ? '' : f.url || ''} placeholder={f.url?.startsWith('storage:') ? `Archivo subido: ${f.url.split('/').pop()}` : 'https://…'}
          onChange={(e) => setF({ ...f, url: e.target.value })} />
        {f.kind !== 'link' && <input type="file" accept={f.kind === 'pdf' ? 'application/pdf' : 'video/*'} onChange={(e) => upload(e.target.files?.[0])} />}
      </>)}
      <label className="fl" htmlFor="l-body">{f.kind === 'text' ? 'Contenido' : 'Texto de apoyo (opcional)'}</label>
      <p className="note" style={{ margin: 0 }}>Formato: # título, ## subtítulo, - lista, 1. lista numerada, **negrita**, *cursiva*, [texto](https://enlace). Deja una línea en blanco entre párrafos.</p>
      {preview ? <div className="panel" style={{ marginTop: 0 }}><Markdown text={f.body || ''} /></div>
        : <textarea id="l-body" rows={f.kind === 'text' ? 16 : 5} value={f.body || ''} onChange={(e) => setF({ ...f, body: e.target.value })} />}
      {err && <div className="msg err">{err}</div>}
      <div className="row">
        <button className="btn solid" disabled={busy || !f.title?.trim() || (needsUrl && !f.url?.trim()) || (f.kind === 'text' && !f.body?.trim())} onClick={save}>Guardar lección</button>
        <button className="btn" onClick={() => setPreview(!preview)}>{preview ? 'Editar texto' : 'Vista previa'}</button>
        <button className="btn" onClick={onCancel}>Cancelar</button>
        <span className="spacer" />
        {f.id && <button className={`btn ${armed ? 'danger' : ''}`} onClick={async () => { if (!armed) return setArmed(true); await deleteLesson(f.id!); onDone(); }}>{armed ? 'Confirmar: borrar' : 'Borrar lección'}</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Questions({ course, questions, onChange }: { course: Course; questions: CourseQuestion[]; onChange: () => void }) {
  const [editing, setEditing] = useState<Partial<CourseQuestion> | null>(null);
  return (
    <section className="panel">
      {editing ? (
        <QuestionForm course={course} draft={editing} onDone={() => { setEditing(null); onChange(); }} onCancel={() => setEditing(null)} />
      ) : (
        <>
          <p className="note">Las respuestas correctas solo las ven los editores: el test se corrige en el servidor. {course.quiz_size ? `Cada intento saca ${course.quiz_size} preguntas al azar.` : 'Cada intento incluye todas las preguntas.'}</p>
          <ol className="edlist">
            {questions.map((q) => (
              <li key={q.id}>
                <span className="edtitle">{q.stem}<small>{q.options.length} opciones · correcta: {q.correct.map((k) => LETTERS[k]).join(', ')}</small></span>
                <button className="btn small" onClick={() => setEditing(q)}>Editar</button>
              </li>
            ))}
          </ol>
          {!questions.length && <p className="note">Todavía no hay preguntas.</p>}
          <button className="btn solid" onClick={() => setEditing({ course_id: course.id, stem: '', options: ['', '', ''], correct: [0], explanation: '', position: questions.length })}>Añadir pregunta</button>
        </>
      )}
    </section>
  );
}

function QuestionForm({ course, draft, onDone, onCancel }: { course: Course; draft: Partial<CourseQuestion>; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState(draft);
  const [err, setErr] = useState('');
  const [armed, setArmed] = useState(false);
  const opts = f.options || [];
  const correct = f.correct || [];
  const valid = !!f.stem?.trim() && opts.length >= 2 && opts.every((o) => o.trim()) && correct.length >= 1 && correct.length < opts.length;
  const save = async () => {
    setErr('');
    try { await saveQuestion({ id: f.id, course_id: course.id, stem: f.stem!.trim(), options: opts.map((o) => o.trim()), correct: [...correct].sort(), explanation: (f.explanation || '').trim(), position: f.position ?? 0 }); onDone(); }
    catch (e) { setErr((e as Error).message || 'No se ha podido guardar.'); }
  };
  const setOpt = (k: number, v: string) => setF({ ...f, options: opts.map((o, i) => (i === k ? v : o)) });
  const removeOpt = (k: number) => setF({ ...f, options: opts.filter((_, i) => i !== k), correct: correct.filter((c) => c !== k).map((c) => (c > k ? c - 1 : c)) });
  return (
    <div className="form">
      <h2 style={{ fontSize: 18 }}>{f.id ? 'Editar pregunta' : 'Nueva pregunta'}</h2>
      <label className="fl" htmlFor="q-stem">Enunciado</label>
      <textarea id="q-stem" rows={3} value={f.stem || ''} onChange={(e) => setF({ ...f, stem: e.target.value })} />
      <span className="fl">Opciones (marca la correcta; si marcas varias, será de respuesta múltiple)</span>
      {opts.map((o, k) => (
        <div key={k} className="topt">
          <input type="checkbox" aria-label={`Opción ${LETTERS[k]} correcta`} checked={correct.includes(k)}
            onChange={(e) => setF({ ...f, correct: e.target.checked ? [...correct, k] : correct.filter((c) => c !== k) })} />
          <span className="key">{LETTERS[k]}</span>
          <span className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="text" aria-label={`Texto de la opción ${LETTERS[k]}`} value={o} onChange={(e) => setOpt(k, e.target.value)} />
            {opts.length > 2 && <button className="btn small" aria-label={`Quitar opción ${LETTERS[k]}`} onClick={() => removeOpt(k)}>×</button>}
          </span>
        </div>
      ))}
      {opts.length < 6 && <div><button className="btn small" onClick={() => setF({ ...f, options: [...opts, ''] })}>Añadir opción</button></div>}
      <label className="fl" htmlFor="q-expl">Explicación (se muestra al aprobar)</label>
      <textarea id="q-expl" rows={2} value={f.explanation || ''} onChange={(e) => setF({ ...f, explanation: e.target.value })} />
      {err && <div className="msg err">{err}</div>}
      <div className="row">
        <button className="btn solid" disabled={!valid} onClick={save}>Guardar pregunta</button>
        <button className="btn" onClick={onCancel}>Cancelar</button>
        {!valid && <span className="note">Rellena el enunciado y todas las opciones, y marca al menos una correcta (no todas).</span>}
        <span className="spacer" />
        {f.id && <button className={`btn ${armed ? 'danger' : ''}`} onClick={async () => { if (!armed) return setArmed(true); await deleteQuestion(f.id!); onDone(); }}>{armed ? 'Confirmar: borrar' : 'Borrar pregunta'}</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Assignments({ course, assignments, onChange }: { course: Course; assignments: Assignment[]; onChange: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [due, setDue] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { Promise.all([trainingPeople(), listTeams()]).then(([p, t]) => { setPeople(p); setTeams(t); }).catch((e) => setMsg({ ok: false, text: e?.message })); }, []);
  const name = (p?: Person) => (p ? p.display_name || p.email : 'Persona eliminada');
  const pById = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const tById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const filtered = people.filter((p) => !q || `${p.display_name} ${p.email}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (key: string) => setSel((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const assign = async () => {
    setMsg(null);
    try {
      await addAssignments(course.id, [...sel].map((k) => (k.startsWith('t:') ? { team_id: k.slice(2) } : { user_id: k.slice(2) })), due || null);
      setSel(new Set()); setMsg({ ok: true, text: 'Asignado.' }); onChange();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message || 'No se ha podido asignar.' }); }
  };
  return (
    <>
      <section className="panel">
        <h2 style={{ fontSize: 18 }}>Asignar</h2>
        {!course.is_published && <div className="msg err">El curso está en borrador: las personas asignadas no lo verán hasta que lo publiques.</div>}
        <div className="assign-grid">
          <fieldset>
            <legend className="fl">Equipos</legend>
            {teams.map((t) => <label key={t.id} className="okline"><input type="checkbox" checked={sel.has('t:' + t.id)} onChange={() => toggle('t:' + t.id)} /> {t.name}</label>)}
            {!teams.length && <p className="note">No hay equipos. Créalos en Administración → Equipos.</p>}
          </fieldset>
          <fieldset>
            <legend className="fl">Personas</legend>
            <input type="search" className="select" placeholder="Buscar por nombre o email" aria-label="Buscar personas" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="pickbox">
              {filtered.map((p) => <label key={p.user_id} className="okline"><input type="checkbox" checked={sel.has('u:' + p.user_id)} onChange={() => toggle('u:' + p.user_id)} /> {p.display_name || p.email} {p.display_name && <span className="muted">· {p.email}</span>}</label>)}
            </div>
          </fieldset>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="fl" htmlFor="a-due">Fecha límite (opcional)</label>
          <input id="a-due" type="date" className="select" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn solid" disabled={!sel.size} onClick={assign}>Asignar a {sel.size} {sel.size === 1 ? 'elemento' : 'elementos'}</button>
        </div>
        <p className="note">Asignar a un equipo incluye a quien entre en él más adelante. Si ya estaba asignado, se actualiza la fecha límite.</p>
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
      </section>
      <section className="panel">
        <h2 style={{ fontSize: 18 }}>Asignaciones actuales</h2>
        {!assignments.length ? <p className="note">Sin asignaciones.</p> : (
          <div className="table-wrap">
            <table className="simple">
              <thead><tr><th>Asignado a</th><th>Fecha límite</th><th>Desde</th><th /></tr></thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.team_id ? <><span className="tag">Equipo</span> {tById.get(a.team_id)?.name || '—'}</> : name(pById.get(a.user_id!))}</td>
                    <td>{fmtDay(a.due_date)}</td>
                    <td>{fmtDay(a.created_at)}</td>
                    <td><button className="btn small" onClick={async () => { await removeAssignment(a.id); onChange(); }}>Quitar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
function Compliance({ course }: { course: Course }) {
  const [rows, setRows] = useState<StatusRow[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<TrainingState | 'all'>('all');
  useEffect(() => { trainingStatus(course.id).then(setRows).catch((e) => setErr(e?.message || 'Error')); }, [course.id]);
  if (err) return <section className="panel"><div className="msg err">{err}</div></section>;
  if (!rows) return <section className="panel"><p className="note">Cargando…</p></section>;
  const count = (s: TrainingState) => rows.filter((r) => r.state === s).length;
  const list = rows.filter((r) => filter === 'all' || r.state === filter);
  const csv = () => {
    const head = ['Nombre', 'Email', 'Equipos', 'Estado', 'Fecha límite', 'Completada', 'Nota %', 'Conformidad firmada', 'Válida hasta', 'Intentos'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [r.display_name, r.email, r.teams, STATE_LABEL[r.state], r.due_date, r.last_passed_at && new Date(r.last_passed_at).toISOString(),
      r.score_pct, r.ack_at && new Date(r.ack_at).toISOString(), r.expires_at && new Date(r.expires_at).toISOString().slice(0, 10), r.attempts].map(esc).join(';'));
    const blob = new Blob(['﻿' + [head.map(esc).join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cumplimiento-${course.title.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').slice(0, 60)}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <section className="panel">
      <div className="kpis">
        <div><b>{rows.length}</b><span>asignadas</span></div>
        <div className="ok"><b>{count('completado')}</b><span>completadas</span></div>
        <div><b>{count('pendiente')}</b><span>pendientes</span></div>
        <div className="bad"><b>{count('vencido')}</b><span>vencidas</span></div>
        <div className="warn"><b>{count('caducado')}</b><span>caducadas</span></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        {(['all', 'vencido', 'caducado', 'pendiente', 'completado'] as const).map((k) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'all' ? 'Todas' : STATE_LABEL[k]}</button>
        ))}
        <span className="spacer" />
        <button className="btn small" disabled={!rows.length} onClick={csv}>Exportar CSV</button>
      </div>
      {!rows.length ? <p className="note">Nadie tiene este curso asignado todavía.</p> : (
        <div className="table-wrap">
          <table className="simple">
            <thead><tr><th>Persona</th><th>Equipos</th><th>Estado</th><th>Fecha límite</th><th>Completada</th><th>Nota</th><th>Conformidad</th><th>Válida hasta</th><th /></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.user_id}>
                  <td>{r.display_name || r.email}{r.display_name && <div className="muted" style={{ fontSize: 12.5 }}>{r.email}</div>}</td>
                  <td>{r.teams || '—'}</td>
                  <td><span className={`state ${r.state}`}>{STATE_LABEL[r.state]}</span></td>
                  <td>{fmtDay(r.due_date)}</td>
                  <td>{fmtDay(r.last_passed_at)}</td>
                  <td>{r.score_pct != null ? `${r.score_pct}%` : r.attempts ? `${r.attempts} intento${r.attempts === 1 ? '' : 's'}` : '—'}</td>
                  <td title={r.ack_at ? fmtDateTime(r.ack_at) : undefined}>{r.ack_at ? 'Firmada' : '—'}</td>
                  <td>{fmtDay(r.expires_at)}</td>
                  <td>{r.completion_id && <Link className="btn small" to={`/formacion/certificado/${r.completion_id}`}>Certificado</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
