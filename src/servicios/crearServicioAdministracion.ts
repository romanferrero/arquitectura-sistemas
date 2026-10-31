import { describirError } from "../datos/describirError.ts";
import type { ComandosRedis } from "../datos/tiposRedis.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";
import type { Registrador } from "../pipeline/pipeline.ts";
import { PREFIJO_ACTIVO } from "./crearCacheActivos.ts";

/**
 * Operaciones administrativas (solo ADMIN).
 *
 * `limpiarCache` borra UNICAMENTE las claves de la cache de activos (`activo:*`). Redis guarda mucho
 * mas que cache: los trabajos de la cola (`bull:*`), las preferencias de cada usuario, el contador
 * de reportes, el ranking y el modo panico. Un `FLUSHALL` o `FLUSHDB` los borraria a todos: se
 * perderian reportes pendientes y se apagaria el modo panico en pleno incidente. Por eso se recorre
 * con SCAN (por tandas, sin bloquear Redis como haria KEYS) y se borra solo lo que corresponde.
 *
 * Es una FABRICA para probarla con un Redis falso.
 */
export function crearServicioAdministracion(dependencias: {
  redis: ComandosRedis;
  registrador: Registrador;
  /** Cuantas claves pide cada vuelta de SCAN (es una sugerencia para Redis, no un limite exacto). */
  tamanoTanda?: number;
}) {
  const { redis, registrador, tamanoTanda = 100 } = dependencias;

  return {
    /** Vacia la cache de activos y dice cuantas entradas borro. 503 si Redis falla. */
    async limpiarCache(quien: string): Promise<{ eliminadas: number }> {
      let eliminadas = 0;
      try {
        let cursor = "0";
        do {
          const tanda = await redis.scan(cursor, { MATCH: `${PREFIJO_ACTIVO}*`, COUNT: tamanoTanda });
          cursor = tanda.cursor;
          if (tanda.keys.length > 0) eliminadas += await redis.del(tanda.keys);
        } while (cursor !== "0");
      } catch (error) {
        registrador.error(`No se pudo limpiar la caché: ${describirError(error)}`);
        throw new ErrorApi(503, "No se pudo limpiar la caché en este momento");
      }
      registrador.info(`${quien} limpió la caché de activos (${eliminadas} entradas)`);
      return { eliminadas };
    },
  };
}
