import { describe, expect, test } from "@jest/globals";
import { camposModificados } from "../../src/utilidades/camposModificados.ts";

const campos = ["simbolo", "nombre", "cantidad", "precioCompra"] as const;
const antes = { id: "1", simbolo: "BTC", nombre: "Bitcoin", cantidad: 0.5, precioCompra: 40000, creadoEn: "x" };

describe("camposModificados", () => {
  test("devuelve solo los campos que cambiaron, en el orden de la lista", () => {
    const despues = { ...antes, precioCompra: 42000, cantidad: 1.25 };

    expect(camposModificados(antes, despues, campos)).toEqual(["cantidad", "precioCompra"]);
  });

  test("sin cambios devuelve una lista vacía", () => {
    expect(camposModificados(antes, { ...antes }, campos)).toEqual([]);
  });

  test("ignora los campos que no están en la lista, aunque cambien", () => {
    const despues = { ...antes, id: "2", creadoEn: "otra fecha" };

    expect(camposModificados(antes, despues, campos)).toEqual([]);
  });

  test("detecta el cambio de símbolo", () => {
    expect(camposModificados(antes, { ...antes, simbolo: "ETH" }, campos)).toEqual(["simbolo"]);
  });
});
