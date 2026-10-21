import React, { useState } from 'react';
import { lockCounts, unlockAll, useStore } from '../store';
import { I } from './icons';

/** "Desbloquear todo": release fixed pieces, frozen sheets and hand-set rotations, then optimize everything. */
export function UnlockMenu({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  useStore(s => s.layout); useStore(s => s.project.overrides);
  const c = lockCounts();
  const total = c.pieces + c.sheets + c.rots;
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open} title="Soltar todo lo fijado y optimizar desde cero"><I.unlock /> Desbloquear todo{total ? <span className="pill" style={{ marginLeft: 6 }}>{total}</span> : null}</button>
      {open && <div className="pane unlock-pop" style={{ left: 0, right: 'auto', top: 34 }} onMouseLeave={() => setOpen(false)}>
        <b>Desbloquear todo y optimizar</b>
        <ul className="help-list">
          <li>{c.pieces} piezas fijadas</li>
          <li>{c.sheets} láminas bloqueadas</li>
          <li>{c.rots} marcas con giro puesto a mano</li>
        </ul>
        <span className="muted" style={{ fontSize: 12 }}>Los espejos puestos a mano ({c.flips}) se mantienen, porque cambian la pieza que sale de la máquina. Puedes soltarlos también.</span>
        <button className="btn primary" onClick={() => { setOpen(false); unlockAll(false); }}>Soltar todo y optimizar</button>
        {c.flips > 0 && <button className="btn ghost" onClick={() => { setOpen(false); unlockAll(true); }}>Soltar todo, también los espejos</button>}
        <span className="muted" style={{ fontSize: 12 }}>Ctrl+Z vuelve al resultado anterior.</span>
      </div>}
    </div>
  );
}
