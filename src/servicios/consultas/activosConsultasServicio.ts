import { env } from "../../config/env.ts";
import * as repositorio from "../../datos/activosRepositorio.ts";
import { auditoria } from "../auditoriaServicio.ts";
import { cacheActivos } from "../cacheActivosServicio.ts";
import { obtenerPrecio } from "../preciosServicio.ts";
import { crearConsultasActivos } from "./crearConsultasActivos.ts";

/** Las consultas de la aplicacion: la fabrica ya conectada a Redis (modelo de lectura), MySQL, MongoDB y CoinGecko. */
export const consultasActivos = crearConsultasActivos({
  repositorio,
  cache: cacheActivos,
  auditoria,
  obtenerPrecio,
  moneda: env.MONEDA,
  ahora: () => new Date(),
});
