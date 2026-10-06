import { redondear } from "../../utilidades/redondear.ts";
import type { Filtro } from "../pipeline.ts";
import type { ActivoEvaluado, LoteEvaluado, ResultadoAnalisis } from "./tipos.ts";

/**
 * Tercer filtro del analisis: arma la respuesta final.
 *
 *  - Redondea a dos decimales monto, precioCompra y volatilidad.
 *  - Agrega los metadatos de auditoria: un id de analisis, la fecha y los
 *    filtros que se aplicaron, en orden.
 *  - Calcula el resumen del lote.
 *
 * La cantidad NO se redondea: es la fraccion del activo que se posee, y a dos
 * decimales 0.00345 BTC pasaria a ser 0.
 *
 * Es una FABRICA porque depende de dos cosas que no son deterministicas: el
 * reloj y el generador de ids. Se reciben por parametro para poder fijarlos en
 * los tests. `filtrosPrevios` son los nombres de los filtros que lo anteceden;
 * el propio se agrega solo.
 */
export function crearFiltroFormato(dependencias: {
  filtrosPrevios: string[];
  ahora: () => Date;
  generarId: () => string;
}): Filtro<LoteEvaluado, ResultadoAnalisis> {
  const nombre = "FiltroFormato";

  return {
    nombre,
    ejecutar(entrada, registrador) {
      const idAnalisis = dependencias.generarId();
      const activos = entrada.activos.map(formatear);

      registrador.info(`Valores redondeados a 2 decimales y auditoría ${idAnalisis} agregada`);
      return {
        auditoria: {
          idAnalisis,
          analizadoEn: dependencias.ahora().toISOString(),
          filtrosAplicados: [...dependencias.filtrosPrevios, nombre],
        },
        resumen: {
          recibidos: entrada.recibidos,
          descartados: entrada.recibidos - activos.length,
          analizados: activos.length,
          altoRiesgo: activos.filter((activo) => activo.riesgo === "high_risk").length,
        },
        activos,
      };
    },
  };
}

function formatear(activo: ActivoEvaluado): ActivoEvaluado {
  return {
    ...activo,
    precioCompra: redondear(activo.precioCompra),
    monto: redondear(activo.monto),
    volatilidad: activo.volatilidad === undefined ? undefined : redondear(activo.volatilidad),
  };
}
