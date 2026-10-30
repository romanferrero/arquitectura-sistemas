import { Worker } from "bullmq";
import { env, mongoUri, redisConfig, reporteDemoraMs } from "../config/env.ts";
import { logger, registradorDe } from "../config/logger.ts";
import { listar } from "../datos/activosRepositorio.ts";
import { registrar } from "../datos/auditoriaRepositorio.ts";
import { cerrarConexiones, conectarMongo, conectarMysql } from "../datos/conexiones.ts";
import { describirError } from "../datos/describirError.ts";
import { cerrarRedis, conectarRedis, redis } from "../datos/redis.ts";
import type { DatosReporte, ReporteValoracion } from "../modelos/reporte.ts";
import { crearManejadoresEventos } from "../reportes/eventosWorker.ts";
import { NOMBRE_COLA_REPORTES } from "../reportes/estadoReporte.ts";
import { generarReporte } from "../reportes/generarReporte.ts";
import { crearProcesadorReporte } from "../reportes/procesadorReporte.ts";
import { obtenerPrecios } from "../servicios/preciosServicio.ts";
import { CLAVE_REPORTES_EXITOSOS } from "../servicios/crearServicioEstadisticas.ts";

/**
 * WORKER de la cola `cola-reportes`: un proceso APARTE de la API (misma imagen, otro comando).
 * Toma los pedidos que la API dejo en la cola, genera el reporte y registra el resultado en la
 * auditoria de MongoDB. La API responde 202 al instante y este proceso hace el trabajo pesado.
 *
 *   npm run worker                      (en local)
 *   node dist/procesos/workerReportes.js  (en Docker, ver docker-compose.yml)
 *
 * Es un proceso separado a proposito: se puede escalar, reiniciar o detener sin tocar la API, y
 * (Parte 8) si la API corre en cluster no se multiplican los workers sin querer.
 *
 * Como la API, si no llega a alguna base no arranca. Las migraciones las aplica la API: el
 * worker solo se conecta (en Docker espera a que la API este sana).
 */
const registrador = registradorDe("WorkerReportes");

async function arrancar(): Promise<void> {
  mongoUri(); // valida la configuracion antes de abrir nada (fail fast)
  const demoraMs = reporteDemoraMs();
  const conexion = redisConfig();

  await conectarMysql();
  await conectarMongo();
  await conectarRedis(); // cliente oficial: lo usa el contador de reportes exitosos
  registrador.info("Conectado a MySQL, MongoDB y Redis");

  const procesar = crearProcesadorReporte({
    generar: (reportarProgreso) =>
      generarReporte({
        listarActivos: () => listar(),
        obtenerPrecios,
        reportarProgreso,
        esperar: (milisegundos) => new Promise((resolver) => setTimeout(resolver, milisegundos)),
        demoraMs,
        moneda: env.MONEDA.toUpperCase(),
        ahora: () => new Date(),
      }),
    registrarAuditoria: registrar,
    registrador,
    ahora: () => new Date(),
  });

  const eventos = crearManejadoresEventos({
    registrador,
    contarExito: () => redis.incr(CLAVE_REPORTES_EXITOSOS), // INCR: contador atomico compartido
  });

  // BullMQ abre sus propias conexiones (ioredis); el worker se reconecta solo si Redis se cae.
  // `concurrency: 1`: un reporte a la vez por proceso; para mas paralelismo se suman procesos.
  const worker = new Worker<DatosReporte, ReporteValoracion>(NOMBRE_COLA_REPORTES, procesar, {
    connection: { host: conexion.host, port: conexion.puerto, password: conexion.password },
    concurrency: 1,
  });

  // Eventos de la letra: .on('completed') y .on('failed') escriben en Winston.
  worker.on("completed", (trabajo) => void eventos.alCompletar(trabajo));
  worker.on("failed", (trabajo, error) => eventos.alFallar(trabajo, error));
  worker.on("error", (error) => registrador.error(`Error del worker: ${describirError(error)}`));

  registrador.info(`Escuchando la cola ${NOMBRE_COLA_REPORTES} (demora simulada: ${demoraMs} ms por reporte)`);

  // Cierre ordenado: `worker.close()` NO corta el trabajo en curso, espera a que termine; recien
  // despues se cierran las conexiones. Asi un reporte a medias no se pierde ni queda trabado.
  let cerrando = false;
  const cerrar = (senal: string): void => {
    if (cerrando) return;
    cerrando = true;
    registrador.info(`${senal} recibida: terminando el trabajo en curso y cerrando`);
    setTimeout(() => process.exit(1), 30_000).unref(); // si algo se cuelga, no esperar para siempre
    void worker
      .close()
      .then(() => Promise.allSettled([cerrarConexiones(), cerrarRedis()]))
      .then(() => process.exit(0));
  };
  process.on("SIGTERM", () => cerrar("SIGTERM"));
  process.on("SIGINT", () => cerrar("SIGINT"));
}

arrancar().catch(async (error: unknown) => {
  logger.error(`No se pudo iniciar el worker de reportes: ${describirError(error)}`);
  await Promise.allSettled([cerrarConexiones(), cerrarRedis()]);
  process.exit(1);
});
