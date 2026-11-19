// Listas de nombres y datos de color para generar jugadores y clubes (portadas del HTML original).
import type { Position } from '../domain/types';

export const CITY_NAMES = ['Del Sur', 'Norte', 'Central', 'Costa', 'Rivadavia', 'San Martín', 'Belgrano', 'Alto', 'Unidos', 'Atlético', 'Loma', 'Vélez del Río', 'Independencia', 'Los Andes', 'Sarmiento', 'Bermejo', 'Vista Alegre', 'La Ribera', 'Palmar', 'El Fuerte', 'Miramar', 'San Cayetano', 'La Estación', 'Puerto Nuevo'] as const;

export const CLUB_WORDS = ['Halcones', 'Rayo', 'Tigres', 'Cóndor', 'Pumas', 'Furia', 'Trueno', 'Estrella', 'Lobos', 'Fénix', 'Titanes', 'Relámpago', 'Toros', 'Águilas', 'Vendaval', 'Centella', 'Huracán', 'Cometas', 'Leones', 'Bravos'] as const;

export const TEAM_COLORS = ['#e5484d', '#4b9eff', '#49c97d', '#ffc24b', '#c264e0', '#ff8a4c', '#3ddbd9', '#e05c9d', '#8b9eff', '#9ccc3c', '#ff6161', '#5ac8fa', '#d4a017', '#7a86ff', '#43c6ac', '#f2555c'] as const;

export const FIRST_NAMES = ['Mateo', 'Bruno', 'Tomás', 'Iker', 'Facu', 'Nico', 'Santi', 'Lauta', 'Gonza', 'Fede', 'Joaquín', 'Ramiro', 'Agustín', 'Ezequiel', 'Franco', 'Tobías', 'Ignacio', 'Valentín', 'Emiliano', 'Ciro', 'Bautista', 'Dante', 'Thiago', 'Benicio', 'Renzo'] as const;

export const LAST_NAMES = ['Gómez', 'Fernández', 'Rodríguez', 'López', 'Díaz', 'Álvarez', 'Romero', 'Sosa', 'Torres', 'Molina', 'Ortiz', 'Silva', 'Núñez', 'Herrera', 'Aguirre', 'Benítez', 'Cabrera', 'Ríos', 'Acosta', 'Medina', 'Flores', 'Vega', 'Ledesma', 'Peralta', 'Correa'] as const;

export const ORIGINS = ['Buenos Aires', 'Córdoba', 'Rosario', 'Mendoza', 'Santa Fe', 'Tucumán', 'Salta', 'Mar del Plata', 'La Plata', 'Neuquén', 'Bahía Blanca', 'San Juan', 'Resistencia', 'Posadas', 'Comodoro Rivadavia', 'San Salvador de Jujuy', 'Río Cuarto', 'Concordia', 'Uruguay', 'Paraguay', 'Brasil', 'Chile', 'Bolivia'] as const;

export const TRAITS: Record<Position, readonly string[]> = {
  POR: ['Reflejos felinos', 'Buen achique', 'Seguro bajo los palos', 'Bueno con los pies', 'Líder del arco'],
  CIE: ['Marcador duro', 'Buena salida con la pelota', 'Líder de la defensa', 'Contundente en el uno contra uno', 'Anticipa bien'],
  ALA: ['Desequilibrante', 'Buen centro', 'Motor incansable', 'Gambeteador', 'Llegada desde atrás'],
  PIV: ['Killer del área', 'Juego de espaldas al arco', 'Definición letal', 'Pivot de área', 'Buen manejo de pelota'],
};
