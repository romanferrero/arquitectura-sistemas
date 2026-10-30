import { randomUUID } from "node:crypto";
import { adaptadorColaReportes } from "../colas/colaReportes.ts";
import { registradorDe } from "../config/logger.ts";
import { crearServicioReportes } from "./crearServicioReportes.ts";

/**
 * El servicio de reportes de la aplicacion: la fabrica ya conectada a la cola de BullMQ.
 * Si Redis no responde en 2 segundos, pedir o consultar un reporte da 503.
 */
export const reportes = crearServicioReportes({
  cola: adaptadorColaReportes,
  registrador: registradorDe("Reportes"),
  tiempoMaximoMs: 2_000,
  generarId: randomUUID,
  ahora: () => new Date(),
});
