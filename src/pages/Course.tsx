import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../App';
import Markdown from '../components/Markdown';
import { LETTERS } from '../lib/exam';
import {
  catLabel, completeLesson, courseQuiz, myTraining, fileUrl, fmtDay, getCourse, submitCourse,
  type Completion, type Course as CourseT, type Lesson, type QuizQuestion, type SubmitResult,
} from '../lib/training';

type View = { kind: 'lesson'; id: string } | { kind: 'quiz' };

export default function Course() {
  const { id = '' } = useParams();
  const [data, setData] = useState<{ course: CourseT; lessons: Lesson[]; done: Set<string>; completions: Completion[] } | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View | null>(null);
  const { setPending } = useApp();

  const load = async () => {
    try {
      const d = await getCourse(id);
      setData(d);
      setView((v) => v || (d.lessons.find((l) => !d.done.has(l.id)) ? { kind: 'lesson', id: d.lessons.find((l) => !d.done.has(l.id))!.id } : d.lessons.length ? { kind: 'quiz' } : { kind: 'quiz' }));
    } catch (e) { setError((e as Error).message || 'No se ha podido cargar el curso.'); }
  };
  useEffect(() => { load(); }, [id]);

  if (error) return <main className="wrap"><div className="msg err" style={{ marginTop: 24 }}>{error}</div><p><Link to="/formacion">← Volver a formación</Link></p></main>;
  if (!data || !view) return <div className="center">Cargando curso…</div>;
  const { course, lessons, done, completions } = data;
  const allDone = lessons.every((l) => done.has(l.id));
  const passed = completions.find((c) => c.passed);
  const valid = passed && (!passed.expires_at || new Date(passed.expires_at) > new Date());
  const idx = view.kind === 'lesson' ? lessons.findIndex((l) => l.id === view.id) : -1;
  const lesson = idx >= 0 ? lessons[idx] : null;

  const markDone = async (l: Lesson) => {
    await completeLesson(l);
    const next = lessons.slice(idx + 1).find((x) => !done.has(x.id) && x.id !== l.id);
    setData({ ...data, done: new Set(done).add(l.id) });
    setView(next ? { kind: 'lesson', id: next.id } : { kind: 'quiz' });
    window.scrollTo({ top: 0 });
  };

  return (
    <main className="wrap">
      <header className="hero" style={{ paddingBottom: 6 }}>
        <div className="eyebrow"><Link to="/formacion">Formación</Link> · {catLabel(course.category)}</div>
        <h1>{course.title}</h1>
        {course.summary && <p>{course.summary}</p>}
        {valid && (
          <div className="msg ok">
            Formación superada el {fmtDay(passed!.completed_at)}{passed!.expires_at ? `, válida hasta el ${fmtDay(passed!.expires_at)}` : ''}.{' '}
            <Link to={`/formacion/certificado/${passed!.id}`}>Ver certificado</Link>
          </div>
        )}
        {passed && !valid && <div className="msg err">Tu certificado caducó el {fmtDay(passed.expires_at)}. Repasa el contenido y vuelve a hacer el test para renovarlo.</div>}
      </header>
      <div className="course-layout">
        <nav className="panel steps" aria-label="Contenido del curso">
          <ol>
            {lessons.map((l, k) => (
              <li key={l.id}>
                <button className={`step ${view.kind === 'lesson' && view.id === l.id ? 'on' : ''}`} aria-current={view.kind === 'lesson' && view.id === l.id ? 'step' : undefined}
                  onClick={() => { setView({ kind: 'lesson', id: l.id }); window.scrollTo({ top: 0 }); }}>
                  <span className={`dot ${done.has(l.id) ? 'done' : ''}`} aria-label={done.has(l.id) ? 'Completada' : 'Pendiente'}>{done.has(l.id) ? '✓' : k + 1}</span>
                  <span>{l.title}</span>
                </button>
              </li>
            ))}
            <li>
              <button className={`step ${view.kind === 'quiz' ? 'on' : ''}`} onClick={() => setView({ kind: 'quiz' })}>
                <span className={`dot ${valid ? 'done' : ''}`}>{valid ? '✓' : '★'}</span>
                <span>Test final{course.requires_ack ? ' y conformidad' : ''}</span>
              </button>
            </li>
          </ol>
          <p className="note" style={{ marginTop: 10 }}>{done.size} de {lessons.length} lecciones completadas · aprobado con {course.pass_pct}%</p>
        </nav>
        <section className="panel lesson">
          {lesson ? (
            <LessonView key={lesson.id} lesson={lesson} isDone={done.has(lesson.id)} onDone={() => markDone(lesson)}
              onNext={() => setView(lessons[idx + 1] ? { kind: 'lesson', id: lessons[idx + 1].id } : { kind: 'quiz' })} />
          ) : (
            <Quiz course={course} ready={allDone} onFinished={() => { load(); myTraining().then((m) => setPending(m.filter((x) => x.state !== 'completado').length)).catch(() => {}); }} />
          )}
        </section>
      </div>
    </main>
  );
}

