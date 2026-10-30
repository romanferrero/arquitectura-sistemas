import { describe, expect, test } from "@jest/globals";
import { ErrorApi } from "../../src/errores/ErrorApi.ts";
import type { Activo } from "../../src/modelos/activo.ts";
import { CLAVE_RANKING } from "../../src/servicios/crearCacheActivos.ts";
import { CLAVE_REPORTES_EXITOSOS, crearServicioEstadisticas } from "../../src/servicios/crearServicioEstadisticas.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";
import { crearRedisFalso } from "../ayudas/redisFalso.ts";

function armar(activos: Record<string, string> = {}) {
  const falso = crearRedisFalso();
  const registro = crearRegistroEnMemoria();
  const servicio = crearServicioEstadisticas({
    redis: falso.redis,
    buscarActivo: async (id) => (activos[id] === undefined ? undefined : ({ id, simbolo: activos[id] } as Activo)),
    registrador: registro.registradorDe("Estadisticas"),
    cantidadMasConsultados: 3,
  });
  return { ...falso, servicio, lineas: registro.lineas };
}

describe("crearServicioEstadisticas", () => {
  test("sin datos todo está en cero y el ranking vacío", async () => {
    const { servicio } = armar();

    expect(await servicio.obtener()).toEqual({ reportesExitosos: 0, masConsultados: [] });
  });

  test("el contador de reportes lo lleva INCR: cada incremento se refleja", async () => {
    const { servicio, redis } = armar();

    await redis.incr(CLAVE_REPORTES_EXITOSOS);
    await redis.incr(CLAVE_REPORTES_EXITOSOS);
    await redis.incr(CLAVE_REPORTES_EXITOSOS);

    expect((await servicio.obtener()).reportesExitosos).toBe(3);
  });

  test("el ranking va de más a menos consultado, con el símbolo de cada activo", async () => {
    const { servicio, redis } = armar({ "id-btc": "BTC", "id-eth": "ETH" });
    await redis.zIncrBy(CLAVE_RANKING, 2, "id-eth");
    await redis.zIncrBy(CLAVE_RANKING, 5, "id-btc");

    expect((await servicio.obtener()).masConsultados).toEqual([
      { id: "id-btc", simbolo: "BTC", consultas: 5 },
      { id: "id-eth", simbolo: "ETH", consultas: 2 },
    ]);
  });

  test("muestra solo los N más consultados", async () => {
    const { servicio, redis } = armar();
    for (const [id, veces] of [["a", 1], ["b", 4], ["c", 3], ["d", 2]] as const) await redis.zIncrBy(CLAVE_RANKING, veces, id);

    const { masConsultados } = await servicio.obtener();

    expect(masConsultados.map((fila) => fila.id)).toEqual(["b", "c", "d"]);
  });

  test("un activo que ya no existe en MySQL aparece sin símbolo en vez de fallar", async () => {
    const { servicio, redis } = armar();
    await redis.zIncrBy(CLAVE_RANKING, 1, "id-borrado");

    expect((await servicio.obtener()).masConsultados).toEqual([{ id: "id-borrado", consultas: 1 }]);
  });

  test("con Redis caído da 503 y lo deja en el log", async () => {
    const { servicio, estado, lineas } = armar();
    estado.caido = true;

    try {
      await servicio.obtener();
      throw new Error("Se esperaba un error");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorApi);
      expect((error as ErrorApi).estado).toBe(503);
    }
    expect(lineas[0]).toContain("[ERROR] Estadisticas:");
  });
});
