import { describe, expect, test } from "@jest/globals";
import { ErrorApi } from "../../src/errores/ErrorApi.ts";
import type { DatosReporte } from "../../src/modelos/reporte.ts";
import { crearServicioReportes } from "../../src/servicios/crearServicioReportes.ts";
import type { ColaDeReportes, TrabajoReporte } from "../../src/servicios/crearServicioReportes.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";

const ID = "3f9d2c1e-8b7a-4c3d-9e1f-0a1b2c3d4e5f";

/** Cola falsa en memoria: guarda lo que se agrega y deja fijar el estado de cada trabajo. */
function armar(cambios: Partial<ColaDeReportes> = {}, tiempoMaximoMs = 50) {
  const agregados: DatosReporte[] = [];
  const trabajos = new Map<string, TrabajoReporte>();
  const registro = crearRegistroEnMemoria();
  const cola: ColaDeReportes = {
    agregar: async (datos) => void agregados.push(datos),
    buscar: async (id) => trabajos.get(id),
    ...cambios,
  };
  const servicio = crearServicioReportes({
    cola,
    registrador: registro.registradorDe("Reportes"),
    tiempoMaximoMs,
    generarId: () => ID,
    ahora: () => new Date("2026-10-30T12:00:00.000Z"),
  });
  return { servicio, agregados, trabajos, lineas: registro.lineas };
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorApi) return error;
    throw error;
  }
  throw new Error("Se esperaba un ErrorApi y no hubo error");
}

const datos: DatosReporte = { idReporte: ID, solicitadoEn: "2026-10-30T12:00:00.000Z", solicitadoPor: "auth0|admin" };

describe("crearServicioReportes · solicitar", () => {
  test("deja el pedido en la cola y devuelve el id con estado en_cola, sin generar nada", async () => {
    const { servicio, agregados } = armar();

    expect(await servicio.solicitar("auth0|admin")).toEqual({ idReporte: ID, estado: "en_cola" });
    expect(agregados).toEqual([datos]);
  });

  test("si la cola falla da 503 y lo deja en el log", async () => {
    const { servicio, lineas } = armar({
      agregar: async () => {
        throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
      },
    });

    const error = await errorDe(servicio.solicitar("auth0|admin"));

    expect(error.estado).toBe(503);
    expect(lineas[0]).toContain("[ERROR] Reportes: No se pudo usar la cola de reportes");
  });

  test("si la cola no responde a tiempo da 503 en lugar de quedar colgada", async () => {
    const { servicio } = armar({ agregar: () => new Promise(() => undefined) }, 20);

    const error = await errorDe(servicio.solicitar("auth0|admin"));

    expect(error.estado).toBe(503);
  });
});

describe("crearServicioReportes · consultar", () => {
  test("un reporte en cola muestra su estado y progreso 0", async () => {
    const { servicio, trabajos } = armar();
    trabajos.set(ID, { estado: "en_cola", progreso: 0, datos, intentos: 0 });

    expect(await servicio.consultar(ID)).toEqual({
      idReporte: ID,
      estado: "en_cola",
      progreso: 0,
      solicitadoEn: datos.solicitadoEn,
      solicitadoPor: "auth0|admin",
      intentos: 0,
    });
  });

  test("un reporte de antes de la autenticación (sin solicitadoPor) se consulta igual, sin ese campo", async () => {
    const { servicio, trabajos } = armar();
    trabajos.set(ID, { estado: "en_cola", progreso: 0, datos: { idReporte: ID, solicitadoEn: datos.solicitadoEn }, intentos: 0 });

    expect(await servicio.consultar(ID)).not.toHaveProperty("solicitadoPor");
  });

  test("un reporte procesándose muestra su progreso", async () => {
    const { servicio, trabajos } = armar();
    trabajos.set(ID, { estado: "procesando", progreso: 65, datos, intentos: 1 });

    expect(await servicio.consultar(ID)).toMatchObject({ estado: "procesando", progreso: 65, intentos: 1 });
  });

  test("un reporte completado trae el resultado y progreso 100", async () => {
    const { servicio, trabajos } = armar();
    const resultado = { generadoEn: "x", moneda: "USD", resumen: {}, posiciones: [], sinPrecio: [] };
    trabajos.set(ID, { estado: "completado", progreso: 90, datos, intentos: 1, resultado: resultado as never });

    const respuesta = await servicio.consultar(ID);

    expect(respuesta.estado).toBe("completado");
    expect(respuesta.progreso).toBe(100);
    expect(respuesta.resultado).toEqual(resultado);
    expect(respuesta).not.toHaveProperty("motivo");
  });

  test("un reporte fallido trae el motivo y no trae resultado", async () => {
    const { servicio, trabajos } = armar();
    trabajos.set(ID, { estado: "fallido", progreso: 10, datos, intentos: 3, motivo: "La API de precios respondió con el estado 429" });

    const respuesta = await servicio.consultar(ID);

    expect(respuesta).toMatchObject({ estado: "fallido", intentos: 3, motivo: "La API de precios respondió con el estado 429" });
    expect(respuesta).not.toHaveProperty("resultado");
  });

  test("el motivo solo se muestra si el reporte está fallido (uno en reintento no lo muestra)", async () => {
    const { servicio, trabajos } = armar();
    trabajos.set(ID, { estado: "en_cola", progreso: 0, datos, intentos: 1, motivo: "falló una vez" });

    expect(await servicio.consultar(ID)).not.toHaveProperty("motivo");
  });

  test("un id que no existe da 404", async () => {
    const { servicio } = armar();

    expect((await errorDe(servicio.consultar(ID))).estado).toBe(404);
  });

  test("un id que no es un UUID da 404 sin preguntarle a la cola", async () => {
    let consultas = 0;
    const { servicio } = armar({
      buscar: async () => {
        consultas += 1;
        return undefined;
      },
    });

    expect((await errorDe(servicio.consultar("meta"))).estado).toBe(404);
    expect(consultas).toBe(0);
  });

  test("si la cola falla da 503", async () => {
    const { servicio } = armar({
      buscar: async () => {
        throw new Error("Redis caído");
      },
    });

    expect((await errorDe(servicio.consultar(ID))).estado).toBe(503);
  });
});
