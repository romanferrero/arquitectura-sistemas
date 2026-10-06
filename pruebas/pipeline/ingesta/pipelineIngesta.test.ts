import { describe, expect, test } from "@jest/globals";
import { ErrorApi } from "../../../src/errores/ErrorApi.ts";
import { crearPipelineIngesta } from "../../../src/pipeline/ingesta/pipelineIngesta.ts";
import type { ObtenerTasa } from "../../../src/servicios/tasasServicio.ts";
import { crearRegistroEnMemoria } from "../../ayudas/registro.ts";

/** Arma el pipeline real de ingesta, con logger en memoria y tasas falsas. */
function armarPipeline(tasas: Record<string, number> = {}) {
  const { lineas, registradorDe } = crearRegistroEnMemoria();
  const consultas: string[] = [];
  const obtenerTasa: ObtenerTasa = async (moneda) => {
    consultas.push(moneda);
    const tasa = tasas[moneda];
    if (tasa === undefined) throw new ErrorApi(400, `La moneda ${moneda} no está soportada`);
    return tasa;
  };
  const pipeline = crearPipelineIngesta({ registradorDe, obtenerTasa });
  return { pipeline, lineas, consultas };
}

describe("Pipeline de ingesta", () => {
  test("tiene los tres filtros en el orden validación → normalización → conversión", () => {
    const { pipeline } = armarPipeline();

    expect(pipeline.pasos).toEqual([
      "FiltroValidacion",
      "FiltroNormalizacion",
      "FiltroConversionMoneda",
    ]);
  });

  test("un activo en USD sale validado y normalizado, sin consultar tasas", async () => {
    const { pipeline, consultas } = armarPipeline();

    const resultado = await pipeline.ejecutar({
      simbolo: " btc ",
      nombre: "  Bitcoin ",
      cantidad: 0.5,
      precioCompra: 40000,
    });

    expect(resultado.datos).toEqual({
      simbolo: "BTC",
      nombre: "Bitcoin",
      cantidad: 0.5,
      precioCompra: 40000,
    });
    expect(resultado.conversion).toBeUndefined();
    expect(consultas).toEqual([]);
  });

  test("un activo en EUR sale con el precio convertido a USD", async () => {
    const { pipeline, consultas } = armarPipeline({ EUR: 1.08 });

    const resultado = await pipeline.ejecutar({
      simbolo: "eth",
      nombre: "Ethereum",
      cantidad: 3,
      precioCompra: 2000,
      moneda: "eur",
    });

    expect(consultas).toEqual(["EUR"]); // la moneda llega ya normalizada
    expect(resultado.datos).toEqual({
      simbolo: "ETH",
      nombre: "Ethereum",
      cantidad: 3,
      precioCompra: 2160,
    });
    expect(resultado.conversion).toEqual({ monedaOriginal: "EUR", precioOriginal: 2000, tasa: 1.08 });
  });

  test("ejecuta y registra los filtros en el orden correcto", async () => {
    const { pipeline, lineas } = armarPipeline();

    await pipeline.ejecutar({ simbolo: " btc ", nombre: "Bitcoin", cantidad: 1, precioCompra: 100 });

    expect(lineas).toEqual([
      "[INFO] FiltroValidacion: Estructura del activo válida",
      "[INFO] Pipeline ingesta: FiltroValidacion ejecutado con éxito",
      "[INFO] FiltroNormalizacion: Símbolo BTC normalizado",
      "[INFO] Pipeline ingesta: FiltroNormalizacion ejecutado con éxito",
      "[INFO] FiltroConversionMoneda: Sin conversión: el precio ya está en USD",
      "[INFO] Pipeline ingesta: FiltroConversionMoneda ejecutado con éxito",
    ]);
  });

  test("fail fast: un body inválido corta en la validación", async () => {
    const { pipeline, lineas, consultas } = armarPipeline({ EUR: 1.08 });

    await expect(
      pipeline.ejecutar({ simbolo: "", nombre: "Bitcoin", cantidad: -1, precioCompra: 1, moneda: "EUR" }),
    ).rejects.toMatchObject({ estado: 400, message: "Datos del activo inválidos" });

    expect(consultas).toEqual([]); // nunca se llego a pedir una tasa
    expect(lineas).toEqual([
      "[ERROR] Pipeline ingesta: Falló FiltroValidacion: Datos del activo inválidos",
    ]);
  });

  test("si la conversión falla, registra los filtros previos y cuál falló", async () => {
    const { pipeline, lineas } = armarPipeline(); // sin tasas: cualquier moneda falla

    await expect(
      pipeline.ejecutar({ simbolo: "btc", nombre: "Bitcoin", cantidad: 1, precioCompra: 100, moneda: "xxx" }),
    ).rejects.toMatchObject({ estado: 400, message: "La moneda XXX no está soportada" });

    expect(lineas).toEqual([
      "[INFO] FiltroValidacion: Estructura del activo válida",
      "[INFO] Pipeline ingesta: FiltroValidacion ejecutado con éxito",
      "[INFO] FiltroNormalizacion: Símbolo BTC normalizado",
      "[INFO] Pipeline ingesta: FiltroNormalizacion ejecutado con éxito",
      "[ERROR] Pipeline ingesta: Falló FiltroConversionMoneda: La moneda XXX no está soportada",
    ]);
  });
});
