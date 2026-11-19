import { initials } from './format';

/** Escudo del club: forma de escudo con el color del equipo y sus iniciales. */
export function Badge({ name, color, size = 'md' }: { name: string; color: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <span className={`crest crest-${size}`} style={{ '--crest': color } as React.CSSProperties} aria-hidden="true">
      <span>{initials(name)}</span>
    </span>
  );
}
