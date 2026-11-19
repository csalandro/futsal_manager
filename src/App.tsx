import { useGame } from './store/gameStore';
import { Game } from './ui/Game';
import { LiveMatch } from './ui/LiveMatch';
import { MainMenu } from './ui/MainMenu';
import { PickTeam } from './ui/PickTeam';

export default function App() {
  const screen = useGame((s) => s.screen);
  const live = useGame((s) => s.live != null);
  return (
    <div id="app">
      {screen === 'menu' && <MainMenu />}
      {screen === 'pickTeam' && <PickTeam />}
      {screen === 'game' && <Game />}
      {live && <LiveMatch />}
    </div>
  );
}
