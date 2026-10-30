import { describe, expect, test } from "@jest/globals";
import { conTiempoMaximo } from "../../src/utilidades/conTiempoMaximo.ts";

describe("conTiempoMaximo", () => {
  test("devuelve el resultado si la operación termina a tiempo", async () => {
    expect(await conTiempoMaximo(async () => 42, 100, "tardó demasiado")).toBe(42);
  });

  test("rechaza con la descripción si la operación no termina a tiempo", async () => {
    await expect(conTiempoMaximo(() => new Promise(() => undefined), 20, "MongoDB no respondió en 20 ms")).rejects.toThrow(
      "MongoDB no respondió en 20 ms",
    );
  });

  test("si la operación falla antes del tiempo, propaga su error", async () => {
    await expect(
      conTiempoMaximo(async () => {
        throw new Error("falló");
      }, 100, "tardó demasiado"),
    ).rejects.toThrow("falló");
  });

  test("un error sincrónico de la operación también es un rechazo", async () => {
    await expect(
      conTiempoMaximo(() => {
        throw new Error("explotó antes de devolver una promesa");
      }, 100, "tardó demasiado"),
    ).rejects.toThrow("explotó antes");
  });

  test("si la operación pierde la carrera y falla después, no queda un rechazo sin manejar", async () => {
    let rechazarOperacion: (error: Error) => void = () => undefined;
    const lenta = new Promise<never>((_resolver, rechazar) => {
      rechazarOperacion = rechazar;
    });
    const sinManejar: unknown[] = [];
    const oyente = (razon: unknown): void => void sinManejar.push(razon);
    process.on("unhandledRejection", oyente);
    try {
      await expect(conTiempoMaximo(() => lenta, 10, "vencido")).rejects.toThrow("vencido");
      rechazarOperacion(new Error("falló tarde"));
      await new Promise((resolver) => setTimeout(resolver, 20));
    } finally {
      process.off("unhandledRejection", oyente);
    }
    expect(sinManejar).toEqual([]);
  });
});
