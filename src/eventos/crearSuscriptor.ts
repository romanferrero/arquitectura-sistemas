import { describirError } from "../datos/describirError.ts";
import type { Registrador } from "../pipeline/pipeline.ts";
import { CANAL_ACTIVOS, EventoInvalidoError, parsearEventoActivo } from "./eventoActivo.ts";
import type { EventoActivo } from "./eventoActivo.ts";

/** Lo que se necesita de una conexion de Redis en modo suscripcion (el cliente real `redis.duplicate()` lo cumple). */
export type ConexionSuscriptora = {
  subscribe(canal: string, oyente: (mensaje: string) => void): Promise<unknown>;
};

/**
 * SUSCRIPTOR de eventos de activos (el lado "Subscriber" de Pub/Sub): escucha el canal, valida cada
 * mensaje contra el contrato y se lo pasa a `manejar`. No sabe que hace `manejar`: las proyecciones y las
 * notificaciones son dos suscriptores distintos que comparten esta misma mecanica.
 *
 *  - Un mensaje que no es JSON o no cumple el contrato se DESCARTA con un aviso: el canal no garantiza
 *    quien escribe, y un mensaje malo no puede voltear al suscriptor.
 *  - Si `manejar` falla se deja el error en el log y se sigue con el proximo: Pub/Sub no reenvia, asi
 *    que reintentar no es posible; lo que si hay que evitar es que un evento roto frene a los demas.
 *  - Los eventos se procesan UNO POR VEZ y en el orden en que llegaron (cola en memoria): asi un
 *    ACTIVO_ACTUALIZADO nunca se aplica antes que el ACTIVO_CREADO anterior.
 *
 * Es una FABRICA con la conexion por parametro: se prueba sin Redis.
 */
export function crearSuscriptor(dependencias: {
  conexion: ConexionSuscriptora;
  manejar: (evento: EventoActivo) => Promise<void>;
  registrador: Registrador;
  canal?: string;
}) {
  const { conexion, manejar, registrador, canal = CANAL_ACTIVOS } = dependencias;
  let cola: Promise<void> = Promise.resolve();

  async function procesar(mensaje: string): Promise<void> {
    let evento: EventoActivo;
    try {
      evento = parsearEventoActivo(mensaje);
    } catch (error) {
      if (!(error instanceof EventoInvalidoError)) throw error;
      registrador.warn(`Mensaje descartado: ${error.message}`);
      return;
    }
    try {
      await manejar(evento);
    } catch (error) {
      registrador.error(
        `No se pudo procesar el evento ${evento.tipo} (${evento.idEvento}, activo ${evento.activoId}): ${describirError(error)}`,
      );
    }
  }

  return {
    /** Se suscribe al canal. Desde aca cada mensaje entra en la cola de procesamiento. */
    async iniciar(): Promise<void> {
      await conexion.subscribe(canal, (mensaje) => {
        // El .catch es la red de seguridad: una promesa rechazada en la cola dejaria de ejecutar TODOS los
        // eventos siguientes (el suscriptor seguiria "vivo" pero sin hacer nada).
        cola = cola
          .then(() => procesar(mensaje))
          .catch((error: unknown) => registrador.error(`Error inesperado al procesar un mensaje: ${describirError(error)}`));
      });
      registrador.info(`Suscripto al canal ${canal}`);
    },

    /** Espera a que termine lo que ya llego (para cerrar sin cortar un evento a la mitad). */
    async esperarPendientes(): Promise<void> {
      await cola;
    },
  };
}
