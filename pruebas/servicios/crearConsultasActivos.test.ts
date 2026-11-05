import { describe, expect, test } from "@jest/globals";
import { ErrorApi } from "../../src/errores/ErrorApi.ts";
import type { Activo } from "../../src/modelos/activo.ts";
import type { RegistroAuditoria } from "../../src/modelos/auditoria.ts";
import { crearCacheActivos } from "../../src/servicios/crearCacheActivos.ts";
import { crearConsultasActivos } from "../../src/servicios/consultas/crearConsultasActivos.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";
import { crearRedisFalso } from "../ayudas/redisFalso.ts";

const AHORA = new Date("2026-11-04T12:00:00.000Z");

function activo(id: string, simbolo: string, cantidad = 1, precioCompra = 100): Activo {
  return { id, simbolo, nombre: simbolo, cantidad, precioCompra, creadoEn: "2026-11-01T10:00:00.000Z", actualizadoEn: "2026-11-01T10:00:00.000Z" };
}

const btc = activo("id-btc", "BTC", 2, 30000);
const eth = activo("id-eth", "ETH", 10, 2000);

/**
 * La cache es la REAL (con un Redis falso) y la base es un contador: asi se ve cuantas veces una consulta
 * tuvo que ir a MySQL, que es justo lo que CQRS busca reducir.
 */
