import { describirError } from "../datos/describirError.ts";
import type { Preferencias } from "../modelos/preferencias.ts";
import type { Registrador } from "../pipeline/pipeline.ts";
import { esWhaleAlert, montoUsd } from "../utilidades/whaleAlert.ts";
import type { EventoActivo } from "./eventoActivo.ts";

/**
 * NOTIFICACIONES (Whale Alert): el segundo suscriptor del canal, independiente del de proyecciones. Si una
 * operacion deja una posicion cuyo monto (cantidad x precioCompra, en USD) SUPERA el limite de alerta del
 * usuario que la hizo, "envia" una notificacion (por ahora, una linea de log: no hay un canal de envio real).
 *
 * El limite sale de las preferencias del usuario (`limiteAlertaUsd`, en Redis); si el usuario no configuro
 * ninguno rige el umbral general (`UMBRAL_MONTO_USD`). Si no se pueden leer las preferencias (Redis caido)
 * tambien rige el umbral general: una alerta con el limite por defecto vale mas que ninguna.
 *
 * Que dispara una alerta:
 *  - ACTIVO_CREADO: la posicion nueva supera el limite.
 *  - ACTIVO_ACTUALIZADO: la posicion queda por encima del limite Y su monto cambio (cambiar solo el nombre
 *    de una posicion grande no avisa de nuevo).
 *  - ACTIVO_ELIMINADO: nunca.
 *
 * Es una FABRICA con todo por parametro: se prueba sin Redis.
 */
export function crearNotificaciones(dependencias: {
  obtenerPreferencias: (usuario: string) => Promise<Pick<Preferencias, "limiteAlertaUsd">>;
  umbralPorDefectoUsd: number;
  registrador: Registrador;
}) {
  const { obtenerPreferencias, umbralPorDefectoUsd, registrador } = dependencias;

  async function limiteDe(usuario: string | undefined): Promise<number> {
    if (usuario === undefined) return umbralPorDefectoUsd;
    try {
      return (await obtenerPreferencias(usuario)).limiteAlertaUsd;
    } catch (error) {
      registrador.warn(`No se pudieron leer las preferencias de ${usuario} (se usa el umbral general): ${describirError(error)}`);
      return umbralPorDefectoUsd;
    }
  }

  return {
    async notificar(evento: EventoActivo): Promise<void> {
      const posicion = evento.despues;
      if (evento.tipo === "ACTIVO_ELIMINADO" || posicion === undefined) return;

      const monto = montoUsd(posicion);
      if (evento.tipo === "ACTIVO_ACTUALIZADO" && evento.antes !== undefined && montoUsd(evento.antes) === monto) return;

      const usuario = evento.metadatos.usuario;
      const limite = await limiteDe(usuario);
      if (!esWhaleAlert(monto, limite)) return;

      registrador.info(
        `Notificación enviada al usuario ${usuario ?? "desconocido"}: Whale Alert, ${posicion.simbolo} vale ${monto} USD ` +
          `y supera su límite de ${limite} USD (${evento.tipo}, evento ${evento.idEvento})`,
      );
    },
  };
}
