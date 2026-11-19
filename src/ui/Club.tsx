import { useState } from 'react';
import type { FinanceConcept, StaffKey, Team } from '../domain/types';
import { ECONOMY, STADIUM_NAME_MAX, STADIUM_UPGRADES, STAFF } from '../engine/config';
import {
  canSpend, hireCost, LOCKOUT_REASON, matchdayExpenses, squadWages, stadiumMaintenance, staffWages, upgradeCost,
} from '../engine/finance';
import { userTeam } from '../engine/season';
import { useGame } from '../store/gameStore';
import { money } from './format';

type Sub = 'finanzas' | 'estadio' | 'empleados' | 'sponsor';

const CONCEPT: Record<FinanceConcept, string> = {
  entradas: 'Entradas',
  sponsor: 'Auspiciante',
  bono: 'Bono de sponsor',
  sueldos: 'Sueldos del plantel',
  staff: 'Sueldos del staff',
  mantenimiento: 'Mantenimiento del estadio',
  contratos: 'Contratos (renovaciones e indemnizaciones)',
  estadio: 'Ampliaciones del estadio',
  empleados: 'Contratación de empleados',
};
const INCOME: FinanceConcept[] = ['entradas', 'sponsor', 'bono'];
const EXPENSE: FinanceConcept[] = ['sueldos', 'staff', 'mantenimiento', 'contratos', 'estadio', 'empleados'];

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;

/** Aviso de la directiva (deuda o gastos restringidos). Se usa en Inicio, Plantel y Club. */
export function FinanceAlert({ team }: { team: Team }) {
  const f = team.finance;
  if (f.financialLockout) {
    return (
      <p className="alert error" role="alert">
        🔒 <b>Gastos restringidos por la directiva.</b> El presupuesto viene en rojo hace demasiado tiempo: no podés renovar
        contratos, contratar empleados ni ampliar el estadio hasta volver a números positivos.
      </p>
    );
  }
  if (f.debtStreak > 0) {
    const left = ECONOMY.lockoutThreshold - f.debtStreak;
    return (
      <p className="alert warn" role="status">
        ⚠️ Presupuesto en rojo hace {f.debtStreak} fecha{f.debtStreak === 1 ? '' : 's'}. Si sigue así {left} fecha
        {left === 1 ? '' : 's'} más, la directiva te restringe los gastos.
      </p>
    );
  }
  return null;
}

