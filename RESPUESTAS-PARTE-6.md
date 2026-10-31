# Parte 6 — Seguridad, identidad y control de acceso

Respuestas sobre cómo se resolvió la Parte 6 en **portafolio-cripto**. El detalle de uso (variables, endpoints, matriz de
roles) está en el [README](README.md) y la configuración de Auth0 en [AUTH0.md](AUTH0.md); acá va el razonamiento.

> **Opción elegida:** la **B (recomendada)**: Auth0 como proveedor de identidad. La opción A (registro y login propios con
> `bcrypt` en MySQL) no se implementó. Se probó con una cuenta real de Auth0 (tenant gratuito), no solo con un simulador.

---

## 1. ¿Qué decisiones de arquitectura tomaste?

**La API no maneja usuarios ni contraseñas: solo verifica tokens.** Auth0 autentica y emite un JWT firmado; la API comprueba esa
firma con las claves públicas (JWKS) de Auth0 y confía en lo que el token dice. Así no hay una tabla de usuarios que proteger, ni
hashes que filtrar, ni lógica de recuperación de contraseñas, y el login (MFA, bloqueos, proveedores sociales) lo mantiene un
servicio especializado.

| Decisión | Motivo |
| --- | --- |
| **Verificar, no emitir** (`jose` + JWKS) | Delegar lo difícil y de alto riesgo. Cambiar de proveedor (Keycloak, Clerk…) es cambiar 4 variables |
| Algoritmo fijo **`RS256`**, y `iss`, `aud`, `exp` obligatorios | Sin la lista cerrada, `alg: none` o firmar con HS256 usando la clave pública como secreto podrían pasar |
| **401 vs 403 vs 503** distintos | 401: no se sabe quién sos. 403: se sabe pero no podés. 503: no se pudo verificar porque el proveedor no responde (no es culpa del cliente) |
| El mensaje de un token inválido **no dice qué falló** | No le sirve a un atacante; el de "venció" sí se dice, porque le sirve al cliente legítimo |
| Los **roles viajan en el token**, en un claim propio con espacio de nombres | Lo pide la letra y evita consultar al proveedor en cada petición; Auth0 exige el espacio de nombres (una URL) para claims propios |
| Los roles desconocidos se descartan; un usuario **sin roles** es válido pero no puede nada | La autenticación dice *quién*, la autorización *qué*; no se confía en roles inventados |
| **La matriz se declara en cada ruta** y un test la verifica | Una ruta nueva sin permiso quedaría abierta a cualquier usuario autenticado sin que nadie lo note. El test falla en ese caso |
| **Modo pánico en Redis**, no en memoria | La API va a correr en varias instancias (Parte 8): una variable en memoria cambiaría en una sola |
| El modo pánico **falla cerrado** y el **ADMIN nunca se bloquea** | Ante la duda durante un incidente no se escribe (503); pero el ADMIN tiene que poder operar y apagarlo |
| Limpiar la caché con **`SCAN` + borrar `activo:*`**, nunca `FLUSHALL` | Redis también guarda la cola, las preferencias, los contadores y el modo pánico |
| Preferencias **por usuario** (`preferencias:<sub>`) con el `sub` del token | El id sale del token verificado, nunca del pedido: nadie lee ni cambia las de otro |
| El `sub` del usuario va a `metadatos.usuario` de la auditoría y de los reportes | Trazabilidad: quién hizo cada cosa |
| `/salud` queda público | Lo necesitan Docker y los monitores, que no tienen token |

## 2. ¿Qué arquitectura utilizaste?

Sigue siendo un monolito modular en capas; la seguridad se agrega como **un punto de control en la entrada** (*Policy
Enforcement Point*): el middleware de autenticación y los de autorización van antes de los controladores, que no saben nada de
tokens. Es **autenticación federada** (OpenID Connect / OAuth 2.0 con un proveedor externo) con **tokens sin estado**
(*stateless*) y **RBAC** (control de acceso basado en roles). El modo pánico es un *kill switch* compartido (estado distribuido
en Redis).

```
Cliente ─ usuario y contraseña ─► Auth0 ─► JWT (iss, aud, exp, sub, roles)
Cliente ─ Authorization: Bearer ─► autenticar (firma, iss, aud, exp) ─► autorizar (rol) ─► modo pánico (si escribe) ─► controlador
```

Que el token sea *stateless* es lo que permite escalar: ninguna instancia guarda sesiones, así que da igual cuál reciba el pedido.

## 3. ¿Tuviste en cuenta atributos de calidad?

| Atributo | Táctica aplicada | Dónde se ve |
| --- | --- | --- |
| **Seguridad: autenticación** | Verificación criptográfica del token (firma, algoritmo fijo, emisor, audiencia, vencimiento) | `verificadorJwt.ts`, 33 tests, 6 mutaciones detectadas |
| **Seguridad: autorización / mínimo privilegio** | RBAC por ruta; cada rol solo lo que necesita | La matriz del README; el test de contrato `permisosDeRutas.test.ts` |
| **Seguridad: defensa en profundidad** | Rol y, además, modo pánico; lectura, escritura y administración separadas | `permisos.ts` |
| **Auditabilidad** | Cada 403 y cada cambio del modo pánico al log; `metadatos.usuario` en MongoDB | Logs y auditoría |
| **Disponibilidad** | Las claves de Auth0 se guardan en memoria: con Auth0 caído, una API que ya las tenía sigue autenticando | Verificado: 200 con el proveedor caído; sin claves previas, 503 |
| **Escalabilidad** | Token sin estado; el modo pánico lo ven todas las instancias | Redis |
| **Rendimiento** | No se consulta a Auth0 por petición | ~4 ms por petición autenticada |
| **Testabilidad** | Fábricas con la clave y Redis por parámetro; claves generadas al momento, sin red | 385 tests, ninguno necesita internet |

