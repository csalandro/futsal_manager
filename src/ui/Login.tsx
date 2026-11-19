import { useState } from 'react';
import { useAuth } from '../store/authStore';
import { IconBall } from './icons';

export function Login() {
  const login = useAuth((s) => s.login);
  const error = useAuth((s) => s.error);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);

  return (
    <main className="auth">
      <div className="auth-art" aria-hidden="true">
        <div className="auth-court" />
      </div>
      <section className="auth-panel">
        <div className="logo">
          <span className="logo-mark">
            <IconBall size={26} />
          </span>
          <span className="logo-text">
            FUTSAL <b>MANAGER</b>
          </span>
        </div>
        <h1 className="auth-title">Ingresá a tu cuenta</h1>
        <p className="muted">Las cuentas las crea el administrador. Tus partidas se guardan en el servidor.</p>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setSending(true);
            await login(username, password);
            setSending(false);
          }}
        >
          <label className="field">
            <span>Usuario</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn primary block" disabled={sending}>
            {sending ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  );
}
