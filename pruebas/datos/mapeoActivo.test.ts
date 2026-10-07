import { describe, expect, test } from "@jest/globals";
import { activoAFila, filaAActivo } from "../../src/datos/mapeoActivo.ts";
import type { Activo } from "../../src/modelos/activo.ts";

const activo: Activo = {
  id: "2d335d2c-5a18-43ad-a1d4-498732cb0d2e",
  simbolo: "BTC",
  nombre: "Bitcoin",
  cantidad: 0.5,
  precioCompra: 40000,
  creadoEn: "2026-10-07T20:11:48.357Z",
  actualizadoEn: "2026-10-07T21:00:00.000Z",
};

describe("filaAActivo", () => {
  test("pasa los DECIMAL de texto a number y las fechas de Date a texto ISO", () => {
    const resultado = filaAActivo({
      id: activo.id,
      simbolo: "BTC",
      nombre: "Bitcoin",
      cantidad: "0.50000000",
      precioCompra: "40000.00",
      creadoEn: new Date("2026-10-07T20:11:48.357Z"),
      actualizadoEn: new Date("2026-10-07T21:00:00.000Z"),
    });

    expect(resultado).toEqual(activo);
  });
});

describe("activoAFila", () => {
  test("pasa los números a texto con la escala de la columna y las fechas a Date", () => {
    const fila = activoAFila(activo);

    expect(fila.cantidad).toBe("0.50000000");
    expect(fila.precioCompra).toBe("40000.00");
    expect(fila.creadoEn).toEqual(new Date("2026-10-07T20:11:48.357Z"));
    expect(fila.actualizadoEn).toEqual(new Date("2026-10-07T21:00:00.000Z"));
  });

  test("redondea a la escala de la columna: 8 decimales la cantidad y 2 el precio", () => {
    const fila = activoAFila({ ...activo, cantidad: 0.123456789, precioCompra: 98.456 });

    expect(fila.cantidad).toBe("0.12345679");
    expect(fila.precioCompra).toBe("98.46");
  });

  test("no usa notación científica en los extremos que admite la validación", () => {
    const minimo = activoAFila({ ...activo, cantidad: 0.00000001, precioCompra: 0.01 });
    const maximo = activoAFila({ ...activo, cantidad: 1e15, precioCompra: 1e15 });

    expect(minimo.cantidad).toBe("0.00000001");
    expect(minimo.precioCompra).toBe("0.01");
    expect(maximo.cantidad).toBe("1000000000000000.00000000");
    expect(maximo.precioCompra).toBe("1000000000000000.00");
  });

  test("ida y vuelta: un activo ya redondeado vuelve igual", () => {
    expect(filaAActivo(activoAFila(activo))).toEqual(activo);
  });
});
