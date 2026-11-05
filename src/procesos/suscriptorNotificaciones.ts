import { env } from "../config/env.ts";
import { crearNotificaciones } from "../eventos/crearNotificaciones.ts";
import { preferencias } from "../servicios/preferenciasServicio.ts";
import { ejecutarSuscriptor } from "./ejecutarSuscriptor.ts";

/**
 * SUSCRIPTOR DE NOTIFICACIONES (Whale Alert): escucha el mismo canal que el de proyecciones, pero es
 * OTRO proceso con otro trabajo: avisa al usuario cuando una operacion suya deja una posicion por encima
 * de su limite de alerta (ver `crearNotificaciones`). Los dos suscriptores no se conocen entre si; cada uno
 * recibe todos los eventos y se puede parar, reiniciar o escalar por separado.
 *
 *   npm run suscriptor:notificaciones                        (en local)
 *   node dist/procesos/suscriptorNotificaciones.js           (en Docker, ver docker-compose.yml)
 *
 * No usa MySQL ni MongoDB: solo Redis (el canal y las preferencias de cada usuario).
 */
void ejecutarSuscriptor({
  nombre: "SuscriptorNotificaciones",
  usaMongo: false,
  manejar: (registrador) => {
    const notificaciones = crearNotificaciones({
      obtenerPreferencias: (usuario) => preferencias.obtener(usuario),
      umbralPorDefectoUsd: env.UMBRAL_MONTO_USD,
      registrador,
    });
    return (evento) => notificaciones.notificar(evento);
  },
});
