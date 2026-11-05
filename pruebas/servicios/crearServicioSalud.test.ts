import { describe, expect, test } from "@jest/globals";
import { crearServicioSalud } from "../../src/servicios/crearServicioSalud.ts";
import type { NombreDependencia } from "../../src/servicios/crearServicioSalud.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";

type Comportamiento = "ok" | "falla" | "cuelga";

/** Las tres comprobaciones falsas: cada una anda, falla o no responde nunca. */
function armar(comportamiento: Partial<Record<NombreDependencia, Comportamiento>> = {}, tiempoMaximoMs = 30) {
  const registro = crearRegistroEnMemoria();
  const llamadas: NombreDependencia[] = [];
  const comprobar = (nombre: NombreDependencia) => async (): Promise<void> => {
    llamadas.push(nombre);
    const que = comportamiento[nombre] ?? "ok";
    if (que === "falla") throw new Error(`${nombre} rechazó la conexión en db.interno:3306`);
    if (que === "cuelga") await new Promise(() => undefined);
  };
  let tiempo = 0;
  const salud = crearServicioSalud({
    comprobaciones: { mysql: comprobar("mysql"), mongodb: comprobar("mongodb"), redis: comprobar("redis") },
    tiempoMaximoMs,
    registrador: registro.registradorDe("Salud"),
    instancia: () => "3",
    pid: 4242,
    uptimeSegundos: () => 12.4,
    reloj: () => (tiempo += 5),
    ahora: () => new Date("2026-11-05T10:00:00.000Z"),
  });
  return { salud, llamadas, lineas: registro.lineas };
}

describe("crearServicioSalud", () => {
  test("con las tres bases respondiendo el estado es ok, y trae la instancia, el pid y el uptime", async () => {
    const { salud } = armar();

    const resultado = await salud.comprobar();

    expect(resultado.estado).toBe("ok");
    expect(resultado.dependencias.mysql.estado).toBe("ok");
    expect(resultado.dependencias.mongodb.estado).toBe("ok");
    expect(resultado.dependencias.redis.estado).toBe("ok");
    expect(resultado).toMatchObject({ instancia: "3", pid: 4242, uptimeSegundos: 12, fecha: "2026-11-05T10:00:00.000Z" });
  });

  test("comprueba las tres bases cada vez", async () => {
    const { salud, llamadas } = armar();

    await salud.comprobar();

    expect([...llamadas].sort()).toEqual(["mongodb", "mysql", "redis"]);
  });

  test.each<NombreDependencia>(["mysql", "mongodb", "redis"])("si %s falla, el estado es degradado y dice cuál", async (cual) => {
    const { salud } = armar({ [cual]: "falla" });

    const resultado = await salud.comprobar();

    expect(resultado.estado).toBe("degradado");
    expect(resultado.dependencias[cual].estado).toBe("error");
    const otras = (["mysql", "mongodb", "redis"] as const).filter((nombre) => nombre !== cual);
    for (const otra of otras) expect(resultado.dependencias[otra].estado).toBe("ok");
  });

  test("una base que no responde a tiempo cuenta como caída y NO cuelga el health check", async () => {
    const { salud } = armar({ redis: "cuelga" }, 20);

    const resultado = await salud.comprobar();

    expect(resultado.estado).toBe("degradado");
    expect(resultado.dependencias.redis.estado).toBe("error");
  });

  test("el detalle del error va al log y NO a la respuesta (el endpoint es público)", async () => {
    const { salud, lineas } = armar({ mysql: "falla" });

    const resultado = await salud.comprobar();

    expect(JSON.stringify(resultado)).not.toContain("db.interno");
    expect(lineas.some((linea) => linea.includes("[ERROR] Salud:") && linea.includes("mysql") && linea.includes("db.interno:3306"))).toBe(true);
  });

  test("con varias caídas a la vez las informa a todas", async () => {
    const { salud } = armar({ mysql: "falla", mongodb: "falla" });

    const { dependencias } = await salud.comprobar();

    expect([dependencias.mysql.estado, dependencias.mongodb.estado, dependencias.redis.estado]).toEqual(["error", "error", "ok"]);
  });

  test("mientras la instancia se apaga responde cerrando, aunque las bases anden", async () => {
    const { salud } = armar();
    salud.marcarCerrando();

    const resultado = await salud.comprobar();

    expect(resultado.estado).toBe("cerrando");
    expect(resultado.dependencias.mysql.estado).toBe("ok");
  });

  test("las comprobaciones corren en paralelo: tres que tardan lo mismo no suman sus tiempos", async () => {
    const registro = crearRegistroEnMemoria();
    const espera = async (): Promise<void> => void (await new Promise((resolver) => setTimeout(resolver, 40)));
    const salud = crearServicioSalud({
      comprobaciones: { mysql: espera, mongodb: espera, redis: espera },
      tiempoMaximoMs: 500,
      registrador: registro.registradorDe("Salud"),
      instancia: () => "0",
      pid: 1,
      uptimeSegundos: () => 0,
      reloj: () => performance.now(),
      ahora: () => new Date(),
    });

    const inicio = performance.now();
    await salud.comprobar();

    expect(performance.now() - inicio).toBeLessThan(100); // en serie serian ~120 ms
  });
});
