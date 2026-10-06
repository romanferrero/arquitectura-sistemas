import type { Filtro } from "../pipeline.ts";
import type { ActivoAnalizable, ActivoEvaluado, LoteDepurado, LoteEvaluado, MotivoRiesgo } from "./tipos.ts";

export type UmbralesRiesgo = {
  /** Monto en USD a partir del cual se dispara la Whale Alert. */
  montoUsd: number;
  /** Volatilidad (en %) a partir de la cual el activo es de alto riesgo. */
  volatilidad: number;
};

/**
 * Segundo filtro del analisis: marca como `high_risk` los activos de riesgo.
 *
 * Un activo es high_risk si se cumple ALGUNO de estos motivos:
 *  - whale_alert:     su monto (cantidad x precioCompra) SUPERA el umbral de monto.
 *  - alta_volatilidad: su volatilidad informada SUPERA el umbral de volatilidad.
 *
 * "Supera" es estrictamente mayor: un monto igual al umbral no dispara la alerta.
 * Si el activo no informa volatilidad, solo se evalua el monto.
 *
 * Es una FABRICA porque necesita los umbrales: la aplicacion le pasa los de la
 * configuracion y los tests, los que quieran.
 */
export function crearFiltroAnalisisRiesgo(umbrales: UmbralesRiesgo): Filtro<LoteDepurado, LoteEvaluado> {
  return {
    nombre: "FiltroAnalisisRiesgo",
    ejecutar(entrada, registrador) {
      const activos = entrada.activos.map((activo) => {
        const evaluado = evaluar(activo, umbrales);
        if (evaluado.riesgo === "high_risk") {
          registrador.info(
            `${evaluado.simbolo} marcado como high_risk (${evaluado.motivosRiesgo.join(", ")})`,
          );
        }
        return evaluado;
      });

      const altoRiesgo = activos.filter((activo) => activo.riesgo === "high_risk").length;
      registrador.info(`${altoRiesgo} de ${activos.length} activos marcados como high_risk`);
      return { recibidos: entrada.recibidos, activos };
    },
  };
}

function evaluar(activo: ActivoAnalizable, umbrales: UmbralesRiesgo): ActivoEvaluado {
  const monto = activo.cantidad * activo.precioCompra;
  const motivosRiesgo: MotivoRiesgo[] = [];

  if (monto > umbrales.montoUsd) motivosRiesgo.push("whale_alert");
  if (activo.volatilidad !== undefined && activo.volatilidad > umbrales.volatilidad) {
    motivosRiesgo.push("alta_volatilidad");
  }

  return {
    ...activo,
    monto,
    riesgo: motivosRiesgo.length > 0 ? "high_risk" : "normal",
    motivosRiesgo,
  };
}
