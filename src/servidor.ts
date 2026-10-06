import { app } from "./app.ts";
import { env } from "./config/env.ts";

/**
 * Punto de entrada de la aplicacion: lo unico que hace es poner la app a
 * escuchar en el puerto configurado.
 */
app.listen(env.PORT, () => {
  console.log(`API de portafolio escuchando en http://localhost:${env.PORT}`);
  console.log(`Entorno: ${env.NODE_ENV} | Moneda: ${env.MONEDA.toUpperCase()}`);
});
