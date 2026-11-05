import { mongoUri } from "../config/env.ts";
import { logger, registradorDe } from "../config/logger.ts";
import { cerrarConexiones, conectarMongo } from "../datos/conexiones.ts";
import { describirError } from "../datos/describirError.ts";
import { cerrarRedis, conectarRedis, redis } from "../datos/redis.ts";
import { crearSuscriptor } from "../eventos/crearSuscriptor.ts";
import type { EventoActivo } from "../eventos/eventoActivo.ts";
import type { Registrador } from "../pipeline/pipeline.ts";

/**
 * El esqueleto comun de los procesos SUSCRIPTORES (proyecciones y notificaciones): cada uno es un proceso
 * APARTE de la API (misma imagen, otro comando), igual que el worker de reportes. Hace lo mismo en los dos:
 *
 *  1. conecta lo que necesita (Redis siempre; MongoDB solo si `usaMongo`);
 *  2. abre una SEGUNDA conexion a Redis (`duplicate()`) y la dedica a escuchar el canal: una conexion que
 *     se suscribe queda en modo suscripcion y ya no puede ejecutar otros comandos. La conexion de datos
 *     (la primera) sigue sirviendo para leer y escribir claves;
 *  3. entrega cada evento a `manejar` (ver `crearSuscriptor`);
 *  4. al recibir SIGTERM/SIGINT deja de escuchar, termina el evento en curso y cierra todo.
 *
 * Como la API, si no llega a una base no arranca (en Docker, `restart: unless-stopped` lo reintenta).
 */
export async function ejecutarSuscriptor(opciones: {
  nombre: string;
  usaMongo: boolean;
  manejar: (registrador: Registrador) => (evento: EventoActivo) => Promise<void>;
}): Promise<void> {
  const registrador = registradorDe(opciones.nombre);
  const suscriptora = redis.duplicate();

  const cerrarTodo = async (): Promise<void> => {
    await Promise.allSettled([
      suscriptora.isOpen ? suscriptora.quit() : Promise.resolve(),
      cerrarRedis(),
      cerrarConexiones(),
    ]);
  };

  try {
    if (opciones.usaMongo) mongoUri(); // valida la configuracion antes de abrir nada (fail fast)

    await conectarRedis(); // conexion de datos
    if (opciones.usaMongo) await conectarMongo();

    suscriptora.on("error", (error: unknown) => registrador.error(`Error de la conexión suscriptora: ${describirError(error)}`));
    suscriptora.on("reconnecting", () => registrador.warn("Reconectando la conexión suscriptora..."));
    // Al reconectar el cliente se vuelve a suscribir solo, pero los eventos publicados mientras estuvo
    // desconectado NO se recuperan: Pub/Sub no guarda mensajes.
    suscriptora.on("ready", () =>
      registrador.info("Conexión suscriptora lista (los eventos publicados mientras estuvo caída no se reenvían)"),
    );
    await suscriptora.connect();

    const suscriptor = crearSuscriptor({
      conexion: suscriptora,
      manejar: opciones.manejar(registrador),
      registrador,
    });
    await suscriptor.iniciar();

    // Cierre ordenado: primero se deja de escuchar, despues se termina lo que ya llego y recien entonces
    // se cierran las conexiones. Asi un evento a medias no queda sin proyectar.
    let cerrando = false;
    const cerrar = (senal: string): void => {
      if (cerrando) return;
      cerrando = true;
      registrador.info(`${senal} recibida: dejando de escuchar y terminando lo pendiente`);
      setTimeout(() => process.exit(1), 10_000).unref(); // si algo se cuelga, no esperar para siempre
      void suscriptora
        .unsubscribe()
        .then(() => suscriptor.esperarPendientes())
        .catch((error: unknown) => registrador.error(`No se pudo cerrar limpiamente: ${describirError(error)}`))
        .then(() => cerrarTodo())
        .then(() => process.exit(0));
    };
    process.on("SIGTERM", () => cerrar("SIGTERM"));
    process.on("SIGINT", () => cerrar("SIGINT"));
  } catch (error) {
    logger.error(`No se pudo iniciar ${opciones.nombre}: ${describirError(error)}`);
    await cerrarTodo();
    process.exit(1);
  }
}
