import { describe, expect, test } from "@jest/globals";
import { ErrorApi } from "../../../src/errores/ErrorApi.ts";
import { crearFiltroConversionMoneda } from "../../../src/pipeline/ingesta/filtroConversionMoneda.ts";
import type { ActivoNormalizado } from "../../../src/pipeline/ingesta/tipos.ts";
import type { ObtenerTasa } from "../../../src/servicios/tasasServicio.ts";
import { crearRegistroEnMemoria, registradorSilencioso } from "../../ayudas/registro.ts";

const activoEnUsd: ActivoNormalizado = {
  simbolo: "BTC",
  nombre: "Bitcoin",
  cantidad: 0.5,
  precioCompra: 40000,
  moneda: "USD",
};

/** Tasa falsa: responde con las tasas dadas y anota que monedas se consultaron. */
function crearTasaFalsa(tasas: Record<string, number>) {
  const consultas: string[] = [];
  const obtenerTasa: ObtenerTasa = async (moneda) => {
    consultas.push(moneda);
    const tasa = tasas[moneda];
    if (tasa === undefined) throw new ErrorApi(400, `La moneda ${moneda} no está soportada`);
    return tasa;
  };
  return { obtenerTasa, consultas };
}

describe("FiltroConversionMoneda", () => {
  test("si el activo ya está en USD no consulta ninguna tasa", async () => {
    const { obtenerTasa, consultas } = crearTasaFalsa({});
    const filtro = crearFiltroConversionMoneda({ obtenerTasa });

    const resultado = await filtro.ejecutar(activoEnUsd, registradorSilencioso);

    expect(consultas).toEqual([]);
    expect(resultado.conversion).toBeUndefined();
    expect(resultado.datos).toEqual({
      simbolo: "BTC",
      nombre: "Bitcoin",
      cantidad: 0.5,
      precioCompra: 40000,
    });
  });

  test("en otra moneda convierte el precio de compra a USD", async () => {
    const { obtenerTasa, consultas } = crearTasaFalsa({ EUR: 1.08 });
    const filtro = crearFiltroConversionMoneda({ obtenerTasa });

    const resultado = await filtro.ejecutar(
      { ...activoEnUsd, moneda: "EUR", precioCompra: 100 },
      registradorSilencioso,
    );

    expect(consultas).toEqual(["EUR"]);
    expect(resultado.datos.precioCompra).toBe(108);
  });

  test("el activo que sale ya no lleva el campo moneda", async () => {
    const { obtenerTasa } = crearTasaFalsa({ EUR: 1.08 });
    const filtro = crearFiltroConversionMoneda({ obtenerTasa });

    const resultado = await filtro.ejecutar({ ...activoEnUsd, moneda: "EUR" }, registradorSilencioso);

    expect(resultado.datos).not.toHaveProperty("moneda");
  });

  test("redondea el precio convertido a dos decimales", async () => {
    const { obtenerTasa } = crearTasaFalsa({ UYU: 0.024766 });
    const filtro = crearFiltroConversionMoneda({ obtenerTasa });

    const resultado = await filtro.ejecutar(
      { ...activoEnUsd, moneda: "UYU", precioCompra: 1000 },
      registradorSilencioso,
    );

    expect(resultado.datos.precioCompra).toBe(24.77); // 24.766 -> 24.77
  });

  test("devuelve el detalle de la conversión para poder auditarla", async () => {
    const { obtenerTasa } = crearTasaFalsa({ EUR: 1.08 });
    const filtro = crearFiltroConversionMoneda({ obtenerTasa });

    const resultado = await filtro.ejecutar(
      { ...activoEnUsd, moneda: "EUR", precioCompra: 100 },
      registradorSilencioso,
    );

    expect(resultado.conversion).toEqual({ monedaOriginal: "EUR", precioOriginal: 100, tasa: 1.08 });
  });

  test("propaga el error si la tasa no se puede obtener", async () => {
    const { obtenerTasa } = crearTasaFalsa({});
    const filtro = crearFiltroConversionMoneda({ obtenerTasa });

    await expect(
      filtro.ejecutar({ ...activoEnUsd, moneda: "XXX" }, registradorSilencioso),
    ).rejects.toMatchObject({ estado: 400, message: "La moneda XXX no está soportada" });
  });

  test("rechaza con 400 si el precio convertido queda en cero", async () => {
    const { obtenerTasa } = crearTasaFalsa({ JPY: 0.0067 });
    const filtro = crearFiltroConversionMoneda({ obtenerTasa });

    // 0.1 JPY * 0.0067 = 0.00067 USD, que con dos decimales es 0.
    await expect(
      filtro.ejecutar({ ...activoEnUsd, moneda: "JPY", precioCompra: 0.1 }, registradorSilencioso),
    ).rejects.toMatchObject({ estado: 400 });
  });

  test("registra si convirtió o no", async () => {
    const { lineas, registradorDe } = crearRegistroEnMemoria();
    const { obtenerTasa } = crearTasaFalsa({ EUR: 1.08 });
    const filtro = crearFiltroConversionMoneda({ obtenerTasa });
    const registrador = registradorDe(filtro.nombre);

    await filtro.ejecutar(activoEnUsd, registrador);
    await filtro.ejecutar({ ...activoEnUsd, moneda: "EUR", precioCompra: 100 }, registrador);

    expect(lineas).toEqual([
      "[INFO] FiltroConversionMoneda: Sin conversión: el precio ya está en USD",
      "[INFO] FiltroConversionMoneda: Convertido 100 EUR a 108 USD (tasa 1.08)",
    ]);
  });
});
