import { registradorDe } from "../config/logger.ts";
import * as repositorio from "../datos/auditoriaRepositorio.ts";
import { crearServicioAuditoria } from "./crearServicioAuditoria.ts";

/**
 * El servicio de auditoria de la aplicacion: la fabrica ya conectada al
 * repositorio de MongoDB y al logger. Si MongoDB no responde en 2 segundos, una
 * operacion de escritura sigue adelante sin su registro (ver crearServicioAuditoria).
 */
export const auditoria = crearServicioAuditoria({
  repositorio,
  registrador: registradorDe("Auditoria"),
  tiempoMaximoMs: 2_000,
});
