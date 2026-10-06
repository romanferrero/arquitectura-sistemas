import { describe, expect, test } from "@jest/globals";
import { Pipeline } from "../../src/pipeline/pipeline.ts";
import type { FabricaRegistrador, Filtro } from "../../src/pipeline/pipeline.ts";

/** Registrador falso: guarda en memoria todo lo que se loguea. */
function crearRegistroEnMemoria() {
  const lineas: string[] = [];
  const registradorDe: FabricaRegistrador = (origen) => ({
    info: (mensaje) => lineas.push(`[INFO] ${origen}: ${mensaje}`),
    error: (mensaje) => lineas.push(`[ERROR] ${origen}: ${mensaje}`),
  });
  return { lineas, registradorDe };
}

/** Filtro de prueba: agrega su marca al texto y anota que fue ejecutado. */
function filtroQueMarca(nombre: string, ejecutados: string[]): Filtro<string, string> {
  return {
    nombre,
    ejecutar(entrada) {
      ejecutados.push(nombre);
      return `${entrada}>${nombre}`;
    },
  };
}

describe("Pipeline", () => {
  test("sin filtros devuelve la entrada tal cual", async () => {
    const { registradorDe } = crearRegistroEnMemoria();
    const pipeline = Pipeline.crear<number>("vacio", registradorDe);

    await expect(pipeline.ejecutar(42)).resolves.toBe(42);
  });

  test("ejecuta los filtros en el orden en que se agregaron", async () => {
    const { registradorDe } = crearRegistroEnMemoria();
    const ejecutados: string[] = [];
    const pipeline = Pipeline.crear<string>("orden", registradorDe)
      .agregar(filtroQueMarca("A", ejecutados))
      .agregar(filtroQueMarca("B", ejecutados))
      .agregar(filtroQueMarca("C", ejecutados));

    const salida = await pipeline.ejecutar("inicio");

    expect(ejecutados).toEqual(["A", "B", "C"]);
    expect(salida).toBe("inicio>A>B>C");
    expect(pipeline.pasos).toEqual(["A", "B", "C"]);
  });

  test("cada filtro recibe la salida del anterior, aunque cambie el tipo", async () => {
    const { registradorDe } = crearRegistroEnMemoria();
    const aNumero: Filtro<string, number> = {
      nombre: "ANumero",
      ejecutar: (texto) => Number(texto),
    };
    const duplicar: Filtro<number, number> = {
      nombre: "Duplicar",
      ejecutar: (numero) => numero * 2,
    };

    const pipeline = Pipeline.crear<string>("tipos", registradorDe)
      .agregar(aNumero)
      .agregar(duplicar);

    await expect(pipeline.ejecutar("21")).resolves.toBe(42);
  });

  test("espera a los filtros asincronicos antes de seguir", async () => {
    const { registradorDe } = crearRegistroEnMemoria();
    const ejecutados: string[] = [];
    const lento: Filtro<string, string> = {
      nombre: "Lento",
      async ejecutar(entrada) {
        await new Promise((resolver) => setTimeout(resolver, 10));
        ejecutados.push("Lento");
        return `${entrada}>Lento`;
      },
    };

    const pipeline = Pipeline.crear<string>("async", registradorDe)
      .agregar(lento)
      .agregar(filtroQueMarca("Rapido", ejecutados));

    await expect(pipeline.ejecutar("inicio")).resolves.toBe("inicio>Lento>Rapido");
    expect(ejecutados).toEqual(["Lento", "Rapido"]);
  });

  test("fail fast: si un filtro falla, los siguientes no se ejecutan", async () => {
    const { registradorDe } = crearRegistroEnMemoria();
    const ejecutados: string[] = [];
    const errorOriginal = new Error("dato inválido");
    const roto: Filtro<string, string> = {
      nombre: "Roto",
      ejecutar() {
        throw errorOriginal;
      },
    };

    const pipeline = Pipeline.crear<string>("falla", registradorDe)
      .agregar(filtroQueMarca("A", ejecutados))
      .agregar(roto)
      .agregar(filtroQueMarca("C", ejecutados));

    // Se propaga el MISMO error, no uno envuelto: asi un ErrorApi conserva su estado.
    await expect(pipeline.ejecutar("inicio")).rejects.toBe(errorOriginal);
    expect(ejecutados).toEqual(["A"]);
  });

  test("registra los filtros que terminaron bien y cual fallo", async () => {
    const { lineas, registradorDe } = crearRegistroEnMemoria();
    const ejecutados: string[] = [];
    const roto: Filtro<string, string> = {
      nombre: "Roto",
      ejecutar() {
        throw new Error("dato inválido");
      },
    };

    const pipeline = Pipeline.crear<string>("demo", registradorDe)
      .agregar(filtroQueMarca("A", ejecutados))
      .agregar(roto)
      .agregar(filtroQueMarca("C", ejecutados));

    await expect(pipeline.ejecutar("inicio")).rejects.toThrow("dato inválido");
    expect(lineas).toEqual([
      "[INFO] Pipeline demo: A ejecutado con éxito",
      "[ERROR] Pipeline demo: Falló Roto: dato inválido",
    ]);
  });

  test("le entrega a cada filtro un registrador firmado con su nombre", async () => {
    const { lineas, registradorDe } = crearRegistroEnMemoria();
    const normalizar: Filtro<string, string> = {
      nombre: "FiltroNormalizacion",
      ejecutar(entrada, registrador) {
        const simbolo = entrada.trim().toUpperCase();
        registrador.info(`Símbolo ${simbolo} normalizado`);
        return simbolo;
      },
    };

    const pipeline = Pipeline.crear<string>("ingesta", registradorDe).agregar(normalizar);

    await expect(pipeline.ejecutar(" btc ")).resolves.toBe("BTC");
    expect(lineas[0]).toBe("[INFO] FiltroNormalizacion: Símbolo BTC normalizado");
  });

  test("agregar() no modifica el pipeline original", () => {
    const { registradorDe } = crearRegistroEnMemoria();
    const ejecutados: string[] = [];
    const base = Pipeline.crear<string>("base", registradorDe).agregar(
      filtroQueMarca("A", ejecutados),
    );

    const extendido = base.agregar(filtroQueMarca("B", ejecutados));

    expect(base.pasos).toEqual(["A"]);
    expect(extendido.pasos).toEqual(["A", "B"]);
  });
});
