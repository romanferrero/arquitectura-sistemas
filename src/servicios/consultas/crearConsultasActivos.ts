import { ErrorApi } from "../../errores/ErrorApi.ts";
import type { Activo, ActivoConPrecio } from "../../modelos/activo.ts";
import type { RegistroAuditoria } from "../../modelos/auditoria.ts";
import { redondear } from "../../utilidades/redondear.ts";

export type ResultadoCache = "HIT" | "MISS";

/**
 * LADO DE LECTURA de CQRS: consultar activos sin modificar nada. Las consultas leen primero de REDIS
 * (el modelo de lectura: una copia lista para servir, sin pasar por la base principal) y recien si el
 * dato no esta van a MySQL y lo dejan en Redis para la proxima. Cada respuesta dice de donde salio
 * (`HIT` o `MISS`), y el controlador lo informa en el header `X-Cache`.
 *
 * Por que importa: la mayoria del trafico de una API suele ser de lectura. Con este camino, esas
 * lecturas no tocan MySQL mientras el dato este en Redis, y la base principal queda para lo que solo
 * ella puede hacer: guardar y garantizar la integridad. (Ver "CQRS y rendimiento" en el README.)
 *
 * El precio: CONSISTENCIA EVENTUAL. Entre que un comando confirma en MySQL y el modelo de lectura se
 * actualiza hay una ventana en la que una consulta puede devolver el dato anterior. El TTL es la red de seguridad.
 *
 * Es una FABRICA con todas sus dependencias por parametro: se prueba sin MySQL, Redis ni red.
 */
export function crearConsultasActivos(dependencias: {
  /** El lado de escritura, que solo se consulta cuando el dato NO esta en Redis. */
  repositorio: {
    listar: () => Promise<Activo[]>;
    buscarPorId: (id: string) => Promise<Activo | undefined>;
  };
  cache: {
    consultar: (id: string, cargar: () => Promise<Activo>) => Promise<{ activo: Activo; cache: ResultadoCache }>;
    consultarLista: (cargar: () => Promise<Activo[]>) => Promise<{ activos: Activo[]; cache: ResultadoCache }>;
  };
  auditoria: { historialDe: (entidadId: string) => Promise<RegistroAuditoria[]> };
  obtenerPrecio: (simbolo: string) => Promise<number>;
  moneda: string;
  ahora: () => Date;
}) {
  const { repositorio, cache, auditoria, obtenerPrecio, moneda, ahora } = dependencias;

  /** El activo desde MySQL, o 404. Es lo que se ejecuta cuando Redis no lo tiene. */
  async function cargarDeMysql(id: string): Promise<Activo> {
    const activo = await repositorio.buscarPorId(id);
    if (activo === undefined) throw new ErrorApi(404, `No existe un activo con id ${id}`);
    return activo;
  }

  async function consultarActivo(id: string): Promise<{ activo: Activo; cache: ResultadoCache }> {
    return await cache.consultar(id, () => cargarDeMysql(id)); // 404 si no existe
  }

  return {
    /** El portafolio completo (o un simbolo). La lista entera vive en Redis y el filtro se aplica sobre ella. */
    async listarActivos(simbolo?: string): Promise<{ activos: Activo[]; cache: ResultadoCache }> {
      const { activos, cache: origen } = await cache.consultarLista(() => repositorio.listar());
      const buscado = simbolo?.trim().toUpperCase();
      return { activos: buscado === undefined ? activos : activos.filter((activo) => activo.simbolo === buscado), cache: origen };
    },

    consultarActivo,

    /**
     * Combina el activo con su cotizacion actual y calcula el rendimiento de la posicion. El activo sale del
     * modelo de lectura; la cotizacion es de un tercero (502 si falla) y nunca se cachea.
     */
    async obtenerActivoConPrecio(id: string): Promise<ActivoConPrecio> {
      const { activo } = await consultarActivo(id); // 404 si no existe
      const precioActual = await obtenerPrecio(activo.simbolo); // 502 si falla la API

      const valorActual = activo.cantidad * precioActual;
      const costoTotal = activo.cantidad * activo.precioCompra;
      const gananciaPerdida = valorActual - costoTotal;

      return {
        ...activo,
        precioActual,
        moneda,
        valorActual: redondear(valorActual),
        costoTotal: redondear(costoTotal),
        gananciaPerdida: redondear(gananciaPerdida),
        variacionPorcentual: redondear((gananciaPerdida / costoTotal) * 100),
        consultadoEn: ahora().toISOString(),
      };
    },

    /**
     * Historial de un activo. Funciona aunque el activo ya se haya eliminado (el historial es justamente lo
     * que queda). Si no hay registros y el activo tampoco existe, el id es desconocido: 404.
     */
    async historialDeActivo(id: string): Promise<RegistroAuditoria[]> {
      const registros = await auditoria.historialDe(id);
      if (registros.length === 0) await cargarDeMysql(id); // lanza 404 si no existe
      return registros;
    },
  };
}
