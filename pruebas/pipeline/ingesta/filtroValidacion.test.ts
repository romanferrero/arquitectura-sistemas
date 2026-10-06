import { describe, expect, test } from "@jest/globals";
import { ErrorApi } from "../../../src/errores/ErrorApi.ts";
import { filtroValidacion } from "../../../src/pipeline/ingesta/filtroValidacion.ts";
import { crearRegistroEnMemoria, registradorSilencioso } from "../../ayudas/registro.ts";

const bodyValido = { simbolo: "BTC", nombre: "Bitcoin", cantidad: 0.5, precioCompra: 40000 };

async function validar(entrada: unknown) {
  return await filtroValidacion.ejecutar(entrada, registradorSilencioso);
}

describe("FiltroValidacion", () => {
  test("acepta un body válido y lo devuelve", async () => {
    await expect(validar(bodyValido)).resolves.toEqual(bodyValido);
  });

  test("solo valida: no transforma los valores", async () => {
    const entrada = { ...bodyValido, simbolo: "  btc ", nombre: "  Bitcoin  " };

    // El simbolo " btc " es valido una vez recortado, pero sale tal cual.
    await expect(validar(entrada)).resolves.toEqual(entrada);
  });

  test("la moneda es opcional y, si viene, se conserva", async () => {
    await expect(validar({ ...bodyValido, moneda: "eur" })).resolves.toMatchObject({
      moneda: "eur",
    });
    expect(await validar(bodyValido)).not.toHaveProperty("moneda");
  });

  test("descarta los campos desconocidos, incluido el id", async () => {
    const resultado = await validar({ ...bodyValido, id: "intento-de-id", otro: 1 });

    expect(resultado).toEqual(bodyValido);
  });

  test("rechaza con ErrorApi 400 y el mensaje general", async () => {
    const promesa = validar({});

    await expect(promesa).rejects.toBeInstanceOf(ErrorApi);
    await expect(promesa).rejects.toMatchObject({
      estado: 400,
      message: "Datos del activo inválidos",
    });
  });

  test("devuelve TODOS los errores juntos, no solo el primero", async () => {
    await expect(validar({ simbolo: "", cantidad: -1 })).rejects.toMatchObject({
      detalles: [
        "simbolo debe tener entre 1 y 10 caracteres alfanuméricos (ej: BTC)",
        "nombre es obligatorio y debe ser un texto",
        "cantidad debe ser mayor a 0",
        "precioCompra es obligatorio y debe ser un número",
      ],
    });
  });

  test.each([
    ["null", null],
    ["un texto", "BTC"],
    ["un número", 42],
    ["un array", [bodyValido]],
  ])("rechaza un body que es %s", async (_descripcion, entrada) => {
    await expect(validar(entrada)).rejects.toMatchObject({
      estado: 400,
      detalles: ["El cuerpo debe ser un objeto JSON"],
    });
  });

  test.each([
    ["con caracteres no alfanuméricos", "BT-C"],
    ["demasiado largo", "ABCDEFGHIJK"],
    ["solo espacios", "   "],
  ])("rechaza un símbolo %s", async (_descripcion, simbolo) => {
    await expect(validar({ ...bodyValido, simbolo })).rejects.toMatchObject({
      detalles: ["simbolo debe tener entre 1 y 10 caracteres alfanuméricos (ej: BTC)"],
    });
  });

  test("rechaza un nombre vacío y uno de más de 50 caracteres", async () => {
    await expect(validar({ ...bodyValido, nombre: "   " })).rejects.toMatchObject({
      detalles: ["nombre no puede estar vacío"],
    });
    await expect(validar({ ...bodyValido, nombre: "x".repeat(51) })).rejects.toMatchObject({
      detalles: ["nombre no puede superar los 50 caracteres"],
    });
  });

  test.each([
    ["cero", 0],
    ["negativo", -5],
    ["un texto", "10"],
    ["null", null],
  ])("rechaza una cantidad que es %s", async (_descripcion, cantidad) => {
    await expect(validar({ ...bodyValido, cantidad })).rejects.toMatchObject({ estado: 400 });
  });

  test.each([["EURO"], ["E1"], [""], [123], [null]])(
    "rechaza la moneda %p",
    async (moneda) => {
      await expect(validar({ ...bodyValido, moneda })).rejects.toMatchObject({ estado: 400 });
    },
  );

  test("registra que la estructura es válida", async () => {
    const { lineas, registradorDe } = crearRegistroEnMemoria();

    await filtroValidacion.ejecutar(bodyValido, registradorDe(filtroValidacion.nombre));

    expect(lineas).toEqual(["[INFO] FiltroValidacion: Estructura del activo válida"]);
  });
});
