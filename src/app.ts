import express from "express";
import { obtenerSalud } from "./controladores/saludControlador.ts";
import { marcarInstancia } from "./middlewares/instancia.ts";
import { activosRutas } from "./rutas/activosRutas.ts";
import { autenticar } from "./seguridad/autenticacion.ts";
import { manejadorErrores, noEncontrado } from "./middlewares/manejadorErrores.ts";

/**
 * Arma la aplicacion Express. Se separa de servidor.ts para poder importar la
 * app (por ejemplo desde un test) sin levantar el puerto.
 *
 * EL ORDEN IMPORTA: primero los middlewares, despues las rutas, y al final
 * el 404 y el manejador de errores.
 */
export const app = express();

// Antes que nada: toda respuesta (tambien un 401 o un 404) dice que instancia del cluster la atendio.
app.use(marcarInstancia);

// Health check: comprueba que esta instancia llegue a MySQL, MongoDB y Redis (200 o 503). Es PUBLICO: lo usan
// Docker y los monitores, que no tienen un token.
app.get("/salud", obtenerSalud);

// Todas las rutas de la API cuelgan de /api y EXIGEN un token valido (Authorization: Bearer).
// El middleware va antes que las rutas: sin token no se llega a ningun controlador.
// El body JSON se parsea DESPUES de autenticar: a quien no tiene credenciales no se le gasta CPU ni
// memoria en parsearle un cuerpo (ni se le muestra como reacciona el parser con uno roto): recibe 401.
app.use("/api", autenticar, express.json(), activosRutas);

// Si ninguna ruta coincidio -> 404.
app.use(noEncontrado);

// Ultimo middleware: convierte cualquier error en una respuesta JSON.
app.use(manejadorErrores);
