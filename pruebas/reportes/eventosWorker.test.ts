import { describe, expect, test } from "@jest/globals";
import { crearManejadoresEventos } from "../../src/reportes/eventosWorker.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";

function armar(contarExito: () => Promise<number> = async () => 1) {
  const registro = crearRegistroEnMemoria();
  const manejadores = crearManejadoresEventos({ registrador: registro.registradorDe("WorkerReportes"), contarExito });
  return { manejadores, lineas: registro.lineas };
}

describe("manejadores de eventos del worker", () => {
  describe("completed", () => {
    test("cuenta el éxito y lo deja en el log con el total", async () => {
      let llamadas = 0;
      const { manejadores, lineas } = armar(async () => (llamadas += 1) + 6);

      await manejadores.alCompletar({ id: "rep-1", attemptsMade: 0, opts: {} });

      expect(llamadas).toBe(1);
      expect(lineas).toEqual(["[INFO] WorkerReportes: Reporte rep-1 completado (reportes exitosos hasta ahora: 7)"]);
    });

    test("si no se puede contar, el reporte igual figura completado y el fallo queda en el log (sin lanzar)", async () => {
      const { manejadores, lineas } = armar(async () => {
        throw new Error("Redis caído");
      });

      await expect(manejadores.alCompletar({ id: "rep-1", attemptsMade: 0, opts: {} })).resolves.toBeUndefined();

      expect(lineas[0]).toBe("[INFO] WorkerReportes: Reporte rep-1 completado");
      expect(lineas[1]).toContain("[ERROR] WorkerReportes: No se pudo contar el reporte exitoso");
      expect(lineas[1]).toContain("Redis caído");
    });
  });

  describe("failed", () => {
    test("un intento fallido con intentos pendientes dice que se reintenta", () => {
      const { manejadores, lineas } = armar();

      manejadores.alFallar({ id: "rep-1", attemptsMade: 1, opts: { attempts: 3 } }, new Error("CoinGecko caído"));

      expect(lineas).toEqual(["[ERROR] WorkerReportes: Reporte rep-1 falló (intento 1 de 3), se reintenta: CoinGecko caído"]);
    });

    test("el último intento dice que falló definitivamente", () => {
      const { manejadores, lineas } = armar();

      manejadores.alFallar({ id: "rep-1", attemptsMade: 3, opts: { attempts: 3 } }, new Error("CoinGecko caído"));

      expect(lineas).toEqual(["[ERROR] WorkerReportes: Reporte rep-1 falló definitivamente tras 3 intento(s): CoinGecko caído"]);
    });

    test("un trabajo sin reintentos configurados falla definitivamente al primer intento", () => {
      const { manejadores, lineas } = armar();

      manejadores.alFallar({ id: "rep-1", attemptsMade: 1, opts: {} }, new Error("x"));

      expect(lineas[0]).toContain("falló definitivamente");
    });

    test("si el trabajo ya no está (BullMQ lo pasa como undefined) igual se loguea el error", () => {
      const { manejadores, lineas } = armar();

      manejadores.alFallar(undefined, new Error("se perdió"));

      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toContain("se perdió");
    });
  });
});
