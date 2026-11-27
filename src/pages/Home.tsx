import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listExams } from '../lib/data';
import type { Exam } from '../lib/types';
import { useApp } from '../App';

export default function Home() {
  const { profile, pending } = useApp();
  const [exams, setExams] = useState<(Exam & { question_count: number })[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listExams().then(setExams).catch((e: { message?: string; code?: string }) =>
      setError(`No se han podido cargar los exámenes. Detalle: ${e?.message || 'error desconocido'}${e?.code ? ` (${e.code})` : ''}`));
  }, []);

  const vendors = exams ? [...new Set(exams.map((e) => e.vendor))] : [];
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const toggle = (v: string) => setCollapsed((c) => {
    const next = c.includes(v) ? c.filter((x) => x !== v) : [...c, v];
    saveCollapsed(next);
    return next;
  });
  const allCollapsed = vendors.length > 0 && vendors.every((v) => collapsed.includes(v));
  const setAll = (fold: boolean) => { const next = fold ? vendors : []; saveCollapsed(next); setCollapsed(next); };

  return (
    <main className="wrap">
      <header className="hero">
        <div className="eyebrow">Hola{profile?.display_name ? `, ${profile.display_name}` : ''}</div>
        <h1>Elige un examen</h1>
        <p>Cada examen tiene simulacros con el reparto oficial por dominios, práctica con corrección al momento, tu lista de repaso y preguntas escritas por el equipo.</p>
        <p style={{ marginTop: 8 }}><Link to="/registro">Cómo registrarte en el examen oficial de cada fabricante →</Link></p>
      </header>
      {pending > 0 && (
        <Link to="/formacion" className="todo-banner">
          <b>{pending === 1 ? 'Tienes 1 formación asignada pendiente.' : `Tienes ${pending} formaciones asignadas pendientes.`}</b>
          <span>Ver mis formaciones →</span>
        </Link>
      )}
      {error && <div className="msg err">{error}</div>}
      {!exams && !error && <div className="center">Cargando exámenes…</div>}
      {exams && exams.length === 0 && (
        <div className="panel"><p className="note">Todavía no hay exámenes. {profile?.is_admin ? <>Impórtalos desde <Link to="/admin">Administración</Link>.</> : 'Un administrador debe importarlos.'}</p></div>
      )}
      {vendors.length > 1 && (
        <div className="vendor-tools">
          <button className="btn small" onClick={() => setAll(!allCollapsed)}>{allCollapsed ? 'Desplegar todo' : 'Compactar todo'}</button>
        </div>
      )}
      {vendors.map((v) => {
        const list = exams!.filter((e) => e.vendor === v);
        const open = !collapsed.includes(v);
        return (
          <section key={v} className="vendor">
            <button className="vendor-head" aria-expanded={open} onClick={() => toggle(v)}>
              <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
              <h2>{vendorLabel(v)}</h2>
              <span className="vendor-count">{list.length} {list.length === 1 ? 'examen' : 'exámenes'}</span>
            </button>
            {open ? (
              <div className="grid-cards exams">
                {list.map((e) => (
                  <Link key={e.id} className="card exam-card" to={`/e/${e.slug}`}>
                    <div className="row"><span className="tag">{e.code || e.vendor}</span>{!e.is_published && <span className="tag multi">Oculto</span>}</div>
                    <h2 title={e.name}>{e.name}</h2>
                    <p title={e.description ?? undefined}>{e.description}</p>
                    <div className="meta">{e.question_count} preguntas · examen de {e.sim_questions} en {e.sim_minutes} min</div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="vendor-chips">
                {list.map((e) => (
                  <Link key={e.id} className="tag chip" to={`/e/${e.slug}`} title={e.name}>{e.code || e.name}</Link>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}

/** Section titles: Anthropic's exams are the Claude certifications. */
function vendorLabel(v: string) {
  return v === 'Anthropic' ? 'Claude' : v;
}

const COLLAPSE_KEY = 'exam-prep-collapsed-vendors';

function loadCollapsed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveCollapsed(v: string[]) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(v)); } catch { /* private window: keep it for this visit only */ }
}
