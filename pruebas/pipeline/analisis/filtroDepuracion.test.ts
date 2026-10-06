import { describe, expect, test } from "@jest/globals";
import { filtroDepuracion } from "../../../src/pipeline/analisis/filtroDepuracion.ts";
import { crearRegistroEnMemoria, registradorSilencioso } from "../../ayudas/registro.ts";

const valido = { simbolo: "BTC", nombre: "Bitcoin", cantidad: 1, precioCompra: 100 };

async function depurar(entrada: unknown[]) {
  return await filtroDepuracion.ejecutar(entrada, registradorSilencioso);
}

describe("FiltroDepuracion", () => {
  test("conserva un activo válido y cuenta cuántos llegaron", async () => {
    const resultado = await depurar([valido]);

    expect(resultado.recibidos).toBe(1);
    expect(resultado.activos).toEqual([
      { simbolo: "BTC", nombre: "Bitcoin", cantidad: 1, precioCompra: 100, volatilidad: undefined },
    ]);
  });

  test("conserva la volatilidad si viene, incluso en cero", async () => {
    const resultado = await depurar([{ ...valido, volatilidad: 0 }, { ...valido, volatilidad: 45.5 }]);

    expect(resultado.activos.map((activo) => activo.volatilidad)).toEqual([0, 45.5]);
  });

  test("el nombre es opcional y se ignoran los campos desconocidos", async () => {
    const resultado = await depurar([{ simbolo: "BTC", cantidad: 1, precioCompra: 100, otro: "x" }]);

    expect(resultado.activos[0]).toEqual({
      simbolo: "BTC",
      nombre: undefined,
      cantidad: 1,
      precioCompra: 100,
      volatilidad: undefined,
    });
  });

  test("limpia el símbolo (espacios y mayúsculas) y el nombre (espacios)", async () => {
    const resultado = await depurar([{ ...valido, simbolo: "  btc ", nombre: " Bitcoin  " }]);

    expect(resultado.activos[0]).toMatchObject({ simbolo: "BTC", nombre: "Bitcoin" });
  });

  test.each([
    ["cantidad en cero", { cantidad: 0 }],
    ["cantidad negativa", { cantidad: -1 }],
    ["precioCompra en cero", { precioCompra: 0 }],
    ["precioCompra negativo", { precioCompra: -5 }],
  ])("descarta un activo con %s", async (_descripcion, cambio) => {
    const resultado = await depurar([{ ...valido, ...cambio }]);

    expect(resultado.activos).toEqual([]);
    expect(resultado.recibidos).toBe(1);
  });

  test("descarta cantidad y precio negativos aunque su producto sea positivo", async () => {
    const resultado = await depurar([{ ...valido, cantidad: -2, precioCompra: -50 }]);

    expect(resultado.activos).toEqual([]);
  });

  test.each([
    ["null", null],
    ["un texto", "BTC"],
    ["un número", 42],
    ["un array", [valido]],
  ])("descarta un elemento que es %s", async (_descripcion, elemento) => {
    expect((await depurar([elemento])).activos).toEqual([]);
  });

  test.each([
    ["falta", undefined],
    ["está vacío", "   "],
    ["no es un texto", 123],
  ])("descarta un activo cuyo símbolo %s", async (_descripcion, simbolo) => {
    expect((await depurar([{ ...valido, simbolo }])).activos).toEqual([]);
  });

  test.each([
    ["un texto", "10"],
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
    ["null", null],
  ])("descarta una cantidad que es %s", async (_descripcion, cantidad) => {
    expect((await depurar([{ ...valido, cantidad }])).activos).toEqual([]);
  });

  test.each([
    ["negativa", -1],
    ["un texto", "alta"],
    ["null", null],
  ])("descarta un activo con volatilidad %s", async (_descripcion, volatilidad) => {
    expect((await depurar([{ ...valido, volatilidad }])).activos).toEqual([]);
  });

  test("un elemento malo no invalida al resto del lote", async () => {
    const resultado = await depurar([
      { ...valido, simbolo: "BTC" },
      { ...valido, simbolo: "ETH", cantidad: 0 },
      null,
      { ...valido, simbolo: "SOL" },
    ]);

    expect(resultado.recibidos).toBe(4);
    expect(resultado.activos.map((activo) => activo.simbolo)).toEqual(["BTC", "SOL"]);
  });

  test("un lote vacío da un lote vacío", async () => {
    expect(await depurar([])).toEqual({ recibidos: 0, activos: [] });
  });

  test("no modifica el lote de entrada", async () => {
    const entrada = [{ ...valido, simbolo: " btc " }, { ...valido, cantidad: 0 }];
    const copia = structuredClone(entrada);

    await depurar(entrada);

    expect(entrada).toEqual(copia);
  });

  test("registra cada descarte con su índice y motivo, y el resumen", async () => {
    const { lineas, registradorDe } = crearRegistroEnMemoria();

    await filtroDepuracion.ejecutar(
      [valido, { ...valido, cantidad: 0 }, null],
      registradorDe(filtroDepuracion.nombre),
    );

    expect(lineas).toEqual([
      "[INFO] FiltroDepuracion: Descartado el elemento 1: cantidad debe ser mayor a 0",
      "[INFO] FiltroDepuracion: Descartado el elemento 2: no es un objeto",
      "[INFO] FiltroDepuracion: 1 de 3 activos conservados",
    ]);
  });
});
