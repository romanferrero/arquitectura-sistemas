import { describirError } from "../datos/describirError.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";
import { OPERACIONES_AUDITORIA } from "../modelos/auditoria.ts";
import type {
  FiltroAuditoria,
  NuevoRegistroAuditoria,
  OperacionAuditoria,
  RegistroAuditoria,
} from "../modelos/auditoria.ts";
import type { Registrador } from "../pipeline/pipeline.ts";

export const LIMITE_POR_DEFECTO = 50;
export const LIMITE_MAXIMO = 200;

/** Lo que el servicio necesita del repositorio; en la aplicacion es el de MongoDB. */
export type RepositorioAuditoria = {
  registrar: (registro: NuevoRegistroAuditoria) => Promise<void>;
  historialDe: (entidadId: string) => Promise<RegistroAuditoria[]>;
  listar: (filtro: FiltroAuditoria) => Promise<RegistroAuditoria[]>;
};

/**
 * Servicio del historial de auditoria.
 *
 * Es una FABRICA porque el repositorio, el logger y el tiempo maximo entran por
 * parametro: asi se prueba sin MongoDB ni consola. Lo cablea auditoriaServicio.ts.
 *
 * ESCRIBIR vs LEER, dos politicas distintas:
 *
 *  - `registrar` es de MEJOR ESFUERZO. Se llama despues de que MySQL ya confirmo
 *    la operacion, que es la que importa: si la auditoria falla (o MongoDB no
 *    responde a tiempo) se deja el error en el log y la operacion sigue siendo
 *    exitosa. No se puede deshacer lo ya escrito en MySQL ni hay transaccion que
 *    abarque las dos bases, y fallarle al cliente por un historial seria peor que
 *    perder esa linea. A cambio, puede haber operaciones sin registro.
 *    (La solucion completa seria un Transactional Outbox.)
 *
 *  - `historialDe` y `listar` son consultas: si MongoDB no esta, no hay nada que
 *    devolver, y eso es un 503 (servicio no disponible), no un 500.
 */
export function crearServicioAuditoria(dependencias: {
  repositorio: RepositorioAuditoria;
  registrador: Registrador;
  tiempoMaximoMs: number;
}) {
  const { repositorio, registrador, tiempoMaximoMs } = dependencias;

  async function registrar(registro: NuevoRegistroAuditoria): Promise<void> {
    let temporizador: NodeJS.Timeout | undefined;
    try {
      // Dentro de una funcion async para que tambien un error sincronico sea un rechazo.
      const guardado = (async () => await repositorio.registrar(registro))();
      // Si pierde la carrera contra el tiempo, evita un rechazo sin manejar mas tarde.
      guardado.catch(() => undefined);

      const vencido = new Promise<never>((_resolver, rechazar) => {
        temporizador = setTimeout(
          () => rechazar(new Error(`MongoDB no respondió en ${tiempoMaximoMs} ms`)),
          tiempoMaximoMs,
        );
      });
      await Promise.race([guardado, vencido]);
    } catch (error) {
      registrador.error(
        `No se pudo registrar la auditoría (${registro.operacion} ${registro.entidadId}): ${describirError(error)}`,
      );
    } finally {
      clearTimeout(temporizador);
    }
  }

  async function leer<T>(consulta: () => Promise<T>): Promise<T> {
    try {
      return await consulta();
    } catch (error) {
      registrador.error(`No se pudo consultar la auditoría: ${describirError(error)}`);
      throw new ErrorApi(503, "El historial de auditoría no está disponible en este momento");
    }
  }

  return {
    registrar,

    /** Historial de un activo, del evento mas reciente al mas viejo. */
    async historialDe(entidadId: string): Promise<RegistroAuditoria[]> {
      return await leer(() => repositorio.historialDe(entidadId));
    },

    /** Historial general. Recibe los parametros de la URL tal cual (texto) y los valida. */
    async listar(consulta: { operacion?: string | undefined; limite?: string | undefined }) {
      const filtro = validarConsulta(consulta);
      return await leer(() => repositorio.listar(filtro));
    },
  };
}

function validarConsulta(consulta: { operacion?: string | undefined; limite?: string | undefined }): FiltroAuditoria {
  const errores: string[] = [];

  let operacion: OperacionAuditoria | undefined;
  if (consulta.operacion !== undefined && consulta.operacion.trim() !== "") {
    const buscada = consulta.operacion.trim().toUpperCase();
    const valida = OPERACIONES_AUDITORIA.find((candidata) => candidata === buscada);
    if (valida === undefined) {
      errores.push(`operacion debe ser una de: ${OPERACIONES_AUDITORIA.join(", ")}`);
    } else {
      operacion = valida;
    }
  }

  let limite = LIMITE_POR_DEFECTO;
  if (consulta.limite !== undefined) {
    const numero = Number(consulta.limite);
    if (!/^\d+$/.test(consulta.limite.trim()) || numero < 1 || numero > LIMITE_MAXIMO) {
      errores.push(`limite debe ser un entero entre 1 y ${LIMITE_MAXIMO}`);
    } else {
      limite = numero;
    }
  }

  if (errores.length > 0) throw new ErrorApi(400, "Consulta de auditoría inválida", errores);
  return operacion === undefined ? { limite } : { operacion, limite };
}
