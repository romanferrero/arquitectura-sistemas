import { randomUUID } from "node:crypto";
import { Pipeline } from "../pipeline.ts";
import type { FabricaRegistrador } from "../pipeline.ts";
import { crearFiltroAnalisisRiesgo } from "./filtroAnalisisRiesgo.ts";
import type { UmbralesRiesgo } from "./filtroAnalisisRiesgo.ts";
import { filtroDepuracion } from "./filtroDepuracion.ts";
import { crearFiltroFormato } from "./filtroFormato.ts";

/**
 * Pipeline de analisis: recibe un lote de activos y devuelve el reporte.
 *
 *   lote --> Depuracion --> AnalisisRiesgo --> Formato --> reporte
 *
 * El orden importa: se depura primero para no evaluar riesgo sobre montos
 * invalidos, y se formatea al final para que el redondeo no altere las
 * comparaciones contra los umbrales.
 *
 * Todo lo externo entra por parametro (logger, umbrales, reloj, generador de
 * ids); los dos ultimos tienen un valor por defecto para el uso normal.
 */
export function crearPipelineAnalisis(dependencias: {
  registradorDe: FabricaRegistrador;
  umbrales: UmbralesRiesgo;
  ahora?: () => Date;
  generarId?: () => string;
}) {
  const analisisRiesgo = crearFiltroAnalisisRiesgo(dependencias.umbrales);
  const formato = crearFiltroFormato({
    filtrosPrevios: [filtroDepuracion.nombre, analisisRiesgo.nombre],
    ahora: dependencias.ahora ?? (() => new Date()),
    generarId: dependencias.generarId ?? randomUUID,
  });

  return Pipeline.crear<unknown[]>("analisis", dependencias.registradorDe)
    .agregar(filtroDepuracion)
    .agregar(analisisRiesgo)
    .agregar(formato);
}
