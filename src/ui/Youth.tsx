import { useState } from 'react';
import { SQUAD, YOUTH } from '../engine/config';
import { canSpend, LOCKOUT_REASON } from '../engine/finance';
import { userTeam } from '../engine/season';
import { academyFacilityCost, youthSellPrice } from '../engine/youth';
import { useGame } from '../store/gameStore';
import { money, ratingClass } from './format';

/** Cantera: juveniles de 15 a 18 que se promueven solos a los 19; subir antes, vender o bajar de primera. */
export function Youth() {
  const game = useGame((s) => s.game);
  const promote = useGame((s) => s.promoteYouth);
  const demote = useGame((s) => s.demoteToAcademy);
  const sell = useGame((s) => s.sellYouth);
  const upgrade = useGame((s) => s.upgradeAcademy);
  const [notice, setNotice] = useState<string | null>(null);
  const team = game ? userTeam(game) : undefined;
  if (!game || !team) return null;

  const full = team.squad.length >= SQUAD.max;
  const maxed = team.academyFacility >= YOUTH.facilityMax;
  const cost = academyFacilityCost(team);
  const locked = !canSpend(team);
  const why = maxed ? 'Nivel máximo.' : locked ? LOCKOUT_REASON : team.budget < cost ? 'No alcanza el presupuesto.' : undefined;
  const young = team.squad.filter((p) => p.age < YOUTH.promoteAge);
  const academy = [...team.academy].sort((a, b) => b.age - a.age || b.potential - a.potential);

  return (
    <div className="stack">
      {notice && (
        <p className="alert error" role="alert">
          {notice}
        </p>
      )}
      <section className="panel">
        <header className="panel-head">
          <h2>Cantera de juveniles</h2>
          <span className="panel-meta">
            Centro juvenil {team.academyFacility}/{YOUTH.facilityMax}
            {team.staff.scouts > 0 && ` · ${team.staff.scouts} ojeador${team.staff.scouts === 1 ? '' : 'es'}`}
            {team.staff.youthCoaches > 0 && ` · ${team.staff.youthCoaches} entrenador${team.staff.youthCoaches === 1 ? '' : 'es'} de juveniles`}
          </span>
        </header>
        <p className="muted small hint">
          Cada temporada llegan {YOUTH.intake} chicos de {YOUTH.intakeAge} años y crecen hasta los {YOUTH.promoteAge - 1}. A los {YOUTH.promoteAge} suben
          obligatoriamente al primer equipo (si el plantel ya tiene {SQUAD.max}, quedan libres). Podés subirlos antes, venderlos por el 50% de
          su valor o volver a bajarlos. Con un mejor centro juvenil, ojeadores y entrenador de juveniles, rinden más.
        </p>
        <button type="button" className="btn primary" disabled={!!why} title={why} onClick={() => setNotice(upgrade())}>
          {maxed ? 'Nivel máximo' : locked ? 'Gastos restringidos' : `Mejorar centro juvenil ${money(cost)}`}
        </button>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Juveniles ({YOUTH.startAges[0]} a {YOUTH.startAges[YOUTH.startAges.length - 1]} años)</h2>
          <span className="tag">{academy.length}</span>
        </header>
        {academy.length === 0 ? (
          <p className="empty">No hay juveniles en la cantera.</p>
        ) : (
          <div className="stack">
            {academy.map((p) => (
              <div key={p.id} className="offer-row">
                <div>
                  <strong>
                    {p.name} <span className={`pos pos-${p.pos.toLowerCase()}`}>{p.pos}</span>
                  </strong>
                  <span className="muted small">
                    {p.age} años · nivel <span className={`rating ${ratingClass(p.rating)}`}>{p.rating}</span> · potencial {p.potential}
                  </span>
                </div>
                <span className="row-actions">
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={full}
                    title={full ? `El plantel ya tiene ${SQUAD.max} jugadores.` : 'Subir al primer equipo'}
                    onClick={() => setNotice(promote(p.id))}
                  >
                    Subir a primera
                  </button>
                  <button type="button" className="btn small" onClick={() => setNotice(sell(p.id))}>
                    Vender {money(youthSellPrice(p))}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {young.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <h2>Menores de {YOUTH.promoteAge} en primera</h2>
            <span className="tag">{young.length}</span>
          </header>
          <div className="stack">
            {young.map((p) => (
              <div key={p.id} className="offer-row">
                <div>
                  <strong>
                    {p.name} <span className={`pos pos-${p.pos.toLowerCase()}`}>{p.pos}</span>
                  </strong>
                  <span className="muted small">
                    {p.age} años · nivel {p.rating}
                  </span>
                </div>
                <button type="button" className="btn small ghost" onClick={() => setNotice(demote(p.id))}>
                  Bajar a juveniles
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
