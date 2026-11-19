import { useAuth } from '../store/authStore';
import { useGame } from '../store/gameStore';
import { IconBall, IconLogout, IconSave, IconShield } from './icons';

/** Barra superior de las pantallas fuera de una partida (menú, elegir equipo, administración). */
export function AppHeader() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const screen = useGame((s) => s.screen);
  const backToMenu = useGame((s) => s.backToMenu);
  const openAdmin = useGame((s) => s.openAdmin);

  return (
    <header className="app-header">
      <button type="button" className="logo" onClick={backToMenu} aria-label="Ir a mis partidas">
        <span className="logo-mark">
          <IconBall size={22} />
        </span>
        <span className="logo-text">
          FUTSAL <b>MANAGER</b>
        </span>
      </button>
      <nav className="header-nav" aria-label="Cuenta">
        {user?.role === 'ADMIN' && (
          <>
            <button type="button" className={screen === 'menu' ? 'on' : ''} onClick={backToMenu}>
              <IconSave size={18} />
              <span>Partidas</span>
            </button>
            <button type="button" className={screen === 'admin' ? 'on' : ''} onClick={openAdmin}>
              <IconShield size={18} />
              <span>Usuarios</span>
            </button>
          </>
        )}
        <span className="header-user" title={user?.username}>
          <span className="avatar">{user?.displayName.slice(0, 1).toUpperCase()}</span>
          <span className="hide-sm">{user?.displayName}</span>
        </span>
        <button type="button" onClick={() => void logout()} aria-label="Cerrar sesión" title="Cerrar sesión">
          <IconLogout size={18} />
        </button>
      </nav>
    </header>
  );
}
