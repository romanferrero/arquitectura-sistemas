import { describe, expect, test } from "@jest/globals";
import { SimboloDuplicadoError } from "../../src/datos/simboloDuplicadoError.ts";
import { ErrorApi } from "../../src/errores/ErrorApi.ts";
import type { DatosEventoActivo } from "../../src/eventos/eventoActivo.ts";
import type { Activo, DatosActivo } from "../../src/modelos/activo.ts";
import type { NuevoRegistroAuditoria } from "../../src/modelos/auditoria.ts";
import type { ConversionMoneda } from "../../src/pipeline/ingesta/tipos.ts";
import { crearComandosActivos } from "../../src/servicios/comandos/crearComandosActivos.ts";
import type { RepositorioDeEscritura } from "../../src/servicios/comandos/crearComandosActivos.ts";

const AHORA = new Date("2026-11-04T12:00:00.000Z");
const ANA = "auth0|ana";

const bitcoin: Activo = {
  id: "id-btc",
  simbolo: "BTC",
  nombre: "Bitcoin",
  cantidad: 0.5,
  precioCompra: 30000,
  creadoEn: "2026-11-01T10:00:00.000Z",
  actualizadoEn: "2026-11-01T10:00:00.000Z",
};

/**
 * Todo falso y en memoria: un repositorio que se comporta como MySQL (simbolo unico, fila que puede
 * desaparecer) y, para comprobar el ORDEN de lo que pasa despues de confirmar, un registro compartido
 * de llamadas a la cache, la auditoria y el publicador.
 */
