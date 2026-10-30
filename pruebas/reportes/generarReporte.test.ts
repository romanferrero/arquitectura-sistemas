import { describe, expect, test } from "@jest/globals";
import type { Activo } from "../../src/modelos/activo.ts";
import { generarReporte } from "../../src/reportes/generarReporte.ts";
import type { DependenciasReporte } from "../../src/reportes/generarReporte.ts";

function activo(simbolo: string, cantidad: number, precioCompra: number): Activo {
  return {
    id: `id-${simbolo}`,
    simbolo,
    nombre: simbolo,
    cantidad,
    precioCompra,
    creadoEn: "2026-10-01T10:00:00.000Z",
    actualizadoEn: "2026-10-01T10:00:00.000Z",
  };
}

/** Dependencias falsas: sin base, sin red y sin esperar de verdad. */
function armar(activos: Activo[], precios: Record<string, number>, cambios: Partial<DependenciasReporte> = {}) {
  const progreso: number[] = [];
  const esperas: number[] = [];
  const pedidos: string[][] = [];
  const dependencias: DependenciasReporte = {
    listarActivos: async () => activos,
    obtenerPrecios: async (simbolos) => {
      pedidos.push(simbolos);
      return new Map(Object.entries(precios).filter(([simbolo]) => simbolos.includes(simbolo)));
    },
    reportarProgreso: async (porcentaje) => void progreso.push(porcentaje),
    esperar: async (milisegundos) => void esperas.push(milisegundos),
    demoraMs: 4_000,
    moneda: "USD",
    ahora: () => new Date("2026-10-30T12:00:00.000Z"),
    ...cambios,
  };
  return { dependencias, progreso, esperas, pedidos };
}

describe("generarReporte", () => {
  test("valúa cada posición y suma el total", async () => {
    const { dependencias } = armar([activo("BTC", 2, 30000), activo("ETH", 10, 2000)], { BTC: 33000, ETH: 1800 });

    const reporte = await generarReporte(dependencias);

    expect(reporte.posiciones).toEqual([
      {
        simbolo: "BTC",
        nombre: "BTC",
        cantidad: 2,
        precioCompra: 30000,
        precioActual: 33000,
        costo: 60000,
        valorActual: 66000,
        gananciaPerdida: 6000,
        variacionPorcentual: 10,
      },
      {
        simbolo: "ETH",
        nombre: "ETH",
        cantidad: 10,
        precioCompra: 2000,
        precioActual: 1800,
        costo: 20000,
        valorActual: 18000,
        gananciaPerdida: -2000,
        variacionPorcentual: -10,
      },
    ]);
    expect(reporte.resumen).toEqual({
      activos: 2,
      valuados: 2,
      sinPrecio: 0,
      costoTotal: 80000,
      valorActual: 84000,
      gananciaPerdida: 4000,
      variacionPorcentual: 5,
    });
    expect(reporte.moneda).toBe("USD");
    expect(reporte.generadoEn).toBe("2026-10-30T12:00:00.000Z");
  });

  test("cotiza todos los símbolos en una sola llamada", async () => {
    const { dependencias, pedidos } = armar([activo("BTC", 1, 1), activo("ETH", 1, 1), activo("SOL", 1, 1)], {
      BTC: 1,
      ETH: 1,
      SOL: 1,
    });

    await generarReporte(dependencias);

    expect(pedidos).toEqual([["BTC", "ETH", "SOL"]]);
  });

  test("un símbolo sin cotización va a sinPrecio y no cuenta en los totales", async () => {
    const { dependencias } = armar([activo("BTC", 1, 100), activo("RARO", 5, 50)], { BTC: 110 });

    const reporte = await generarReporte(dependencias);

    expect(reporte.sinPrecio).toEqual(["RARO"]);
    expect(reporte.posiciones.map((posicion) => posicion.simbolo)).toEqual(["BTC"]);
    expect(reporte.resumen).toMatchObject({ activos: 2, valuados: 1, sinPrecio: 1, costoTotal: 100, valorActual: 110 });
  });

  test("si ningún símbolo tiene cotización el reporte sale igual, con los totales en cero", async () => {
    const { dependencias } = armar([activo("RARO", 5, 50)], {});

    const reporte = await generarReporte(dependencias);

    expect(reporte.resumen).toMatchObject({ valuados: 0, sinPrecio: 1, costoTotal: 0, valorActual: 0, variacionPorcentual: 0 });
  });

  test("un portafolio vacío da un reporte vacío, sin dividir por cero", async () => {
    const { dependencias } = armar([], {});

    const reporte = await generarReporte(dependencias);

    expect(reporte.posiciones).toEqual([]);
    expect(reporte.resumen).toEqual({
      activos: 0,
      valuados: 0,
      sinPrecio: 0,
      costoTotal: 0,
      valorActual: 0,
      gananciaPerdida: 0,
      variacionPorcentual: 0,
    });
  });

  test("redondea a dos decimales, sumando los valores sin redondear", async () => {
    // 3 x 0.335 = 1.005 cada una: sumadas dan 2.01 (redondeando antes darian 1.01 + 1.01 = 2.02 o 2.00).
    const { dependencias } = armar([activo("A", 3, 0.335), activo("B", 3, 0.335)], { A: 0.5, B: 0.5 });

    const reporte = await generarReporte(dependencias);

    expect(reporte.resumen.costoTotal).toBe(2.01);
    expect(reporte.resumen.valorActual).toBe(3);
  });

  test("reparte la demora simulada en pasos y avisa el progreso de menor a mayor hasta 100", async () => {
    const { dependencias, progreso, esperas } = armar([activo("BTC", 1, 1)], { BTC: 1 }, { demoraMs: 4_000 });

    await generarReporte(dependencias);

    expect(esperas).toEqual([1_000, 1_000, 1_000, 1_000]);
    expect(progreso).toEqual([10, 40, 53, 65, 78, 90, 100]);
  });

  test("sin demora no espera nada pero igual informa el progreso", async () => {
    const { dependencias, esperas, progreso } = armar([], {}, { demoraMs: 0 });

    await generarReporte(dependencias);

    expect(esperas.every((espera) => espera === 0)).toBe(true);
    expect(progreso.at(-1)).toBe(100);
  });

  test("si la API de precios falla, el error sigue de largo (la cola reintenta) y no avisa el 100%", async () => {
    const { dependencias, progreso } = armar([activo("BTC", 1, 1)], {}, {
      obtenerPrecios: async () => {
        throw new Error("CoinGecko caído");
      },
    });

    await expect(generarReporte(dependencias)).rejects.toThrow("CoinGecko caído");
    expect(progreso).toEqual([10]);
  });
});
