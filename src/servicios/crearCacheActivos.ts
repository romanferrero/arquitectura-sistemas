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

  /**
   * MySQL compara los ids sin distinguir mayusculas (collation `_ci`): `GET /api/activos/ABC...`
   * encuentra al activo `abc...`. Si la clave de la cache usara el id tal como llega, un mismo
   * activo tendria varias claves y un PUT o DELETE invalidaria solo una. Por eso TODO lo que
   * toca Redis usa el id en minusculas (los ids son UUID, que se generan en minusculas).
   */
  const normalizar = (id: string): string => id.toLowerCase();

  /** El activo guardado, o undefined si no esta en la cache (o Redis no responde). */
  async function leer(id: string): Promise<Activo | undefined> {
    const clave = PREFIJO_ACTIVO + normalizar(id);
    const texto = await intentar(`No se pudo leer ${clave}`, () => redis.get(clave), null);
    if (texto === null) return undefined;

    try {
      const dato: unknown = JSON.parse(texto);
      const idGuardado = typeof dato === "object" && dato !== null ? (dato as { id?: unknown }).id : undefined;
      if (typeof idGuardado === "string" && normalizar(idGuardado) === normalizar(id)) {
        return dato as Activo;
      }
    } catch {
      // cae al aviso de abajo
    }
    registrador.error(`Dato inválido en la caché (${clave}): se lee de MySQL`);
    return undefined;
  }

  /** Guarda el activo con TTL: pasado ese tiempo se vuelve a leer de MySQL. */
  async function guardar(activo: Activo): Promise<void> {
    const clave = PREFIJO_ACTIVO + normalizar(activo.id);
    await intentar(`No se pudo guardar ${clave}`, () => redis.set(clave, JSON.stringify(activo), { EX: ttlSegundos }), undefined);
  }

  /** Suma una consulta al ranking de activos mas consultados (ZINCRBY, atomico). */
  async function contarConsulta(id: string): Promise<void> {
    await intentar("No se pudo actualizar el ranking", () => redis.zIncrBy(CLAVE_RANKING, 1, normalizar(id)), 0);
  }

  return {
    leer,
    guardar,
    contarConsulta,

    /**
     * Lectura con cache (cache-aside): primero Redis; si el activo no esta, `cargar` lo lee de
     * la fuente de verdad (MySQL) y se guarda con TTL. Devuelve tambien si salio de la cache.
     *
     * Si `cargar` lanza (por ejemplo un 404), el error sigue de largo: lo inexistente no se
     * guarda ni se cuenta en el ranking.
     */
    async consultar(id: string, cargar: () => Promise<Activo>): Promise<{ activo: Activo; cache: "HIT" | "MISS" }> {
      const enCache = await leer(id);
      if (enCache !== undefined) {
        void contarConsulta(id); // el ranking es una estadistica: no se espera, y nunca rechaza
        return { activo: enCache, cache: "HIT" };
      }

      const activo = await cargar();
      await guardar(activo); // este si se espera: asi la lectura siguiente ya es un HIT
      void contarConsulta(id);
      return { activo, cache: "MISS" };
    },

    /** Saca el activo de la cache (despues de un PUT o un DELETE confirmado en MySQL). */
    async invalidar(id: string): Promise<void> {
      const clave = PREFIJO_ACTIVO + normalizar(id);
      await intentar(`No se pudo invalidar ${clave}`, () => redis.del(clave), 0);
    },

    /** Saca el activo del ranking (cuando se elimina). */
    async quitarDelRanking(id: string): Promise<void> {
      await intentar("No se pudo actualizar el ranking", () => redis.zRem(CLAVE_RANKING, normalizar(id)), 0);
    },
  };
}