function Finanzas({ team, season }: { team: Team; season: number }) {
  const setPrice = useGame((s) => s.setTicketPrice);
  const f = team.finance;
  const totals = f.totals.season === season ? f.totals.byConcept : {};
  const sum = (keys: FinanceConcept[]) => keys.reduce((s, k) => s + (totals[k] ?? 0), 0);
  const income = sum(INCOME), expense = sum(EXPENSE);
  const recent = [...f.log].reverse().slice(0, 15);
  const row = (k: FinanceConcept) => {
    const v = totals[k] ?? 0;
    return (
      <tr key={k}>
        <td className="left">{CONCEPT[k]}</td>
        <td className={`num ${v > 0 ? 'up' : v < 0 ? 'down' : 'muted'}`}>{signed(v)}</td>
      </tr>
    );
  };

  return (
    <div className="dash">
      <section className="panel">
        <header className="panel-head">
          <h2>Caja del club</h2>
        </header>
        <dl className="kv">
          <div>
            <dt>Presupuesto</dt>
            <dd className={team.budget < 0 ? 'down' : ''}>{money(team.budget)}</dd>
          </div>
          <div>
            <dt>Gasto fijo por fecha</dt>
            <dd className="down">{money(matchdayExpenses(team))}</dd>
          </div>
          <div>
            <dt>Sueldos del plantel</dt>
            <dd>{money(squadWages(team))}</dd>
          </div>
          <div>
            <dt>Sueldos del staff</dt>
            <dd>{money(staffWages(team))}</dd>
          </div>
          <div>
            <dt>Auspiciante por fecha</dt>
            <dd className="up">{money(f.sponsor.perMatch)}</dd>
          </div>
          <div>
            <dt>Mantenimiento</dt>
            <dd>{money(stadiumMaintenance(team))}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Precio de la entrada</h2>
          <span className="panel-meta">
            de ${ECONOMY.ticketMin} a ${ECONOMY.ticketMax}
          </span>
        </header>
        <label className="field">
          <span>Precio ($)</span>
          <input
            type="number"
            inputMode="numeric"
            min={ECONOMY.ticketMin}
            max={ECONOMY.ticketMax}
            key={f.ticketPrice}
            defaultValue={f.ticketPrice}
            onBlur={(e) => {
              if (Number(e.target.value) !== f.ticketPrice) setPrice(Number(e.target.value));
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <p className="muted small hint">
          La gente que va a la cancha depende del precio, de la moral, de la categoría y de la capacidad del estadio. Solo
          cobrás entradas cuando jugás de local. Precio de referencia: División A ${ECONOMY.baseTicketPrice.A}, B $
          {ECONOMY.baseTicketPrice.B}, C ${ECONOMY.baseTicketPrice.C}.
        </p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Temporada {season}</h2>
          <span className={`panel-meta ${income + expense >= 0 ? 'up' : 'down'}`}>Neto {signed(income + expense)}</span>
        </header>
        <table className="grid compact">
          <tbody>
            <tr className="sub-head">
              <th className="left" colSpan={2}>
                Ingresos · {signed(income)}
              </th>
            </tr>
            {INCOME.map(row)}
            <tr className="sub-head">
              <th className="left" colSpan={2}>
                Egresos · {signed(expense)}
              </th>
            </tr>
            {EXPENSE.map(row)}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Últimos movimientos</h2>
          <span className="tag">{f.log.length}</span>
        </header>
        {recent.length === 0 ? (
          <p className="empty">Todavía no hay movimientos.</p>
        ) : (
          <ul className="ledger">
            {recent.map((e, i) => (
              <li key={i}>
                <span className="ledger-text">
                  <span>{e.label}</span>
                  <small className="muted">Temp. {e.season}</small>
                </span>
                <b className={e.amount >= 0 ? 'up' : 'down'}>{signed(e.amount)}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Estadio({ team, onResult }: { team: Team; onResult: (m: string | null) => void }) {
  const upgrade = useGame((s) => s.upgradeStadium);
  const rename = useGame((s) => s.renameStadium);
  const locked = !canSpend(team);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Estadio</h2>
        <span className="panel-meta">Capacidad {team.stadium.capacity.toLocaleString('es-AR')}</span>
      </header>
      <label className="field">
        <span>Nombre</span>
        <input
          type="text"
          maxLength={STADIUM_NAME_MAX}
          key={team.stadium.name}
          defaultValue={team.stadium.name}
          onBlur={(e) => {
            if (e.target.value.trim() === team.stadium.name) return;
            const err = rename(e.target.value);
            onResult(err);
            if (err) e.target.value = team.stadium.name;
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      <p className="muted small hint">
        El mantenimiento cuesta el {ECONOMY.maintenancePerSeat * 100}% de la capacidad por fecha (hoy {money(stadiumMaintenance(team))}).
        Más lugares permiten más gente, pero también un gasto fijo mayor.
      </p>
      <div className="stack">
        {STADIUM_UPGRADES.map((u) => {
          const cost = upgradeCost(team.stadium.capacity, u.key);
          const why = locked ? LOCKOUT_REASON : team.budget < cost ? 'No alcanza el presupuesto.' : undefined;
          return (
            <div key={u.key} className="offer-row">
              <div>
                <strong>{u.label}</strong>
                <span className="muted small">+{u.add} lugares</span>
              </div>
              <button type="button" className="btn small primary" disabled={!!why} title={why} onClick={() => onResult(upgrade(u.key))}>
                {locked ? 'Gastos restringidos' : `Ampliar ${money(cost)}`}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Empleados({ team, onResult }: { team: Team; onResult: (m: string | null) => void }) {
  const hire = useGame((s) => s.hireStaff);
  const fire = useGame((s) => s.fireStaff);
  const locked = !canSpend(team);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Empleados</h2>
        <span className="panel-meta">Sueldo: {money(ECONOMY.staffWage)} por fecha cada uno</span>
      </header>
      <div className="stack">
        {STAFF.defs.map((def) => {
          const key: StaffKey = def.key;
          const count = team.staff[key];
          const cost = hireCost(team, key);
          const maxed = count >= def.max;
          const why = maxed
            ? 'Ya tenés el máximo.'
            : locked
              ? LOCKOUT_REASON
              : team.budget < cost
                ? 'No alcanza el presupuesto.'
                : undefined;
          const minCount = key === 'trainers' ? STAFF.minTrainers : 0;
          return (
            <div key={key} className="offer-row">
              <div>
                <strong>
                  {def.label}{' '}
                  <span className="tag tiny">
                    {count}/{def.max}
                  </span>
                </strong>
                <span className="muted small">{def.note}</span>
              </div>
              <span className="row-actions">
                <button type="button" className="btn small primary" disabled={!!why} title={why} onClick={() => onResult(hire(key))}>
                  {maxed ? 'Al máximo' : locked ? 'Gastos restringidos' : `Contratar ${money(cost)}`}
                </button>
                <button
                  type="button"
                  className="btn small ghost danger-text"
                  disabled={count <= minCount}
                  title={count <= minCount ? 'No hay a quién despedir.' : 'Despedir (no se devuelve plata)'}
                  onClick={() => onResult(fire(key))}
                >
                  Despedir
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Sponsor({ team, onResult }: { team: Team; onResult: (m: string | null) => void }) {
  const game = useGame((s) => s.game);
  const choose = useGame((s) => s.chooseSponsor);
  const pending = game && game.sponsorOffers?.season === game.season ? game.sponsorOffers : null;
  const s = team.finance.sponsor;
  return (
    <div className="stack">
      <section className="panel">
        <header className="panel-head">
          <h2>Auspiciante actual</h2>
        </header>
        <p>
          <strong>{s.name}</strong> · {money(s.perMatch)} por fecha
          <span className="muted small"> · {s.season === 0 ? 'contrato de origen' : `firmado en la temporada ${s.season}`}</span>
        </p>
      </section>
      {pending && (
        <section className="panel">
          <header className="panel-head">
            <h2>Ofertas de la temporada {pending.season}</h2>
          </header>
          <p className="muted small hint">Elegí quién auspicia al club. Si no elegís, seguís con el actual.</p>
          <div className="stack">
            {pending.offers.map((o, i) => (
              <div key={o.name} className="offer-row">
                <div>
                  <strong>{o.name}</strong>
                  <span className="muted small">
                    {money(o.perMatch)} por fecha{o.bonus > 0 ? ` + bono de ${money(o.bonus)} al firmar` : ''}
                  </span>
                </div>
                <button type="button" className="btn small primary" onClick={() => onResult(choose(i))}>
                  Elegir
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function Club() {
  const game = useGame((s) => s.game);
  const [sub, setSub] = useState<Sub>('finanzas');
  const [notice, setNotice] = useState<string | null>(null);
  const team = game ? userTeam(game) : undefined;
  if (!game || !team) return null;
  const pending = game.sponsorOffers?.season === game.season;

  const SUBS: { id: Sub; label: string }[] = [
    { id: 'finanzas', label: 'Finanzas' },
    { id: 'estadio', label: 'Estadio' },
    { id: 'empleados', label: 'Empleados' },
    { id: 'sponsor', label: pending ? 'Sponsor •' : 'Sponsor' },
  ];

  return (
    <div className="stack">
      <FinanceAlert team={team} />
      <div className="segmented" role="tablist" aria-label="Secciones del club">
        {SUBS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={sub === x.id}
            className={sub === x.id ? 'on' : ''}
            onClick={() => {
              setSub(x.id);
              setNotice(null);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      {notice && (
        <p className="alert error" role="alert">
          {notice}
        </p>
      )}
      {sub === 'finanzas' && <Finanzas team={team} season={game.season} />}
      {sub === 'estadio' && <Estadio team={team} onResult={setNotice} />}
      {sub === 'empleados' && <Empleados team={team} onResult={setNotice} />}
      {sub === 'sponsor' && <Sponsor team={team} onResult={setNotice} />}
    </div>
  );
}
