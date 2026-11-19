import { initials } from './format';

export function Badge({ name, color, size }: { name: string; color: string; size?: 'lg' }) {
  return (
    <span className={`badge${size ? ' ' + size : ''}`} style={{ background: color }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
