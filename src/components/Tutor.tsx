import { useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Lang } from '../lib/lang';

type Msg = { role: 'user' | 'assistant'; content: string };

const T = {
  es: {
    open: 'Explícamelo con IA', title: 'Tutor IA', thinking: 'Pensando…', ask: 'Pregunta algo más sobre esta pregunta',
    send: 'Enviar', close: 'Cerrar', note: 'Respuesta generada por IA a partir de la pregunta, su explicación y la documentación oficial. Contrasta lo importante.',
    off: 'El tutor aún no está activado: falta conectar Claude en Bedrock. Avisa a un administrador.',
    limit: (n: number) => `Has llegado al límite de ${n} consultas al tutor por hoy. Mañana vuelve a estar disponible.`,
    fail: 'El tutor no ha podido responder ahora. Inténtalo de nuevo en un momento.', retry: 'Reintentar',
  },
  en: {
    open: 'Explain it with AI', title: 'AI tutor', thinking: 'Thinking…', ask: 'Ask something else about this question',
    send: 'Send', close: 'Close', note: 'AI-generated from the question, its explanation and the official docs. Double-check what matters.',
    off: 'The tutor is not enabled yet: Claude on Bedrock still needs to be connected. Let an admin know.',
    limit: (n: number) => `You have reached today's limit of ${n} tutor requests. It will be available again tomorrow.`,
    fail: "The tutor couldn't answer right now. Try again in a moment.", retry: 'Retry',
  },
};

/**
 * "Explain it with AI" for one bank question. `order` is the option order the person saw
 * (order[k] = original index shown as letter k) and `picked` the original indices they chose.
 */
export default function Tutor({ questionId, order, picked, lang }: { questionId: string; order?: number[]; picked: number[]; lang: Lang }) {
  const L = T[lang === 'en' ? 'en' : 'es'];
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [input, setInput] = useState('');

  const call = async (history: Msg[]) => {
    setBusy(true); setErr('');
    try {
      const { data, error } = await supabase.functions.invoke('tutor', {
        body: { question_id: questionId, order, picked, lang, messages: history },
      });
      if (error) {
        let status = 0, body: { error?: string; limit?: number } = {};
        if (error instanceof FunctionsHttpError) {
          status = error.context.status;
          try { body = await error.context.json(); } catch { /* not json */ }
        }
        setErr(status === 503 && body.error === 'not_configured' ? L.off : status === 429 ? L.limit(body.limit || 0) : L.fail);
        return false;
      }
      setMsgs([...history, { role: 'assistant', content: String(data?.answer || '').trim() || '…' }]);
      return true;
    } catch {
      setErr(L.fail);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const start = () => { setOpen(true); if (!msgs.length) call([]); };
  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(history); setInput('');
    if (!(await call(history))) { setMsgs(msgs); setInput(text); }
  };

  if (!open) {
    return (
      <button type="button" className="btn small tutorbtn" onClick={start}>
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" /></svg>
        {L.open}
      </button>
    );
  }
  return (
    <section className="tutor" aria-label={L.title} aria-busy={busy}>
      <div className="tutorhead">
        <span className="eyebrow">{L.title}</span>
        <button type="button" className="linkbtn" onClick={() => setOpen(false)}>{L.close}</button>
      </div>
      <div className="tutorlog" aria-live="polite">
        {msgs.map((m, k) => <div key={k} className={`tmsg ${m.role}`}>{m.content}</div>)}
        {busy && <div className="tmsg assistant muted">{L.thinking}</div>}
        {err && (
          <div className="msg err">
            {err}{' '}
            {!msgs.length && err === L.fail && <button type="button" className="linkbtn" onClick={() => call([])}>{L.retry}</button>}
          </div>
        )}
      </div>
      {msgs.length > 0 && (
        <form className="tutorask" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label className="sr-only" htmlFor={`ta-${questionId}`}>{L.ask}</label>
          <input id={`ta-${questionId}`} value={input} maxLength={1000} placeholder={L.ask} onChange={(e) => setInput(e.target.value)} disabled={busy} />
          <button className="btn small solid" disabled={busy || !input.trim()}>{L.send}</button>
        </form>
      )}
      <p className="note tutornote">{L.note}</p>
    </section>
  );
}
