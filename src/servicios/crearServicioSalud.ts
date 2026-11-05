import { describirError } from "../datos/describirError.ts";
import type { Registrador } from "../pipeline/pipeline.ts";
import { conTiempoMaximo } from "../utilidades/conTiempoMaximo.ts";

export type NombreDependencia = "mysql" | "mongodb" | "redis";

export type ResultadoDependencia = {
  estado: "ok" | "error";
  /** Cuanto tardo en responder la comprobacion (o en rendirse). */
  ms: number;
};

export type ResultadoSalud = {
  /** `ok`: todo responde. `degradado`: alguna dependencia no responde. `cerrando`: la instancia esta apagandose. */
  estado: "ok" | "degradado" | "cerrando";
  dependencias: Record<NombreDependencia, ResultadoDependencia>;
  /** Que instancia del cluster respondio (el `NODE_APP_INSTANCE` de PM2). */
  instancia: string;
  pid: number;
  uptimeSegundos: number;
  fecha: string;
};

/**
 * HEALTH CHECK: comprueba que esta instancia llegue a MySQL, MongoDB y Redis. Es una FABRICA con todo por
 * parametro (las comprobaciones, el reloj, el pid) para probarla sin bases.
 *
 *  - Las tres comprobaciones corren EN PARALELO y cada una con un tiempo maximo: una base colgada no puede
 *    colgar el health check (y con el, el healthcheck de Docker o al balanceador).
 *  - El detalle de un fallo va al LOG, no a la respuesta: el endpoint es publico y un mensaje de error
 *    mostraria hosts y puertos internos. La respuesta solo dice `ok` o `error` y cuanto tardo.
 *  - Mientras la instancia se apaga (`marcarCerrando`) responde `cerrando` y la API lo traduce a 503: asi quien
 *    la consulta deja de mandarle trafico antes de que termine de cerrar.
 */
export function crearServicioSalud(dependencias: {
  comprobaciones: Record<NombreDependencia, () => Promise<unknown>>;
  tiempoMaximoMs: number;
  registrador: Registrador;
  instancia: () => string;
  pid: number;
  uptimeSegundos: () => number;
  /** Reloj en milisegundos; tiene que ser monotono (en la app, `performance.now`). */
  reloj: () => number;
  ahora: () => Date;
}) {
  const { comprobaciones, tiempoMaximoMs, registrador, instancia, pid, uptimeSegundos, reloj, ahora } = dependencias;
  let cerrando = false;

  async function comprobar(nombre: NombreDependencia): Promise<ResultadoDependencia> {
    const inicio = reloj();
    try {
      await conTiempoMaximo(comprobaciones[nombre], tiempoMaximoMs, `${nombre} no respondió en ${tiempoMaximoMs} ms`);
      return { estado: "ok", ms: Math.round(reloj() - inicio) };
    } catch (error) {
      registrador.error(`Health check: ${nombre} no está disponible: ${describirError(error)}`);
      return { estado: "error", ms: Math.round(reloj() - inicio) };
    }
  }

  return {
    /** Desde aca la instancia responde `cerrando`. */
    marcarCerrando(): void {
      cerrando = true;
    },

    async comprobar(): Promise<ResultadoSalud> {
      const [mysql, mongodb, redis] = await Promise.all([comprobar("mysql"), comprobar("mongodb"), comprobar("redis")]);
      const todasBien = [mysql, mongodb, redis].every((resultado) => resultado.estado === "ok");
      return {
        estado: cerrando ? "cerrando" : todasBien ? "ok" : "degradado",
        dependencias: { mysql, mongodb, redis },
        instancia: instancia(),
        pid,
        uptimeSegundos: Math.round(uptimeSegundos()),
        fecha: ahora().toISOString(),
      };
    },
  };
}
