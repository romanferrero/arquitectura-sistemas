import { describe, expect, test } from "@jest/globals";
import type { Activo } from "../../src/modelos/activo.ts";
import { CLAVE_RANKING, crearCacheActivos } from "../../src/servicios/crearCacheActivos.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";
import { crearRedisFalso } from "../ayudas/redisFalso.ts";

const bitcoin: Activo = {
  id: "id-btc",
  simbolo: "BTC",
  nombre: "Bitcoin",
  cantidad: 0.5,
  precioCompra: 30000,
  creadoEn: "2026-10-01T10:00:00.000Z",
  actualizadoEn: "2026-10-01T10:00:00.000Z",
};

function armar() {
  const falso = crearRedisFalso();
  const registro = crearRegistroEnMemoria();
  const cache = crearCacheActivos({ redis: falso.redis, registrador: registro.registradorDe("Cache"), ttlSegundos: 60 });
  return { ...falso, lineas: registro.lineas, cache };
}

describe("crearCacheActivos", () => {
  test("un activo que no está guardado no se encuentra", async () => {
    const { cache } = armar();

    expect(await cache.leer("id-btc")).toBeUndefined();
  });

  test("guarda el activo con el TTL configurado y lo devuelve igual", async () => {
    const { cache, ttl, textos } = armar();

    await cache.guardar(bitcoin);

    expect(ttl.get("activo:id-btc")).toBe(60);
    expect(textos.has("activo:id-btc")).toBe(true);
    expect(await cache.leer("id-btc")).toEqual(bitcoin);
  });

  test("invalidar saca el activo de la caché", async () => {
    const { cache } = armar();
    await cache.guardar(bitcoin);

    await cache.invalidar("id-btc");

    expect(await cache.leer("id-btc")).toBeUndefined();
  });

  test("cada consulta suma uno al ranking y eliminar al activo lo saca", async () => {
    const { cache, rankings } = armar();

    await cache.contarConsulta("id-btc");
    await cache.contarConsulta("id-btc");
    await cache.contarConsulta("id-eth");
    expect(rankings.get(CLAVE_RANKING)?.get("id-btc")).toBe(2);
    expect(rankings.get(CLAVE_RANKING)?.get("id-eth")).toBe(1);

    await cache.quitarDelRanking("id-btc");
    expect(rankings.get(CLAVE_RANKING)?.has("id-btc")).toBe(false);
  });

  test("un dato corrupto en la caché se trata como si no estuviera y se avisa", async () => {
    const { cache, textos, lineas } = armar();
    textos.set("activo:id-btc", "{esto no es json");

    expect(await cache.leer("id-btc")).toBeUndefined();
    expect(lineas.some((linea) => linea.includes("Dato inválido"))).toBe(true);
  });

  test("un dato guardado bajo otro id no se acepta", async () => {
    const { cache, textos } = armar();
    textos.set("activo:id-btc", JSON.stringify({ ...bitcoin, id: "otro-id" }));

    expect(await cache.leer("id-btc")).toBeUndefined();
  });

  describe("con Redis caído", () => {
    test("ningún método rechaza: la caché falla en silencio y deja el error en el log", async () => {
      const { cache, estado, lineas } = armar();
      estado.caido = true;

      expect(await cache.leer("id-btc")).toBeUndefined();
      await expect(cache.guardar(bitcoin)).resolves.toBeUndefined();
      await expect(cache.invalidar("id-btc")).resolves.toBeUndefined();
      await expect(cache.contarConsulta("id-btc")).resolves.toBeUndefined();
      await expect(cache.quitarDelRanking("id-btc")).resolves.toBeUndefined();

      expect(lineas).toHaveLength(5);
      expect(lineas.every((linea) => linea.startsWith("[ERROR] Cache:") && linea.includes("Redis no responde"))).toBe(true);
    });
  });
});
