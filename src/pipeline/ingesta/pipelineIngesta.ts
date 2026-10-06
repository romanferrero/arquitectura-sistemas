import type { ObtenerTasa } from "../../servicios/tasasServicio.ts";
import { Pipeline } from "../pipeline.ts";
import type { FabricaRegistrador } from "../pipeline.ts";
import { crearFiltroConversionMoneda } from "./filtroConversionMoneda.ts";
import { filtroNormalizacion } from "./filtroNormalizacion.ts";
import { filtroValidacion } from "./filtroValidacion.ts";

/**
 * Pipeline de ingesta: todo activo nuevo (POST) o reemplazado (PUT) pasa por
 * aca antes de guardarse.
 *
 *   body --> Validacion --> Normalizacion --> ConversionMoneda --> datos listos
 *
 * El orden importa: no tiene sentido normalizar algo que no es valido, ni
 * consultar una tasa para una moneda que todavia no se limpio.
 *
 * Recibe el logger y la tasa por parametro (no los importa) para que los tests
 * armen un pipeline identico al real pero sin red ni variables de entorno.
 */
export function crearPipelineIngesta(dependencias: {
  registradorDe: FabricaRegistrador;
  obtenerTasa: ObtenerTasa;
}) {
  return Pipeline.crear<unknown>("ingesta", dependencias.registradorDe)
    .agregar(filtroValidacion)
    .agregar(filtroNormalizacion)
    .agregar(crearFiltroConversionMoneda({ obtenerTasa: dependencias.obtenerTasa }));
}
