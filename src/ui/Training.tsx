import { useState } from 'react';
import { TRAINING } from '../engine/config';
import { canSpend, LOCKOUT_REASON } from '../engine/finance';
import { userTeam } from '../engine/season';
import { growthChance, INTENSITIES, intensityOf, trainingCap, trainingFacilityCost, trainingFacilityInjuryMult, trainingFacilityMult } from '../engine/training';
import { useGame } from '../store/gameStore';
import { money, ratingClass } from './format';

/** Entrenamiento individual: elegir a quiénes entrenar (3 por preparador), la intensidad y el centro de entrenamiento. */
export function Training() {
  const game = useGame((s) => s.game);
  const toggle = useGame((s) => s.toggleTraining);
  const setIntensity = useGame((s) => s.setTrainingIntensity);
  const upgrade = useGame((s) => s.upgradeTrainingFacility);
  const [notice, setNotice] = useState<string | null>(null);
  const team = game ? userTeam(game) : undefined;
  if (!game || !team) return null;

  const cap = trainingCap(team);
  const maxed = team.trainingFacility >= TRAINING.facilityMax;
  const cost = trainingFacilityCost(team);
  const locked = !canSpend(team);
  const why = maxed ? 'Nivel máximo.' : locked ? LOCKOUT_REASON : team.budget < cost ? 'No alcanza el presupuesto.' : undefined;
  const rows = [...team.squad].sort(
    (a, b) =>
      Number(team.training.includes(b.id)) - Number(team.training.includes(a.id)) || b.potential - b.rating - (a.potential - a.rating),
  );

  return (
    <div className="stack">
      {notice && (
        <p className="alert error" role="alert">
          {notice}
        </p>
      )}
      <section className="panel">
        <header className="panel-head">
          <h2>Centro de entrenamiento</h2>
          <span className="panel-meta">
            Nivel {team.trainingFacility}/{TRAINING.facilityMax}
          </span>
        </header>
        <p className="muted small hint">
          Mejora las instalaciones del primer equipo: hoy el progreso rinde x{trainingFacilityMult(team).toFixed(2)} y el riesgo de lesión
          en la práctica es x{trainingFacilityInjuryMult(team).toFixed(2)}.
        </p>
        <button type="button" className="btn primary" disabled={!!why} title={why} onClick={() => setNotice(upgrade())}>
          {maxed ? 'Nivel máximo' : locked ? 'Gastos restringidos' : `Mejorar centro ${money(cost)}`}
        </button>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            Entrenamiento ({team.training.length}/{cap})
          </h2>
          <span className="panel-meta">{team.staff.trainers} preparador{team.staff.trainers === 1 ? '' : 'es'}</span>
        </header>
        <p className="muted small hint">
          Elegí hasta {cap} jugadores y la intensidad de cada uno: a más intensidad progresan más rápido, pero se cansan más y arriesgan
          lesionarse en la práctica. Se entrena en cada fecha de liga. Más preparadores físicos, más cupos.
        </p>
        <div className="stack">
          {rows.map((p) => {
            const on = team.training.includes(p.id);
            const atMax = p.rating >= p.potential;
            const intensity = intensityOf(team, p.id);
            const chance = Math.round(growthChance(team, p, intensity) * 100);
            const disabled = !on && (atMax || team.training.length >= cap);
            return (
              <div key={p.id} className="offer-row">
                <div>
                  <strong>
                    {p.name} <span className={`pos pos-${p.pos.toLowerCase()}`}>{p.pos}</span>{' '}
                    <span className={`rating ${ratingClass(p.rating)}`}>{p.rating}</span>
                    <span className="muted small"> / pot. {p.potential}</span>
                  </strong>
                  <span className="muted small">
                    {p.age} años · {atMax ? 'ya llegó a su potencial' : `${chance}% de mejorar por fecha`}
                  </span>
                </div>
                <span className="row-actions">
                  {on && (
                    <span className="segmented small" role="group" aria-label={`Intensidad de ${p.name}`}>
                      {INTENSITIES.map((k) => (
                        <button
                          key={k}
                          type="button"
                          className={k === intensity ? 'on' : ''}
                          aria-pressed={k === intensity}
                          title={TRAINING.intensities[k].desc}
                          onClick={() => setNotice(setIntensity(p.id, k))}
                        >
                          {TRAINING.intensities[k].label}
                        </button>
                      ))}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`btn small ${on ? '' : 'primary'}`}
                    disabled={disabled}
                    title={disabled ? (atMax ? 'Ya llegó a su potencial.' : 'No quedan cupos.') : undefined}
                    onClick={() => setNotice(toggle(p.id))}
                  >
                    {on ? 'Quitar' : 'Entrenar'}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
