import { describe, expect, test } from "@jest/globals";
import { esWhaleAlert, montoUsd } from "../../src/utilidades/whaleAlert.ts";

describe("whaleAlert", () => {
  test("el monto es cantidad x precio de compra", () => {
    expect(montoUsd({ cantidad: 0.5, precioCompra: 30000 })).toBe(15000);
  });

  test("dispara cuando el monto SUPERA el umbral", () => {
    expect(esWhaleAlert(100_001, 100_000)).toBe(true);
  });

  test("un monto igual al umbral, o menor, no dispara", () => {
    expect(esWhaleAlert(100_000, 100_000)).toBe(false);
    expect(esWhaleAlert(1, 100_000)).toBe(false);
  });
});
