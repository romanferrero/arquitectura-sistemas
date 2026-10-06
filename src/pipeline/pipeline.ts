/**
 * Patron Pipes & Filters.
 *
 * Un FILTRO hace una unica operacion: recibe un valor, lo procesa y devuelve el
 * resultado (o lanza un error). Un PIPELINE encadena filtros y los ejecuta en
 * orden, pasandole a cada uno la salida del anterior.
 *
 * Este archivo no importa nada del resto de la aplicacion: ni Express, ni el
 * logger real, ni la configuracion. Todo lo que necesita lo recibe por
 * parametro, y por eso se puede testear aislado.
 */

/** Lo minimo que un filtro necesita para dejar registro de lo que hizo. */
export type Registrador = {
  info(mensaje: string): void;
  error(mensaje: string): void;
};

/** Devuelve un registrador que firma sus mensajes con el nombre recibido. */
export type FabricaRegistrador = (origen: string) => Registrador;

export type Filtro<Entrada, Salida> = {
  nombre: string;
  ejecutar(entrada: Entrada, registrador: Registrador): Salida | Promise<Salida>;
};

export class Pipeline<Entrada, Salida> {
  readonly nombre: string;
  private readonly registradorDe: FabricaRegistrador;
  private readonly filtros: readonly Filtro<unknown, unknown>[];

  private constructor(
    nombre: string,
    registradorDe: FabricaRegistrador,
    filtros: readonly Filtro<unknown, unknown>[],
  ) {
    this.nombre = nombre;
    this.registradorDe = registradorDe;
    this.filtros = filtros;
  }

  /** Pipeline vacio: lo que entra es lo que sale. */
  static crear<Entrada>(
    nombre: string,
    registradorDe: FabricaRegistrador,
  ): Pipeline<Entrada, Entrada> {
    return new Pipeline<Entrada, Entrada>(nombre, registradorDe, []);
  }

  /**
   * Devuelve un pipeline NUEVO con el filtro al final. El compilador exige que
   * la entrada del filtro coincida con la salida acumulada hasta ahi, asi un
   * orden invalido de filtros no compila.
   */
  agregar<Siguiente>(filtro: Filtro<Salida, Siguiente>): Pipeline<Entrada, Siguiente> {
    return new Pipeline<Entrada, Siguiente>(this.nombre, this.registradorDe, [
      ...this.filtros,
      filtro as Filtro<unknown, unknown>,
    ]);
  }

  /** Nombres de los filtros en el orden en que se ejecutan. */
  get pasos(): string[] {
    return this.filtros.map((filtro) => filtro.nombre);
  }

  /**
   * Ejecuta los filtros en orden. FAIL FAST: si uno lanza, se registra cual
   * fallo, los siguientes no se ejecutan y el error original sigue viaje hacia
   * quien llamo (asi un ErrorApi conserva su codigo HTTP).
   */
  async ejecutar(entrada: Entrada): Promise<Salida> {
    const registrador = this.registradorDe(`Pipeline ${this.nombre}`);
    let actual: unknown = entrada;

    for (const filtro of this.filtros) {
      try {
        actual = await filtro.ejecutar(actual, this.registradorDe(filtro.nombre));
      } catch (error) {
        registrador.error(`Falló ${filtro.nombre}: ${mensajeDe(error)}`);
        throw error;
      }
      registrador.info(`${filtro.nombre} ejecutado con éxito`);
    }

    // Cada agregar() verifico el tipo de su eslabon; aca solo se recupera el final.
    return actual as Salida;
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
