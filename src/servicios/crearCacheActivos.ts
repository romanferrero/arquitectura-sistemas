import { describirError } from "../datos/describirError.ts";
import type { ComandosRedis } from "../datos/tiposRedis.ts";
import type { Activo } from "../modelos/activo.ts";
import type { Registrador } from "../pipeline/pipeline.ts";

export const PREFIJO_ACTIVO = "activo:";
export const CLAVE_RANKING = "activos:mas-consultados";

/**
 * Cache de activos en Redis (cache-aside): se guarda cada activo como un String JSON
 * con TTL bajo la clave `activo:<id>`, y se lleva un ranking de los mas consultados
 * en un Sorted Set.
 *
 * Es una FABRICA porque Redis, el logger y el TTL entran por parametro: asi se prueba
 * con un Redis falso. Lo cablea cacheActivosServicio.ts.
 *
 * MEJOR ESFUERZO: la cache es solo una optimizacion. Si Redis falla (caido, lento,
 * dato corrupto) el error se loguea y la operacion sigue con MySQL, que es la fuente de
 * verdad. Por eso NINGUN metodo rechaza: el servicio que la usa no necesita try/catch.
 *
 * Limite conocido: la cache puede quedar desactualizada hasta que venza el TTL si una
 * lectura que ya paso por MySQL guarda su resultado justo despues de que un PUT invalida
 * la clave. El TTL es la red de seguridad.
 */
export function crearCacheActivos(dependencias: {
  redis: ComandosRedis;
  registrador: Registrador;
  ttlSegundos: number;
}) {
  const { redis, registrador, ttlSegundos } = dependencias;

  /** Ejecuta una operacion de Redis; si falla la loguea y devuelve el valor de respaldo. */
  async function intentar<T>(descripcion: string, operacion: () => Promise<T>, respaldo: T): Promise<T> {
    try {
      return await operacion();
    } catch (error) {
      registrador.error(`${descripcion}: ${describirError(error)}`);
      return respaldo;
    }
  }

  return {
    /** El activo guardado, o undefined si no esta en la cache (o Redis no responde). */
    async leer(id: string): Promise<Activo | undefined> {
      const texto = await intentar(`No se pudo leer ${PREFIJO_ACTIVO}${id}`, () => redis.get(PREFIJO_ACTIVO + id), null);
      if (texto === null) return undefined;

      try {
        const dato: unknown = JSON.parse(texto);
        if (typeof dato === "object" && dato !== null && (dato as { id?: unknown }).id === id) {
          return dato as Activo;
        }
      } catch {
        // cae al aviso de abajo
      }
      registrador.error(`Dato inválido en la caché (${PREFIJO_ACTIVO}${id}): se lee de MySQL`);
      return undefined;
    },

    /** Guarda el activo con TTL: pasado ese tiempo se vuelve a leer de MySQL. */
    async guardar(activo: Activo): Promise<void> {
      await intentar(
        `No se pudo guardar ${PREFIJO_ACTIVO}${activo.id}`,
        () => redis.set(PREFIJO_ACTIVO + activo.id, JSON.stringify(activo), { EX: ttlSegundos }),
        undefined,
      );
    },

    /** Saca el activo de la cache (despues de un PUT o un DELETE confirmado en MySQL). */
    async invalidar(id: string): Promise<void> {
      await intentar(`No se pudo invalidar ${PREFIJO_ACTIVO}${id}`, () => redis.del(PREFIJO_ACTIVO + id), 0);
    },

    /** Suma una consulta al ranking de activos mas consultados (ZINCRBY, atomico). */
    async contarConsulta(id: string): Promise<void> {
      await intentar("No se pudo actualizar el ranking", () => redis.zIncrBy(CLAVE_RANKING, 1, id), 0);
    },

    /** Saca el activo del ranking (cuando se elimina). */
    async quitarDelRanking(id: string): Promise<void> {
      await intentar("No se pudo actualizar el ranking", () => redis.zRem(CLAVE_RANKING, id), 0);
    },
  };
}
