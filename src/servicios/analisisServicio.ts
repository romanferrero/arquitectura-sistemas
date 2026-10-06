import { env } from "../config/env.ts";
import { registradorDe } from "../config/logger.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";
import { crearPipelineAnalisis } from "../pipeline/analisis/pipelineAnalisis.ts";
import type { ResultadoAnalisis } from "../pipeline/analisis/tipos.ts";

/**
 * Analisis de un lote de activos. No toca el repositorio: el lote viene en el
 * body y el resultado se devuelve sin guardarse.
 */

// Depuracion, analisis de riesgo y formato. Aca se le conectan el logger y los
// umbrales de la configuracion.
const pipelineAnalisis = crearPipelineAnalisis({
  registradorDe,
  umbrales: { montoUsd: env.UMBRAL_MONTO_USD, volatilidad: env.UMBRAL_VOLATILIDAD },
});

export async function analizarActivos(cuerpo: unknown): Promise<ResultadoAnalisis> {
  if (!Array.isArray(cuerpo)) {
    throw new ErrorApi(400, "El cuerpo debe ser un array de activos");
  }
  return await pipelineAnalisis.ejecutar(cuerpo);
}