**Verificado con Auth0 real** (los tres usuarios, cada uno con su token): la matriz completa (12 filas × 3 roles), el modo pánico
(TRADER 403 en escrituras, lecturas y `analizar` siguen; ADMIN sigue escribiendo), la falla cerrada con Redis detenido (TRADER 503,
ADMIN 201, lectura 200), las preferencias aisladas por usuario y que limpiar la caché no toca las claves `bull:*`,
`preferencias:*`, `estadisticas:*` ni el ranking. Newman con Auth0 real: 70 requests, 0 fallas.

> **Lo que se resignó:** la revocación inmediata. Un token es válido hasta que vence (en este tenant, **24 horas**): si a un usuario
> se le quita un rol o se lo bloquea en Auth0, su token ya emitido sigue funcionando con los permisos viejos hasta entonces. Es el
> precio de no consultar al proveedor en cada petición. Se mitiga con tokens de vida corta.

## 4. ¿Qué mejoras implementarías en futuras versiones?

- **Tokens de vida corta + *refresh tokens***, para acotar la ventana de la revocación. Y que el front use *Authorization Code + PKCE*:
  hoy los tokens de prueba se piden con usuario y contraseña (*Resource Owner Password*), que Auth0 desaconseja y es solo para desarrollo.
- **Permisos finos (*scopes*)** en lugar de roles gruesos (`crear:activos`, `ver:auditoria`…), para no tocar el código al cambiar quién puede qué.
- **MFA obligatorio para el ADMIN** y alertas ante un uso inusual del modo pánico.
- **Auditar en MongoDB** (no solo en el log) quién activó el modo pánico y quién limpió la caché.
- **Rate limiting** por usuario/IP: hoy alguien con permiso puede saturar la API o la cola de reportes.
- **HTTPS** en la entrada (terminación TLS, `helmet`, CORS explícito): hoy la API habla HTTP plano en local.
- **Secretos fuera del `.env`** (gestor de secretos) y **usuario de aplicación con permisos mínimos** en MongoDB (hoy usa el root).
- **Revocar sesiones** consultando una lista de tokens revocados en Redis para casos críticos.

## 5. ¿Qué dificultades encontraste y cómo las resolviste?

1. **Auth0 rechazó el primer pedido de token:** `Client … is not authorized to access resource server`. Faltaba **autorizar la
   aplicación en la API** (pestaña *Application Access*), un paso que la guía no tenía en su lugar. → Se agregó como paso 6.5 de
   `AUTH0.md` y quedó registrado en la bitácora. La guía se había escrito de memoria del panel y esto fue lo único que hubo que corregir.
2. **El token trae la audiencia como lista** (`[api, userinfo]`). → El verificador la acepta si incluye la de esta API (hay un test).
3. **`pm.sendRequest` de Postman no hereda la autenticación de la colección:** el request de limpieza daba 401 en sus `DELETE` y dejaba
   datos viejos. → Se manda el token a mano en ese script.
4. **El modo pánico puede quedar activo si una corrida de pruebas se corta a medias**, y entonces la siguiente falla en su primera
   escritura. → La colección arranca con un request que lo apaga (`T4`).
5. **Mi Redis falso saltaba claves al recorrer con `SCAN` mientras se borraba**: usaba un índice como cursor. El `SCAN` real garantiza
   devolver lo que existe durante todo el recorrido. → El cursor del falso pasó a ser la última clave vista. Lo encontró un test, no un bug de la aplicación.
6. **Cuidado con el modo pánico y `analizar`:** es un `POST` pero no guarda nada. → No se bloquea; se documentó y se separó `puedeOperar` de `puedeEscribir`.
7. **Cambiar las preferencias de "una billetera" a "por usuario"** dejó huérfana la clave anterior (`preferencias:billetera`). Son datos de
   desarrollo y no se migraron.
8. **Límite gratuito de CoinGecko (429):** volvió a dejar intermitente la colección de Postman si se corre muchas veces seguidas.

---

## Para discutir en clase

- Un token vale 24 horas aunque le quiten el rol al usuario. ¿Cuándo justifica una API consultar al proveedor en cada pedido (o llevar
  una lista de revocados) a costa de la latencia y de depender de él?
- El modo pánico **falla cerrado** (503 si Redis no responde). ¿Y si el incidente fuera justamente que Redis se cayó? ¿Quién protege al sistema?
- ¿Es mejor que un usuario sin permiso reciba 403 o 404? ¿Qué le revela cada uno a un atacante?
- Los roles están en el token. ¿Qué pasa si hay que revocar a un ADMIN comprometido a las 3 de la mañana?
