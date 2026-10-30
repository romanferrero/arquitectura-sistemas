import { describirError } from "../datos/describirError.ts";
import type { Registrador } from "../pipeline/pipeline.ts";

/** Lo que los manejadores miran de un trabajo (BullMQ les pasa uno con mas cosas). */
type TrabajoTerminado = {
  id?: string | undefined;
  attemptsMade: number;
  opts: { attempts?: number | undefined };
};

/**
 * Manejadores de los eventos del worker de BullMQ: `completed` y `failed`. Su unico trabajo
 * es la OBSERVABILIDAD: dejar en el log (Winston) como terminaron las tareas asincronas, que
 * de otro modo ocurrirían sin que nadie las vea, y contar los exitos.
 *
 * `contarExito` es un contador atomico en Redis (INCR): lo comparten todos los procesos.
 * Si contar falla, solo se loguea: el reporte ya se genero y no hay que dar por fallido el trabajo.
 */
export function crearManejadoresEventos(dependencias: {
  registrador: Registrador;
  contarExito: () => Promise<number>;
}) {
  const { registrador, contarExito } = dependencias;

  return {
    /** Evento `completed`. */
    async alCompletar(trabajo: TrabajoTerminado): Promise<void> {
      try {
        const total = await contarExito();
        registrador.info(`Reporte ${String(trabajo.id)} completado (reportes exitosos hasta ahora: ${total})`);
      } catch (error) {
        registrador.info(`Reporte ${String(trabajo.id)} completado`);
        registrador.error(`No se pudo contar el reporte exitoso: ${describirError(error)}`);
      }
    },

    /** Evento `failed`: se dispara en CADA intento fallido, no solo en el ultimo. */
    alFallar(trabajo: TrabajoTerminado | undefined, error: Error): void {
      const maximo = trabajo?.opts.attempts ?? 1;
      const hechos = trabajo?.attemptsMade ?? maximo;
      const identificador = String(trabajo?.id);
      if (hechos >= maximo) {
        registrador.error(`Reporte ${identificador} falló definitivamente tras ${hechos} intento(s): ${error.message}`);
      } else {
        registrador.error(`Reporte ${identificador} falló (intento ${hechos} de ${maximo}), se reintenta: ${error.message}`);
      }
    },
  };
}
