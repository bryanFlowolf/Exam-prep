import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setState('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setState('idle');
      const status = (error as { status?: number }).status;
      setError(status === 429 || /rate limit|too many/i.test(error.message)
        ? 'Se han enviado demasiados enlaces en poco tiempo. Espera unos minutos y vuelve a intentarlo; si ya te llegó un enlace antes, puedes usar ese.'
        : error.message.includes('acceso') || error.message.includes('Database error')
          ? 'Este email no tiene acceso. Pide a un administrador que lo añada a la lista de acceso.'
          : 'No se ha podido enviar el enlace. Revisa el email e inténtalo de nuevo.');
    } else setState('sent');
  };

  return (
    <main className="login">
      <div className="hero" style={{ paddingBottom: 8 }}>
        <div className="eyebrow">Exam Prep</div>
        <h1>Prepara tus certificaciones</h1>
        <p>Simulacros y práctica por dominio, con tu progreso guardado en tu cuenta.</p>
      </div>
      <div className="panel">
        {state === 'sent' ? (
          <div className="form">
            <h2 style={{ fontSize: 20 }}>Revisa tu correo</h2>
            <p className="note">Te hemos enviado un enlace a <b>{email}</b>. Ábrelo en este navegador para entrar. Puede tardar un minuto y a veces llega a la carpeta de spam.</p>
            <button className="btn" onClick={() => setState('idle')}>Usar otro email</button>
          </div>
        ) : (
          <form className="form" onSubmit={send}>
            <label className="fl" htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" />
            {error && <div className="msg err">{error}</div>}
            <button className="btn solid" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Enviando…' : 'Enviarme un enlace de acceso'}</button>
            <p className="note">Sin contraseña: cada vez que entres recibirás un enlace en tu correo.</p>
          </form>
        )}
      </div>
    </main>
  );
}
