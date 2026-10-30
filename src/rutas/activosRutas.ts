import { Router } from "express";
import * as controlador from "../controladores/activosControlador.ts";
import * as auditoria from "../controladores/auditoriaControlador.ts";
import * as preferencias from "../controladores/preferenciasControlador.ts";
import * as reportes from "../controladores/reportesControlador.ts";
import * as usuario from "../controladores/usuarioControlador.ts";

/**
 * Unico lugar donde se define el mapeo verbo HTTP + path -> controlador.
 * Se monta en app.ts bajo el prefijo /api.
 */
export const activosRutas = Router();

// Quien es el usuario del token y que roles tiene.
activosRutas.get("/yo", usuario.perfil);

activosRutas.get("/activos", controlador.listar);
activosRutas.post("/activos", controlador.crear);
activosRutas.post("/activos/analizar", controlador.analizar);

// Reporte de valoracion masiva: se encola y se genera aparte (202). Se consulta por su id.
activosRutas.post("/activos/reporte", reportes.solicitar);
activosRutas.get("/reportes/:id", reportes.consultar);

// Esta ruta va antes que "/activos/:id" por claridad; Express igual las
// distingue porque tienen distinta cantidad de segmentos.
activosRutas.get("/activos/:id/precio", controlador.obtenerConPrecio);

// Historial de un activo (sigue disponible aunque el activo ya se haya eliminado).
activosRutas.get("/activos/:id/historial", auditoria.historial);

activosRutas.get("/activos/:id", controlador.obtener);
activosRutas.put("/activos/:id", controlador.actualizar);
activosRutas.delete("/activos/:id", controlador.eliminar);

// Precio de un simbolo suelto, sin necesidad de tenerlo en el portafolio.
activosRutas.get("/precios/:simbolo", controlador.precioPorSimbolo);

// Historial general de auditoria, con filtro por operacion y tope de resultados.
activosRutas.get("/auditoria", auditoria.listarAuditoria);

// Preferencias de la billetera (Hash de Redis).
activosRutas.get("/preferencias", preferencias.obtener);
activosRutas.put("/preferencias", preferencias.actualizar);

// Estadisticas globales (Redis): reportes exitosos y activos mas consultados.
activosRutas.get("/estadisticas", reportes.obtenerEstadisticas);
