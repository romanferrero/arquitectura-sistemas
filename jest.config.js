/**
 * Jest en modo ESM (el proyecto es "type": "module").
 * Se ejecuta con `node --experimental-vm-modules`, ver el script "test".
 */
export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/pruebas/**/*.test.ts"],
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": "<rootDir>/pruebas/transformadorTs.js",
  },
};
