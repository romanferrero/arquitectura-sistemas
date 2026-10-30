import type { Activo } from "../modelos/activo.ts";
import type { PosicionValuada, ReporteValoracion } from "../modelos/reporte.ts";
import { redondear } from "../utilidades/redondear.ts";

/** Todo lo que el generador necesita de afuera: asi se prueba sin bases, sin red y sin esperar. */
export type DependenciasReporte = {
  listarActivos: () => Promise<Activo[]>;
  /** Cotizaciones de varios simbolos en una llamada; lanza si el tercero falla. */
  obtenerPrecios: (simbolos: string[]) => Promise<Map<string, number>>;
  /** Informa el avance (0 a 100) al trabajo de la cola. */
  reportarProgreso: (porcentaje: number) => Promise<void>;
  esperar: (milisegundos: number) => Promise<void>;
  /** Demora total simulada del "calculo complejo". */
  demoraMs: number;
  moneda: string;
  ahora: () => Date;
};

/** El calculo simulado se reparte en estos pasos, cada uno con su aviso de progreso. */
const PASOS_DE_CALCULO = 4;

/**
 * Genera el Reporte de Valoracion Masiva: lee todo el portafolio, lo cotiza con UNA sola
 * llamada y calcula el rendimiento de cada posicion y el total.
 *
 * Es la tarea "pesada" que se saca del ciclo de la peticion: la demora es simulada
 * (`demoraMs`) para que se vea la cola trabajando y el progreso avanzando.
 *
 * Los simbolos sin cotizacion NO hacen fallar el reporte: se listan en `sinPrecio` y quedan
 * fuera de los totales. En cambio, si la API de precios falla, el error sigue de largo: el
 * trabajo falla y la cola lo reintenta.
 */
export async function generarReporte(dependencias: DependenciasReporte): Promise<ReporteValoracion> {
  const { listarActivos, obtenerPrecios, reportarProgreso, esperar, demoraMs, moneda, ahora } = dependencias;

  const activos = await listarActivos();
  await reportarProgreso(10);

  const precios = await obtenerPrecios(activos.map((activo) => activo.simbolo));
  await reportarProgreso(40);

  for (let paso = 1; paso <= PASOS_DE_CALCULO; paso += 1) {
    await esperar(demoraMs / PASOS_DE_CALCULO);
    await reportarProgreso(40 + Math.round((paso / PASOS_DE_CALCULO) * 50));
  }

  const posiciones: PosicionValuada[] = [];
  const sinPrecio: string[] = [];
  for (const activo of activos) {
    const precioActual = precios.get(activo.simbolo);
    if (precioActual === undefined) {
      sinPrecio.push(activo.simbolo);
      continue;
    }
    const costo = activo.cantidad * activo.precioCompra;
    const valorActual = activo.cantidad * precioActual;
    posiciones.push({
      simbolo: activo.simbolo,
      nombre: activo.nombre,
      cantidad: activo.cantidad,
      precioCompra: activo.precioCompra,
      precioActual,
      costo: redondear(costo),
      valorActual: redondear(valorActual),
      gananciaPerdida: redondear(valorActual - costo),
      variacionPorcentual: variacion(valorActual, costo),
    });
  }

  // Los totales se suman con los valores SIN redondear y se redondean una sola vez al final.
  const costoTotal = posiciones.reduce((suma, posicion) => suma + posicion.cantidad * posicion.precioCompra, 0);
  const valorTotal = posiciones.reduce((suma, posicion) => suma + posicion.cantidad * posicion.precioActual, 0);

  await reportarProgreso(100);
  return {
    generadoEn: ahora().toISOString(),
    moneda,
    resumen: {
      activos: activos.length,
      valuados: posiciones.length,
      sinPrecio: sinPrecio.length,
      costoTotal: redondear(costoTotal),
      valorActual: redondear(valorTotal),
      gananciaPerdida: redondear(valorTotal - costoTotal),
      variacionPorcentual: variacion(valorTotal, costoTotal),
    },
    posiciones,
    sinPrecio,
  };
}

/** Variacion porcentual del valor respecto del costo; 0 si no hay costo (portafolio vacio). */
function variacion(valor: number, costo: number): number {
  return costo === 0 ? 0 : redondear(((valor - costo) / costo) * 100);
}
