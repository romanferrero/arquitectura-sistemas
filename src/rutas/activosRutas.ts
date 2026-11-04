import { Router } from "express";
import * as admin from "../controladores/adminControlador.ts";
import * as controlador from "../controladores/activosControlador.ts";
import * as auditoria from "../controladores/auditoriaControlador.ts";
import * as preferencias from "../controladores/preferenciasControlador.ts";
import * as reportes from "../controladores/reportesControlador.ts";
import * as usuario from "../controladores/usuarioControlador.ts";
import { puedeAuditar, puedeEscribir, puedeLeer, puedeOperar, soloAdmin } from "../seguridad/permisos.ts";

/**
 * Unico lugar donde se define el mapeo verbo HTTP + path -> controlador.
 * Se monta en app.ts bajo el prefijo /api, DESPUES del middleware de autenticacion.
 *
 * Y es tambien el unico lugar donde se ve QUIEN puede hacer cada cosa: cada ruta declara su permiso
 * (puedeLeer, puedeAuditar, puedeOperar, puedeEscribir o soloAdmin; la matriz esta en
 * seguridad/permisos.ts). La unica sin permiso de rol es `/yo`: cualquier usuario autenticado puede
 * preguntar quien es. Un test (pruebas/rutas/permisosDeRutas.test.ts) falla si una ruta nueva se
 * agrega sin permiso o con uno distinto del que figura en la tabla.
 */
export const activosRutas = Router();

// Quien es el usuario del token y que roles tiene (sin exigir ningun rol).
activosRutas.get("/yo", usuario.perfil);

activosRutas.get("/activos", puedeLeer, controlador.listar);
activosRutas.post("/activos", ...puedeEscribir, controlador.crear);
// Analizar un lote es un calculo: no guarda nada, por eso no se bloquea en modo panico.
activosRutas.post("/activos/analizar", puedeOperar, controlador.analizar);

// Reporte de valoracion masiva: se encola y se genera aparte (202). Se consulta por su id.
activosRutas.post("/activos/reporte", soloAdmin, reportes.solicitar);
activosRutas.get("/reportes/:id", soloAdmin, reportes.consultar);

// Esta ruta va antes que "/activos/:id" por claridad; Express igual las
// distingue porque tienen distinta cantidad de segmentos.
activosRutas.get("/activos/:id/precio", puedeLeer, controlador.obtenerConPrecio);

// Historial de un activo (sigue disponible aunque el activo ya se haya eliminado).
activosRutas.get("/activos/:id/historial", puedeLeer, auditoria.historial);

activosRutas.get("/activos/:id", puedeLeer, controlador.obtener);
activosRutas.put("/activos/:id", ...puedeEscribir, controlador.actualizar);
activosRutas.delete("/activos/:id", ...puedeEscribir, controlador.eliminar);

// Precio de un simbolo suelto, sin necesidad de tenerlo en el portafolio.
activosRutas.get("/precios/:simbolo", puedeLeer, controlador.precioPorSimbolo);

// Historial general de auditoria, con filtro por operacion y tope de resultados.
activosRutas.get("/auditoria", puedeAuditar, auditoria.listarAuditoria);

// Preferencias del usuario del token (Hash de Redis, una clave por usuario).
activosRutas.get("/preferencias", puedeLeer, preferencias.obtener);
activosRutas.put("/preferencias", ...puedeEscribir, preferencias.actualizar);

// Estadisticas globales (Redis): reportes exitosos y activos mas consultados.
activosRutas.get("/estadisticas", soloAdmin, reportes.obtenerEstadisticas);

// Administracion: vaciar la cache de activos y el modo panico (interruptor de emergencia).
activosRutas.delete("/admin/cache", soloAdmin, admin.limpiarCache);
activosRutas.get("/admin/modo-panico", soloAdmin, admin.estadoModoPanico);
activosRutas.put("/admin/modo-panico", soloAdmin, admin.cambiarModoPanico);
