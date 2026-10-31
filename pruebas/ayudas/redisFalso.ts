import type { ComandosRedis } from "../../src/datos/tiposRedis.ts";

/**
 * Redis falso para los tests: guarda todo en memoria y cumple ComandosRedis.
 *
 * - `caido = true` hace que cualquier comando rechace, como cuando Redis no responde.
 * - `ttl` guarda el EX con el que se escribio cada String, para comprobar que se uso.
 * - `comandos` registra cada llamada en orden, para comprobar que se hizo (o no).
 */
export function crearRedisFalso() {
  const textos = new Map<string, string>();
  const hashes = new Map<string, Record<string, string>>();
  const rankings = new Map<string, Map<string, number>>();
  const ttl = new Map<string, number>();
  const comandos: string[] = [];
  const estado = { caido: false };

  function usar(comando: string): void {
    comandos.push(comando);
    if (estado.caido) throw new Error("Redis no responde");
  }

  const redis: ComandosRedis = {
    async get(clave) {
      usar(`GET ${clave}`);
      return textos.get(clave) ?? null;
    },
    async set(clave, valor, opciones) {
      usar(`SET ${clave}`);
      textos.set(clave, valor);
      if (opciones !== undefined) ttl.set(clave, opciones.EX);
      return "OK";
    },
    async del(clave) {
      const claves = Array.isArray(clave) ? clave : [clave];
      usar(`DEL ${claves.join(" ")}`);
      let borradas = 0;
      for (const una of claves) {
        ttl.delete(una);
        const existia = textos.delete(una) || hashes.delete(una) || rankings.delete(una);
        if (existia) borradas += 1;
      }
      return borradas;
    },
    async scan(cursor, opciones) {
      usar(`SCAN ${cursor} MATCH ${opciones.MATCH} COUNT ${opciones.COUNT}`);
      const patron = new RegExp(`^${opciones.MATCH.split("*").map((parte) => parte.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
      const todas = [...textos.keys(), ...hashes.keys(), ...rankings.keys()].sort();
      // El cursor es la ultima clave vista (y "0" al empezar): asi borrar claves a mitad del recorrido no
      // hace saltear ninguna, igual que el SCAN real, que garantiza devolver lo que existe de principio a fin.
      const pendientes = cursor === "0" ? todas : todas.filter((clave) => clave > cursor);
      const tanda = pendientes.slice(0, opciones.COUNT);
      const quedan = pendientes.length > tanda.length;
      // Como Redis, filtra DESPUES de leer la tanda: una tanda puede venir con menos claves (o vacia).
      return { cursor: quedan ? (tanda.at(-1) ?? "0") : "0", keys: tanda.filter((clave) => patron.test(clave)) };
    },
    async incr(clave) {
      usar(`INCR ${clave}`);
      const nuevo = Number(textos.get(clave) ?? "0") + 1;
      textos.set(clave, String(nuevo));
      return nuevo;
    },
    async zRangeWithScores(clave, inicio, fin, opciones) {
      usar(`ZRANGE ${clave} ${inicio} ${fin}${opciones?.REV === true ? " REV" : ""}`);
      const ordenados = [...(rankings.get(clave) ?? new Map<string, number>())]
        .map(([value, score]) => ({ value, score }))
        .sort((a, b) => a.score - b.score);
      if (opciones?.REV === true) ordenados.reverse();
      return ordenados.slice(inicio, fin + 1);
    },
    async zIncrBy(clave, incremento, miembro) {
      usar(`ZINCRBY ${clave} ${incremento} ${miembro}`);
      const ranking = rankings.get(clave) ?? new Map<string, number>();
      const nuevo = (ranking.get(miembro) ?? 0) + incremento;
      ranking.set(miembro, nuevo);
      rankings.set(clave, ranking);
      return nuevo;
    },
    async zRem(clave, miembro) {
      usar(`ZREM ${clave} ${miembro}`);
      return rankings.get(clave)?.delete(miembro) === true ? 1 : 0;
    },
    async hSet(clave, campos) {
      usar(`HSET ${clave}`);
      const hash = hashes.get(clave) ?? {};
      const nuevos = Object.keys(campos).filter((campo) => !(campo in hash)).length;
      hashes.set(clave, { ...hash, ...campos });
      return nuevos;
    },
    async hGetAll(clave) {
      usar(`HGETALL ${clave}`);
      return { ...(hashes.get(clave) ?? {}) };
    },
  };

  return { redis, textos, hashes, rankings, ttl, comandos, estado };
}
