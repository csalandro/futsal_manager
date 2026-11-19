import { useEffect, useState } from 'react';
import { useGame } from '../store/gameStore';
import { formatDate } from './format';

const SLOTS = [1, 2, 3];

export function MainMenu() {
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

  useEffect(() => {
    void refreshSaves();
  }, [refreshSaves]);

  return (
    <main className="menu">
      <div className="splash-badge" aria-hidden="true">
        ⚽
      </div>
      <h1 className="menu-title">
        Futsal <span className="accent">Manager</span>
      </h1>
      <p className="menu-sub">Dirigí a tu equipo desde la División C hasta lo más alto.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <ul className="slots">
        {SLOTS.map((slot) => {
          const save = saves.find((s) => s.slot === slot);
          return (
            <li key={slot} className="card slot">
              <h2 className="section-title">Ranura {slot}</h2>
              {save ? (
                <>
                  <p className="slot-team">{save.teamName || 'Sin equipo elegido'}</p>
                  <p className="muted">
                    Temporada {save.season} · {formatDate(save.updatedAt)}
                  </p>
                  <div className="row2">
                    <button type="button" className="btn" disabled={busy} onClick={() => void loadGame(slot)}>
                      Cargar
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
                        <button type="button" className="btn secondary" onClick={() => setConfirmSlot(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn secondary" onClick={() => setConfirmSlot(slot)}>
                        Borrar
                      </button>
                    )}
                  </div>
                </>
              ) : creatingSlot === slot ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    newGame(dtName, slot);
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
                      placeholder="Tu nombre"
                      onChange={(e) => setDtName(e.target.value)}
                    />
                  </label>
                  <div className="row2">
                    <button type="submit" className="btn">
                      Empezar
                    </button>
                    <button type="button" className="btn secondary" onClick={() => setCreatingSlot(null)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="muted">Ranura vacía</p>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setCreatingSlot(slot);
                      setDtName('');
                    }}
                  >
                    Nueva partida
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
