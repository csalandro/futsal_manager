import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth, type Role } from '../store/authStore';
import { AppHeader } from './AppHeader';
import { formatDate } from './format';
import { IconPlus } from './icons';

interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  createdAt: string;
  _count: { saves: number };
}

const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Administrador', USER: 'Jugador' };

function CreateUserForm({ onCreated, onCancel }: { onCreated: (u: AdminUser) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'USER' as Role });
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      className="panel create-user"
      onSubmit={async (e) => {
        e.preventDefault();
        setSending(true);
        setError(null);
        try {
          const { user } = await api<{ user: AdminUser }>('POST', '/admin/users', form);
          onCreated(user);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setSending(false);
        }
      }}
    >
      <header className="panel-head">
        <h2>Nuevo usuario</h2>
      </header>
      <div className="form-grid">
        <label className="field">
          <span>Usuario</span>
          <input value={form.username} onChange={set('username')} autoCapitalize="none" spellCheck={false} autoComplete="off" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._\-]+" autoFocus />
        </label>
        <label className="field">
          <span>Nombre visible</span>
          <input value={form.displayName} onChange={set('displayName')} required maxLength={48} autoComplete="off" />
        </label>
        <label className="field">
          <span>Contraseña inicial</span>
          <input type="text" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>Rol</span>
          <select value={form.role} onChange={set('role')}>
            <option value="USER">Jugador</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={sending}>
          Crear usuario
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function UserCard({ u, isSelf, onChange, onDelete }: { u: AdminUser; isSelf: boolean; onChange: (u: AdminUser) => void; onDelete: (id: string) => void }) {
  const [mode, setMode] = useState<'view' | 'password' | 'delete'>('view');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const patch = async (data: Partial<{ role: Role; active: boolean; password: string; displayName: string }>) => {
    setSending(true);
    setError(null);
    setNote(null);
    try {
      const { user } = await api<{ user: AdminUser }>('PATCH', `/admin/users/${u.id}`, data);
      onChange(user);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setSending(false);
    }
  };

  return (
    <li className={`panel user-card${u.active ? '' : ' inactive'}`}>
      <div className="uc-main">
        <span className="avatar lg">{u.displayName.slice(0, 1).toUpperCase()}</span>
        <div className="uc-id">
          <strong>
            {u.displayName} {isSelf && <span className="tag tiny">Vos</span>}
          </strong>
          <span className="muted small">@{u.username}</span>
        </div>
        <div className="uc-badges">
          <span className={`tag ${u.role === 'ADMIN' ? 'accent' : ''}`}>{ROLE_LABEL[u.role]}</span>
          {!u.active && <span className="tag danger">Desactivado</span>}
        </div>
      </div>
      <dl className="uc-meta">
        <div>
          <dt>Partidas</dt>
          <dd>{u._count.saves}</dd>
        </div>
        <div>
          <dt>Alta</dt>
          <dd>{formatDate(u.createdAt).split(',')[0]}</dd>
        </div>
      </dl>

      {mode === 'view' && (
        <div className="uc-actions">
          <label className="field inline">
            <span>Rol</span>
            <select value={u.role} disabled={sending || isSelf} onChange={(e) => void patch({ role: e.target.value as Role })}>
              <option value="USER">Jugador</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </label>
          <button type="button" className="btn small" disabled={sending || isSelf} onClick={() => void patch({ active: !u.active })}>
            {u.active ? 'Desactivar' : 'Activar'}
          </button>
          <button type="button" className="btn small" onClick={() => setMode('password')}>
            Cambiar contraseña
          </button>
          {!isSelf && (
            <button type="button" className="btn small ghost danger-text" onClick={() => setMode('delete')}>
              Borrar
            </button>
          )}
        </div>
      )}

      {mode === 'password' && (
        <form
          className="uc-actions"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await patch({ password })) {
              setPassword('');
              setMode('view');
              setNote('Contraseña actualizada.');
            }
          }}
        >
          <label className="field inline grow">
            <span>Nueva contraseña</span>
            <input type="text" value={password} minLength={8} required autoComplete="new-password" autoFocus onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" className="btn small primary" disabled={sending}>
            Guardar
          </button>
          <button type="button" className="btn small ghost" onClick={() => setMode('view')}>
            Cancelar
          </button>
        </form>
      )}

      {mode === 'delete' && (
        <div className="uc-actions confirm">
          <span>
            ¿Borrar a <b>@{u.username}</b> y sus {u._count.saves} partidas? No se puede deshacer.
          </span>
          <button
            type="button"
            className="btn small danger"
            disabled={sending}
            onClick={async () => {
              setSending(true);
              try {
                await api('DELETE', `/admin/users/${u.id}`);
                onDelete(u.id);
              } catch (e) {
                setError(errorMessage(e));
                setSending(false);
              }
            }}
          >
            Sí, borrar
          </button>
          <button type="button" className="btn small ghost" onClick={() => setMode('view')}>
            Cancelar
          </button>
        </div>
      )}

      {note && (
        <p className="alert ok" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function Admin() {
  const me = useAuth((s) => s.user);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    api<{ users: AdminUser[] }>('GET', '/admin/users').then(
      ({ users }) => alive && setUsers(users),
      (e) => alive && setError(errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, []);

  const q = filter.trim().toLowerCase();
  const shown = (users ?? []).filter((u) => !q || u.username.includes(q) || u.displayName.toLowerCase().includes(q));

  return (
    <div className="page">
      <AppHeader />
      <main className="page-body">
        <div className="page-intro row">
          <div>
            <h1>Usuarios</h1>
            <p className="muted">Creá cuentas, asigná roles y controlá quién puede jugar.</p>
          </div>
          {!creating && (
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              <IconPlus size={18} /> Nuevo usuario
            </button>
          )}
        </div>

        {creating && (
          <CreateUserForm
            onCancel={() => setCreating(false)}
            onCreated={(u) => {
              setUsers((list) => [...(list ?? []), u]);
              setCreating(false);
            }}
          />
        )}

        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}

        {users && users.length > 4 && (
          <label className="field search">
            <span className="sr-only">Buscar usuario</span>
            <input type="search" placeholder="Buscar por usuario o nombre…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        )}

        {!users ? (
          <p className="muted">Cargando…</p>
        ) : (
          <ul className="user-list">
            {shown.map((u) => (
              <UserCard
                key={u.id}
                u={u}
                isSelf={u.id === me?.id}
                onChange={(nu) => setUsers((list) => list?.map((x) => (x.id === nu.id ? nu : x)) ?? null)}
                onDelete={(id) => setUsers((list) => list?.filter((x) => x.id !== id) ?? null)}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
