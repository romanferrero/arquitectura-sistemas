import { describe, expect, test } from "@jest/globals";
import { filtroNormalizacion } from "../../../src/pipeline/ingesta/filtroNormalizacion.ts";
import type { ActivoEntrada } from "../../../src/pipeline/ingesta/tipos.ts";
import { crearRegistroEnMemoria, registradorSilencioso } from "../../ayudas/registro.ts";

const entrada: ActivoEntrada = {
  simbolo: "btc",
  nombre: "Bitcoin",
  cantidad: 0.5,
  precioCompra: 40000,
};

async function normalizar(datos: ActivoEntrada) {
  return await filtroNormalizacion.ejecutar(datos, registradorSilencioso);
}

describe("FiltroNormalizacion", () => {
  test("pasa el símbolo a mayúsculas y le saca los espacios", async () => {
    expect((await normalizar({ ...entrada, simbolo: "  btc " })).simbolo).toBe("BTC");
    expect((await normalizar({ ...entrada, simbolo: "eTh" })).simbolo).toBe("ETH");
  });

  test("saca los espacios sobrantes del nombre, en los bordes y adentro", async () => {
    const resultado = await normalizar({ ...entrada, nombre: "  Bitcoin    Cash  " });

    expect(resultado.nombre).toBe("Bitcoin Cash");
  });

  test("sin moneda asume USD", async () => {
    expect((await normalizar(entrada)).moneda).toBe("USD");
  });

  test("pasa la moneda a mayúsculas", async () => {
    expect((await normalizar({ ...entrada, moneda: " eur " })).moneda).toBe("EUR");
  });

  test("no toca cantidad ni precio", async () => {
    const resultado = await normalizar({ ...entrada, cantidad: 1.25, precioCompra: 42000.5 });

    expect(resultado.cantidad).toBe(1.25);
    expect(resultado.precioCompra).toBe(42000.5);
  });

  test("no modifica el objeto de entrada", async () => {
    const original: ActivoEntrada = { ...entrada, simbolo: " btc ", nombre: " Bitcoin " };
    const copia = structuredClone(original);

    await normalizar(original);

    expect(original).toEqual(copia);
  });

  test("registra el símbolo ya normalizado", async () => {
    const { lineas, registradorDe } = crearRegistroEnMemoria();

    await filtroNormalizacion.ejecutar(
      { ...entrada, simbolo: " btc " },
      registradorDe(filtroNormalizacion.nombre),
    );

    expect(lineas).toEqual(["[INFO] FiltroNormalizacion: Símbolo BTC normalizado"]);
  });
});
