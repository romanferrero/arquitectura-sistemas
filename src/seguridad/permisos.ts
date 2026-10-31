import { registradorDe } from "../config/logger.ts";
import { redis } from "../datos/redis.ts";
import { crearAutorizacion } from "./autorizar.ts";
import { crearModoPanico } from "./modoPanico.ts";

/**
 * Los permisos de la aplicacion: la matriz de roles, ya conectada al logger y a Redis.
 *
 *   | Quien hace el pedido        | AUDITOR | TRADER | ADMIN |
 *   | Leer (activos, precios...)  |    si   |   si   |  si   |   -> puedeLeer
 *   | Leer la auditoria general   |    si   |   no   |  si   |   -> puedeAuditar
 *   | Operar y escribir (CRUD)    |    no   |   si   |  si   |   -> puedeEscribir (y el modo panico)
 *   | Reportes, estadisticas,     |    no   |   no   |  si   |   -> soloAdmin
 *   | cache y modo panico         |         |        |       |
 *
 * Cada ruta de activosRutas.ts declara cual usa: asi la matriz se lee en un solo lugar y hay un test
 * que falla si alguien agrega una ruta sin ningun permiso.
 *
 * Importante para el modo panico: el ADMIN no se bloquea nunca, y solo se bloquean las operaciones
 * que ESCRIBEN. `analizar` es un POST pero no guarda nada (es un calculo), por eso `puedeOperar`
 * no lleva el bloqueo.
 */
export const modoPanico = crearModoPanico({ redis, registrador: registradorDe("ModoPanico") });

const autorizar = crearAutorizacion(registradorDe("Autorizacion"));

/** Cualquier usuario con algun rol conocido: leer es lo menos peligroso. */
export const puedeLeer = autorizar("AUDITOR", "TRADER", "ADMIN");

/** La auditoria general la ven quienes la revisan (AUDITOR) y quien administra; un TRADER no. */
export const puedeAuditar = autorizar("AUDITOR", "ADMIN");

/** Operaciones de un TRADER (o de un ADMIN) que NO escriben, como analizar un lote. */
export const puedeOperar = autorizar("TRADER", "ADMIN");

/** Operaciones que ESCRIBEN: el rol correcto y, ademas, que no este el modo panico. Se usa con `...`. */
export const puedeEscribir = [puedeOperar, modoPanico.bloquearEnModoPanico];

/** Procesos administrativos: reportes masivos, estadisticas, cache y modo panico. */
export const soloAdmin = autorizar("ADMIN");
