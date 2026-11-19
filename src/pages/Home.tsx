import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listExams } from '../lib/data';
import type { Exam } from '../lib/types';
import { useApp } from '../App';

export default function Home() {
  const { profile } = useApp();
  const [exams, setExams] = useState<(Exam & { question_count: number })[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listExams().then(setExams).catch((e: { message?: string; code?: string }) =>
      setError(`No se han podido cargar los exámenes. Detalle: ${e?.message || 'error desconocido'}${e?.code ? ` (${e.code})` : ''}`));
  }, []);

  const vendors = exams ? [...new Set(exams.map((e) => e.vendor))] : [];

  return (
    <main className="wrap">
      <header className="hero">
        <div className="eyebrow">Hola{profile?.display_name ? `, ${profile.display_name}` : ''}</div>
        <h1>Elige un examen</h1>
        <p>Cada examen tiene simulacros con el reparto oficial por dominios, práctica con corrección al momento, tu lista de repaso y preguntas escritas por el equipo.</p>
      </header>
      {error && <div className="msg err">{error}</div>}
      {!exams && !error && <div className="center">Cargando exámenes…</div>}
      {exams && exams.length === 0 && (
        <div className="panel"><p className="note">Todavía no hay exámenes. {profile?.is_admin ? <>Impórtalos desde <Link to="/admin">Administración</Link>.</> : 'Un administrador debe importarlos.'}</p></div>
      )}
      {vendors.map((v) => (
        <section key={v} style={{ marginTop: 22 }}>
          <div className="eyebrow">{v}</div>
          <div className="grid-cards" style={{ marginTop: 8 }}>
            {exams!.filter((e) => e.vendor === v).map((e) => (
              <Link key={e.id} className="card exam-card" to={`/e/${e.slug}`}>
                <div className="row"><span className="tag">{e.code || e.vendor}</span>{!e.is_published && <span className="tag multi">Oculto</span>}</div>
                <h2>{e.name}</h2>
                <p>{e.description}</p>
                <div className="meta">{e.question_count} preguntas · examen de {e.sim_questions} en {e.sim_minutes} min</div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
