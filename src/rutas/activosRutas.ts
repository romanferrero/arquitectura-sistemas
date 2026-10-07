import { Router } from "express";
import * as controlador from "../controladores/activosControlador.ts";
import * as auditoria from "../controladores/auditoriaControlador.ts";

/**
 * Unico lugar donde se define el mapeo verbo HTTP + path -> controlador.
 * Se monta en app.ts bajo el prefijo /api.
 */
export const activosRutas = Router();

activosRutas.get("/activos", controlador.listar);
activosRutas.post("/activos", controlador.crear);
activosRutas.post("/activos/analizar", controlador.analizar);

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
