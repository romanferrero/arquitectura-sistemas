import { describe, expect, test } from "@jest/globals";
import { crearPipelineAnalisis } from "../../../src/pipeline/analisis/pipelineAnalisis.ts";
import { crearRegistroEnMemoria } from "../../ayudas/registro.ts";

/** Pipeline real de analisis, con logger en memoria, umbrales chicos y reloj e id fijos. */
function armarPipeline() {
  const { lineas, registradorDe } = crearRegistroEnMemoria();
  const pipeline = crearPipelineAnalisis({
    registradorDe,
    umbrales: { montoUsd: 100_000, volatilidad: 80 },
    ahora: () => new Date("2026-10-06T12:00:00.000Z"),
    generarId: () => "analisis-1",
  });
  return { pipeline, lineas };
}

describe("Pipeline de análisis", () => {
  test("tiene los tres filtros en el orden depuración → riesgo → formato", () => {
    const { pipeline } = armarPipeline();

    expect(pipeline.pasos).toEqual(["FiltroDepuracion", "FiltroAnalisisRiesgo", "FiltroFormato"]);
  });

  test("procesa un lote mixto: descarta, marca el riesgo y redondea", async () => {
    const { pipeline } = armarPipeline();

    const resultado = await pipeline.ejecutar([
      { simbolo: "BTC", nombre: "Bitcoin", cantidad: 10, precioCompra: 50000.456 }, // 500004.56 -> whale
      { simbolo: "ETH", nombre: "Ethereum", cantidad: 3, precioCompra: 2000 }, // normal
      { simbolo: "SOL", cantidad: 1, precioCompra: 100, volatilidad: 90 }, // volatil
      { simbolo: "ADA", cantidad: 0, precioCompra: 1 }, // monto en cero: se descarta
      null, // no es un activo: se descarta
    ]);

    expect(resultado.resumen).toEqual({ recibidos: 5, descartados: 2, analizados: 3, altoRiesgo: 2 });
    expect(resultado.activos.map((a) => [a.simbolo, a.riesgo, a.motivosRiesgo])).toEqual([
      ["BTC", "high_risk", ["whale_alert"]],
      ["ETH", "normal", []],
      ["SOL", "high_risk", ["alta_volatilidad"]],
    ]);
    expect(resultado.activos[0]).toMatchObject({ precioCompra: 50000.46, monto: 500004.56 });
    expect(resultado.auditoria).toEqual({
      idAnalisis: "analisis-1",
      analizadoEn: "2026-10-06T12:00:00.000Z",
      filtrosAplicados: ["FiltroDepuracion", "FiltroAnalisisRiesgo", "FiltroFormato"],
    });
  });

  test("el riesgo se evalúa con el monto exacto, antes de redondear", async () => {
    const { pipeline } = armarPipeline();

    // 100000.004 supera el umbral; redondeado a dos decimales seria 100000 y no lo superaria.
    const resultado = await pipeline.ejecutar([{ simbolo: "BTC", cantidad: 1, precioCompra: 100000.004 }]);

    expect(resultado.activos[0]).toMatchObject({ monto: 100000, riesgo: "high_risk" });
  });

  test("un array vacío da un reporte vacío", async () => {
    const { pipeline } = armarPipeline();

    const resultado = await pipeline.ejecutar([]);

    expect(resultado.activos).toEqual([]);
    expect(resultado.resumen).toEqual({ recibidos: 0, descartados: 0, analizados: 0, altoRiesgo: 0 });
  });

  test("ejecuta y registra los filtros en el orden correcto", async () => {
    const { pipeline, lineas } = armarPipeline();

    await pipeline.ejecutar([
      { simbolo: "BTC", cantidad: 100, precioCompra: 50000 },
      { simbolo: "ETH", cantidad: -1, precioCompra: 2000 },
    ]);

    expect(lineas).toEqual([
      "[INFO] FiltroDepuracion: Descartado el elemento 1: cantidad debe ser mayor a 0",
      "[INFO] FiltroDepuracion: 1 de 2 activos conservados",
      "[INFO] Pipeline analisis: FiltroDepuracion ejecutado con éxito",
      "[INFO] FiltroAnalisisRiesgo: BTC marcado como high_risk (whale_alert)",
      "[INFO] FiltroAnalisisRiesgo: 1 de 1 activos marcados como high_risk",
      "[INFO] Pipeline analisis: FiltroAnalisisRiesgo ejecutado con éxito",
      "[INFO] FiltroFormato: Valores redondeados a 2 decimales y auditoría analisis-1 agregada",
      "[INFO] Pipeline analisis: FiltroFormato ejecutado con éxito",
    ]);
  });
});
