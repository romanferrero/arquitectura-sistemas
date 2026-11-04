import { env } from "../config/env.ts";
import { registradorDe } from "../config/logger.ts";
import { redis } from "../datos/redis.ts";
import { crearServicioPreferencias } from "./crearServicioPreferencias.ts";

/**
 * Las preferencias de la aplicacion: una clave por usuario (`preferencias:<sub>`).
 */
export const preferencias = crearServicioPreferencias({
  redis,
  registrador: registradorDe("Preferencias"),
  prefijoClave: "preferencias:",
  porDefecto: { monedaVisualizacion: env.MONEDA.toUpperCase(), limiteAlertaUsd: env.UMBRAL_MONTO_USD },
});
