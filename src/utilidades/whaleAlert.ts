/** El monto de una posicion en USD: cantidad x precio de compra. */
export function montoUsd(activo: { cantidad: number; precioCompra: number }): number {
  return activo.cantidad * activo.precioCompra;
}

/**
 * La regla de la Whale Alert: un monto dispara la alerta cuando SUPERA el umbral (estrictamente mayor:
 * un monto igual al umbral no la dispara). La comparten el analisis de riesgo (pipeline) y el
 * suscriptor de notificaciones, para que las dos hablen de lo mismo.
 */
export function esWhaleAlert(monto: number, umbralUsd: number): boolean {
  return monto > umbralUsd;
}
