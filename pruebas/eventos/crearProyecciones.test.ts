import { describe, expect, test } from "@jest/globals";
import { crearProyecciones } from "../../src/eventos/crearProyecciones.ts";
import type { NuevoRegistroAuditoria } from "../../src/modelos/auditoria.ts";
import { crearCacheActivos } from "../../src/servicios/crearCacheActivos.ts";
import { CLAVE_EVENTOS_ACTIVOS } from "../../src/servicios/crearServicioEstadisticas.ts";
import { crearRedisFalso } from "../ayudas/redisFalso.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";
import { activoDePrueba, eventoActualizado, eventoCreado, eventoEliminado } from "../ayudas/eventosDePrueba.ts";

/**
 * La cache es la REAL (con un Redis falso) para ver sus efectos en las claves; la auditoria es un
 * repositorio falso con el mismo comportamiento idempotente que el de MongoDB (indice unico en idEvento).
 */
function armar(cambios: { auditoriaFalla?: boolean } = {}) {
  const falso = crearRedisFalso();
  const registro = crearRegistroEnMemoria();
  const cache = crearCacheActivos({ redis: falso.redis, registrador: registro.registradorDe("Cache"), ttlSegundos: 60 });

  const auditados: (NuevoRegistroAuditoria & { idEvento: string })[] = [];
  const proyecciones = crearProyecciones({
    cache,
    redis: falso.redis,
    auditoria: {
      registrarEvento: async (nuevo) => {
        if (cambios.auditoriaFalla === true) throw new Error("MongoDB no responde");
        if (auditados.some((existente) => existente.idEvento === nuevo.idEvento)) return "duplicado";
        auditados.push(nuevo);
        return "registrado";
      },
    },
    registrador: registro.registradorDe("Proyecciones"),
  });

  return { proyecciones, auditados, cache, ...falso, lineas: registro.lineas };
}

describe("proyecciones · la caché", () => {
  test("un activo creado deja vieja la lista: la invalida", async () => {
    const { proyecciones, textos } = armar();
    textos.set("activos:todos", "[]");

    await proyecciones.proyectar(eventoCreado);

    expect(textos.has("activos:todos")).toBe(false);
  });

  test("un activo actualizado invalida su entrada y la lista, y NO escribe el dato del evento", async () => {
    const { proyecciones, textos, comandos } = armar();
    textos.set("activo:id-btc", JSON.stringify(activoDePrueba));
    textos.set("activos:todos", "[]");

    await proyecciones.proyectar(eventoActualizado);

    expect(textos.has("activo:id-btc")).toBe(false);
    expect(textos.has("activos:todos")).toBe(false);
    expect(comandos.some((comando) => comando.startsWith("SET "))).toBe(false); // solo invalida: un evento viejo no pisa un dato nuevo
  });

  test("un activo eliminado se saca de la caché, de la lista y del ranking", async () => {
    const { proyecciones, textos, rankings } = armar();
    textos.set("activo:id-btc", JSON.stringify(activoDePrueba));
    textos.set("activos:todos", "[]");
    rankings.set("activos:mas-consultados", new Map([["id-btc", 7], ["id-eth", 3]]));

    await proyecciones.proyectar(eventoEliminado);

    expect(textos.has("activo:id-btc")).toBe(false);
    expect(textos.has("activos:todos")).toBe(false);
    expect([...(rankings.get("activos:mas-consultados")?.keys() ?? [])]).toEqual(["id-eth"]);
  });

  test("crear o actualizar NO toca el ranking: un activo no pierde sus consultas por cambiar", async () => {
    const { proyecciones, rankings } = armar();
    rankings.set("activos:mas-consultados", new Map([["id-btc", 7]]));

    await proyecciones.proyectar(eventoCreado);
    await proyecciones.proyectar(eventoActualizado);

    expect(rankings.get("activos:mas-consultados")?.get("id-btc")).toBe(7);
  });

  test("el id del activo se normaliza a minúsculas, como en la caché que lo guardó", async () => {
    const { proyecciones, textos } = armar();
    textos.set("activo:id-btc", JSON.stringify(activoDePrueba));

    await proyecciones.proyectar({ ...eventoActualizado, activoId: "ID-BTC" });

    expect(textos.has("activo:id-btc")).toBe(false);
  });
});

describe("proyecciones · el contador de eventos", () => {
  test("suma uno al campo del tipo de evento en el Hash estadisticas:eventos-activos", async () => {
    const { proyecciones, hashes } = armar();

    await proyecciones.proyectar(eventoCreado);
    await proyecciones.proyectar(eventoCreado);
    await proyecciones.proyectar(eventoEliminado);

    expect(hashes.get(CLAVE_EVENTOS_ACTIVOS)).toEqual({ ACTIVO_CREADO: "2", ACTIVO_ELIMINADO: "1" });
  });
});

