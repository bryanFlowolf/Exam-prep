import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { useExam } from '../lib/useExam';
import { LETTERS, fmtDate } from '../lib/exam';
import { deleteQuestion, saveTeamQuestion } from '../lib/data';
import type { Question } from '../lib/types';
import { QL, qText } from '../lib/lang';
import Stem from '../components/Stem';

type Draft = { domain_id: string; stem: string; options: string[]; correct: boolean[]; explanation: string; ok: boolean };

const empty = (domainId: string): Draft => ({ domain_id: domainId, stem: '', options: ['', '', '', '', ''], correct: [false, false, false, false, false], explanation: '', ok: false });

export default function Team() {
  const { slug = '' } = useParams();
  const { userId, profile, lang } = useApp();
  const { data, error, update } = useExam(slug, userId);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  if (error) return <main className="wrap"><div className="msg err" style={{ marginTop: 24 }}>{error}</div></main>;
  if (!data) return <div className="center">Cargando…</div>;

  const d = draft || empty(data.domains[0]?.id || '');
  const domains = Object.fromEntries(data.domains.map((x) => [x.id, x]));
  const team = data.questions.filter((q) => q.source === 'team');
  const list = team.filter((q) => filter === 'all' || q.domain_id === filter).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const author = (q: Question) => (q.author_id === userId ? 'Tú' : (q.author_id && data.authors[q.author_id]) || 'Un compañero');
  const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });

  const startEdit = (q: Question) => {
    const options = [...q.options]; while (options.length < 5) options.push('');
    setDraft({ domain_id: q.domain_id, stem: q.stem, options, correct: options.map((_, i) => q.correct.includes(i)), explanation: q.explanation, ok: false });
    setEditing(q.id); setMsg('');
    document.getElementById('tform')?.scrollIntoView({ block: 'start' });
  };

  const save = async () => {
    const filled = d.options.map((t, i) => ({ t: t.trim(), c: d.correct[i] })).filter((x) => x.t);
    const options = filled.map((x) => x.t);
    const correct = filled.map((x, i) => (x.c ? i : -1)).filter((i) => i >= 0);
    if (d.stem.trim().length < 10) return setMsg('Escribe un enunciado de al menos 10 caracteres.');
    if (options.length < 2) return setMsg('Añade al menos dos opciones.');
    if (!correct.length) return setMsg('Marca al menos una opción correcta.');
    if (correct.length === options.length) return setMsg('Al menos una opción debe ser incorrecta.');
    if (!d.ok) return setMsg('Confirma que la pregunta es original antes de publicarla.');
    setSaving(true); setMsg('');
    try {
      const q = await saveTeamQuestion(data.exam.id, { domain_id: d.domain_id, stem: d.stem.trim(), options, correct, explanation: d.explanation.trim() }, editing || undefined);
      update((x) => ({
        ...x,
        questions: editing ? x.questions.map((y) => (y.id === q.id ? q : y)) : [...x.questions, q],
        authors: { ...x.authors, [userId]: profile?.display_name || '' },
      }));
      setDraft(null); setEditing(null);
    } catch {
      setMsg('No se ha podido guardar la pregunta. Inténtalo de nuevo.');
    } finally { setSaving(false); }
  };

  const remove = async (q: Question) => {
    if (armed !== q.id) { setArmed(q.id); setTimeout(() => setArmed((a) => (a === q.id ? null : a)), 3000); return; }
    try {
      await deleteQuestion(q.id);
      update((x) => ({ ...x, questions: x.questions.filter((y) => y.id !== q.id) }));
    } catch { setMsg('No se ha podido borrar la pregunta.'); }
    setArmed(null);
  };

  return (
    <main className="wrap">
      <div className="crumbs" style={{ marginTop: 14 }}><Link to="/">Exámenes</Link> / <Link to={`/e/${slug}`}>{data.exam.name}</Link></div>
      <header className="hero" style={{ paddingTop: 12 }}>
        <div className="eyebrow">Compartidas · {team.length} preguntas</div>
        <h1>Preguntas del equipo</h1>
        <p>Preguntas de práctica escritas por los compañeros a partir del temario oficial. Todos las ven y las pueden practicar; cada persona edita y borra solo las suyas.</p>
      </header>

      <div className="row">
        <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todas</button>
        {data.domains.map((x) => <button key={x.id} className="chip" aria-pressed={filter === x.id} onClick={() => setFilter(x.id)}>{x.code}</button>)}
      </div>

      <section className="panel form" id="tform">
        <div className="eyebrow">{editing ? 'Editar pregunta' : 'Añadir una pregunta'}</div>
        <p className="note">Escribe preguntas originales a partir del temario. No copies ni reconstruyas preguntas del examen real ni de bancos de terceros: el acuerdo de confidencialidad del examen lo prohíbe y puede suponer la retirada de la certificación.</p>
        <label className="fl" htmlFor="tq-d">Dominio</label>
        <select id="tq-d" value={d.domain_id} onChange={(e) => set({ domain_id: e.target.value })}>
          {data.domains.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
        </select>
        <label className="fl" htmlFor="tq-q">Enunciado</label>
        <textarea id="tq-q" rows={3} maxLength={3000} value={d.stem} onChange={(e) => set({ stem: e.target.value })} placeholder="Describe un escenario y lo que hay que decidir" />
        <div className="fl">Opciones · marca la correcta (o las correctas si es de respuesta múltiple)</div>
        <div className="form" style={{ gap: 6 }}>
          {d.options.map((o, i) => (
            <div className="topt" key={i}>
              <input type="checkbox" id={`tq-c${i}`} aria-label={`Opción ${LETTERS[i]} correcta`} checked={d.correct[i]} onChange={(e) => set({ correct: d.correct.map((c, k) => (k === i ? e.target.checked : c)) })} />
              <span className="key">{LETTERS[i]}</span>
              <input type="text" id={`tq-o${i}`} maxLength={600} value={o} placeholder={i < 2 ? 'Obligatoria' : 'Opcional'} onChange={(e) => set({ options: d.options.map((x, k) => (k === i ? e.target.value : x)) })} />
            </div>
          ))}
        </div>
        <label className="fl" htmlFor="tq-e">Explicación</label>
        <textarea id="tq-e" rows={2} maxLength={3000} value={d.explanation} onChange={(e) => set({ explanation: e.target.value })} placeholder="Por qué es correcta y por qué fallan las demás" />
        <label className="okline"><input type="checkbox" checked={d.ok} onChange={(e) => set({ ok: e.target.checked })} /> Confirmo que es una pregunta original, no copiada ni reconstruida de un examen real.</label>
        {msg && <div className="msg err">{msg}</div>}
        <div className="row">
          <button className="btn solid" disabled={saving} onClick={save}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Publicar pregunta'}</button>
          {editing && <button className="btn" onClick={() => { setDraft(null); setEditing(null); setMsg(''); }}>Cancelar</button>}
        </div>
      </section>

      <section className="list">
        {list.map((q) => {
          const mine = q.author_id === userId;
          const t = qText(q, lang);
          return (
            <article key={q.id} className="ritem team">
              <div className="qhead">
                <span className="tag">{domains[q.domain_id]?.code} · {domains[q.domain_id]?.name}</span>
                <span className="tag">{author(q)}</span>
                {q.correct.length > 1 && <span className="tag multi">{QL[lang].choose(q.correct.length)}</span>}
                {t.missing && <span className="tag">{QL[lang].missing}</span>}
                <span className="tag">{fmtDate(q.created_at)}</span>
              </div>
              <Stem text={t.stem} />
              <ul>{t.options.map((o, i) => <li key={i} className={q.correct.includes(i) ? 'c' : ''}>{LETTERS[i]}. {o}</li>)}</ul>
              {t.explanation && <div className="expl">{t.explanation}</div>}
              {(mine || profile?.is_admin) && (
                <div className="row" style={{ marginTop: 10 }}>
                  {mine && <button className="btn small" onClick={() => startEdit(q)}>Editar</button>}
                  <button className={`btn small ${armed === q.id ? 'solid' : ''}`} onClick={() => remove(q)}>{armed === q.id ? 'Confirmar borrado' : mine ? 'Borrar' : 'Borrar (moderación)'}</button>
                </div>
              )}
            </article>
          );
        })}
        {!list.length && <p className="note">Todavía no hay preguntas en este filtro. Añade la primera con el formulario de arriba.</p>}
      </section>
    </main>
  );
}
