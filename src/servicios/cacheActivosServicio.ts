import { cacheTtlSegundos } from "../config/env.ts";
import { registradorDe } from "../config/logger.ts";
import { redis } from "../datos/redis.ts";
import { crearCacheActivos } from "./crearCacheActivos.ts";

/** La cache de la aplicacion: la fabrica ya conectada a Redis, al logger y al TTL configurado. */
export const cacheActivos = crearCacheActivos({
  redis,
  registrador: registradorDe("Cache"),
  ttlSegundos: cacheTtlSegundos(),
});
