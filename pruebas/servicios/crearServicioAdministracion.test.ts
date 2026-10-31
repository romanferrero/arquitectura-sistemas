import { describe, expect, test } from "@jest/globals";
import { ErrorApi } from "../../src/errores/ErrorApi.ts";
import { crearServicioAdministracion } from "../../src/servicios/crearServicioAdministracion.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";
import { crearRedisFalso } from "../ayudas/redisFalso.ts";

function armar(tamanoTanda?: number) {
  const falso = crearRedisFalso();
  const registro = crearRegistroEnMemoria();
  const servicio = crearServicioAdministracion({
    redis: falso.redis,
    registrador: registro.registradorDe("Administracion"),
    ...(tamanoTanda === undefined ? {} : { tamanoTanda }),
  });
  return { falso, servicio, lineas: registro.lineas };
}

/** Llena Redis con cache de activos Y con todo lo demas que vive ahi y NO se puede tocar. */
async function poblar(falso: ReturnType<typeof crearRedisFalso>, cantidadDeActivos: number): Promise<void> {
  for (let i = 0; i < cantidadDeActivos; i += 1) await falso.redis.set(`activo:id-${i}`, "{}", { EX: 60 });
  await falso.redis.set("estadisticas:reportes-exitosos", "7");
  await falso.redis.set("modo_panico", "true");
  await falso.redis.set("bull:cola-reportes:meta", "{}");
  await falso.redis.set("bull:cola-reportes:abc", "{}");
  await falso.redis.hSet("preferencias:auth0|ana", { monedaVisualizacion: "EUR" });
  await falso.redis.zIncrBy("activos:mas-consultados", 3, "id-0");
}

const INTACTAS = [
  "bull:cola-reportes:abc",
  "bull:cola-reportes:meta",
  "estadisticas:reportes-exitosos",
  "modo_panico",
  "preferencias:auth0|ana",
  "activos:mas-consultados",
];

function clavesQueQuedan(falso: ReturnType<typeof crearRedisFalso>): string[] {
  return [...falso.textos.keys(), ...falso.hashes.keys(), ...falso.rankings.keys()].sort();
}

describe("crearServicioAdministracion · limpiarCache", () => {
  test("borra solo las entradas de la caché de activos y dice cuántas", async () => {
    const { falso, servicio } = armar();
    await poblar(falso, 3);

    expect(await servicio.limpiarCache("auth0|admin")).toEqual({ eliminadas: 3 });

    expect(clavesQueQuedan(falso)).toEqual([...INTACTAS].sort());
  });

  test("NO toca los trabajos de la cola, las preferencias, el contador, el ranking ni el modo pánico", async () => {
    const { falso, servicio } = armar();
    await poblar(falso, 5);

    await servicio.limpiarCache("auth0|admin");

    for (const clave of INTACTAS) {
      expect(clavesQueQuedan(falso)).toContain(clave);
    }
  });

  test("recorre TODAS las tandas de SCAN, no solo la primera", async () => {
    const { falso, servicio } = armar(2); // de a 2 claves por vuelta
    await poblar(falso, 9);

    expect(await servicio.limpiarCache("auth0|admin")).toEqual({ eliminadas: 9 });

    expect(falso.comandos.filter((comando) => comando.startsWith("SCAN")).length).toBeGreaterThan(3);
    expect(clavesQueQuedan(falso).filter((clave) => clave.startsWith("activo:"))).toEqual([]);
  });

  test("usa SCAN con el patrón activo:* y nunca KEYS ni FLUSH", async () => {
    const { falso, servicio } = armar();
    await poblar(falso, 2);

    await servicio.limpiarCache("auth0|admin");

    expect(falso.comandos.some((comando) => comando.startsWith("SCAN 0 MATCH activo:* "))).toBe(true);
    expect(falso.comandos.some((comando) => /KEYS|FLUSH/.test(comando))).toBe(false);
  });

  test("con la caché vacía devuelve 0 y no falla", async () => {
    const { servicio } = armar();

    expect(await servicio.limpiarCache("auth0|admin")).toEqual({ eliminadas: 0 });
  });

  test("quién la limpió y cuántas entradas borró queda en el log", async () => {
    const { falso, servicio, lineas } = armar();
    await poblar(falso, 4);

    await servicio.limpiarCache("auth0|admin");

    expect(lineas).toEqual(["[INFO] Administracion: auth0|admin limpió la caché de activos (4 entradas)"]);
  });

  test("con Redis caído da 503 y lo deja en el log", async () => {
    const { falso, servicio, lineas } = armar();
    falso.estado.caido = true;

    try {
      await servicio.limpiarCache("auth0|admin");
      throw new Error("Se esperaba un error");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorApi);
      expect((error as ErrorApi).estado).toBe(503);
    }
    expect(lineas[0]).toContain("[ERROR] Administracion: No se pudo limpiar la caché");
  });
});
