import { describe, expect, test } from "@jest/globals";
import type { NuevoRegistroAuditoria } from "../../src/modelos/auditoria.ts";
import type { ReporteValoracion } from "../../src/modelos/reporte.ts";
import { crearProcesadorReporte } from "../../src/reportes/procesadorReporte.ts";
import type { TrabajoEnProceso } from "../../src/reportes/procesadorReporte.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";

const reporte: ReporteValoracion = {
  generadoEn: "2026-10-30T12:00:00.000Z",
  moneda: "USD",
  resumen: { activos: 2, valuados: 1, sinPrecio: 1, costoTotal: 100, valorActual: 110, gananciaPerdida: 10, variacionPorcentual: 10 },
  posiciones: [],
  sinPrecio: ["RARO"],
};

function armar(cambios: { generar?: () => Promise<ReporteValoracion>; registrarAuditoria?: (r: NuevoRegistroAuditoria) => Promise<void> } = {}) {
  const registro = crearRegistroEnMemoria();
  const auditados: NuevoRegistroAuditoria[] = [];
  const progreso: number[] = [];
  let reloj = 1_000;
  const procesar = crearProcesadorReporte({
    generar: cambios.generar ?? (async (reportar) => {
      await reportar(50);
      return reporte;
    }),
    registrarAuditoria: cambios.registrarAuditoria ?? (async (r) => void auditados.push(r)),
    registrador: registro.registradorDe("WorkerReportes"),
    ahora: () => new Date((reloj += 500)),
  });
  const trabajo: TrabajoEnProceso = {
    data: { idReporte: "rep-1", solicitadoEn: "2026-10-30T11:59:00.000Z", solicitadoPor: "auth0|admin" },
    attemptsMade: 0,
    updateProgress: async (porcentaje) => void progreso.push(porcentaje),
  };
  return { procesar, trabajo, auditados, progreso, lineas: registro.lineas };
}

describe("crearProcesadorReporte", () => {
  test("genera el reporte, lo devuelve y reenvía el progreso a la cola", async () => {
    const { procesar, trabajo, progreso } = armar();

    expect(await procesar(trabajo)).toEqual(reporte);
    expect(progreso).toEqual([50]);
  });

  test("registra en la auditoría una operación GENERAR_REPORTE sobre la entidad Reporte", async () => {
    const { procesar, trabajo, auditados } = armar();

    await procesar(trabajo);

    expect(auditados).toEqual([
      {
        operacion: "GENERAR_REPORTE",
        entidad: "Reporte",
        entidadId: "rep-1",
        despues: { resumen: reporte.resumen, sinPrecio: ["RARO"] },
        metadatos: { origen: "worker", usuario: "auth0|admin", intento: 1, solicitadoEn: "2026-10-30T11:59:00.000Z", duracionMs: 500 },
      },
    ]);
  });

  test("un trabajo de antes de la autenticación (sin solicitadoPor) se procesa igual, sin usuario en la auditoría", async () => {
    const { procesar, trabajo, auditados } = armar();

    await procesar({ ...trabajo, data: { idReporte: "rep-viejo", solicitadoEn: "2026-10-30T11:00:00.000Z" } });

    expect(auditados[0]?.metadatos).not.toHaveProperty("usuario");
    expect(auditados[0]?.entidadId).toBe("rep-viejo");
  });

  test("el intento cuenta desde 1 y sube con los reintentos", async () => {
    const { procesar, trabajo, auditados } = armar();

    await procesar({ ...trabajo, attemptsMade: 2 });

    expect(auditados[0]?.metadatos?.["intento"]).toBe(3);
  });

  test("si falla la generación el error sigue de largo y no se audita nada", async () => {
    const { procesar, trabajo, auditados } = armar({
      generar: async () => {
        throw new Error("CoinGecko caído");
      },
    });

    await expect(procesar(trabajo)).rejects.toThrow("CoinGecko caído");
    expect(auditados).toEqual([]);
  });

  test("si falla la auditoría el trabajo FALLA (la cola lo reintenta) en vez de darse por bueno", async () => {
    const { procesar, trabajo } = armar({
      registrarAuditoria: async () => {
        throw new Error("MongoDB caído");
      },
    });

    await expect(procesar(trabajo)).rejects.toThrow("MongoDB caído");
  });

  test("deja en el log que empezó a generar el reporte y en qué intento", async () => {
    const { procesar, trabajo, lineas } = armar();

    await procesar(trabajo);

    expect(lineas).toEqual(["[INFO] WorkerReportes: Generando el reporte rep-1 (intento 1)"]);
  });
});
