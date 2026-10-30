import { describe, expect, test } from "@jest/globals";
import { ErrorApi } from "../../src/errores/ErrorApi.ts";
import { crearServicioPreferencias } from "../../src/servicios/crearServicioPreferencias.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";
import { crearRedisFalso } from "../ayudas/redisFalso.ts";

function armar() {
  const falso = crearRedisFalso();
  const registro = crearRegistroEnMemoria();
  const servicio = crearServicioPreferencias({
    redis: falso.redis,
    registrador: registro.registradorDe("Preferencias"),
    clave: "preferencias:billetera",
    porDefecto: { monedaVisualizacion: "USD", limiteAlertaUsd: 100000 },
  });
  return { ...falso, lineas: registro.lineas, servicio };
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorApi) return error;
    throw error;
  }
  throw new Error("Se esperaba un ErrorApi y no hubo error");
}

describe("crearServicioPreferencias", () => {
  test("sin nada guardado devuelve los valores por defecto", async () => {
    const { servicio } = armar();

    expect(await servicio.obtener()).toEqual({ monedaVisualizacion: "USD", limiteAlertaUsd: 100000 });
  });

  test("guarda las preferencias en un Hash y las devuelve con el tipo correcto", async () => {
    const { servicio, hashes } = armar();

    const resultado = await servicio.actualizar({ monedaVisualizacion: "eur", limiteAlertaUsd: 2500.5 });

    expect(resultado).toEqual({ monedaVisualizacion: "EUR", limiteAlertaUsd: 2500.5 });
    expect(hashes.get("preferencias:billetera")).toEqual({ monedaVisualizacion: "EUR", limiteAlertaUsd: "2500.5" });
    expect(await servicio.obtener()).toEqual(resultado);
  });

  test("actualiza solo el campo enviado y conserva el otro", async () => {
    const { servicio } = armar();
    await servicio.actualizar({ monedaVisualizacion: "UYU", limiteAlertaUsd: 500 });

    const resultado = await servicio.actualizar({ limiteAlertaUsd: 900 });

    expect(resultado).toEqual({ monedaVisualizacion: "UYU", limiteAlertaUsd: 900 });
  });

  test("un campo sin configurar usa el valor por defecto aunque el otro sí esté", async () => {
    const { servicio } = armar();

    expect(await servicio.actualizar({ monedaVisualizacion: "EUR" })).toEqual({
      monedaVisualizacion: "EUR",
      limiteAlertaUsd: 100000,
    });
  });

  test.each([
    ["un cuerpo vacío", {}],
    ["un cuerpo que no es un objeto", "texto"],
    ["una moneda que no es un código de 3 letras", { monedaVisualizacion: "DOLAR" }],
    ["una moneda que no es texto", { monedaVisualizacion: 5 }],
    ["un límite negativo", { limiteAlertaUsd: -1 }],
    ["un límite en cero", { limiteAlertaUsd: 0 }],
    ["un límite que viene como texto", { limiteAlertaUsd: "100" }],
    ["un límite gigante", { limiteAlertaUsd: 1e20 }],
    ["un campo desconocido", { monedaVisualizacion: "USD", tema: "oscuro" }],
  ])("rechaza con 400 %s y no escribe nada", async (_descripcion, cuerpo) => {
    const { servicio, comandos } = armar();

    const error = await errorDe(servicio.actualizar(cuerpo));

    expect(error.estado).toBe(400);
    expect(comandos).toEqual([]);
  });

  test("informa todos los errores de validación juntos", async () => {
    const { servicio } = armar();

    const error = await errorDe(servicio.actualizar({ monedaVisualizacion: "DOLAR", limiteAlertaUsd: -5 }));

    expect(error.detalles).toHaveLength(2);
  });

  describe("con Redis caído", () => {
    test("leer y escribir dan 503 y se loguea el error", async () => {
      const { servicio, estado, lineas } = armar();
      estado.caido = true;

      expect((await errorDe(servicio.obtener())).estado).toBe(503);
      expect((await errorDe(servicio.actualizar({ limiteAlertaUsd: 10 }))).estado).toBe(503);
      expect(lineas).toHaveLength(2);
      expect(lineas[0]).toContain("[ERROR] Preferencias:");
    });
  });
});
