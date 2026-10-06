/**
 * Formas que toma el lote de activos mientras recorre el pipeline de analisis.
 * A diferencia de la ingesta (un activo por vez), aca cada filtro trabaja sobre
 * el LOTE completo, porque el endpoint recibe un array.
 *
 *   unknown[] --Depuracion--> LoteDepurado --AnalisisRiesgo--> LoteEvaluado
 *             --Formato--> ResultadoAnalisis
 *
 * Los montos se interpretan en USD: este endpoint no convierte monedas.
 */

/** Un activo que paso la depuracion: tiene lo minimo para poder analizarse. */
export type ActivoAnalizable = {
  simbolo: string;
  nombre: string | undefined;
  cantidad: number;
  precioCompra: number;
  /** Volatilidad en porcentaje (ej: 45 = 45%). Es opcional. */
  volatilidad: number | undefined;
};

/** El lote depurado recuerda cuantos elementos llegaron, para el resumen. */
export type LoteDepurado = {
  recibidos: number;
  activos: ActivoAnalizable[];
};

export type Riesgo = "high_risk" | "normal";

/** Por que un activo es high_risk. Puede haber mas de un motivo a la vez. */
export type MotivoRiesgo = "whale_alert" | "alta_volatilidad";

export type ActivoEvaluado = ActivoAnalizable & {
  /** cantidad x precioCompra, en USD. */
  monto: number;
  riesgo: Riesgo;
  motivosRiesgo: MotivoRiesgo[];
};

export type LoteEvaluado = {
  recibidos: number;
  activos: ActivoEvaluado[];
};

/** Respuesta final del endpoint. */
export type ResultadoAnalisis = {
  auditoria: {
    idAnalisis: string;
    analizadoEn: string;
    filtrosAplicados: string[];
  };
  resumen: {
    recibidos: number;
    descartados: number;
    analizados: number;
    altoRiesgo: number;
  };
  activos: ActivoEvaluado[];
};
