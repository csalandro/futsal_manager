export function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$ ${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
  if (abs >= 10_000) return `$ ${Math.round(n / 1000).toLocaleString('es-AR')} K`;
  return '$ ' + Math.round(n).toLocaleString('es-AR');
}

export function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    parts
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Banda de color de un rating, al estilo de los atributos de un manager. */
export function ratingClass(r: number): string {
  if (r >= 78) return 'r5';
  if (r >= 68) return 'r4';
  if (r >= 58) return 'r3';
  if (r >= 48) return 'r2';
  return 'r1';
}
