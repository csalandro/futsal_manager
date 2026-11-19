import { useState } from 'react';
import { useGame } from '../store/gameStore';
import { AppHeader } from './AppHeader';
import { Dt, JobOffers } from './Dt';
import { IconArrow } from './icons';

/** Pantalla del DT sin club (despedido): elige entre las ofertas, o espera a que lleguen otras. */
export function Unemployed() {
  const game = useGame((s) => s.game);
  const busy = useGame((s) => s.busy);
  const error = useGame((s) => s.error);
  const wait = useGame((s) => s.waitForOffers);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<'ofertas' | 'dt'>('ofertas');
  if (!game) return null;
  const fired = game.dt.fired;

  return (
    <div className="page">
      <AppHeader />
      <main className="page-body">
        <div className="page-intro">
          <h1>Sin club</h1>
          <p className="muted">
            DT {game.dtName} · Temporada {game.season}
            {fired && ` · te despidieron de ${fired.club} en la temporada ${fired.season}`}
          </p>
        </div>
        {(error || notice) && (
          <p className="alert error" role="alert">
            {error ?? notice}
          </p>
        )}
        <div className="segmented" role="tablist" aria-label="Sin club">
          <button type="button" role="tab" aria-selected={view === 'ofertas'} className={view === 'ofertas' ? 'on' : ''} onClick={() => setView('ofertas')}>
            Ofertas
          </button>
          <button type="button" role="tab" aria-selected={view === 'dt'} className={view === 'dt' ? 'on' : ''} onClick={() => setView('dt')}>
            Mi carrera
          </button>
        </div>
        {view === 'ofertas' ? (
          <section className="panel">
            <header className="panel-head">
              <h2>Ofertas de clubes</h2>
              <span className="tag">{game.dt.jobOffers.length}</span>
            </header>
            <p className="muted small hint">
              Elegí un club para volver a dirigir o esperá: el tiempo sigue pasando y pueden llegar otras ofertas.
            </p>
            <JobOffers game={game} onResult={setNotice} />
            <div className="actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void wait()}>
                Esperar ofertas <IconArrow size={16} />
              </button>
            </div>
          </section>
        ) : (
          <Dt />
        )}
      </main>
    </div>
  );
}
