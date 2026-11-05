/**
 * Jest en modo ESM (el proyecto es "type": "module").
 * Se ejecuta con `node --experimental-vm-modules`, ver el script "test".
 */
export default {
  testEnvironment: "node",
  // Tope de procesos: con un worker por nucleo (16) y Docker corriendo, esta maquina (8 GB) se queda sin
  // memoria y Jest tira "worker ran out of memory". Con 2 la suite entera corre en pocos segundos.
  maxWorkers: 2,
  testMatch: ["<rootDir>/pruebas/**/*.test.ts"],
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": "<rootDir>/pruebas/transformadorTs.js",
  },
};