function embedUrl(url: string): string | null {
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

function LessonView({ lesson, isDone, onDone, onNext }: { lesson: Lesson; isDone: boolean; onDone: () => Promise<void>; onNext: () => void }) {
  const [src, setSrc] = useState<string | null>(lesson.url && !lesson.url.startsWith('storage:') ? lesson.url : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (lesson.url.startsWith('storage:')) fileUrl(lesson.url).then(setSrc).catch(() => setErr('No se ha podido abrir el archivo de la lección.'));
  }, [lesson.url]);
  const embed = lesson.kind === 'video' && src ? embedUrl(src) : null;

  return (
    <article>
      <div className="eyebrow">{{ text: 'Lectura', video: 'Vídeo', pdf: 'Documento PDF', link: 'Recurso externo' }[lesson.kind]}</div>
      <h2 className="ltitle">{lesson.title}</h2>
      {err && <div className="msg err">{err}</div>}
      {lesson.kind === 'video' && src && (embed
        ? <div className="media"><iframe src={embed} title={lesson.title} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
        : /\.(mp4|webm|ogg)(\?|$)/i.test(src) || lesson.url.startsWith('storage:')
          ? <video className="media-video" src={src} controls preload="metadata" />
          : <p><a className="btn" href={src} target="_blank" rel="noopener noreferrer">Abrir el vídeo ↗</a></p>)}
      {lesson.kind === 'pdf' && src && (
        <>
          <div className="media pdf"><iframe src={src} title={lesson.title} /></div>
          <p className="note"><a href={src} target="_blank" rel="noopener noreferrer">Abrir el PDF en otra pestaña ↗</a></p>
        </>
      )}
      {lesson.body && <Markdown text={lesson.body} />}
      {lesson.kind === 'link' && src && <p><a className="btn" href={src} target="_blank" rel="noopener noreferrer">Abrir el recurso ↗</a></p>}
      <div className="row" style={{ marginTop: 20 }}>
        {isDone
          ? <><span className="tag accent">Lección completada</span><span className="spacer" /><button className="btn solid" onClick={onNext}>Siguiente</button></>
          : <button className="btn solid" disabled={busy} onClick={async () => { setBusy(true); try { await onDone(); } catch { setErr('No se ha podido guardar tu avance.'); } finally { setBusy(false); } }}>Marcar como completada y seguir</button>}
      </div>
    </article>
  );
}

