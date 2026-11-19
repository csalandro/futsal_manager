import { userTeam } from '../engine/season';
import { useGame, type Tab } from '../store/gameStore';
import { Badge } from './Badge';
import { Fixture } from './Fixture';
import { Home } from './Home';
import { Squad } from './Squad';
import { Table } from './Table';
import { Tactics } from './Tactics';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Inicio' },
  { id: 'squad', label: 'Plantel' },
  { id: 'tactics', label: 'Tácticas' },
  { id: 'table', label: 'Tabla' },
  { id: 'fixture', label: 'Fixture' },
];

export function Game() {
  const game = useGame((s) => s.game);
  const tab = useGame((s) => s.tab);
  const busy = useGame((s) => s.busy);
  const error = useGame((s) => s.error);
  const setTab = useGame((s) => s.setTab);
  const backToMenu = useGame((s) => s.backToMenu);
  if (!game || !game.userDivision) return null;
  const team = userTeam(game);
  if (!team) return null;
  const div = game.divisions[game.userDivision];
  const total = div.schedule.length;
  const played = Math.min(div.matchday, total);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <Badge name={team.name} color={team.color} />
          <div className="brand-text">
            <div className="brand-name">{team.name}</div>
            <div className="brand-sub">
              División {div.id} · Temporada {game.season} · Fecha {played}/{total}
            </div>
          </div>
        </div>
        <div className="top-actions">
          {busy && (
            <span className="saving" role="status">
              Guardando…
            </span>
          )}
          <button type="button" className="btn secondary small" onClick={backToMenu}>
            Menú
          </button>
        </div>
      </header>
      <div className="court-line" />
      <nav className="tabs" aria-label="Secciones">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === tab ? 'active' : ''}
            aria-current={t.id === tab ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="page">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {tab === 'home' && <Home />}
        {tab === 'squad' && <Squad />}
        {tab === 'tactics' && <Tactics />}
        {tab === 'table' && <Table />}
        {tab === 'fixture' && <Fixture />}
      </main>
    </>
  );
}
