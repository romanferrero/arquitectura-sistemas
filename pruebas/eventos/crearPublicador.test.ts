import { describe, expect, test } from "@jest/globals";
import { crearPublicador } from "../../src/eventos/crearPublicador.ts";
import { CANAL_ACTIVOS, parsearEventoActivo } from "../../src/eventos/eventoActivo.ts";
import type { DatosEventoActivo } from "../../src/eventos/eventoActivo.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";
import { crearRedisFalso } from "../ayudas/redisFalso.ts";

const ID_EVENTO = "8f509a2c-d7d1-4cf8-a0a8-f422bb0c3e83";

const activo = {
  id: "id-btc",
  simbolo: "BTC",
  nombre: "Bitcoin",
  cantidad: 0.5,
  precioCompra: 30000,
  creadoEn: "2026-11-04T10:00:00.000Z",
  actualizadoEn: "2026-11-04T10:00:00.000Z",
};

const creado: DatosEventoActivo = {
  tipo: "ACTIVO_CREADO",
  activoId: "id-btc",
  despues: activo,
  metadatos: { origen: "API", usuario: "auth0|ana" },
};

function armar() {
  const falso = crearRedisFalso();
  const registro = crearRegistroEnMemoria();
  const publicador = crearPublicador({
    redis: falso.redis,
    registrador: registro.registradorDe("Eventos"),
    generarId: () => ID_EVENTO,
    ahora: () => new Date("2026-11-04T10:00:00.000Z"),
  });
  return { ...falso, publicador, lineas: registro.lineas };
}

describe("crearPublicador", () => {
  test("publica en el canal activos-actualizaciones un mensaje que cumple el contrato", async () => {
    const { publicador, publicados } = armar();

    await publicador.publicar(creado);

    expect(publicados).toHaveLength(1);
    expect(publicados[0]?.canal).toBe(CANAL_ACTIVOS);
    expect(parsearEventoActivo(publicados[0]?.mensaje ?? "")).toEqual({
      version: 1,
      idEvento: ID_EVENTO,
      ocurridoEn: "2026-11-04T10:00:00.000Z",
      ...creado,
    });
  });

  test("completa la versión, el id y la fecha: el que publica no los pone", async () => {
    const { publicador, publicados } = armar();

    await publicador.publicar(creado);

    const evento = JSON.parse(publicados[0]?.mensaje ?? "{}") as Record<string, unknown>;
    expect(evento["version"]).toBe(1);
    expect(evento["idEvento"]).toBe(ID_EVENTO);
    expect(evento["ocurridoEn"]).toBe("2026-11-04T10:00:00.000Z");
  });

  test("deja en el log cuántos suscriptores lo recibieron", async () => {
    const { publicador, estado, lineas } = armar();
    estado.receptores = 2;

    await publicador.publicar(creado);

    expect(lineas).toEqual([`[INFO] Eventos: Evento ACTIVO_CREADO publicado (${ID_EVENTO}, activo id-btc, receptores: 2)`]);
  });

  test("con 0 receptores igual publica (nadie escuchaba) y lo dice en el log", async () => {
    const { publicador, lineas } = armar();

    await publicador.publicar(creado);

    expect(lineas[0]).toContain("receptores: 0");
  });

  test("con Redis caído NO rechaza: la operación que lo originó ya se confirmó en MySQL", async () => {
    const { publicador, estado, lineas } = armar();
    estado.caido = true;

    await expect(publicador.publicar(creado)).resolves.toBeUndefined();

    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain("[ERROR] Eventos: No se pudo publicar el evento ACTIVO_CREADO de id-btc");
  });

  test("un evento que no cumple el contrato no se publica y queda en el log como error", async () => {
    const { publicador, publicados, lineas } = armar();

    // Un ACTIVO_CREADO sin `despues` es un bug de quien publica: los suscriptores lo descartarian.
    await publicador.publicar({ tipo: "ACTIVO_CREADO", activoId: "id-btc", metadatos: { origen: "API" } });

    expect(publicados).toEqual([]);
    expect(lineas[0]).toContain("[ERROR] Eventos: No se publicó el evento ACTIVO_CREADO de id-btc: no cumple el contrato");
  });

  test("cada evento lleva su propio id", async () => {
    const falso = crearRedisFalso();
    let contador = 0;
    const publicador = crearPublicador({
      redis: falso.redis,
      registrador: crearRegistroEnMemoria().registradorDe("Eventos"),
      generarId: () => `8f509a2c-d7d1-4cf8-a0a8-f422bb0c3e8${(contador += 1)}`,
      ahora: () => new Date(),
    });

    await publicador.publicar(creado);
    await publicador.publicar(creado);

    const ids = falso.publicados.map((p) => (JSON.parse(p.mensaje) as { idEvento: string }).idEvento);
    expect(new Set(ids).size).toBe(2);
  });

  describe("publica un evento por tipo de operación", () => {
    test("actualizado trae antes, después y los campos que cambiaron", async () => {
      const { publicador, publicados } = armar();

      await publicador.publicar({
        tipo: "ACTIVO_ACTUALIZADO",
        activoId: "id-btc",
        antes: activo,
        despues: { ...activo, cantidad: 2 },
        camposModificados: ["cantidad"],
        metadatos: { origen: "API", usuario: "auth0|ana" },
      });

      const evento = parsearEventoActivo(publicados[0]?.mensaje ?? "");
      expect(evento.camposModificados).toEqual(["cantidad"]);
      expect(evento.antes?.cantidad).toBe(0.5);
      expect(evento.despues?.cantidad).toBe(2);
    });

    test("eliminado trae como era el activo", async () => {
      const { publicador, publicados } = armar();

      await publicador.publicar({ tipo: "ACTIVO_ELIMINADO", activoId: "id-btc", antes: activo, metadatos: { origen: "API" } });

      const evento = parsearEventoActivo(publicados[0]?.mensaje ?? "");
      expect(evento.antes).toEqual(activo);
      expect(evento.despues).toBeUndefined();
    });
  });
});
