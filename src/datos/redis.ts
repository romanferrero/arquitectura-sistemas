import { createClient } from "redis";
import { redisUrl } from "../config/env.ts";
import { registradorDe } from "../config/logger.ts";
import { describirError } from "./describirError.ts";

/**
 * Cliente de Redis de la aplicacion (cliente oficial `redis`).
 *
 * Ciclo de vida, como indica su documentacion:
 *  1. `createClient()` solo arma el objeto: no abre ninguna conexion.
 *  2. `.on("error")` es OBLIGATORIO: sin un oyente, un error de conexion (Redis caido)
 *     tumbaria el proceso entero con una excepcion no controlada.
 *  3. `.connect()` abre la conexion; lo llama servidor.ts al arrancar.
 *
 * Se importa solo desde los procesos que usan Redis (no desde `migrar`), porque crear
 * el cliente ya lee REDIS_*.
 */
const registrador = registradorDe("Redis");
let conectadoAlgunaVez = false;

export const redis = createClient({
  url: redisUrl(),
  // Con Redis caido los comandos fallan enseguida en vez de quedar en una cola
  // esperando: la cache es de mejor esfuerzo y no debe demorar la respuesta.
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 5_000,
    // Al ARRANCAR no se reintenta: si Redis no esta, la API no levanta (fail fast, igual
    // que con MySQL y MongoDB). Una vez conectado, si se cae, reintenta para siempre
    // con espera creciente (hasta 2 s) y la API sigue sirviendo desde MySQL mientras tanto.
    reconnectStrategy: (intentos) =>
      conectadoAlgunaVez ? Math.min(intentos * 200, 2_000) : new Error("No se pudo conectar a Redis"),
  },
});

redis.on("ready", () => {
  conectadoAlgunaVez = true;
  registrador.info("Conexión lista");
});
redis.on("error", (error: unknown) => registrador.error(`Error de Redis: ${describirError(error)}`));
redis.on("reconnecting", () => registrador.info("Reconectando..."));

/** Abre la conexion y comprueba que responda. Lanza si no puede conectarse o autenticarse. */
export async function conectarRedis(): Promise<void> {
  await redis.connect();
  await redis.ping();
}

/** Cierra la conexion esperando los comandos en curso; si ya estaba cerrada no hace nada. */
export async function cerrarRedis(): Promise<void> {
  if (redis.isOpen) await redis.quit();
}
