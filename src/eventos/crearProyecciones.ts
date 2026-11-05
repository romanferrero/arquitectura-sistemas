import { describirError } from "../datos/describirError.ts";
import type { ComandosRedis } from "../datos/tiposRedis.ts";
import type { NuevoRegistroAuditoria, OperacionAuditoria } from "../modelos/auditoria.ts";
import type { Registrador } from "../pipeline/pipeline.ts";
import { CLAVE_EVENTOS_ACTIVOS } from "../servicios/crearServicioEstadisticas.ts";
import type { EventoActivo, TipoEventoActivo } from "./eventoActivo.ts";

const OPERACION_DE: Record<TipoEventoActivo, OperacionAuditoria> = {
  ACTIVO_CREADO: "CREAR",
  ACTIVO_ACTUALIZADO: "ACTUALIZAR",
  ACTIVO_ELIMINADO: "ELIMINAR",
};

/**
 * PROYECCIONES: lo que se deriva de cada evento de activo, para que los comandos no tengan que hacerlo.
 * Es el primer suscriptor del canal; por cada evento:
 *
 *  1. CACHE: invalida la entrada `activo:<id>` y la lista `activos:todos`, y si el activo se elimino lo
 *     saca del ranking. Se INVALIDA y no se escribe el dato del evento: dos eventos del mismo activo
 *     pueden llegar en otro orden del que ocurrieron (los publican distintas instancias de la API) y
 *     escribir uno viejo dejaria la cache mal hasta el TTL; invalidar nunca deja un dato equivocado,
 *     solo hace que la proxima lectura vaya a MySQL.
 *  2. CONTADOR: suma uno al Hash `estadisticas:eventos-activos` (HINCRBY, atomico).
 *  3. AUDITORIA: registra la operacion en MongoDB, IDEMPOTENTE por `idEvento`: si el mismo evento llega
 *     dos veces, el segundo se ignora.
 *
 * Los tres pasos son INDEPENDIENTES: si uno falla se registra el error y se siguen los otros (que Mongo
 * este caido no impide invalidar la cache). Como Pub/Sub no reenvia, un paso fallido queda perdido;
 * el TTL de la cache lo corrige solo, y el hueco en la auditoria queda en el log.
 *
 * Es una FABRICA con todo por parametro: se prueba sin Redis ni MongoDB.
 */
export function crearProyecciones(dependencias: {
  cache: {
    invalidar: (id: string) => Promise<void>;
    invalidarLista: () => Promise<void>;
    quitarDelRanking: (id: string) => Promise<void>;
  };
  redis: Pick<ComandosRedis, "hIncrBy">;
  auditoria: {
    registrarEvento: (registro: NuevoRegistroAuditoria & { idEvento: string }) => Promise<"registrado" | "duplicado">;
  };
  registrador: Registrador;
}) {
  const { cache, redis, auditoria, registrador } = dependencias;

  async function paso(descripcion: string, accion: () => Promise<void>): Promise<void> {
    try {
      await accion();
    } catch (error) {
      registrador.error(`${descripcion}: ${describirError(error)}`);
    }
  }

  return {
    async proyectar(evento: EventoActivo): Promise<void> {
      // La cache. Sus metodos no deberian rechazar (tratan a Redis como mejor esfuerzo), pero si uno lo hiciera
      // no puede llevarse puestos el contador y la auditoria: cada operacion va en su propio paso.
      await paso(`No se pudo invalidar la caché del activo ${evento.activoId}`, () => cache.invalidar(evento.activoId));
      await paso("No se pudo invalidar la lista de la caché", () => cache.invalidarLista());
      if (evento.tipo === "ACTIVO_ELIMINADO") {
        await paso(`No se pudo sacar ${evento.activoId} del ranking`, () => cache.quitarDelRanking(evento.activoId));
      }

      await paso(`No se pudo contar el evento ${evento.idEvento}`, async () => {
        await redis.hIncrBy(CLAVE_EVENTOS_ACTIVOS, evento.tipo, 1);
      });

      await paso(`No se pudo auditar el evento ${evento.idEvento} (${evento.tipo} ${evento.activoId})`, async () => {
        const registro: NuevoRegistroAuditoria & { idEvento: string } = {
          operacion: OPERACION_DE[evento.tipo],
          entidadId: evento.activoId,
          metadatos: evento.metadatos,
          idEvento: evento.idEvento,
          ocurridoEn: evento.ocurridoEn,
        };
        if (evento.antes !== undefined) registro.antes = evento.antes;
        if (evento.despues !== undefined) registro.despues = evento.despues;
        if (evento.camposModificados !== undefined) registro.camposModificados = evento.camposModificados;

        const resultado = await auditoria.registrarEvento(registro);
        if (resultado === "duplicado") registrador.info(`Evento ${evento.idEvento} ya estaba auditado: se ignora`);
      });

      registrador.info(`Evento ${evento.tipo} procesado (${evento.idEvento}, activo ${evento.activoId})`);
    },
  };
}
