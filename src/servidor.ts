import { app } from "./app.ts";
import { cierreTimeoutMs, env, instancia, migrarAlArrancar, mongoUri } from "./config/env.ts";
import { logger } from "./config/logger.ts";
import { cerrarConexiones, conectarMongo, conectarMysql } from "./datos/conexiones.ts";
import { describirError } from "./datos/describirError.ts";
import { cerrarColaReportes } from "./colas/colaReportes.ts";
import { cerrarRedis, conectarRedis } from "./datos/redis.ts";
import { migrar } from "./datos/migrar.ts";
import { salud } from "./servicios/saludServicio.ts";

/**
 * Punto de entrada de la aplicacion. En orden:
 *   1. conecta MySQL,
 *   2. aplica las migraciones pendientes (solo si MIGRAR_AL_ARRANCAR no es false),
 *   3. conecta MongoDB,
 *   4. conecta Redis,
 *   5. recien entonces pone la app a escuchar y le avisa a PM2 que esta lista.
 *
 * Si algo de lo anterior falla, la API NO arranca: es mejor cortar con un mensaje
 * claro que levantar y responder 500 a cada pedido.
 *
 * Con una sola instancia migrar al arrancar es comodo. En el cluster de PM2 arrancan varias a la vez y no
 * pueden migrar todas: en Docker lo hace el servicio `migraciones` (un paso aparte, que corre una sola vez antes
 * de la API) y la API arranca con MIGRAR_AL_ARRANCAR=false.
 */
async function arrancar(): Promise<void> {
  mongoUri(); // valida la configuracion de Mongo antes de abrir ninguna conexion (fail fast)
  const timeoutCierreMs = cierreTimeoutMs(); // idem: una variable mal escrita corta aca, no al apagar
  await conectarMysql();
  logger.info("MySQL conectado");

  if (migrarAlArrancar()) {
    const aplicadas = await migrar();
    logger.info(
      aplicadas.length === 0
        ? "Migraciones al día"
        : `Migraciones aplicadas: ${aplicadas.join(", ")}`,
    );
  } else {
    logger.info("Migraciones: no se aplican al arrancar (MIGRAR_AL_ARRANCAR=false)");
  }

  await conectarMongo();
  logger.info("MongoDB conectado");

  await conectarRedis();
  logger.info("Redis conectado");

  const servidor = app.listen(env.PORT, () => {
    logger.info(`API de portafolio escuchando en http://localhost:${env.PORT} (instancia ${instancia()}, pid ${process.pid})`);
    logger.info(`Entorno: ${env.NODE_ENV} | Moneda: ${env.MONEDA.toUpperCase()}`);
    // PM2 (wait_ready) espera este mensaje para dar la instancia por levantada. Fuera de PM2 no hay canal.
    process.send?.("ready");
  });

  // Cierre ordenado (PM2 manda SIGINT; Docker, SIGTERM): deja de aceptar pedidos, espera los que estan en curso,
  // cierra la cola de reportes (productor) y las bases, y recien entonces sale. Mientras tanto /salud responde 503.
  let cerrando = false;
  const cerrar = (senal: string, codigoDeSalida = 0): void => {
    if (cerrando) return; // una segunda senal no reinicia el cierre que ya esta en curso
    cerrando = true;
    salud.marcarCerrando();
    logger.info(`${senal} recibida: cerrando la API (hasta ${timeoutCierreMs} ms para los pedidos en curso)`);
    // Si algo se cuelga no se espera para siempre. Tiene que ser menor que el kill_timeout de PM2.
    setTimeout(() => {
      logger.error(`Cierre forzado: pasaron ${timeoutCierreMs} ms y quedaban pedidos sin terminar`);
      servidor.closeAllConnections();
      process.exit(1);
    }, timeoutCierreMs).unref();
    servidor.close(() => {
      void cerrarTodo().then(() => process.exit(codigoDeSalida));
    });
    servidor.closeIdleConnections();
  };
  process.on("SIGTERM", () => cerrar("SIGTERM"));
  process.on("SIGINT", () => cerrar("SIGINT"));

  // Un error que nadie atajo deja al proceso en un estado desconocido: se cierra ordenadamente y se sale con
  // error, para que PM2 lo reinicie limpio (autorestart) en vez de seguir sirviendo a medias.
  process.on("uncaughtException", (error) => {
    logger.error(`Excepción no atrapada: ${describirError(error)}`);
    cerrar("uncaughtException", 1);
  });
  process.on("unhandledRejection", (motivo) => {
    logger.error(`Promesa rechazada sin manejar: ${describirError(motivo)}`);
    cerrar("unhandledRejection", 1);
  });
}

/** Cierra las conexiones (bases, Redis y la cola), aunque alguna falle al cerrarse. */
async function cerrarTodo(): Promise<void> {
  await Promise.allSettled([cerrarConexiones(), cerrarRedis(), cerrarColaReportes()]);
}

arrancar().catch(async (error: unknown) => {
  logger.error(`No se pudo iniciar la API: ${describirError(error)}`);
  await cerrarTodo();
  process.exit(1);
});
