import { describirError } from "../datos/describirError.ts";
import type { ComandosRedis } from "../datos/tiposRedis.ts";
import type { Registrador } from "../pipeline/pipeline.ts";
import { CANAL_ACTIVOS, VERSION_EVENTO, esquemaEventoActivo } from "./eventoActivo.ts";
import type { DatosEventoActivo, EventoActivo } from "./eventoActivo.ts";

/**
 * PUBLICADOR de eventos de activos (el lado "Publisher" de Pub/Sub): despues de que un comando
 * confirma en MySQL, anuncia lo que paso en el canal `activos-actualizaciones`. La API no sabe quien
 * escucha ni que hace con el mensaje: ese desacople es el objetivo del patron.
 *
 * Es una FABRICA para probarlo con un Redis falso. Lo cablea publicadorServicio.ts.
 *
 * MEJOR ESFUERZO, igual que la cache y la auditoria del CRUD: MySQL ya confirmo la operacion y no se
 * puede deshacer, asi que si publicar falla se deja el error en el log y la operacion sigue siendo
 * exitosa. `publicar` NUNCA rechaza. El costo, que hay que decir: si Redis esta caido en ese instante
 * el evento se pierde, y quienes dependan de el (vistas derivadas) quedan desactualizadas hasta el TTL.
 * (La solucion completa seria un Transactional Outbox.)
 *
 * Pub/Sub tampoco guarda el mensaje: `receptores` es cuantos suscriptores lo recibieron EN ESE
 * MOMENTO; si es 0, el evento no le llego a nadie y no se va a reenviar.
 */
export function crearPublicador(dependencias: {
  redis: ComandosRedis;
  registrador: Registrador;
  generarId: () => string;
  ahora: () => Date;
  canal?: string;
}) {
  const { redis, registrador, generarId, ahora, canal = CANAL_ACTIVOS } = dependencias;

  return {
    async publicar(datos: DatosEventoActivo): Promise<void> {
      const evento: EventoActivo = {
        version: VERSION_EVENTO,
        idEvento: generarId(),
        ...datos,
        ocurridoEn: ahora().toISOString(),
      };

      // Se valida lo que SE PUBLICA: un evento que viola el contrato seria un bug nuestro y los
      // suscriptores lo descartarian. Mejor enterarse aca, en el log de quien lo origino.
      const validacion = esquemaEventoActivo.safeParse(evento);
      if (!validacion.success) {
        const motivos = validacion.error.issues.map((problema) => `${problema.path.join(".")}: ${problema.message}`);
        registrador.error(`No se publicó el evento ${evento.tipo} de ${evento.activoId}: no cumple el contrato (${motivos.join("; ")})`);
        return;
      }

      try {
        const receptores = await redis.publish(canal, JSON.stringify(evento));
        const detalle = `${evento.tipo} publicado (${evento.idEvento}, activo ${evento.activoId}, receptores: ${receptores})`;
        if (receptores === 0) {
          // Nadie lo recibio: ni la cache se va a invalidar ni la auditoria se va a escribir (las hacen los suscriptores).
          registrador.warn(`Evento ${detalle}: ningún suscriptor lo recibió y no se va a reenviar`);
        } else {
          registrador.info(`Evento ${detalle}`);
        }
      } catch (error) {
        registrador.error(`No se pudo publicar el evento ${evento.tipo} de ${evento.activoId}: ${describirError(error)}`);
      }
    },
  };
}
