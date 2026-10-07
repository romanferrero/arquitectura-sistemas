import { describe, expect, test } from "@jest/globals";
import type { NuevoRegistroAuditoria, RegistroAuditoria } from "../../src/modelos/auditoria.ts";
import { crearServicioAuditoria } from "../../src/servicios/crearServicioAuditoria.ts";
import type { RepositorioAuditoria } from "../../src/servicios/crearServicioAuditoria.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";

const registro: NuevoRegistroAuditoria = { operacion: "CREAR", entidadId: "abc", despues: { simbolo: "BTC" } };

const guardado: RegistroAuditoria = {
  id: "1",
  operacion: "CREAR",
  entidad: "Activo",
  entidadId: "abc",
  ocurridoEn: "2026-10-07T20:00:00.000Z",
};

/** Repositorio falso que anota las llamadas; cada metodo se puede reemplazar. */
function armar(cambios: Partial<RepositorioAuditoria> = {}, tiempoMaximoMs = 50) {
  const llamadas: string[] = [];
  const repositorio: RepositorioAuditoria = {
    registrar: async () => {
      llamadas.push("registrar");
    },
    historialDe: async (id) => {
      llamadas.push(`historialDe ${id}`);
      return [guardado];
    },
    listar: async (filtro) => {
      llamadas.push(`listar ${JSON.stringify(filtro)}`);
      return [guardado];
    },
    ...cambios,
  };
  const { lineas, registradorDe } = crearRegistroEnMemoria();
  const servicio = crearServicioAuditoria({ repositorio, registrador: registradorDe("Auditoria"), tiempoMaximoMs });
  return { servicio, llamadas, lineas };
}

describe("registrar (mejor esfuerzo)", () => {
  test("guarda el registro en el repositorio", async () => {
    const { servicio, llamadas, lineas } = armar();

    await servicio.registrar(registro);

    expect(llamadas).toEqual(["registrar"]);
    expect(lineas).toEqual([]);
  });

  test("si el repositorio falla NO lanza: deja el error en el log", async () => {
    const { servicio, lineas } = armar({
      registrar: async () => {
        throw new Error("conexión caída");
      },
    });

    await expect(servicio.registrar(registro)).resolves.toBeUndefined();
    expect(lineas).toEqual([
      "[ERROR] Auditoria: No se pudo registrar la auditoría (CREAR abc): Error: conexión caída",
    ]);
  });

  test("si el repositorio falla de forma sincrónica tampoco lanza", async () => {
    const { servicio, lineas } = armar({
      registrar: () => {
        throw new Error("falla inmediata");
      },
    });

    await expect(servicio.registrar(registro)).resolves.toBeUndefined();
    expect(lineas).toHaveLength(1);
  });

  test("si MongoDB no responde a tiempo, sigue sin esperar y lo deja en el log", async () => {
    const { servicio, lineas } = armar({ registrar: () => new Promise<void>(() => undefined) }, 20);

    const inicio = Date.now();
    await expect(servicio.registrar(registro)).resolves.toBeUndefined();

    expect(Date.now() - inicio).toBeLessThan(500); // no quedo esperando para siempre
    expect(lineas[0]).toContain("MongoDB no respondió en 20 ms");
  });

  test("si el repositorio tarda y despues falla, no hay un rechazo sin manejar", async () => {
    const { servicio } = armar(
      {
        registrar: () => new Promise<void>((_ok, rechazar) => setTimeout(() => rechazar(new Error("tarde")), 60)),
      },
      10,
    );

    await servicio.registrar(registro);
    await new Promise((resolver) => setTimeout(resolver, 100)); // deja correr el rechazo tardio

    expect(true).toBe(true); // si hubiera un rechazo sin manejar, Jest/Node habrian fallado antes
  });
});

describe("historialDe", () => {
  test("devuelve el historial que entrega el repositorio", async () => {
    const { servicio, llamadas } = armar();

    await expect(servicio.historialDe("abc")).resolves.toEqual([guardado]);
    expect(llamadas).toEqual(["historialDe abc"]);
  });

  test("si MongoDB falla responde 503 y lo registra", async () => {
    const { servicio, lineas } = armar({
      historialDe: async () => {
        throw new Error("sin conexión");
      },
    });

    await expect(servicio.historialDe("abc")).rejects.toMatchObject({ estado: 503 });
    expect(lineas[0]).toContain("No se pudo consultar la auditoría");
  });
});

describe("listar", () => {
  test("sin parámetros usa el límite por defecto (50) y no filtra", async () => {
    const { servicio, llamadas } = armar();

    await servicio.listar({});

    expect(llamadas).toEqual(['listar {"limite":50}']);
  });

  test("acepta la operación en minúscula y el límite como texto", async () => {
    const { servicio, llamadas } = armar();

    await servicio.listar({ operacion: "eliminar", limite: "10" });

    expect(llamadas).toEqual(['listar {"operacion":"ELIMINAR","limite":10}']);
  });

  test("una operación vacía cuenta como sin filtro", async () => {
    const { servicio, llamadas } = armar();

    await servicio.listar({ operacion: "  " });

    expect(llamadas).toEqual(['listar {"limite":50}']);
  });

  test("rechaza con 400 una operación desconocida", async () => {
    const { servicio, llamadas } = armar();

    await expect(servicio.listar({ operacion: "BORRAR" })).rejects.toMatchObject({
      estado: 400,
      detalles: ["operacion debe ser una de: CREAR, ACTUALIZAR, ELIMINAR"],
    });
    expect(llamadas).toEqual([]); // ni se consulto a la base
  });

  test.each([["0"], ["201"], ["-1"], ["1.5"], ["abc"], [""]])("rechaza con 400 el límite %p", async (limite) => {
    const { servicio } = armar();

    await expect(servicio.listar({ limite })).rejects.toMatchObject({
      estado: 400,
      detalles: ["limite debe ser un entero entre 1 y 200"],
    });
  });

  test("acepta justo los extremos del límite: 1 y 200", async () => {
    const { servicio, llamadas } = armar();

    await servicio.listar({ limite: "1" });
    await servicio.listar({ limite: "200" });

    expect(llamadas).toEqual(['listar {"limite":1}', 'listar {"limite":200}']);
  });

  test("informa todos los errores de la consulta juntos", async () => {
    const { servicio } = armar();

    await expect(servicio.listar({ operacion: "x", limite: "0" })).rejects.toMatchObject({
      detalles: ["operacion debe ser una de: CREAR, ACTUALIZAR, ELIMINAR", "limite debe ser un entero entre 1 y 200"],
    });
  });
});
