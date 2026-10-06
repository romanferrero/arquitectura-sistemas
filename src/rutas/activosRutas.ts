import { Router } from "express";
import * as controlador from "../controladores/activosControlador.ts";

/**
 * Unico lugar donde se define el mapeo verbo HTTP + path -> controlador.
 * Se monta en app.ts bajo el prefijo /api.
 */
export const activosRutas = Router();

activosRutas.get("/activos", controlador.listar);
activosRutas.post("/activos", controlador.crear);

// Esta ruta va antes que "/activos/:id" por claridad; Express igual las
// distingue porque tienen distinta cantidad de segmentos.
activosRutas.get("/activos/:id/precio", controlador.obtenerConPrecio);

activosRutas.get("/activos/:id", controlador.obtener);
activosRutas.put("/activos/:id", controlador.actualizar);
activosRutas.delete("/activos/:id", controlador.eliminar);

// Precio de un simbolo suelto, sin necesidad de tenerlo en el portafolio.
activosRutas.get("/precios/:simbolo", controlador.precioPorSimbolo);
