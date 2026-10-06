import { describe, expect, test } from "@jest/globals";
import { crearFiltroFormato } from "../../../src/pipeline/analisis/filtroFormato.ts";
import type { ActivoEvaluado, LoteEvaluado } from "../../../src/pipeline/analisis/tipos.ts";
import { crearRegistroEnMemoria, registradorSilencioso } from "../../ayudas/registro.ts";

// Reloj e id fijos: asi la salida es predecible y se puede comparar completa.
const filtro = crearFiltroFormato({
  filtrosPrevios: ["FiltroDepuracion", "FiltroAnalisisRiesgo"],
  ahora: () => new Date("2026-10-06T12:00:00.000Z"),
  generarId: () => "analisis-1",
});

function evaluado(cambio: Partial<ActivoEvaluado> = {}): ActivoEvaluado {
  return {
    simbolo: "BTC",
    nombre: undefined,
    cantidad: 1,
    precioCompra: 100,
    volatilidad: undefined,
    monto: 100,
    riesgo: "normal",
    motivosRiesgo: [],
    ...cambio,
  };
}

function lote(recibidos: number, ...activos: ActivoEvaluado[]): LoteEvaluado {
  return { recibidos, activos };
}

async function formatear(entrada: LoteEvaluado) {
  return await filtro.ejecutar(entrada, registradorSilencioso);
}

describe("FiltroFormato", () => {
  test("redondea monto, precio de compra y volatilidad a dos decimales", async () => {
    const { activos } = await formatear(
      lote(1, evaluado({ precioCompra: 40000.456, monto: 1234.5678, volatilidad: 45.678 })),
    );

    expect(activos[0]).toMatchObject({ precioCompra: 40000.46, monto: 1234.57, volatilidad: 45.68 });
  });

  test("NO redondea la cantidad: es la fracción del activo que se posee", async () => {
    const { activos } = await formatear(lote(1, evaluado({ cantidad: 0.00345 })));

    expect(activos[0]?.cantidad).toBe(0.00345);
  });

  test("si no hay volatilidad, sigue sin haberla", async () => {
    const { activos } = await formatear(lote(1, evaluado()));

    expect(activos[0]?.volatilidad).toBeUndefined();
  });

  test("conserva el riesgo y los motivos ya calculados", async () => {
    const { activos } = await formatear(
      lote(1, evaluado({ riesgo: "high_risk", motivosRiesgo: ["whale_alert"] })),
    );

    expect(activos[0]).toMatchObject({ riesgo: "high_risk", motivosRiesgo: ["whale_alert"] });
  });

  test("agrega los metadatos de auditoría, con el propio filtro al final de la lista", async () => {
    const { auditoria } = await formatear(lote(1, evaluado()));

    expect(auditoria).toEqual({
      idAnalisis: "analisis-1",
      analizadoEn: "2026-10-06T12:00:00.000Z",
      filtrosAplicados: ["FiltroDepuracion", "FiltroAnalisisRiesgo", "FiltroFormato"],
    });
  });

  test("arma el resumen: recibidos, descartados, analizados y alto riesgo", async () => {
    const { resumen } = await formatear(
      lote(
        5,
        evaluado({ simbolo: "BTC", riesgo: "high_risk", motivosRiesgo: ["whale_alert"] }),
        evaluado({ simbolo: "ETH" }),
        evaluado({ simbolo: "SOL" }),
      ),
    );

    expect(resumen).toEqual({ recibidos: 5, descartados: 2, analizados: 3, altoRiesgo: 1 });
  });

  test("un lote vacío da un resumen en cero", async () => {
    const resultado = await formatear(lote(0));

    expect(resultado.activos).toEqual([]);
    expect(resultado.resumen).toEqual({ recibidos: 0, descartados: 0, analizados: 0, altoRiesgo: 0 });
  });

  test("no modifica el lote de entrada", async () => {
    const entrada = lote(1, evaluado({ precioCompra: 40000.456 }));
    const copia = structuredClone(entrada);

    await formatear(entrada);

    expect(entrada).toEqual(copia);
  });

  test("registra el id de la auditoría generada", async () => {
    const { lineas, registradorDe } = crearRegistroEnMemoria();

    await filtro.ejecutar(lote(1, evaluado()), registradorDe(filtro.nombre));

    expect(lineas).toEqual([
      "[INFO] FiltroFormato: Valores redondeados a 2 decimales y auditoría analisis-1 agregada",
    ]);
  });
});
