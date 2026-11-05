import pm2 from "pm2";
import { logger, registradorDe } from "../config/logger.ts";
import { describirError } from "../datos/describirError.ts";
import { crearDetectorInestabilidad } from "../monitoreo/crearDetectorInestabilidad.ts";
import type { LecturaProceso } from "../monitoreo/crearDetectorInestabilidad.ts";
import { conTiempoMaximo } from "../utilidades/conTiempoMaximo.ts";

/**
 * MONITOR DE REINICIOS: un proceso aparte, que PM2 corre junto a la API, que le pregunta a PM2 cada pocos segundos
 * cuantas veces lleva reiniciado cada proceso y, si alguno reinicio MAS DE 5 VECES EN UN MINUTO, deja un log de
 * nivel `error` marcado como CRITICO en Winston: es la senal de una posible inestabilidad en el despliegue
 * (un crash loop, una fuga de memoria que repite el reinicio por `max_memory_restart`, una configuracion rota).
 *
 *   pm2-runtime ecosystem.config.cjs --only api,monitor-reinicios      (ver el Dockerfile)
 *
 * La logica (la ventana deslizante) esta en `crearDetectorInestabilidad`, que se prueba sin PM2.
 */
const registrador = registradorDe("MonitorReinicios");

const MAXIMO_REINICIOS = 5;
const VENTANA_MS = 60_000;
const CADA_MS = 5_000;
/** Cuanto se le espera a PM2 por una lectura: bajo CPU saturada o durante un reload puede tardar o no contestar. */
const LECTURA_TIEMPO_MAXIMO_MS = 4_000;
const NOMBRE_PROPIO = "monitor-reinicios";

const detector = crearDetectorInestabilidad({ maximo: MAXIMO_REINICIOS, ventanaMs: VENTANA_MS });

function leerProcesos(): Promise<LecturaProceso[]> {
  return new Promise((resolver, rechazar) => {
    pm2.list((error, lista) => {
      if (error) {
        rechazar(error);
        return;
      }
      resolver(
        lista.flatMap((proceso) =>
          proceso.name === undefined || proceso.name === NOMBRE_PROPIO || proceso.pm_id === undefined
            ? []
            : [{ nombre: proceso.name, id: proceso.pm_id, reinicios: proceso.pm2_env?.restart_time ?? 0 }],
        ),
      );
    });
  });
}

/**
 * Una sola lectura a PM2 a la vez: si la anterior sigue pendiente (PM2 lento o colgado) se espera a esa misma en vez de
 * pedir otra cada 5 s, asi los pedidos no se apilan.
 */
let lecturaPendiente: Promise<LecturaProceso[]> | undefined;
function leerUnaVez(): Promise<LecturaProceso[]> {
  lecturaPendiente ??= leerProcesos().finally(() => {
    lecturaPendiente = undefined;
  });
  return lecturaPendiente;
}

async function vigilar(): Promise<void> {
  try {
    const procesos = await conTiempoMaximo(leerUnaVez, LECTURA_TIEMPO_MAXIMO_MS, `PM2 no respondió en ${LECTURA_TIEMPO_MAXIMO_MS} ms`);
    for (const alerta of detector.observar(procesos, Date.now())) {
      registrador.error(
        `[CRÍTICO] Posible inestabilidad en el despliegue: ${alerta.nombre} (instancia ${alerta.id}) se reinició ` +
          `${alerta.reiniciosEnVentana} veces en ${alerta.ventanaMs / 1000} s (el límite es ${MAXIMO_REINICIOS})`,
      );
    }
  } catch (error) {
    registrador.error(`No se pudo leer el estado de PM2: ${describirError(error)}`);
  }
}

pm2.connect((error) => {
  if (error) {
    logger.error(`El monitor de reinicios no pudo conectarse a PM2: ${describirError(error)}`);
    process.exit(1);
  }
  registrador.info(`Vigilando los reinicios (alerta si hay más de ${MAXIMO_REINICIOS} en ${VENTANA_MS / 1000} s)`);
  void vigilar(); // la primera lectura fija el punto de partida
  setInterval(() => void vigilar(), CADA_MS);
});

const cerrar = (): void => {
  pm2.disconnect();
  process.exit(0);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
