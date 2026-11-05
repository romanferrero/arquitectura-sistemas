import { describe, expect, test } from "@jest/globals";
import { crearSuscriptor } from "../../src/eventos/crearSuscriptor.ts";
import { CANAL_ACTIVOS } from "../../src/eventos/eventoActivo.ts";
import type { EventoActivo } from "../../src/eventos/eventoActivo.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";
import { eventoActualizado, eventoCreado, eventoEliminado } from "../ayudas/eventosDePrueba.ts";

/** Una conexion falsa: guarda el oyente que se le registra y permite "publicar" mensajes a mano. */
function armar(manejar?: (evento: EventoActivo) => Promise<void>) {
  const registro = crearRegistroEnMemoria();
  const manejados: EventoActivo[] = [];
  let oyente: ((mensaje: string) => void) | undefined;
  const suscripciones: string[] = [];

  const suscriptor = crearSuscriptor({
    conexion: {
      subscribe: async (canal, nuevoOyente) => {
        suscripciones.push(canal);
        oyente = nuevoOyente;
      },
    },
    manejar:
      manejar ??
      (async (evento) => {
        manejados.push(evento);
      }),
    registrador: registro.registradorDe("Suscriptor"),
  });

  const recibir = (mensaje: unknown): void => (oyente ?? (() => undefined))(typeof mensaje === "string" ? mensaje : JSON.stringify(mensaje));
  return { suscriptor, recibir, manejados, suscripciones, lineas: registro.lineas };
}

describe("crearSuscriptor", () => {
  test("se suscribe al canal activos-actualizaciones", async () => {
    const { suscriptor, suscripciones } = armar();

    await suscriptor.iniciar();

    expect(suscripciones).toEqual([CANAL_ACTIVOS]);
  });

  test("le entrega al manejador cada evento válido, ya leído", async () => {
    const { suscriptor, recibir, manejados } = armar();
    await suscriptor.iniciar();

    recibir(eventoCreado);
    await suscriptor.esperarPendientes();

    expect(manejados).toEqual([eventoCreado]);
  });

  test("descarta con un WARN un mensaje que no es JSON, y sigue con el próximo", async () => {
    const { suscriptor, recibir, manejados, lineas } = armar();
    await suscriptor.iniciar();

    recibir("esto no es json");
    recibir(eventoCreado);
    await suscriptor.esperarPendientes();

    expect(manejados).toEqual([eventoCreado]);
    expect(lineas.some((linea) => linea.includes("[WARN]") && linea.includes("Mensaje descartado") && linea.includes("no es un JSON válido"))).toBe(true);
  });

  test("descarta un mensaje que no cumple el contrato (versión desconocida) sin llamar al manejador", async () => {
    const { suscriptor, recibir, manejados, lineas } = armar();
    await suscriptor.iniciar();

    recibir({ ...eventoCreado, version: 2 });
    await suscriptor.esperarPendientes();

    expect(manejados).toEqual([]);
    expect(lineas.some((linea) => linea.includes("Mensaje descartado") && linea.includes("version"))).toBe(true);
  });

  test("si el manejador falla deja el ERROR en el log y los eventos siguientes igual se procesan", async () => {
    const procesados: string[] = [];
    const { suscriptor, recibir, lineas } = armar(async (evento) => {
      if (evento.tipo === "ACTIVO_CREADO") throw new Error("Mongo se cayó");
      procesados.push(evento.tipo);
    });
    await suscriptor.iniciar();

    recibir(eventoCreado);
    recibir(eventoEliminado);
    await suscriptor.esperarPendientes();

    expect(procesados).toEqual(["ACTIVO_ELIMINADO"]);
    expect(lineas.some((linea) => linea.includes("[ERROR]") && linea.includes("ACTIVO_CREADO") && linea.includes("Mongo se cayó"))).toBe(true);
  });

  test("procesa los eventos UNO POR VEZ y en el orden en que llegaron, aunque el primero sea lento", async () => {
    const orden: string[] = [];
    const { suscriptor, recibir } = armar(async (evento) => {
      orden.push(`empieza:${evento.tipo}`);
      if (evento.tipo === "ACTIVO_CREADO") await new Promise((resolver) => setTimeout(resolver, 20));
      orden.push(`termina:${evento.tipo}`);
    });
    await suscriptor.iniciar();

    recibir(eventoCreado);
    recibir(eventoActualizado);
    recibir(eventoEliminado);
    await suscriptor.esperarPendientes();

    expect(orden).toEqual([
      "empieza:ACTIVO_CREADO",
      "termina:ACTIVO_CREADO",
      "empieza:ACTIVO_ACTUALIZADO",
      "termina:ACTIVO_ACTUALIZADO",
      "empieza:ACTIVO_ELIMINADO",
      "termina:ACTIVO_ELIMINADO",
    ]);
  });

  test("esperarPendientes sin nada en cola termina enseguida", async () => {
    const { suscriptor } = armar();

    await expect(suscriptor.esperarPendientes()).resolves.toBeUndefined();
  });
});
