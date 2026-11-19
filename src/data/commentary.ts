// Plantillas de relato. {A} = equipo que ataca, {B} = equipo que defiende, {S} = goleador.

export const COMMENT_BUILD = [
  '{A} arma jugada por el sector izquierdo',
  '{A} presiona en salida de {B}',
  'circula la pelota en campo de {B}',
  '{A} busca el hueco entre los cierres',
  'pausa y cambio de ritmo de {A}',
  '{B} recupera y sale rápido de contra',
  '{A} intenta el pívot para descargar',
];
export const COMMENT_CHANCE = [
  '¡remate cruzado de {A}, se va cerca!',
  '{A} prueba de media distancia, ataja el arquero',
  'gran definición al primer palo de {A}... afuera por poco',
  '{A} encuentra el pase filtrado, ¡casi gol!',
  'tiro libre para {A} desde el sector',
];
export const COMMENT_GOAL = [
  '¡¡GOLAZO DE {S}!! Definición perfecta',
  '¡GOL! {S} la clava en el ángulo',
  '{S} anota tras un gran pase, ¡adentro!',
  '¡GOL de {S}! Remate imparable',
  '{S} convierte de zurda, ¡inatajable!',
  '¡GOOOL de {S}! No perdona',
  '{S} define de primera, ¡imposible para el arquero!',
];
export const COMMENT_SAVE = [
  'gran tapada del arquero de {B}',
  '{B} achica bien y evita el gol',
  'el palo le niega el gol a {A}',
  'atajadón del arquero de {B}',
];
export const COMMENT_FOUL = [
  '{B} comete falta sobre {A} en mitad de cancha',
  '{B} corta con dureza el avance de {A}',
  'falta de {B}, se corta el ataque de {A}',
  '{B} llega tarde y comete infracción sobre {A}',
];
export const COMMENT_YELLOW = [
  '🟨 amarilla para {B} por la falta sobre {A}',
  '{B} se lleva la amonestación tras la infracción',
  'el árbitro saca la tarjeta amarilla para {B}',
];
export const COMMENT_RED = [
  '🟥 ¡roja directa para {B}!',
  '{B} ve la expulsión tras una entrada durísima sobre {A}',
  'el árbitro no duda: roja para {B}',
];

export function fillTeams(tpl: string, a: string, b: string): string {
  return tpl.replaceAll('{A}', a).replaceAll('{B}', b);
}
export function fillScorer(tpl: string, scorer: string): string {
  return tpl.replaceAll('{S}', scorer);
}
