import winston from "winston";
import { env } from "./env.ts";
import type { Registrador } from "../pipeline/pipeline.ts";

/**
 * Logger unico de la aplicacion (Winston).
 *
 * - development: una linea legible por evento -> "[INFO] FiltroX: mensaje".
 * - production:  JSON con timestamp, que es lo que consume un agregador de logs.
 * - test:        silencioso, para no ensuciar la salida de Jest.
 */
const formatoLegible = winston.format.printf(({ level, message, origen }) => {
  const prefijo = typeof origen === "string" ? `${origen}: ` : "";
  return `[${level.toUpperCase()}] ${prefijo}${String(message)}`;
});

const formatoJson = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
);

export const logger = winston.createLogger({
  level: "info",
  silent: env.NODE_ENV === "test",
  format: env.NODE_ENV === "production" ? formatoJson : formatoLegible,
  transports: [new winston.transports.Console()],
});

/**
 * Registrador que firma cada mensaje con su origen (el nombre de un filtro,
 * de un pipeline...). Es la fabrica que reciben los pipelines.
 */
export function registradorDe(origen: string): Registrador {
  return logger.child({ origen });
}
