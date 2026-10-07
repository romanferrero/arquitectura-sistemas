import { describe, expect, test } from "@jest/globals";
import type { QueryInterface } from "sequelize";
import { migracion001 } from "../../src/datos/migraciones/001-crear-activos.ts";
import { migraciones } from "../../src/datos/migraciones/index.ts";

/**
 * QueryInterface falso: no toca ninguna base, solo anota que se le pidio.
 * La migracion contra MySQL de verdad se prueba a mano con `npm run migrar`.
 */
function crearConsultasFalsas() {
  const llamadas: { metodo: string; argumentos: unknown[] }[] = [];
  const anotar =
    (metodo: string) =>
    async (...argumentos: unknown[]) => {
      llamadas.push({ metodo, argumentos });
    };

  const consultas = {
    createTable: anotar("createTable"),
    addConstraint: anotar("addConstraint"),
    dropTable: anotar("dropTable"),
    sequelize: { query: anotar("query") },
  } as unknown as QueryInterface;

  return { consultas, llamadas };
}

describe("lista de migraciones", () => {
  test("no está vacía y cada migración tiene up y down", () => {
    expect(migraciones.length).toBeGreaterThan(0);
    for (const migracion of migraciones) {
      expect(typeof migracion.up).toBe("function");
      expect(typeof migracion.down).toBe("function");
    }
  });

  test("los nombres son únicos", () => {
    const nombres = migraciones.map((migracion) => migracion.nombre);

    expect(new Set(nombres).size).toBe(nombres.length);
  });

  test("tienen el formato NNN-descripcion y están en orden creciente", () => {
    const nombres = migraciones.map((migracion) => migracion.nombre);

    for (const nombre of nombres) expect(nombre).toMatch(/^\d{3}-[a-z0-9-]+$/);
    expect(nombres).toEqual([...nombres].sort());
  });
});

describe("migración 001-crear-activos", () => {
  test("up crea la tabla activos con sus columnas", async () => {
    const { consultas, llamadas } = crearConsultasFalsas();

    await migracion001.up(consultas);

    const creacion = llamadas.find((llamada) => llamada.metodo === "createTable");
    expect(creacion?.argumentos[0]).toBe("activos");
    expect(Object.keys(creacion?.argumentos[1] as object)).toEqual([
      "id",
      "simbolo",
      "nombre",
      "cantidad",
      "precio_compra",
      "creado_en",
      "actualizado_en",
    ]);
  });

  test("up deja el símbolo único y exige cantidad y precio positivos", async () => {
    const { consultas, llamadas } = crearConsultasFalsas();

    await migracion001.up(consultas);

    const unica = llamadas.find((llamada) => llamada.metodo === "addConstraint");
    expect(unica?.argumentos[1]).toMatchObject({ type: "unique", fields: ["simbolo"] });

    const sql = llamadas.filter((llamada) => llamada.metodo === "query").map((llamada) => String(llamada.argumentos[0]));
    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain("CHECK (cantidad > 0)");
    expect(sql[1]).toContain("CHECK (precio_compra > 0)");
  });

  test("down borra la tabla activos", async () => {
    const { consultas, llamadas } = crearConsultasFalsas();

    await migracion001.down(consultas);

    expect(llamadas).toEqual([{ metodo: "dropTable", argumentos: ["activos"] }]);
  });
});
