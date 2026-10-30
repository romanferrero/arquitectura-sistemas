import type { EstadoReporte } from "../modelos/reporte.ts";

/** Nombre de la cola. BullMQ no admite ":" en el nombre, por eso lleva guion. */
export const NOMBRE_COLA_REPORTES = "cola-reportes";

/** Nombre del tipo de trabajo dentro de la cola. */
export const NOMBRE_TRABAJO_VALORACION = "valoracion-masiva";

/**
 * Como se reintenta y cuanto se conserva. Cada trabajo se intenta hasta 3 veces con espera
 * creciente (1 s, 2 s): un fallo pasajero del tercero (CoinGecko) no pierde el reporte.
 * Los terminados se borran con el tiempo para que Redis no crezca sin limite.
 */
export const OPCIONES_TRABAJO_REPORTE = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 3_600, count: 500 }, // una hora, y como mucho 500
  removeOnFail: { age: 86_400 }, // un dia, para poder ver por que fallaron
} as const;

/** Los reportes se identifican con un UUID; cualquier otra cosa no puede ser un reporte nuestro. */
const FORMATO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function esIdDeReporte(texto: string): boolean {
  return FORMATO_ID.test(texto);
}

/**
 * Los estados de la cola, resumidos en los cuatro que ve el cliente. `delayed` es un trabajo
 * que fallo y espera para reintentarse: para el cliente sigue "en cola".
 */
export function estadoDeCola(estadoDeBullmq: string): EstadoReporte {
  switch (estadoDeBullmq) {
    case "active":
      return "procesando";
    case "completed":
      return "completado";
    case "failed":
      return "fallido";
    default:
      return "en_cola"; // waiting, delayed, prioritized, waiting-children...
  }
}
