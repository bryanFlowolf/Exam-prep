import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GUIDES } from '../lib/registration';

const slug = (v: string) => v.toLowerCase();

export default function Registration() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <main className="wrap">
      <div className="crumbs" style={{ marginTop: 14 }}><Link to="/">Exámenes</Link> / Cómo registrarte</div>
      <header className="hero">
        <div className="eyebrow">Guía práctica</div>
        <h1>Cómo registrarte en los exámenes</h1>
        <p>Pasos para reservar el examen oficial de cada fabricante, cuánto cuesta y qué condiciones tiene. Los precios y las normas cambian: confirma siempre en el enlace oficial antes de pagar.</p>
      </header>
      <nav className="row" aria-label="Fabricantes" style={{ marginBottom: 6 }}>
        {GUIDES.map((g) => <a key={g.vendor} className="chip" href={`#${slug(g.vendor)}`}>{g.label}</a>)}
      </nav>
      {GUIDES.map((g) => (
        <section key={g.vendor} id={slug(g.vendor)} className="panel reg">
          <div className="reg-head">
            <h2 className="ph">{g.label}</h2>
            <span className="tag">{g.where}</span>
          </div>
          <dl className="reg-facts">
            {g.facts.map((f) => <div key={f.k}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}
          </dl>
          <ol className="reg-steps">
            {g.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {g.notes && <ul className="reg-notes">{g.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          <div className="doclinks" style={{ marginTop: 12 }}>
            <span className="eyebrow">Fuentes oficiales · revisado en {g.checked}</span>
            <ul>{g.links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a></li>)}</ul>
          </div>
        </section>
      ))}
    </main>
  );
}
