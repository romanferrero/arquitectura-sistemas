import { registradorDe } from "../config/logger.ts";
import { redis } from "../datos/redis.ts";
import { crearServicioAdministracion } from "./crearServicioAdministracion.ts";

/** Las operaciones administrativas de la aplicacion: la fabrica ya conectada a Redis y al logger. */
export const administracion = crearServicioAdministracion({ redis, registrador: registradorDe("Administracion") });
