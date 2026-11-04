import { randomUUID } from "node:crypto";
import { registradorDe } from "../config/logger.ts";
import { redis } from "../datos/redis.ts";
import { crearPublicador } from "./crearPublicador.ts";

/** El publicador de la aplicacion: la fabrica ya conectada a Redis y al logger. */
export const publicador = crearPublicador({
  redis,
  registrador: registradorDe("Eventos"),
  generarId: randomUUID,
  ahora: () => new Date(),
});
