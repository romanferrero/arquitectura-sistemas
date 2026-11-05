import { registrarEvento } from "../datos/auditoriaRepositorio.ts";
import { redis } from "../datos/redis.ts";
import { crearProyecciones } from "../eventos/crearProyecciones.ts";
import { cacheActivos } from "../servicios/cacheActivosServicio.ts";
import { ejecutarSuscriptor } from "./ejecutarSuscriptor.ts";

/**
 * SUSCRIPTOR DE PROYECCIONES: escucha el canal `activos-actualizaciones` y, por cada evento, deja la
 * cache al dia, cuenta el evento y lo registra en la auditoria de MongoDB (ver `crearProyecciones`).
 * Es el que hace lo que antes hacian los comandos de la API despues de escribir en MySQL.
 *
 *   npm run suscriptor:proyecciones                          (en local)
 *   node dist/procesos/suscriptorProyecciones.js             (en Docker, ver docker-compose.yml)
 *
 * Si este proceso esta caido, los eventos que se publiquen en ese lapso SE PIERDEN (Pub/Sub no guarda
 * mensajes): la cache se corrige sola al vencer el TTL, pero esas operaciones no quedan auditadas.
 * No necesita MySQL: la cache solo se invalida, no se reconstruye desde aca.
 */
void ejecutarSuscriptor({
  nombre: "SuscriptorProyecciones",
  usaMongo: true,
  manejar: (registrador) => {
    const proyecciones = crearProyecciones({
      cache: cacheActivos,
      redis,
      auditoria: { registrarEvento },
      registrador,
    });
    return (evento) => proyecciones.proyectar(evento);
  },
});