function armar(cambios: { ingestar?: (cuerpo: unknown) => Promise<{ datos: DatosActivo; conversion: ConversionMoneda | undefined }> } = {}) {
  const filas = new Map<string, Activo>();
  const llamadas: string[] = [];
  const auditados: NuevoRegistroAuditoria[] = [];
  const publicados: DatosEventoActivo[] = [];
  let siguienteId = 0;

  const repositorio: RepositorioDeEscritura = {
    buscarPorId: async (id) => filas.get(id),
    guardar: async (activo) => {
      if ([...filas.values()].some((fila) => fila.simbolo === activo.simbolo)) throw new SimboloDuplicadoError(activo.simbolo);
      filas.set(activo.id, activo);
      llamadas.push("mysql:guardar");
      return activo;
    },
    reemplazar: async (id, activo) => {
      const antes = filas.get(id);
      if (antes === undefined) return undefined;
      if ([...filas.values()].some((fila) => fila.id !== id && fila.simbolo === activo.simbolo)) throw new SimboloDuplicadoError(activo.simbolo);
      filas.set(id, activo);
      llamadas.push("mysql:reemplazar");
      return { antes, despues: activo };
    },
    eliminar: async (id) => {
      llamadas.push("mysql:eliminar");
      return filas.delete(id);
    },
  };

  const comandos = crearComandosActivos({
    repositorio,
    ingestar:
      cambios.ingestar ??
      (async (cuerpo) => ({ datos: cuerpo as DatosActivo, conversion: undefined })),
    auditoria: {
      registrar: async (registro) => {
        llamadas.push("auditoria");
        auditados.push(registro);
      },
    },
    cache: {
      invalidar: async (id) => void llamadas.push(`cache:invalidar:${id}`),
      invalidarLista: async () => void llamadas.push("cache:invalidarLista"),
      quitarDelRanking: async (id) => void llamadas.push(`cache:ranking:${id}`),
    },
    publicador: {
      publicar: async (evento) => {
        llamadas.push(`evento:${evento.tipo}`);
        publicados.push(evento);
      },
    },
    generarId: () => `id-nuevo-${(siguienteId += 1)}`,
    ahora: () => AHORA,
  });

  return { comandos, filas, llamadas, auditados, publicados };
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

const datosEth: DatosActivo = { simbolo: "ETH", nombre: "Ethereum", cantidad: 2, precioCompra: 2000 };

describe("comandos · crearActivo", () => {
  test("guarda el activo con id y fechas que pone el servidor, y lo devuelve", async () => {
    const { comandos, filas } = armar();

    const creado = await comandos.crearActivo(datosEth, ANA);

    expect(creado).toEqual({ id: "id-nuevo-1", ...datosEth, creadoEn: AHORA.toISOString(), actualizadoEn: AHORA.toISOString() });
    expect(filas.get("id-nuevo-1")).toEqual(creado);
  });

  test("después de confirmar en MySQL: invalida la lista, audita y PUBLICA el evento, en ese orden", async () => {
    const { comandos, llamadas } = armar();

    await comandos.crearActivo(datosEth, ANA);

    expect(llamadas).toEqual(["mysql:guardar", "cache:invalidarLista", "auditoria", "evento:ACTIVO_CREADO"]);
  });

  test("el evento lleva el activo creado, quién lo hizo y desde dónde", async () => {
    const { comandos, publicados } = armar();

    const creado = await comandos.crearActivo(datosEth, ANA);

    expect(publicados).toEqual([
      { tipo: "ACTIVO_CREADO", activoId: creado.id, despues: creado, metadatos: { origen: "API", usuario: ANA } },
    ]);
  });

  test("la conversión de moneda viaja en la auditoría y en el evento", async () => {
    const conversion: ConversionMoneda = { monedaOriginal: "EUR", precioOriginal: 1800, tasa: 1.11 };
    const { comandos, auditados, publicados } = armar({ ingestar: async () => ({ datos: datosEth, conversion }) });

    await comandos.crearActivo({}, ANA);

    expect(auditados[0]?.metadatos).toEqual({ origen: "API", usuario: ANA, conversionMoneda: conversion });
    expect(publicados[0]?.metadatos).toEqual({ origen: "API", usuario: ANA, conversionMoneda: conversion });
  });

  test("un símbolo repetido da 409 y NO deja rastro: ni caché, ni auditoría, ni evento", async () => {
    const { comandos, filas, llamadas } = armar();
    filas.set("id-btc", bitcoin);

    const error = await errorDe(comandos.crearActivo({ simbolo: "BTC", nombre: "Otro", cantidad: 1, precioCompra: 1 }, ANA));

    expect(error.estado).toBe(409);
    expect(llamadas).toEqual([]);
  });

  test("si el pipeline rechaza el cuerpo (400) no se toca nada", async () => {
    const { comandos, llamadas } = armar({
      ingestar: async () => {
        throw new ErrorApi(400, "Datos del activo inválidos", ["cantidad debe ser mayor a 0"]);
      },
    });

    expect((await errorDe(comandos.crearActivo({}, ANA))).estado).toBe(400);
    expect(llamadas).toEqual([]);
  });

  test("un error inesperado de la base sigue de largo y no publica nada", async () => {
    const llamadas: string[] = [];
    const roto = crearComandosActivos({
      repositorio: {
        buscarPorId: async () => undefined,
        guardar: async () => {
          throw new Error("MySQL se cayó");
        },
        reemplazar: async () => undefined,
        eliminar: async () => false,
      },
      ingestar: async () => ({ datos: datosEth, conversion: undefined }),
      auditoria: { registrar: async () => void llamadas.push("auditoria") },
      cache: { invalidar: async () => undefined, invalidarLista: async () => void llamadas.push("lista"), quitarDelRanking: async () => undefined },
      publicador: { publicar: async () => void llamadas.push("evento") },
      generarId: () => "x",
      ahora: () => AHORA,
    });

    await expect(roto.crearActivo({}, ANA)).rejects.toThrow("MySQL se cayó");
    expect(llamadas).toEqual([]);
  });
});

describe("comandos · actualizarActivo", () => {
  const nuevos: DatosActivo = { simbolo: "BTC", nombre: "Bitcoin", cantidad: 2, precioCompra: 31000 };

  test("reemplaza el activo conservando el id y la fecha de alta", async () => {
    const { comandos, filas } = armar();
    filas.set("id-btc", bitcoin);

    const despues = await comandos.actualizarActivo("id-btc", nuevos, ANA);

    expect(despues).toEqual({ id: "id-btc", ...nuevos, creadoEn: bitcoin.creadoEn, actualizadoEn: AHORA.toISOString() });
  });

  test("invalida la entrada y la lista, audita y publica el evento, en ese orden", async () => {
    const { comandos, filas, llamadas } = armar();
    filas.set("id-btc", bitcoin);

    await comandos.actualizarActivo("id-btc", nuevos, ANA);

    expect(llamadas).toEqual(["mysql:reemplazar", "cache:invalidar:id-btc", "cache:invalidarLista", "auditoria", "evento:ACTIVO_ACTUALIZADO"]);
  });

  test("el evento lleva el antes y el después REALES y los campos que cambiaron", async () => {
    const { comandos, filas, publicados, auditados } = armar();
    filas.set("id-btc", bitcoin);

    const despues = await comandos.actualizarActivo("id-btc", nuevos, ANA);

    expect(publicados[0]).toEqual({
      tipo: "ACTIVO_ACTUALIZADO",
      activoId: "id-btc",
      antes: bitcoin,
      despues,
      camposModificados: ["cantidad", "precioCompra"],
      metadatos: { origen: "API", usuario: ANA },
    });
    expect(auditados[0]?.camposModificados).toEqual(["cantidad", "precioCompra"]);
  });

  test("un id que no existe da 404 sin gastar el pipeline ni publicar", async () => {
    let ingestado = false;
    const { comandos, llamadas } = armar({
      ingestar: async () => {
        ingestado = true;
        return { datos: nuevos, conversion: undefined };
      },
    });

    expect((await errorDe(comandos.actualizarActivo("no-existe", nuevos, ANA))).estado).toBe(404);
    expect(ingestado).toBe(false);
    expect(llamadas).toEqual([]);
  });

  test("si el activo se borró mientras corría el pipeline da 404 y no publica", async () => {
    // El activo existe al empezar, pero desaparece mientras el pipeline consulta la API de tasas.
    const { comandos, filas, llamadas } = armar({
      ingestar: async () => {
        filas.delete("id-btc");
        return { datos: nuevos, conversion: undefined };
      },
    });
    filas.set("id-btc", bitcoin);

    expect((await errorDe(comandos.actualizarActivo("id-btc", nuevos, ANA))).estado).toBe(404);
    expect(llamadas).toEqual([]);
  });

  test("pisar el símbolo de OTRO activo da 409 y no publica", async () => {
    const { comandos, filas, llamadas } = armar();
    filas.set("id-btc", bitcoin);
    filas.set("id-eth", { ...bitcoin, id: "id-eth", simbolo: "ETH" });

    const error = await errorDe(comandos.actualizarActivo("id-btc", { ...nuevos, simbolo: "ETH" }, ANA));

    expect(error.estado).toBe(409);
    expect(llamadas).toEqual([]);
  });
});

describe("comandos · eliminarActivo", () => {
  test("borra el activo, limpia caché, lista y ranking, audita y publica el evento, en ese orden", async () => {
    const { comandos, filas, llamadas } = armar();
    filas.set("id-btc", bitcoin);

    await comandos.eliminarActivo("id-btc", ANA);

    expect(filas.has("id-btc")).toBe(false);
    expect(llamadas).toEqual([
      "mysql:eliminar",
      "cache:invalidar:id-btc",
      "cache:invalidarLista",
      "cache:ranking:id-btc",
      "auditoria",
      "evento:ACTIVO_ELIMINADO",
    ]);
  });

  test("el evento lleva como era el activo antes de borrarse", async () => {
    const { comandos, filas, publicados } = armar();
    filas.set("id-btc", bitcoin);

    await comandos.eliminarActivo("id-btc", ANA);

    expect(publicados).toEqual([{ tipo: "ACTIVO_ELIMINADO", activoId: "id-btc", antes: bitcoin, metadatos: { origen: "API", usuario: ANA } }]);
  });

  test("un id que no existe da 404 y no publica", async () => {
    const { comandos, llamadas } = armar();

    expect((await errorDe(comandos.eliminarActivo("no-existe", ANA))).estado).toBe(404);
    expect(llamadas).toEqual([]);
  });

  test("si otro lo borró justo en el medio da 404 y no publica", async () => {
    const { comandos, filas, llamadas } = armar();
    filas.set("id-btc", bitcoin);
    // buscarPorId lo ve, pero cuando llega el DELETE ya no esta (otro pedido lo borro primero).
    const original = filas.delete.bind(filas);
    filas.delete = () => (original("id-btc"), false);

    expect((await errorDe(comandos.eliminarActivo("id-btc", ANA))).estado).toBe(404);
    expect(llamadas).toEqual(["mysql:eliminar"]);
  });
});
