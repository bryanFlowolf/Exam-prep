import { createContext, useContext, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { configured, supabase } from './lib/supabase';
import { getMyProfile, myTeamCount } from './lib/data';
import type { Profile, Session } from './lib/types';
import { LANGS, loadLang, saveLang, type Lang } from './lib/lang';
import Login from './pages/Login';
import Home from './pages/Home';
import ExamHome from './pages/ExamHome';
import Runner from './pages/Runner';
import Review from './pages/Review';
import Team from './pages/Team';
import Admin from './pages/Admin';
import Account from './pages/Account';
import AdminQuality from './pages/AdminQuality';
import AdminTeams from './pages/AdminTeams';
import Teams from './pages/Teams';
import Registration from './pages/Registration';

type Ctx = {
  userId: string;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  session: Session | null;
  setSession: (s: Session | null) => void;
  lang: Lang;
  teamCount: number;
};
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppCtx');
  return c;
};

export const RUN_KEY = 'exam-prep-run';
export const RUN_PROGRESS_KEY = 'exam-prep-run-progress';
function loadRun(): { uid?: string; session: Session } | null {
  try { return JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch { return null; }
}
function saveRun(s: Session | null, uid?: string) {
  try {
    if (s) localStorage.setItem(RUN_KEY, JSON.stringify({ uid, session: s }));
    else { localStorage.removeItem(RUN_KEY); localStorage.removeItem(RUN_PROGRESS_KEY); }
  } catch { /* storage unavailable: the exam just won't survive a reload */ }
}

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSessionState] = useState<Session | null>(() => loadRun()?.session ?? null);
  // Persist the exam in progress so it survives a reload or closing the tab.
  const setSession = (s: Session | null) => { setSessionState(s); saveRun(s, auth?.user.id); };
  const [lang, setLangState] = useState<Lang>(loadLang);
  const [teamCount, setTeamCount] = useState(0);
  const setLang = (l: Lang) => { setLangState(l); saveLang(l); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuth(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const refreshProfile = async () => { try { setProfile(await getMyProfile()); } catch { setProfile(null); } };
  useEffect(() => {
    if (auth) {
      const run = loadRun();
      if (run && run.uid !== auth.user.id) { setSessionState(null); saveRun(null); }
    }
    if (auth) { refreshProfile(); myTeamCount(auth.user.id).then(setTeamCount); } else { setProfile(null); setTeamCount(0); }
  }, [auth?.user.id]);

  if (!configured) {
    return (
      <div className="login panel">
        <h1>Falta la configuración</h1>
        <p className="note">Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (en .env para desarrollo o en las variables de entorno de Vercel) y vuelve a desplegar.</p>
      </div>
    );
  }
  if (auth === undefined) return <div className="center">Cargando…</div>;
  if (!auth) return <Login />;

  return (
    <AppCtx.Provider value={{ userId: auth.user.id, profile, refreshProfile, session, setSession, lang, teamCount }}>
      <header className="topbar">
        <div className="wrap">
          <Link className="brand" to="/"><i className="logo" aria-hidden="true" />Exam Prep</Link>
          <span className="spacer" />
          <div className="langsel" role="group" aria-label="Idioma de las preguntas / Question language">
            {LANGS.map((l) => (
              <button key={l.code} type="button" aria-pressed={lang === l.code} title={l.name} onClick={() => setLang(l.code)}>{l.label}</button>
            ))}
          </div>
          {(teamCount > 0 || profile?.is_admin) && <Link className="btn small hide-sm" to="/equipos">Equipos</Link>}
          {profile?.is_admin && <Link className="btn small hide-sm" to="/admin">Administración</Link>}
          <Link className="btn small" to="/cuenta">{profile?.display_name || 'Mi cuenta'}</Link>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/e/:slug" element={<ExamHome />} />
        <Route path="/e/:slug/examen" element={<Runner />} />
        <Route path="/e/:slug/repaso" element={<Review />} />
        <Route path="/e/:slug/equipo" element={<Team />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/calidad" element={<AdminQuality />} />
        <Route path="/admin/equipos" element={<AdminTeams />} />
        <Route path="/equipos" element={<Teams />} />
        <Route path="/registro" element={<Registration />} />
        <Route path="/cuenta" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppCtx.Provider>
  );
}
