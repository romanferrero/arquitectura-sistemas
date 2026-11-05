import { SimboloDuplicadoError } from "../../datos/simboloDuplicadoError.ts";
import { ErrorApi } from "../../errores/ErrorApi.ts";
import type { DatosEventoActivo } from "../../eventos/eventoActivo.ts";
import type { Activo, DatosActivo } from "../../modelos/activo.ts";
import type { ConversionMoneda } from "../../pipeline/ingesta/tipos.ts";
import { camposModificados } from "../../utilidades/camposModificados.ts";

/** Lo que los comandos usan del repositorio: es el LADO DE ESCRITURA (MySQL), la fuente de verdad. */
export type RepositorioDeEscritura = {
  buscarPorId: (id: string) => Promise<Activo | undefined>;
  guardar: (activo: Activo) => Promise<Activo>;
  reemplazar: (id: string, activo: Activo) => Promise<{ antes: Activo; despues: Activo } | undefined>;
  eliminar: (id: string) => Promise<boolean>;
};

// Campos del activo que el cliente puede cambiar; sirven para decir que se modifico.
const CAMPOS_EDITABLES = ["simbolo", "nombre", "cantidad", "precioCompra"] as const;

/**
 * LADO DE ESCRITURA de CQRS: crear, actualizar y eliminar activos. Un comando valida con las reglas de
 * negocio, persiste en MySQL (la fuente de verdad) y avisa que paso. No devuelve vistas ni lee de la
 * cache: eso es trabajo de las consultas (`crearConsultasActivos`).
 *
 * Despues de que MySQL confirma PUBLICA un evento en Redis Pub/Sub (de mejor esfuerzo: no puede deshacer lo ya
 * guardado ni hacer fallar la operacion) y nada mas. Dejar la cache al dia, llevar los contadores y
 * registrar la auditoria lo hacen los SUSCRIPTORES al recibir el evento (`crearProyecciones`): el comando
 * no sabe que existen. Es lo que pide el patron: validar, persistir y publicar.
 *
 * Es una FABRICA con todas sus dependencias por parametro: se prueba sin MySQL, Redis, MongoDB ni red.
 */
export function crearComandosActivos(dependencias: {
  repositorio: RepositorioDeEscritura;
  /** Validacion, normalizacion y conversion de moneda (el pipeline de ingesta). */
  ingestar: (cuerpo: unknown) => Promise<{ datos: DatosActivo; conversion: ConversionMoneda | undefined }>;
  publicador: { publicar: (evento: DatosEventoActivo) => Promise<void> };
  generarId: () => string;
  ahora: () => Date;
}) {
  const { repositorio, ingestar, publicador, generarId, ahora } = dependencias;

  /** Quien lo hizo, desde donde y, si hubo, la conversion de moneda: viaja en el evento (y de ahi, a la auditoria). */
  function metadatosDe(usuario: string, conversion: ConversionMoneda | undefined) {
    return conversion === undefined
      ? { origen: "API", usuario }
      : { origen: "API", usuario, conversionMoneda: { ...conversion } };
  }

  async function obtenerActivo(id: string): Promise<Activo> {
    const activo = await repositorio.buscarPorId(id);
    if (activo === undefined) throw new ErrorApi(404, `No existe un activo con id ${id}`);
    return activo;
  }

  return {
    // Es async porque el pipeline puede consultar la API de tasas de cambio.
    async crearActivo(cuerpo: unknown, usuario: string): Promise<Activo> {
      const { datos, conversion } = await ingestar(cuerpo); // 400 / 502 si falla un filtro

      // Regla de negocio: una sola posicion por simbolo en el portafolio. La hace cumplir la restriccion
      // UNIQUE de la base: no se busca antes, porque dos pedidos simultaneos podrian pasar esa comprobacion a la vez.
      const momento = ahora().toISOString();
      let creado: Activo;
      try {
        creado = await repositorio.guardar({ id: generarId(), ...datos, creadoEn: momento, actualizadoEn: momento });
      } catch (error) {
        if (error instanceof SimboloDuplicadoError) {
          throw new ErrorApi(409, `Ya existe un activo con el símbolo ${datos.simbolo}`);
        }
        throw error;
      }

      // MySQL ya confirmo: se avisa (de mejor esfuerzo) y listo.
      const metadatos = metadatosDe(usuario, conversion);
      await publicador.publicar({ tipo: "ACTIVO_CREADO", activoId: creado.id, despues: creado, metadatos });
      return creado;
    },

    async actualizarActivo(id: string, cuerpo: unknown, usuario: string): Promise<Activo> {
      const actual = await obtenerActivo(id); // 404 enseguida si no existe, sin gastar el pipeline

      const { datos, conversion } = await ingestar(cuerpo); // 400 / 502 si falla un filtro

      const actualizado: Activo = {
        id: actual.id, // el id nunca cambia, aunque venga en el body
        ...datos,
        creadoEn: actual.creadoEn, // la fecha de alta se conserva
        actualizadoEn: ahora().toISOString(),
      };

      // El simbolo puede cambiar, pero no puede pisar al de OTRO activo: lo garantiza la restriccion UNIQUE.
      let reemplazo: { antes: Activo; despues: Activo } | undefined;
      try {
        // Mientras el pipeline esperaba a la API de tasas el activo pudo borrarse o cambiar: el repositorio
        // relee y bloquea la fila, y devuelve el "antes" real.
        reemplazo = await repositorio.reemplazar(id, actualizado);
      } catch (error) {
        if (error instanceof SimboloDuplicadoError) {
          throw new ErrorApi(409, `Ya existe otro activo con el símbolo ${datos.simbolo}`);
        }
        throw error;
      }
      if (reemplazo === undefined) throw new ErrorApi(404, `No existe un activo con id ${id}`); // se borro mientras tanto

      // `despues` es lo que quedo en la base, no lo que se intento guardar.
      const { antes, despues } = reemplazo;
      const metadatos = metadatosDe(usuario, conversion);
      const modificados = camposModificados(antes, despues, CAMPOS_EDITABLES);
      await publicador.publicar({ tipo: "ACTIVO_ACTUALIZADO", activoId: despues.id, antes, despues, camposModificados: modificados, metadatos });
      return despues;
    },

    async eliminarActivo(id: string, usuario: string): Promise<void> {
      // Se lee antes de borrar: el evento (y con el, el historial) tiene que guardar como era el activo.
      const actual = await obtenerActivo(id);
      if (!(await repositorio.eliminar(id))) {
        throw new ErrorApi(404, `No existe un activo con id ${id}`); // lo borro otro mientras tanto
      }

      const metadatos = { origen: "API", usuario };
      // El id del evento es el de la fila (`actual.id`) y no el de la URL: MySQL compara los ids sin distinguir
      // mayusculas, y un DELETE con el id en mayusculas partiria el historial en dos.
      await publicador.publicar({ tipo: "ACTIVO_ELIMINADO", activoId: actual.id, antes: actual, metadatos });
    },
  };
}