function Quiz({ course, ready, onFinished }: { course: CourseT; ready: boolean; onFinished: () => void }) {
  const [qs, setQs] = useState<QuizQuestion[] | null>(null);
  const [picks, setPicks] = useState<Record<string, number[]>>({});
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);

  const start = async () => {
    setErr(''); setResult(null); setPicks({}); setAck(false);
    try { setQs(await courseQuiz(course.id)); } catch (e) { setErr((e as Error).message || 'No se ha podido cargar el test.'); }
  };
  if (!ready) return (
    <article>
      <div className="eyebrow">Test final</div>
      <h2 className="ltitle">Primero completa las lecciones</h2>
      <p className="note">El test se desbloquea cuando marcas todas las lecciones como completadas.</p>
    </article>
  );

  const toggle = (q: QuizQuestion, k: number) => setPicks((p) => {
    const cur = p[q.id] || [];
    return { ...p, [q.id]: q.multi ? (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]) : [k] };
  });
  const answered = qs ? qs.filter((q) => (picks[q.id] || []).length > 0).length : 0;
  const submit = async () => {
    if (!qs) return;
    setBusy(true); setErr('');
    try {
      const r = await submitCourse(course.id, qs.map((q) => ({ id: q.id, picked: picks[q.id] || [] })), ack);
      setResult(r);
      window.scrollTo({ top: 0 });
      if (r.completion.passed) onFinished();
    } catch (e) { setErr((e as Error).message || 'No se ha podido enviar el test.'); }
    finally { setBusy(false); }
  };

  if (result) {
    const c = result.completion;
    const det = new Map(result.detail.map((d) => [d.id, d]));
    return (
      <article>
        <div className="eyebrow">Resultado del test</div>
        <h2 className="ltitle">{c.passed ? '¡Formación superada!' : 'Todavía no'}</h2>
        <p><span className="score-inline">{c.score_pct}%</span> · {c.correct} de {c.total} correctas · aprobado con {c.pass_pct}%</p>
        {c.passed
          ? <div className="msg ok">Queda registrada{c.ack_at ? ' tu conformidad' : ''} con fecha {new Date(c.completed_at).toLocaleString('es-ES')}. <Link to={`/formacion/certificado/${c.id}`}>Ver y descargar el certificado</Link></div>
          : <div className="msg err">Repasa las lecciones y vuelve a intentarlo. Abajo ves qué preguntas has fallado.</div>}
        <ol className="quizlist">
          {qs!.map((q) => {
            const d = det.get(q.id);
            return (
              <li key={q.id} className={d?.ok ? 'ok' : 'bad'}>
                <p className="qtext">{q.stem} <span className="tag" style={{ color: d?.ok ? 'var(--ok)' : 'var(--bad)' }}>{d?.ok ? 'Correcta' : 'Incorrecta'}</span></p>
                {d?.correct && <p className="note">Respuesta correcta: {d.correct.map((k) => `${LETTERS[k]}. ${q.options[k]}`).join(' · ')}</p>}
                {d?.explanation && <div className="expl">{d.explanation}</div>}
              </li>
            );
          })}
        </ol>
        {!c.passed && <button className="btn solid" onClick={start}>Repetir el test</button>}
      </article>
    );
  }

  if (!qs) return (
    <article>
      <div className="eyebrow">Test final</div>
      <h2 className="ltitle">¿Preparado?</h2>
      <p className="note">Se aprueba con un {course.pass_pct}% de aciertos. Puedes repetirlo si no lo superas.{course.requires_ack ? ' Al aprobar, confirmarás que has recibido y comprendido la formación; quedará registrado con la fecha y hora.' : ''}</p>
      {err && <div className="msg err">{err}</div>}
      <button className="btn solid" onClick={start}>Empezar el test</button>
    </article>
  );

  if (qs.length === 0) return (
    <article>
      <div className="eyebrow">Finalizar</div>
      <h2 className="ltitle">Este curso no tiene test</h2>
      <p className="note">Has completado todas las lecciones.{course.requires_ack ? ' Confirma la declaración para dar la formación por completada.' : ' Pulsa el botón para registrarla como completada.'}</p>
      {course.requires_ack && (
        <label className="ackbox"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span><b>Declaración de conformidad.</b> {course.ack_text}</span></label>
      )}
      {err && <div className="msg err">{err}</div>}
      <button className="btn solid" style={{ marginTop: 14 }} disabled={busy || (course.requires_ack && !ack)} onClick={submit}>Completar la formación</button>
    </article>
  );

  return (
    <article>
      <div className="eyebrow">Test final · {answered} de {qs.length} respondidas</div>
      <ol className="quizlist take">
        {qs.map((q, n) => (
          <li key={q.id}>
            <fieldset>
              <legend className="qtext"><span className="qnum">{n + 1}.</span> {q.stem}{q.multi && <span className="tag multi" style={{ marginLeft: 8 }}>Varias respuestas</span>}</legend>
              <div className="opts">
                {q.options.map((o, k) => (
                  <label key={k} className={`opt ${(picks[q.id] || []).includes(k) ? 'sel' : ''}`}>
                    <input type={q.multi ? 'checkbox' : 'radio'} name={`q-${q.id}`} checked={(picks[q.id] || []).includes(k)} onChange={() => toggle(q, k)} />
                    <span className="key">{LETTERS[k]}</span><span className="otext">{o}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {course.requires_ack && (
        <label className="ackbox">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span><b>Declaración de conformidad.</b> {course.ack_text}</span>
        </label>
      )}
      {err && <div className="msg err">{err}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn solid" disabled={busy || answered < qs.length || (course.requires_ack && !ack)} onClick={submit}>Enviar el test</button>
        {answered < qs.length && <span className="note">Responde todas las preguntas para enviarlo.</span>}
        {answered === qs.length && course.requires_ack && !ack && <span className="note">Marca la declaración de conformidad para enviarlo.</span>}
      </div>
    </article>
  );
}
