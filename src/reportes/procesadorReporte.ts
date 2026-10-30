import type { NuevoRegistroAuditoria } from "../modelos/auditoria.ts";
import type { DatosReporte, ReporteValoracion } from "../modelos/reporte.ts";
import type { Registrador } from "../pipeline/pipeline.ts";

/** Lo que el procesador usa de un trabajo de la cola (BullMQ le pasa uno con mas cosas). */
export type TrabajoEnProceso = {
  data: DatosReporte;
  /** Intentos anteriores que fallaron: 0 la primera vez. */
  attemptsMade: number;
  updateProgress: (porcentaje: number) => Promise<void>;
};

/**
 * Lo que hace el worker con cada trabajo: genera el reporte, informa el progreso a la cola y,
 * al terminar, deja constancia en la auditoria de MongoDB. Devuelve el reporte: la cola lo
 * guarda como resultado del trabajo y es lo que ve `GET /api/reportes/:id`.
 *
 * Es una FABRICA para probarla sin cola, sin bases y sin esperar.
 *
 * Diferencia con la auditoria del CRUD: ACA un fallo al registrar HACE FALLAR el trabajo. En
 * el CRUD la auditoria es de mejor esfuerzo porque la operacion ya ocurrio y no se puede
 * deshacer; un reporte, en cambio, se puede volver a generar, y la cola ya reintenta. Es
 * mejor reintentar que dar por bueno un reporte sin constancia.
 */
export function crearProcesadorReporte(dependencias: {
  generar: (reportarProgreso: (porcentaje: number) => Promise<void>) => Promise<ReporteValoracion>;
  registrarAuditoria: (registro: NuevoRegistroAuditoria) => Promise<void>;
  registrador: Registrador;
  ahora: () => Date;
}) {
  const { generar, registrarAuditoria, registrador, ahora } = dependencias;

  return async function procesar(trabajo: TrabajoEnProceso): Promise<ReporteValoracion> {
    const { idReporte, solicitadoEn } = trabajo.data;
    const intento = trabajo.attemptsMade + 1;
    const inicio = ahora().getTime();
    registrador.info(`Generando el reporte ${idReporte} (intento ${intento})`);

    const reporte = await generar((porcentaje) => trabajo.updateProgress(porcentaje));

    await registrarAuditoria({
      operacion: "GENERAR_REPORTE",
      entidad: "Reporte",
      entidadId: idReporte,
      // El reporte completo queda en la cola; en la auditoria va lo que identifica el resultado.
      despues: { resumen: reporte.resumen, sinPrecio: reporte.sinPrecio },
      metadatos: { origen: "worker", intento, solicitadoEn, duracionMs: ahora().getTime() - inicio },
    });
    return reporte;
  };
}
