import { isPreseason } from '../engine/market';
import { lineupIssues } from '../engine/squad';
import { isSeasonOver, userNextFixture, userTeam } from '../engine/season';
import { useAuth } from '../store/authStore';
import { useGame, type Tab } from '../store/gameStore';
import { Badge } from './Badge';
import { Club } from './Club';
import { Fixture } from './Fixture';
import { Home } from './Home';
import { IconArrow, IconCalendar, IconClub, IconHome, IconLogout, IconMarket, IconSave, IconSquad, IconTable, IconTactics } from './icons';
import { Market } from './Market';
import { Squad } from './Squad';
import { Table } from './Table';
import { Tactics } from './Tactics';

const TABS: { id: Tab; label: string; short: string; icon: (p: { size?: number }) => React.ReactNode }[] = [
  { id: 'home', label: 'Visión general', short: 'Inicio', icon: IconHome },
  { id: 'squad', label: 'Plantel', short: 'Plantel', icon: IconSquad },
  { id: 'tactics', label: 'Tácticas', short: 'Tácticas', icon: IconTactics },
  { id: 'table', label: 'Competición', short: 'Tabla', icon: IconTable },
  { id: 'fixture', label: 'Calendario', short: 'Fixture', icon: IconCalendar },
  { id: 'market', label: 'Mercado de pases', short: 'Mercado', icon: IconMarket },
  { id: 'club', label: 'Club', short: 'Club', icon: IconClub },
];

export function Game() {
  const game = useGame((s) => s.game);
  const tab = useGame((s) => s.tab);
  const busy = useGame((s) => s.busy);
  const error = useGame((s) => s.error);
  const setTab = useGame((s) => s.setTab);
  const backToMenu = useGame((s) => s.backToMenu);
  const startUserMatch = useGame((s) => s.startUserMatch);
  const nextSeason = useGame((s) => s.nextSeason);
  const advancePreseason = useGame((s) => s.advancePreseason);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  if (!game || !game.userDivision) return null;
  const team = userTeam(game);
  if (!team) return null;
  const div = game.divisions[game.userDivision];
  const total = div.schedule.length;
  const played = Math.min(div.matchday, total);
  const over = isSeasonOver(game);
  const preseason = isPreseason(game);
  const next = over ? null : userNextFixture(game);
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  const onContinue = () => {
    if (over) void nextSeason();
    else if (preseason) void advancePreseason();
    else if (next) {
      // Con la alineación inválida, se lleva al usuario a Inicio, donde se explica y se puede autocompletar.
      if (lineupIssues(team).length > 0) setTab('home');
      else startUserMatch();
    }
  };

  return (
    <div className="shell" style={{ '--club': team.color } as React.CSSProperties}>
      <aside className="sidebar">
        <div className="side-club">
          <Badge name={team.name} color={team.color} size="lg" />
          <div className="side-club-text">
            <strong>{team.name}</strong>
            <span>División {div.id}</span>
          </div>
        </div>
        <nav className="side-nav" aria-label="Secciones">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === tab ? 'active' : ''}
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              <t.icon />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <span className="avatar">{user?.displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user?.displayName}</strong>
              <span>DT {game.dtName}</span>
            </div>
          </div>
          <button type="button" className="side-link" onClick={backToMenu}>
            <IconSave size={18} /> Partidas
          </button>
          <button type="button" className="side-link" onClick={() => void logout()}>
            <IconLogout size={18} /> Salir
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button type="button" className="tb-crest" onClick={backToMenu} aria-label="Volver a mis partidas">
            <Badge name={team.name} color={team.color} size="sm" />
          </button>
          <div className="tb-title">
            <h1>{current.label}</h1>
            <span className="tb-sub">
              Temp. {game.season} · {preseason ? 'Pretemporada' : `Fecha ${played}/${total}`}
              {busy && <span className="saving"> · Guardando…</span>}
            </span>
          </div>
          <button
            type="button"
            className="btn continue"
            onClick={onContinue}
            disabled={busy || (!over && !next)}
            title={over ? 'Empezar la siguiente temporada' : preseason ? 'Avanzar una semana de pretemporada' : 'Jugar el próximo partido'}
          >
            <span>{over ? 'Nueva temporada' : preseason ? 'Avanzar semana' : 'Continuar'}</span>
            <IconArrow size={18} />
          </button>
        </header>

        <main className="content">
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          {tab === 'home' && <Home />}
          {tab === 'squad' && <Squad />}
          {tab === 'tactics' && <Tactics />}
          {tab === 'table' && <Table />}
          {tab === 'fixture' && <Fixture />}
          {tab === 'market' && <Market />}
          {tab === 'club' && <Club />}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Secciones">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === tab ? 'active' : ''}
            aria-current={t.id === tab ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={22} />
            <span>{t.short}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
