/**
 * Jest en modo ESM (el proyecto es "type": "module").
 * Se ejecuta con `node --experimental-vm-modules`, ver el script "test".
 */
export default {
  testEnvironment: "node",
  // Un solo proceso (en banda). Con un worker por nucleo (16) y Docker corriendo, esta maquina (8 GB) se queda sin
  // memoria y algun worker muere con "ran out of memory" (a veces tambien con 4 o con 2). En banda la suite entera
  // (~500 tests) tarda unos 8 segundos y no fallo en 6 corridas seguidas.
  maxWorkers: 1,
  testMatch: ["<rootDir>/pruebas/**/*.test.ts"],
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": "<rootDir>/pruebas/transformadorTs.js",
  },
};
