import { useEffect, useState } from 'react';
import { useAuth } from '../store/authStore';
import { useGame } from '../store/gameStore';
import { AppHeader } from './AppHeader';
import { formatDate } from './format';
import { IconPlus } from './icons';

const SLOTS = [1, 2, 3];

export function MainMenu() {
  const user = useAuth((s) => s.user);
  const saves = useGame((s) => s.saves);
  const busy = useGame((s) => s.busy);
  const error = useGame((s) => s.error);
  const refreshSaves = useGame((s) => s.refreshSaves);
  const loadGame = useGame((s) => s.loadGame);
  const deleteSave = useGame((s) => s.deleteSave);
  const newGame = useGame((s) => s.newGame);

  const [confirmSlot, setConfirmSlot] = useState<number | null>(null);
  const [creatingSlot, setCreatingSlot] = useState<number | null>(null);
  const [dtName, setDtName] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void refreshSaves().then(() => setLoaded(true));
  }, [refreshSaves]);

  return (
    <div className="page">
      <AppHeader />
      <main className="page-body narrow">
        <div className="page-intro">
          <h1>Hola, {user?.displayName}</h1>
          <p className="muted">Elegí una partida para seguir o empezá una carrera nueva desde la División que quieras.</p>
        </div>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}

        <ul className="slots" aria-busy={!loaded}>
          {SLOTS.map((slot) => {
            const save = saves.find((s) => s.slot === slot);
            return (
              <li key={slot} className={`panel slot${save ? ' filled' : ''}`}>
                <header className="panel-head">
                  <h2>Partida {slot}</h2>
                  {save && <span className="tag">Temporada {save.season}</span>}
                </header>
                {!loaded ? (
                  <p className="muted">Cargando…</p>
                ) : save ? (
                  <>
                    <p className="slot-team">{save.teamName || 'Sin equipo elegido'}</p>
                    <p className="muted small">Guardada {formatDate(save.updatedAt)}</p>
                    <div className="actions">
                      <button type="button" className="btn primary" disabled={busy} onClick={() => void loadGame(slot)}>
                        Continuar carrera
                      </button>
                      {confirmSlot === slot ? (
                        <>
                          <button
                            type="button"
                            className="btn danger"
                            onClick={() => {
                              setConfirmSlot(null);
                              void deleteSave(slot);
                            }}
                          >
                            Sí, borrar
                          </button>
                          <button type="button" className="btn ghost" onClick={() => setConfirmSlot(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn ghost" onClick={() => setConfirmSlot(slot)}>
                          Borrar
                        </button>
                      )}
                    </div>
                  </>
                ) : creatingSlot === slot ? (
                  <form
                    className="stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      newGame(dtName || user?.displayName || 'DT', slot);
                    }}
                  >
                    <label className="field">
                      <span>Nombre del DT</span>
                      <input
                        type="text"
                        value={dtName}
                        maxLength={24}
                        autoFocus
                        autoComplete="off"
                        placeholder={user?.displayName}
                        onChange={(e) => setDtName(e.target.value)}
                      />
                    </label>
                    <div className="actions">
                      <button type="submit" className="btn primary">
                        Elegir club
                      </button>
                      <button type="button" className="btn ghost" onClick={() => setCreatingSlot(null)}>
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="slot-new"
                    onClick={() => {
                      setCreatingSlot(slot);
                      setDtName('');
                    }}
                  >
                    <IconPlus size={22} />
                    Nueva carrera
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