describe("proyecciones · la auditoría", () => {
  test("un ACTIVO_CREADO se audita como CREAR con el activo, los metadatos, el id del evento y su fecha", async () => {
    const { proyecciones, auditados } = armar();

    await proyecciones.proyectar(eventoCreado);

    expect(auditados).toEqual([
      {
        operacion: "CREAR",
        entidadId: "id-btc",
        despues: activoDePrueba,
        metadatos: { origen: "API", usuario: "auth0|ana" },
        idEvento: eventoCreado.idEvento,
        ocurridoEn: eventoCreado.ocurridoEn,
      },
    ]);
  });

  test("un ACTIVO_ACTUALIZADO se audita como ACTUALIZAR con antes, después y los campos modificados", async () => {
    const { proyecciones, auditados } = armar();

    await proyecciones.proyectar(eventoActualizado);

    expect(auditados[0]).toMatchObject({
      operacion: "ACTUALIZAR",
      antes: activoDePrueba,
      despues: { ...activoDePrueba, cantidad: 2 },
      camposModificados: ["cantidad"],
    });
  });

  test("un ACTIVO_ELIMINADO se audita como ELIMINAR con como era el activo y sin `despues`", async () => {
    const { proyecciones, auditados } = armar();

    await proyecciones.proyectar(eventoEliminado);

    expect(auditados[0]?.operacion).toBe("ELIMINAR");
    expect(auditados[0]?.antes).toEqual(activoDePrueba);
    expect(Object.keys(auditados[0] ?? {})).not.toContain("despues");
  });

  test("la conversión de moneda viaja en los metadatos de la auditoría", async () => {
    const { proyecciones, auditados } = armar();
    const conversion = { monedaOriginal: "EUR", precioOriginal: 100, tasa: 1.1 };

    await proyecciones.proyectar({ ...eventoCreado, metadatos: { origen: "API", usuario: "auth0|ana", conversionMoneda: conversion } });

    expect(auditados[0]?.metadatos).toEqual({ origen: "API", usuario: "auth0|ana", conversionMoneda: conversion });
  });

  test("el MISMO evento recibido dos veces se audita una sola vez (idempotente por idEvento)", async () => {
    const { proyecciones, auditados, lineas } = armar();

    await proyecciones.proyectar(eventoCreado);
    await proyecciones.proyectar(eventoCreado);

    expect(auditados).toHaveLength(1);
    expect(lineas.some((linea) => linea.includes("ya estaba auditado"))).toBe(true);
  });

  test("dos eventos distintos del mismo activo se auditan los dos", async () => {
    const { proyecciones, auditados } = armar();

    await proyecciones.proyectar(eventoCreado);
    await proyecciones.proyectar({ ...eventoActualizado, idEvento: "11111111-1111-4111-8111-111111111111" });

    expect(auditados.map((registro) => registro.operacion)).toEqual(["CREAR", "ACTUALIZAR"]);
  });
});

describe("proyecciones · cuando algo falla", () => {
  test("si MongoDB falla igual se invalida la caché y se cuenta el evento, y no rechaza", async () => {
    const { proyecciones, textos, hashes, lineas } = armar({ auditoriaFalla: true });
    textos.set("activos:todos", "[]");

    await expect(proyecciones.proyectar(eventoCreado)).resolves.toBeUndefined();

    expect(textos.has("activos:todos")).toBe(false);
    expect(hashes.get(CLAVE_EVENTOS_ACTIVOS)).toEqual({ ACTIVO_CREADO: "1" });
    expect(lineas.some((linea) => linea.includes("[ERROR] Proyecciones: No se pudo auditar el evento") && linea.includes("MongoDB no responde"))).toBe(true);
  });

  test("con Redis caído no rechaza: la auditoría se escribe igual y los fallos quedan en el log", async () => {
    const { proyecciones, auditados, estado, lineas } = armar();
    estado.caido = true;

    await expect(proyecciones.proyectar(eventoCreado)).resolves.toBeUndefined();

    expect(auditados).toHaveLength(1);
    expect(lineas.some((linea) => linea.includes("No se pudo contar el evento"))).toBe(true);
    expect(lineas.some((linea) => linea.includes("Cache:"))).toBe(true);
  });

  test("si un paso de la caché RECHAZA, igual se cuenta el evento y se audita (los pasos son independientes)", async () => {
    const falso = crearRedisFalso();
    const registro = crearRegistroEnMemoria();
    const auditados: string[] = [];
    const proyecciones = crearProyecciones({
      cache: {
        invalidar: async () => {
          throw new Error("la caché explotó");
        },
        invalidarLista: async () => {
          throw new Error("la lista explotó");
        },
        quitarDelRanking: async () => {
          throw new Error("el ranking explotó");
        },
      },
      redis: falso.redis,
      auditoria: { registrarEvento: async (nuevo) => (auditados.push(nuevo.idEvento), "registrado" as const) },
      registrador: registro.registradorDe("Proyecciones"),
    });

    await expect(proyecciones.proyectar(eventoEliminado)).resolves.toBeUndefined();

    expect(falso.hashes.get(CLAVE_EVENTOS_ACTIVOS)).toEqual({ ACTIVO_ELIMINADO: "1" });
    expect(auditados).toEqual([eventoEliminado.idEvento]);
    expect(registro.lineas.filter((linea) => linea.includes("[ERROR]"))).toHaveLength(3);
  });

  test("al terminar deja constancia de qué evento procesó", async () => {
    const { proyecciones, lineas } = armar();

    await proyecciones.proyectar(eventoCreado);

    expect(lineas.at(-1)).toBe(`[INFO] Proyecciones: Evento ACTIVO_CREADO procesado (${eventoCreado.idEvento}, activo id-btc)`);
  });
});
