import { registradorDe } from "../config/logger.ts";
import { buscarPorId } from "../datos/activosRepositorio.ts";
import { redis } from "../datos/redis.ts";
import { crearServicioEstadisticas } from "./crearServicioEstadisticas.ts";

/** Las estadisticas de la aplicacion: la fabrica ya conectada a Redis y a MySQL (para los simbolos). */
export const estadisticas = crearServicioEstadisticas({
  redis,
  buscarActivo: buscarPorId,
  registrador: registradorDe("Estadisticas"),
  cantidadMasConsultados: 5,
});
