import { useEffect } from 'react';
import { useAuth } from './store/authStore';
import { useGame } from './store/gameStore';
import { Admin } from './ui/Admin';
import { Game } from './ui/Game';
import { LiveMatch } from './ui/LiveMatch';
import { Login } from './ui/Login';
import { MainMenu } from './ui/MainMenu';
import { PickTeam } from './ui/PickTeam';

export default function App() {
  const status = useAuth((s) => s.status);
  const isAdmin = useAuth((s) => s.user?.role === 'ADMIN');
  const check = useAuth((s) => s.check);
  const screen = useGame((s) => s.screen);
  const live = useGame((s) => s.live != null);

  useEffect(() => {
    void check();
  }, [check]);

  if (status === 'loading') {
    return (
      <div className="splash" role="status">
        <div className="spinner" aria-hidden="true" />
        <span>Cargando…</span>
      </div>
    );
  }
  if (status === 'guest') return <Login />;

  return (
    <>
      {screen === 'menu' && <MainMenu />}
      {screen === 'admin' && (isAdmin ? <Admin /> : <MainMenu />)}
      {screen === 'pickTeam' && <PickTeam />}
      {screen === 'game' && <Game />}
      {live && <LiveMatch />}
    </>
  );
}
