/** Preferencias de la billetera. Se guardan como un Hash de Redis. */
export type Preferencias = {
  /** Moneda en la que el usuario prefiere ver los valores (codigo de 3 letras: USD, EUR, UYU). */
  monedaVisualizacion: string;
  /** Monto en USD a partir del cual el usuario quiere que se lo alerte. */
  limiteAlertaUsd: number;
};
