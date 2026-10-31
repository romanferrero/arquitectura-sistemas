import { describirError } from "../datos/describirError.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";
import type { DatosReporte, EstadoReporte, ReporteValoracion, SeguimientoReporte } from "../modelos/reporte.ts";
import type { Registrador } from "../pipeline/pipeline.ts";
import { esIdDeReporte } from "../reportes/estadoReporte.ts";
import { conTiempoMaximo } from "../utilidades/conTiempoMaximo.ts";

/** Un trabajo de la cola, ya traducido a lo que el servicio necesita saber. */
export type TrabajoReporte = {
  estado: EstadoReporte;
  progreso: number;
  datos: DatosReporte;
  intentos: number;
  resultado?: ReporteValoracion;
  motivo?: string;
};

/** Lo que el servicio necesita de la cola; en la aplicacion es BullMQ (ver colaReportes.ts). */
export type ColaDeReportes = {
  agregar: (datos: DatosReporte) => Promise<void>;
  buscar: (idReporte: string) => Promise<TrabajoReporte | undefined>;
};

/**
 * PRODUCTOR de la cola de reportes: lo que usa la API. No genera nada: solo deja el pedido
 * en la cola (`solicitar`) y deja ver como va (`consultar`). Quien hace el trabajo es el
 * worker, en otro proceso.
 *
 * Es una FABRICA para probarla con una cola falsa. Lo cablea reportesServicio.ts.
 *
 * Si Redis no responde, ambas operaciones dan 503: sin la cola no hay donde dejar el pedido
 * ni donde mirar su estado, y devolver un 202 que no se va a cumplir seria mentirle al cliente.
 *
 * Limite conocido: si Redis responde LENTO (mas de `tiempoMaximoMs`), se da 503 pero el pedido
 * puede terminar encolandose igual, y el cliente que reintente generaria dos reportes. Con
 * Redis caido no pasa: la cola falla en el acto.
 */
export function crearServicioReportes(dependencias: {
  cola: ColaDeReportes;
  registrador: Registrador;
  tiempoMaximoMs: number;
  generarId: () => string;
  ahora: () => Date;
}) {
  const { cola, registrador, tiempoMaximoMs, generarId, ahora } = dependencias;

  async function conCola<T>(operacion: () => Promise<T>): Promise<T> {
    try {
      return await conTiempoMaximo(operacion, tiempoMaximoMs, `Redis no respondió en ${tiempoMaximoMs} ms`);
    } catch (error) {
      registrador.error(`No se pudo usar la cola de reportes: ${describirError(error)}`);
      throw new ErrorApi(503, "La cola de reportes no está disponible en este momento");
    }
  }

  return {
    /** Deja el pedido en la cola y responde enseguida: el reporte se genera aparte. */
    async solicitar(usuario: string): Promise<{ idReporte: string; estado: "en_cola" }> {
      const datos: DatosReporte = { idReporte: generarId(), solicitadoEn: ahora().toISOString(), solicitadoPor: usuario };
      await conCola(() => cola.agregar(datos));
      registrador.info(`Reporte ${datos.idReporte} encolado`);
      return { idReporte: datos.idReporte, estado: "en_cola" };
    },

    /** Como va un reporte: 404 si no existe (o ya se borro por antiguo). */
    async consultar(idReporte: string): Promise<SeguimientoReporte> {
      // Un id que no es un UUID no puede ser un reporte: ni se le pregunta a Redis.
      const trabajo = esIdDeReporte(idReporte) ? await conCola(() => cola.buscar(idReporte)) : undefined;
      if (trabajo === undefined) throw new ErrorApi(404, `No existe un reporte con id ${idReporte}`);

      const seguimiento: SeguimientoReporte = {
        idReporte,
        estado: trabajo.estado,
        progreso: trabajo.estado === "completado" ? 100 : trabajo.progreso,
        solicitadoEn: trabajo.datos.solicitadoEn,
        solicitadoPor: trabajo.datos.solicitadoPor,
        intentos: trabajo.intentos,
      };
      if (trabajo.resultado !== undefined) seguimiento.resultado = trabajo.resultado;
      if (trabajo.estado === "fallido" && trabajo.motivo !== undefined) seguimiento.motivo = trabajo.motivo;
      return seguimiento;
    },
  };
}
