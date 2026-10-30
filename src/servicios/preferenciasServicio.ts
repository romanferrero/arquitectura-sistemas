import { env } from "../config/env.ts";
import { registradorDe } from "../config/logger.ts";
import { redis } from "../datos/redis.ts";
import { crearServicioPreferencias } from "./crearServicioPreferencias.ts";

/**
 * Las preferencias de la aplicacion. Por ahora hay una sola billetera (clave
 * `preferencias:billetera`); cuando haya usuarios (Parte 6) sera una clave por usuario.
 */
export const preferencias = crearServicioPreferencias({
  redis,
  registrador: registradorDe("Preferencias"),
  clave: "preferencias:billetera",
  porDefecto: { monedaVisualizacion: env.MONEDA.toUpperCase(), limiteAlertaUsd: env.UMBRAL_MONTO_USD },
});
