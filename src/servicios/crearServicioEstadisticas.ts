import { describirError } from "../datos/describirError.ts";
import type { ComandosRedis } from "../datos/tiposRedis.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";
import type { Activo } from "../modelos/activo.ts";
import type { Registrador } from "../pipeline/pipeline.ts";
import { CLAVE_RANKING } from "./crearCacheActivos.ts";

/** Contador global de reportes generados con exito. Lo incrementa el worker con INCR. */
export const CLAVE_REPORTES_EXITOSOS = "estadisticas:reportes-exitosos";

export type Estadisticas = {
  reportesExitosos: number;
  masConsultados: { id: string; simbolo?: string; consultas: number }[];
};

/**
 * Estadisticas globales de la aplicacion, guardadas en Redis:
 *  - cuantos reportes se generaron con exito (un contador atomico, INCR);
 *  - los activos mas consultados (el Sorted Set del ranking).
 *
 * Es un estado COMPARTIDO: lo escriben distintos procesos (el worker cuenta los reportes, la
 * API cuenta las consultas) y lo lee cualquiera, por eso vive en Redis y no en la memoria de
 * un proceso. Si Redis falla da 503: son datos que solo existen ahi.
 */
export function crearServicioEstadisticas(dependencias: {
  redis: ComandosRedis;
  buscarActivo: (id: string) => Promise<Activo | undefined>;
  registrador: Registrador;
  cantidadMasConsultados: number;
}) {
  const { redis, buscarActivo, registrador, cantidadMasConsultados } = dependencias;

  return {
    async obtener(): Promise<Estadisticas> {
      let contador: string | null;
      let ranking: { value: string; score: number }[];
      try {
        [contador, ranking] = await Promise.all([
          redis.get(CLAVE_REPORTES_EXITOSOS),
          redis.zRangeWithScores(CLAVE_RANKING, 0, cantidadMasConsultados - 1, { REV: true }),
        ]);
      } catch (error) {
        registrador.error(`No se pudieron leer las estadísticas: ${describirError(error)}`);
        throw new ErrorApi(503, "Las estadísticas no están disponibles en este momento");
      }

      // El ranking guarda ids; se les agrega el simbolo para que se entienda. Si MySQL falla, el
      // dato de Redis sigue siendo valido: se devuelve sin el simbolo en vez de dar un 500.
      const masConsultados = await Promise.all(
        ranking.map(async ({ value, score }) => {
          const activo = await buscarActivo(value).catch((error: unknown) => {
            registrador.error(`No se pudo buscar el símbolo de ${value}: ${describirError(error)}`);
            return undefined;
          });
          return activo === undefined
            ? { id: value, consultas: score }
            : { id: value, simbolo: activo.simbolo, consultas: score };
        }),
      );
      return { reportesExitosos: Number(contador ?? 0), masConsultados };
    },
  };
}
