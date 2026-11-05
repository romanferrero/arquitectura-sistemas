import { describe, expect, test } from "@jest/globals";
import { esErrorDeDuplicado } from "../../src/datos/esErrorDeDuplicado.ts";

describe("esErrorDeDuplicado", () => {
  test("reconoce el E11000 de MongoDB por su código", () => {
    expect(esErrorDeDuplicado(Object.assign(new Error("E11000 duplicate key error"), { code: 11000 }))).toBe(true);
  });

  test.each([
    ["otro código de Mongo", Object.assign(new Error("x"), { code: 121 })],
    ["un error sin código", new Error("E11000 en el texto pero sin código")],
    ["un texto", "E11000"],
    ["null", null],
    ["undefined", undefined],
  ])("no confunde %s", (_nombre, error) => {
    expect(esErrorDeDuplicado(error)).toBe(false);
  });
});
