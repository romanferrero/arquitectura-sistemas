import { readFileSync } from "node:fs";
import { describe, expect, test } from "@jest/globals";

/**
 * "Test de contrato" de la seguridad: lee `src/rutas/activosRutas.ts` y comprueba que CADA ruta
 * declare el permiso que figura en esta tabla. Si alguien agrega una ruta nueva sin permiso (que
 * quedaria abierta a cualquier usuario autenticado), o cambia el de una existente por descuido, este
 * test falla y obliga a decidirlo a conciencia.
 *
 * Se lee el archivo como texto porque importar las rutas arrastraria la configuracion, Redis y las
 * bases; lo que importa aca es solo QUE permiso declara cada una.
 *
 * Leyenda:
 *   puedeLeer      AUDITOR, TRADER, ADMIN
 *   puedeAuditar   AUDITOR, ADMIN
 *   puedeOperar    TRADER, ADMIN                     (no escribe: no se bloquea en modo panico)
 *   ...puedeEscribir  TRADER, ADMIN + bloqueo en modo panico
 *   soloAdmin      ADMIN
 *   (ninguno)      cualquier usuario autenticado
 */
const ESPERADO: Record<string, string> = {
  "GET /yo": "(ninguno)",

  "GET /activos": "puedeLeer",
  "GET /activos/:id": "puedeLeer",
  "GET /activos/:id/precio": "puedeLeer",
  "GET /activos/:id/historial": "puedeLeer",
  "GET /precios/:simbolo": "puedeLeer",
  "GET /preferencias": "puedeLeer",

  "GET /auditoria": "puedeAuditar",

  "POST /activos/analizar": "puedeOperar",

  "POST /activos": "...puedeEscribir",
  "PUT /activos/:id": "...puedeEscribir",
  "DELETE /activos/:id": "...puedeEscribir",
  "PUT /preferencias": "...puedeEscribir",

  "POST /activos/reporte": "soloAdmin",
  "GET /reportes/:id": "soloAdmin",
  "GET /estadisticas": "soloAdmin",
  "DELETE /admin/cache": "soloAdmin",
  "GET /admin/modo-panico": "soloAdmin",
  "PUT /admin/modo-panico": "soloAdmin",
};

/** Lo que el archivo de rutas declara realmente: "METODO /ruta" -> primer argumento tras la ruta. */
function rutasDeclaradas(): Record<string, string> {
  const fuente = readFileSync(new URL("../../src/rutas/activosRutas.ts", import.meta.url), "utf8");
  const declaradas: Record<string, string> = {};
  for (const linea of fuente.split(/\r?\n/)) {
    const coincidencia = /^activosRutas\.(get|post|put|delete|patch)\("([^"]+)",\s*(.+)\);\s*$/.exec(linea);
    if (coincidencia === null) continue;
    const [, metodo, ruta, resto] = coincidencia;
    const primero = (resto ?? "").split(",")[0]?.trim() ?? "";
    // Si el primer argumento ya es el controlador, la ruta no declara ningun permiso.
    const esPermiso = /^(\.\.\.)?(puede[A-Za-z]+|soloAdmin)$/.test(primero);
    declaradas[`${(metodo ?? "").toUpperCase()} ${ruta}`] = esPermiso ? primero : "(ninguno)";
  }
  return declaradas;
}

describe("permisos de las rutas", () => {
  const declaradas = rutasDeclaradas();

  test("el archivo de rutas se leyó bien (hay rutas)", () => {
    expect(Object.keys(declaradas).length).toBeGreaterThanOrEqual(Object.keys(ESPERADO).length);
  });

  test("no hay ninguna ruta que no figure en la tabla (una ruta nueva sin decidir su permiso)", () => {
    const sinTabla = Object.keys(declaradas).filter((ruta) => !(ruta in ESPERADO));

    expect(sinTabla).toEqual([]);
  });

  test("toda ruta de la tabla existe (no quedó una tabla vieja)", () => {
    const faltantes = Object.keys(ESPERADO).filter((ruta) => !(ruta in declaradas));

    expect(faltantes).toEqual([]);
  });

  test.each(Object.entries(ESPERADO))("%s declara %s", (ruta, permiso) => {
    expect(declaradas[ruta]).toBe(permiso);
  });

  test("la única ruta sin permiso de rol es /yo", () => {
    const abiertas = Object.entries(declaradas)
      .filter(([, permiso]) => permiso === "(ninguno)")
      .map(([ruta]) => ruta);

    expect(abiertas).toEqual(["GET /yo"]);
  });

  test("toda ruta que ESCRIBE (POST, PUT, DELETE) exige rol de operación o ser ADMIN, nunca solo leer", () => {
    const escriben = Object.entries(declaradas).filter(([ruta]) => !ruta.startsWith("GET "));

    for (const [ruta, permiso] of escriben) {
      expect([ruta, ["...puedeEscribir", "puedeOperar", "soloAdmin"].includes(permiso)]).toEqual([ruta, true]);
    }
  });

  test("el CRUD de activos y las preferencias pasan por el bloqueo del modo pánico", () => {
    for (const ruta of ["POST /activos", "PUT /activos/:id", "DELETE /activos/:id", "PUT /preferencias"]) {
      expect([ruta, declaradas[ruta]]).toEqual([ruta, "...puedeEscribir"]);
    }
  });
});