function armar(cambios: { precios?: Record<string, number>; historial?: RegistroAuditoria[] } = {}) {
  const falso = crearRedisFalso();
  const registro = crearRegistroEnMemoria();
  const cache = crearCacheActivos({ redis: falso.redis, registrador: registro.registradorDe("Cache"), ttlSegundos: 60 });
  const base = { activos: [btc, eth], consultasALaBase: 0 };

  const consultas = crearConsultasActivos({
    repositorio: {
      listar: async () => {
        base.consultasALaBase += 1;
        return [...base.activos];
      },
      buscarPorId: async (id) => {
        base.consultasALaBase += 1;
        return base.activos.find((fila) => fila.id === id);
      },
    },
    cache,
    auditoria: { historialDe: async () => cambios.historial ?? [] },
    obtenerPrecio: async (simbolo) => {
      const precio = cambios.precios?.[simbolo];
      if (precio === undefined) throw new ErrorApi(404, `No hay cotización para ${simbolo}`);
      return precio;
    },
    moneda: "usd",
    ahora: () => AHORA,
  });
  return { consultas, base, ...falso, lineas: registro.lineas, cache };
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

describe("consultas · listarActivos (el modelo de lectura)", () => {
  test("la primera lectura va a MySQL (MISS) y las siguientes salen de Redis (HIT) sin tocar la base", async () => {
    const { consultas, base } = armar();

    const primera = await consultas.listarActivos();
    const segunda = await consultas.listarActivos();
    const tercera = await consultas.listarActivos();

    expect([primera.cache, segunda.cache, tercera.cache]).toEqual(["MISS", "HIT", "HIT"]);
    expect(base.consultasALaBase).toBe(1); // tres lecturas, una sola consulta a la base
    expect(segunda.activos).toEqual([btc, eth]);
  });

  test("100 lecturas seguidas producen una sola consulta a la base principal", async () => {
    const { consultas, base } = armar();

    for (let i = 0; i < 100; i += 1) await consultas.listarActivos();

    expect(base.consultasALaBase).toBe(1);
  });

  test("filtrar por símbolo se hace sobre la lista cacheada, sin ir a la base", async () => {
    const { consultas, base } = armar();
    await consultas.listarActivos(); // llena la cache

    const resultado = await consultas.listarActivos("eth");

    expect(resultado.activos).toEqual([eth]);
    expect(resultado.cache).toBe("HIT");
    expect(base.consultasALaBase).toBe(1);
  });

  test("el filtro ignora mayúsculas y espacios, y un símbolo que no existe da una lista vacía", async () => {
    const { consultas } = armar();

    expect((await consultas.listarActivos("  Btc ")).activos).toEqual([btc]);
    expect((await consultas.listarActivos("XYZ")).activos).toEqual([]);
  });

  test("filtrar en un MISS guarda la lista COMPLETA, no solo el resultado filtrado", async () => {
    const { consultas } = armar();

    await consultas.listarActivos("BTC"); // MISS filtrado

    expect((await consultas.listarActivos()).activos).toEqual([btc, eth]); // la completa ya estaba en Redis
  });

  test("tras invalidar la lista (un comando la dejó vieja) la próxima lectura vuelve a MySQL", async () => {
    const { consultas, base, cache } = armar();
    await consultas.listarActivos();
    base.activos = [btc];

    await cache.invalidarLista();
    const resultado = await consultas.listarActivos();

    expect(resultado.cache).toBe("MISS");
    expect(resultado.activos).toEqual([btc]);
    expect(base.consultasALaBase).toBe(2);
  });

  test("con Redis caído lee de MySQL igual y no falla", async () => {
    const { consultas, estado, base } = armar();
    estado.caido = true;

    const resultado = await consultas.listarActivos();

    expect(resultado).toEqual({ activos: [btc, eth], cache: "MISS" });
    expect(base.consultasALaBase).toBe(1);
  });

  test("un dato corrupto en Redis se ignora y se lee de MySQL", async () => {
    const { consultas, textos, lineas } = armar();
    textos.set("activos:todos", "esto no es una lista");

    const resultado = await consultas.listarActivos();

    expect(resultado.cache).toBe("MISS");
    expect(resultado.activos).toEqual([btc, eth]);
    expect(lineas.some((linea) => linea.includes("Dato inválido"))).toBe(true);
  });

  test("la lista guardada tiene TTL: si no se invalida, se corrige sola", async () => {
    const { consultas, ttl } = armar();

    await consultas.listarActivos();

    expect(ttl.get("activos:todos")).toBe(60);
  });
});

describe("consultas · consultarActivo", () => {
  test("MISS la primera vez y HIT después, con una sola consulta a la base", async () => {
    const { consultas, base } = armar();

    const primera = await consultas.consultarActivo("id-btc");
    const segunda = await consultas.consultarActivo("id-btc");

    expect([primera.cache, segunda.cache]).toEqual(["MISS", "HIT"]);
    expect(segunda.activo).toEqual(btc);
    expect(base.consultasALaBase).toBe(1);
  });

  test("un id que no existe da 404 y no se guarda nada", async () => {
    const { consultas, textos } = armar();

    expect((await errorDe(consultas.consultarActivo("no-existe"))).estado).toBe(404);
    expect(textos.size).toBe(0);
  });
});

describe("consultas · obtenerActivoConPrecio", () => {
  test("calcula el valor actual, el costo y el rendimiento de la posición", async () => {
    const { consultas } = armar({ precios: { BTC: 33000 } });

    const resultado = await consultas.obtenerActivoConPrecio("id-btc");

    expect(resultado).toEqual({
      ...btc,
      precioActual: 33000,
      moneda: "usd",
      valorActual: 66000,
      costoTotal: 60000,
      gananciaPerdida: 6000,
      variacionPorcentual: 10,
      consultadoEn: AHORA.toISOString(),
    });
  });

  test("el activo sale del modelo de lectura: a la segunda no va a la base", async () => {
    const { consultas, base } = armar({ precios: { BTC: 33000 } });

    await consultas.obtenerActivoConPrecio("id-btc");
    await consultas.obtenerActivoConPrecio("id-btc");

    expect(base.consultasALaBase).toBe(1);
  });

  test("un id que no existe da 404 antes de pedir la cotización", async () => {
    const { consultas } = armar({ precios: { BTC: 1 } });

    expect((await errorDe(consultas.obtenerActivoConPrecio("no-existe"))).estado).toBe(404);
  });

  test("si el tercero no cotiza el símbolo, el error sigue de largo", async () => {
    const { consultas } = armar({ precios: {} });

    expect((await errorDe(consultas.obtenerActivoConPrecio("id-btc"))).estado).toBe(404);
  });
});

describe("consultas · historialDeActivo", () => {
  const registro: RegistroAuditoria = { id: "r1", operacion: "CREAR", entidad: "Activo", entidadId: "id-btc", ocurridoEn: "2026-11-01T10:00:00.000Z" };

  test("devuelve los registros aunque el activo ya no exista", async () => {
    const { consultas, base } = armar({ historial: [registro] });
    base.activos = [];

    expect(await consultas.historialDeActivo("id-btc")).toEqual([registro]);
  });

  test("sin registros y con el activo existente devuelve una lista vacía", async () => {
    const { consultas } = armar();

    expect(await consultas.historialDeActivo("id-btc")).toEqual([]);
  });

  test("sin registros y sin activo, el id es desconocido: 404", async () => {
    const { consultas } = armar();

    expect((await errorDe(consultas.historialDeActivo("nunca-existio"))).estado).toBe(404);
  });
});
