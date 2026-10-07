import { app } from "./app.ts";
import { env, mongoUri } from "./config/env.ts";
import { logger } from "./config/logger.ts";
import { cerrarConexiones, conectarMongo, conectarMysql } from "./datos/conexiones.ts";
import { describirError } from "./datos/describirError.ts";
import { migrar } from "./datos/migrar.ts";

/**
 * Punto de entrada de la aplicacion. En orden:
 *   1. conecta MySQL,
 *   2. aplica las migraciones pendientes (asi la tabla siempre existe),
 *   3. conecta MongoDB,
 *   4. recien entonces pone la app a escuchar.
 *
 * Si algo de lo anterior falla, la API NO arranca: es mejor cortar con un mensaje
 * claro que levantar y responder 500 a cada pedido.
 *
 * Migrar al arrancar es comodo con una sola instancia. Con varias instancias
 * arrancando a la vez convendria un paso de migracion aparte.
 */
async function arrancar(): Promise<void> {
  mongoUri(); // valida la configuracion de Mongo antes de abrir ninguna conexion (fail fast)
  await conectarMysql();
  logger.info("MySQL conectado");

  const aplicadas = await migrar();
  logger.info(
    aplicadas.length === 0
      ? "Migraciones al día"
      : `Migraciones aplicadas: ${aplicadas.join(", ")}`,
  );

  await conectarMongo();
  logger.info("MongoDB conectado");

  const servidor = app.listen(env.PORT, () => {
    logger.info(`API de portafolio escuchando en http://localhost:${env.PORT}`);
    logger.info(`Entorno: ${env.NODE_ENV} | Moneda: ${env.MONEDA.toUpperCase()}`);
  });

  // Cierre ordenado: deja de aceptar pedidos, espera los que estan en curso y
  // recien despues cierra las conexiones a las bases.
  let cerrando = false;
  const cerrar = (senal: string): void => {
    if (cerrando) return; // una segunda senal no reinicia el cierre que ya esta en curso
    cerrando = true;
    logger.info(`${senal} recibida: cerrando la API`);
    setTimeout(() => process.exit(1), 10_000).unref(); // si algo se cuelga, no esperar para siempre
    servidor.close(() => {
      void cerrarConexiones().then(() => process.exit(0));
    });
    servidor.closeIdleConnections();
  };
  process.on("SIGTERM", () => cerrar("SIGTERM"));
  process.on("SIGINT", () => cerrar("SIGINT"));
}

arrancar().catch(async (error: unknown) => {
  logger.error(`No se pudo iniciar la API: ${describirError(error)}`);
  await cerrarConexiones();
  process.exit(1);
});
