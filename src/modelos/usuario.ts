/**
 * Los tres roles de la aplicacion (RBAC). Los emite el proveedor de identidad dentro del token:
 *  - AUDITOR: solo lectura.
 *  - TRADER:  gestion operativa (CRUD de activos).
 *  - ADMIN:   control total.
 */
export const ROLES = ["AUDITOR", "TRADER", "ADMIN"] as const;
export type Rol = (typeof ROLES)[number];

/** Quien hace el pedido, tal como lo dice un token ya verificado. */
export type Usuario = {
  /** Identificador del usuario en el proveedor de identidad (claim `sub`). */
  sub: string;
  /** Los roles conocidos que trae el token; los que no se reconocen se descartan. */
  roles: Rol[];
};
