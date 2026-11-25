import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const SENDER_NAME = 'WolfPack Academy';
const RESEND_SECONDS = 60;

function SpamNotice({ strong }: { strong?: boolean }) {
  return (
    <div className={`spam-notice${strong ? ' strong' : ''}`} role="note">
      <b>¿No ves el email?</b> Revisa la carpeta de <b>Spam</b> o <b>Correo no deseado</b> (en Outlook, mira también la pestaña <b>Otros</b>). Llega con el remitente <b>{SENDER_NAME}</b>. Si lo encuentras ahí, márcalo como <b>"No es spam"</b> para que los siguientes lleguen a la bandeja de entrada.
    </div>
  );
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const request = async () => {
    const wasSent = state === 'sent';
    setResending(wasSent);
    setError('');
    setState('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      const status = (error as { status?: number }).status;
      setError(status === 429 || /rate limit|too many/i.test(error.message)
        ? 'Se han enviado demasiados enlaces en poco tiempo. Espera unos minutos y vuelve a intentarlo; si ya te llegó un enlace antes (revisa también la carpeta de spam), puedes usar ese.'
        : error.message.includes('acceso') || error.message.includes('Database error')
          ? 'Este email no tiene acceso. Pide a un administrador que lo añada a la lista de acceso.'
          : `No se ha podido enviar el enlace. Detalle: ${error.message}${status ? ` (${status})` : ''}`);
      setState(wasSent ? 'sent' : 'idle');
      setResending(false);
      return false;
    }
    setState('sent');
    setResending(false);
    setWait(RESEND_SECONDS);
    return true;
  };

  const send = async (e: React.FormEvent) => { e.preventDefault(); await request(); };

  return (
    <main className="login">
      <div className="hero" style={{ paddingBottom: 8 }}>
        <div className="eyebrow">WolfPack Academy</div>
        <h1>Prepara tus certificaciones</h1>
        <p>Simulacros y práctica por dominio, con tu progreso guardado en tu cuenta.</p>
      </div>
      <div className="panel">
        {state === 'sent' || (state === 'sending' && resending) ? (
          <div className="form">
            <h2 style={{ fontSize: 20 }}>Revisa tu correo</h2>
            <p className="note">Te hemos enviado un enlace a <b>{email}</b>. Ábrelo en este mismo navegador para entrar. Puede tardar uno o dos minutos en llegar.</p>
            <SpamNotice strong />
            {error && <div className="msg err">{error}</div>}
            <div className="row">
              <button className="btn" disabled={wait > 0 || state === 'sending'} onClick={() => request()}>
                {state === 'sending' ? 'Enviando…' : wait > 0 ? `Reenviar enlace (${wait} s)` : 'Reenviar enlace'}
              </button>
              <button className="btn" onClick={() => { setState('idle'); setError(''); }}>Usar otro email</button>
            </div>
          </div>
        ) : (
          <form className="form" onSubmit={send}>
            <label className="fl" htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" />
            {error && <div className="msg err">{error}</div>}
            <button className="btn solid" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Enviando…' : 'Enviarme un enlace de acceso'}</button>
            <p className="note">Sin contraseña: cada vez que entres recibirás un enlace en tu correo. A menudo llega a la carpeta de spam; revísala si no lo ves en un par de minutos.</p>
          </form>
        )}
      </div>
    </main>
  );
}
