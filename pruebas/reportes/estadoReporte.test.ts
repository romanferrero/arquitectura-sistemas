import { describe, expect, test } from "@jest/globals";
import { OPCIONES_TRABAJO_REPORTE, NOMBRE_COLA_REPORTES, esIdDeReporte, estadoDeCola } from "../../src/reportes/estadoReporte.ts";

describe("estadoDeCola", () => {
  test.each([
    ["active", "procesando"],
    ["completed", "completado"],
    ["failed", "fallido"],
    ["waiting", "en_cola"],
    ["delayed", "en_cola"], // fallo y espera para reintentarse
    ["prioritized", "en_cola"],
    ["waiting-children", "en_cola"],
    ["unknown", "en_cola"],
  ])("%s se ve como %s", (deLaCola, delCliente) => {
    expect(estadoDeCola(deLaCola)).toBe(delCliente);
  });
});

describe("esIdDeReporte", () => {
  test("acepta un UUID", () => {
    expect(esIdDeReporte("3f9d2c1e-8b7a-4c3d-9e1f-0a1b2c3d4e5f")).toBe(true);
  });

  test.each(["meta", "1", "", "bull:cola-reportes:meta", "3f9d2c1e-8b7a-4c3d-9e1f-0a1b2c3d4e5f-extra", "../x"])(
    "rechaza %p, que no puede ser un reporte nuestro",
    (texto) => {
      expect(esIdDeReporte(texto)).toBe(false);
    },
  );
});

describe("configuración de la cola", () => {
  test("el nombre no lleva dos puntos (BullMQ no lo admite)", () => {
    expect(NOMBRE_COLA_REPORTES).toBe("cola-reportes");
    expect(NOMBRE_COLA_REPORTES).not.toContain(":");
  });

  test("reintenta 3 veces con espera creciente y limpia los trabajos viejos", () => {
    expect(OPCIONES_TRABAJO_REPORTE.attempts).toBe(3);
    expect(OPCIONES_TRABAJO_REPORTE.backoff.type).toBe("exponential");
    expect(OPCIONES_TRABAJO_REPORTE.removeOnComplete.age).toBeGreaterThan(0);
    expect(OPCIONES_TRABAJO_REPORTE.removeOnFail.age).toBeGreaterThan(0);
  });
});
