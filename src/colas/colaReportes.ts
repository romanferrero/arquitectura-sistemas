import { Queue } from "bullmq";
import type { Job } from "bullmq";
import { redisConfig } from "../config/env.ts";
import { registradorDe } from "../config/logger.ts";
import { describirError } from "../datos/describirError.ts";
import type { DatosReporte, ReporteValoracion } from "../modelos/reporte.ts";
import {
  NOMBRE_COLA_REPORTES,
  NOMBRE_TRABAJO_VALORACION,
  OPCIONES_TRABAJO_REPORTE,
  estadoDeCola,
} from "../reportes/estadoReporte.ts";
import type { ColaDeReportes, TrabajoReporte } from "../servicios/crearServicioReportes.ts";

/**
 * La cola `cola-reportes` vista desde la API (el PRODUCTOR): solo agrega trabajos y los consulta.
 *
 * BullMQ abre sus propias conexiones a Redis con `ioredis` (es lo que trae y lo mas probado),
 * separadas del cliente oficial `redis` que usan la cache y las preferencias. Ambos hablan con
 * el mismo Redis. Con el cliente oficial tambien se puede (BullMQ 6 trae un adaptador), pero en
 * las pruebas una caida de Redis hacia caer el proceso y la recuperacion no fue limpia.
 *
 * `enableOfflineQueue: false`: con Redis caido `add` falla en el acto (1 ms en las pruebas)
 * en vez de quedar esperando, y la API puede responder 503 sin demorar.
 */
const registrador = registradorDe("ColaReportes");
const { host, puerto, password } = redisConfig();

export const colaReportes = new Queue<DatosReporte>(NOMBRE_COLA_REPORTES, {
  connection: { host, port: puerto, password, enableOfflineQueue: false },
  defaultJobOptions: OPCIONES_TRABAJO_REPORTE,
});

// Sin este oyente un error de conexion tumbaria el proceso (igual que en el cliente de Redis).
colaReportes.on("error", (error) => registrador.error(`Error de la cola: ${describirError(error)}`));

/** El trabajo de BullMQ traducido a lo que necesita el servicio. */
async function aTrabajo(trabajo: Job<DatosReporte>): Promise<TrabajoReporte> {
  const estado = estadoDeCola(await trabajo.getState());
  const resultado: TrabajoReporte = {
    estado,
    progreso: typeof trabajo.progress === "number" ? trabajo.progress : 0,
    datos: trabajo.data,
    intentos: trabajo.attemptsStarted,
  };
  if (trabajo.returnvalue !== undefined && trabajo.returnvalue !== null) {
    resultado.resultado = trabajo.returnvalue as ReporteValoracion;
  }
  if (trabajo.failedReason) resultado.motivo = trabajo.failedReason;
  return resultado;
}

/** Lo que usa crearServicioReportes: agregar un pedido y buscarlo despues por su id. */
export const adaptadorColaReportes: ColaDeReportes = {
  async agregar(datos) {
    // El id del trabajo es el del reporte: asi se lo encuentra despues sin guardar nada mas.
    await colaReportes.add(NOMBRE_TRABAJO_VALORACION, datos, { jobId: datos.idReporte });
  },
  async buscar(idReporte) {
    const trabajo = await colaReportes.getJob(idReporte);
    return trabajo === undefined ? undefined : await aTrabajo(trabajo);
  },
};

/** Cierra las conexiones de la cola; si ya estaba cerrada no hace nada. */
export async function cerrarColaReportes(): Promise<void> {
  await colaReportes.close();
}
