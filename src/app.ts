import express from "express";
import { activosRutas } from "./rutas/activosRutas.ts";
import { manejadorErrores, noEncontrado } from "./middlewares/manejadorErrores.ts";

/**
 * Arma la aplicacion Express. Se separa de servidor.ts para poder importar la
 * app (por ejemplo desde un test) sin levantar el puerto.
 *
 * EL ORDEN IMPORTA: primero los middlewares, despues las rutas, y al final
 * el 404 y el manejador de errores.
 */
export const app = express();

// Parsea el body JSON de las peticiones entrantes.
app.use(express.json());

// Health check: sirve para verificar rapido que el contenedor esta vivo.
app.get("/salud", (_req, res) => {
  res.status(200).json({ estado: "ok", fecha: new Date().toISOString() });
});

// Todas las rutas de la API cuelgan de /api.
app.use("/api", activosRutas);

// Si ninguna ruta coincidio -> 404.
app.use(noEncontrado);

// Ultimo middleware: convierte cualquier error en una respuesta JSON.
app.use(manejadorErrores);
