/** Redondea a dos decimales (centavos). */
export function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
