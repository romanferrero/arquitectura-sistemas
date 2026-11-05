/** Lo que se ve de cada proceso en una lectura de PM2: su nombre, su numero y cuantas veces lleva reiniciado. */
export type LecturaProceso = {
  nombre: string;
  /** El `pm_id` de PM2: distingue a las instancias de un mismo cluster. */
  id: number;
  /** El contador acumulado de reinicios (`restart_time` de PM2): solo sube. */
  reinicios: number;
};

export type AlertaInestabilidad = {
  nombre: string;
  id: number;
  /** Cuantos reinicios hubo dentro de la ventana. */
  reiniciosEnVentana: number;
  ventanaMs: number;
};

/**
 * DETECTOR DE INESTABILIDAD: dice que procesos reiniciaron MAS de `maximo` veces dentro de la ventana
 * (por defecto, mas de 5 en un minuto: un crash loop, una fuga de memoria que se repite o un despliegue roto).
 *
 * No escucha a PM2: recibe LECTURAS periodicas del contador de reinicios de cada proceso y calcula la
 * ventana deslizante. Se mide por el contador (`restart_time`) y no por eventos porque el contador cubre todos
 * los motivos (crash, `max_memory_restart`, `pm2 restart`) sin depender de que no se pierda un evento del bus.
 * Si entre dos lecturas el contador subio en N, hubo N reinicios.
 *
 * Es una FABRICA con el reloj por parametro para probarla sin esperar.
 *
 * Para no inundar el log, un proceso que sigue inestable se vuelve a avisar recien despues de una ventana entera;
 * pero si se recupera (vuelve a tener `maximo` reinicios o menos en la ventana), el siguiente episodio se avisa enseguida.
 */
export function crearDetectorInestabilidad(opciones: { maximo: number; ventanaMs: number }) {
  const { maximo, ventanaMs } = opciones;

  /** Cuando se reinicio cada proceso, solo los instantes que todavia caen dentro de la ventana. */
  const reinicios = new Map<string, number[]>();
  const ultimoContador = new Map<string, number>();
  const ultimoAviso = new Map<string, number>();

  return {
    /** Procesa una lectura de todos los procesos y devuelve los que estan inestables y hay que avisar. */
    observar(lecturas: LecturaProceso[], ahoraMs: number): AlertaInestabilidad[] {
      const alertas: AlertaInestabilidad[] = [];
      const vistos = new Set<string>();

      for (const lectura of lecturas) {
        const clave = `${lectura.nombre}#${lectura.id}`;
        vistos.add(clave);

        // La primera vez que se ve un proceso solo se toma como punto de partida: lo que ya llevaba reiniciado
        // no se sabe cuando fue, asi que no cuenta.
        const anterior = ultimoContador.get(clave);
        ultimoContador.set(clave, lectura.reinicios);
        const instantes = (reinicios.get(clave) ?? []).filter((instante) => ahoraMs - instante < ventanaMs);
        if (anterior !== undefined && lectura.reinicios > anterior) {
          for (let i = 0; i < lectura.reinicios - anterior; i += 1) instantes.push(ahoraMs);
        }
        reinicios.set(clave, instantes);

        if (instantes.length <= maximo) {
          // Se recupero: si vuelve a inestabilizarse, se avisa de nuevo sin esperar a que pase la ventana del aviso anterior.
          ultimoAviso.delete(clave);
          continue;
        }
        const avisadoEn = ultimoAviso.get(clave);
        if (avisadoEn !== undefined && ahoraMs - avisadoEn < ventanaMs) continue;
        ultimoAviso.set(clave, ahoraMs);
        alertas.push({ nombre: lectura.nombre, id: lectura.id, reiniciosEnVentana: instantes.length, ventanaMs });
      }

      // Un proceso que ya no aparece (se borro de PM2) no tiene por que ocupar memoria.
      for (const clave of [...ultimoContador.keys()]) {
        if (vistos.has(clave)) continue;
        ultimoContador.delete(clave);
        reinicios.delete(clave);
        ultimoAviso.delete(clave);
      }
      return alertas;
    },
  };
}
