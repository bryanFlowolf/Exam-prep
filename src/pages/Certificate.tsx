import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fmtDateTime, fmtDay, getCompletion, type Completion } from '../lib/training';

/** Printable certificate of a passed course (the browser's "Save as PDF" produces the file). */
export default function Certificate() {
  const { id = '' } = useParams();
  const [c, setC] = useState<Completion | null | undefined>(undefined);
  useEffect(() => { getCompletion(id).then(setC).catch(() => setC(null)); }, [id]);

  if (c === undefined) return <div className="center">Cargando certificado…</div>;
  if (!c || !c.passed) return <main className="wrap"><div className="msg err" style={{ marginTop: 24 }}>Certificado no encontrado.</div><p><Link to="/formacion">← Volver a formación</Link></p></main>;

  return (
    <main className="wrap">
      <div className="row noprint" style={{ marginTop: 18 }}>
        <Link to={`/formacion/${c.course_id}`}>← Volver al curso</Link>
        <span className="spacer" />
        <button className="btn solid" onClick={() => window.print()}>Imprimir o guardar en PDF</button>
      </div>
      <article className="cert">
        <div className="cert-brand"><i className="logo" aria-hidden="true" /> WolfPack Academy · floWolf</div>
        <p className="eyebrow">Certificado de formación</p>
        <p>Se certifica que</p>
        <h1>{c.person_name || c.person_email}</h1>
        {c.person_name && <p className="muted">{c.person_email}</p>}
        <p>ha completado y superado la formación</p>
        <h2>{c.course_title}</h2>
        <dl>
          <div><dt>Fecha</dt><dd>{fmtDateTime(c.completed_at)}</dd></div>
          <div><dt>Resultado</dt><dd>{c.score_pct}% ({c.correct} de {c.total}) · aprobado con {c.pass_pct}%</dd></div>
          <div><dt>Válido hasta</dt><dd>{c.expires_at ? fmtDay(c.expires_at) : 'Sin caducidad'}</dd></div>
          <div><dt>Código</dt><dd className="mono">{c.code}</dd></div>
        </dl>
        {c.ack_at && (
          <section className="cert-ack">
            <p className="eyebrow">Declaración de conformidad</p>
            <p>«{c.ack_text}»</p>
            <p className="muted">Aceptada electrónicamente por {c.person_email} el {fmtDateTime(c.ack_at)}.</p>
          </section>
        )}
      </article>
    </main>
  );
}
