# Configurar Auth0 para portafolio-cripto

La API **no** guarda usuarios ni contraseñas: delega la autenticación en un proveedor de identidad
(**Auth0**, opción B de la letra de la Parte 6). Auth0 emite los JWT y la API solo los **verifica** con
las claves públicas (JWKS) del proveedor. Esta guía deja Auth0 listo en unos 15 minutos.

> **Estado:** esta guía se probó el 2026-10-31 con una cuenta real de Auth0 (tenant gratuito): los tres usuarios
> obtienen su token con el rol correcto y la API los acepta. El único paso que faltaba en la primera versión es el
> **6.5** (autorizar la aplicación en la API). Los nombres de los menús son los del panel al escribir esto y pueden
> cambiar: el objetivo de cada paso está explicado para poder encontrarlo.

Qué se necesita al terminar: un **tenant**, una **API** (con su *identifier*), tres **roles**, tres
**usuarios**, una **Action** que pone los roles en el token y una **aplicación** para pedir tokens de prueba.

---

## 1. Crear la cuenta

1. Entrá a <https://auth0.com> → **Sign up** (el plan gratuito alcanza).
2. Elegí un nombre de *tenant* (por ejemplo `portafolio-cripto-tuapellido`) y una región.
3. Tu dominio queda como `https://<tenant>.<región>.auth0.com` (por ejemplo `https://portafolio-cripto-ana.us.auth0.com`).
   **Anotalo**: lo vas a usar en el `.env`.

## 2. Registrar la API

**Applications → APIs → Create API**

| Campo | Valor |
|---|---|
| Name | `Portafolio Cripto API` |
| Identifier | `https://portafolio-cripto/api` (es solo un nombre único, no hace falta que exista; **no se puede cambiar después**) |
| Signing Algorithm | `RS256` |

El *identifier* es la **audiencia** (`aud`) de los tokens: así la API sabe que un token es para ella y no para otra.

## 3. Crear los tres roles

**User Management → Roles → Create Role**, tres veces, con estos nombres **exactos** (en mayúsculas):

`AUDITOR` · `TRADER` · `ADMIN`

## 4. Crear tres usuarios de prueba

**User Management → Users → Create User**, con la conexión `Username-Password-Authentication`:

| Email (puede ser inventado) | Rol |
|---|---|
| `auditor@portafolio.test` | AUDITOR |
| `trader@portafolio.test` | TRADER |
| `admin@portafolio.test` | ADMIN |

Elegí una contraseña (la misma para los tres sirve). Después, en cada usuario, pestaña **Roles → Assign Roles**
y asignale el que corresponde.

## 5. La Action que pone los roles en el token

Por defecto Auth0 **no** pone los roles dentro del token. Hay que agregarlos con una *Action*:

1. **Actions → Library → Create Action → Build from scratch**. Name: `Roles en el token`. Trigger: **Login / Post Login**.
2. Pegá este código:

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     // Auth0 exige que los claims propios lleven un espacio de nombres (una URL).
     const espacio = "https://portafolio-cripto";
     const roles = (event.authorization && event.authorization.roles) || [];
     api.accessToken.setCustomClaim(`${espacio}/roles`, roles);
   };
   ```

3. **Deploy**.
4. **Actions → Triggers → post-login** (o *Flows → Login*): arrastrá la Action `Roles en el token` entre
   *Start* y *Complete* y tocá **Apply**. **Sin este paso la Action existe pero no se ejecuta.**

El claim queda con el nombre `https://portafolio-cripto/roles`, que es el de `AUTH_CLAIM_ROLES` en el `.env`.

## 6. Una aplicación para pedir tokens de prueba

Para probar sin armar un front, se pide el token con usuario y contraseña (*Resource Owner Password*):

1. **Applications → Applications → Create Application**. Name: `Portafolio Cripto - pruebas`. Tipo: **Native**.
2. En **Settings → Advanced Settings → Grant Types** tildá **Password** y guardá.
3. Copiá el **Client ID** (no hace falta ningún secreto con una aplicación Native).
4. **Settings (del tenant) → General → API Authorization Settings → Default Directory** = `Username-Password-Authentication`
   y guardá. Sin esto el pedido con contraseña falla.
5. **Autorizá la aplicación para usar la API** (sin esto Auth0 responde `Client "..." is not authorized to access resource
   server`): **Applications → APIs → Portafolio Cripto API → pestaña Application Access**, buscá tu aplicación y en
   **User Access** elegí **Authorized** (sin permisos/*scopes*). También se puede desde la aplicación, pestaña **APIs**.

> Esto es **solo para desarrollo**. En una aplicación real el usuario inicia sesión en una página de Auth0
> (flujo *Authorization Code + PKCE*) y nunca entrega su contraseña a la aplicación.

## 7. Completar el `.env`

```dotenv
AUTH_ISSUER=https://<tenant>.<región>.auth0.com/          # CON la barra final
AUTH_AUDIENCE=https://portafolio-cripto/api
AUTH_JWKS_URL=https://<tenant>.<región>.auth0.com/.well-known/jwks.json
AUTH_CLAIM_ROLES=https://portafolio-cripto/roles
```

La barra final del `AUTH_ISSUER` importa: el `iss` del token tiene que coincidir **exacto**.

## 8. Comprobar que anda

```bash
curl -s -X POST https://<tenant>.<región>.auth0.com/oauth/token \
  -d grant_type=password -d username=trader@portafolio.test -d password='<tu contraseña>' \
  -d audience=https://portafolio-cripto/api -d client_id=<CLIENT_ID> -d scope=openid
```

La respuesta trae un `access_token`. Copialo y probá:

```bash
curl -i http://localhost:3000/api/yo -H "Authorization: Bearer <access_token>"
# → 200 {"sub":"auth0|...","roles":["TRADER"]}
```

Para mirar qué trae el token: pegalo en <https://jwt.io> (solo con tokens de prueba) y buscá
`"https://portafolio-cripto/roles": ["TRADER"]`.

## 9. Postman

1. Copiá `postman/entorno-local.postman_environment.json.ejemplo` a `postman/entorno-local.postman_environment.json`
   (ese archivo **no se versiona**: tiene contraseñas) y completá tu dominio, el Client ID, los emails y la contraseña.
2. Importalo en Postman, elegilo como entorno y corré la colección: los tres primeros requests (`T1`, `T2`, `T3`)
   piden los tokens y el resto los usa.

Con Newman: `npx newman run postman/portafolio-cripto.postman_collection.json -e postman/entorno-local.postman_environment.json`.

---

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| `403 unauthorized_client` / `Grant type 'password' not allowed` | No se tildó **Password** en los Grant Types de la aplicación (paso 6.2) |
| `403 invalid_grant` / `Wrong email or password` | Contraseña incorrecta, o falta el **Default Directory** (paso 6.4) |
| `403 access_denied` / `Client is not authorized to access ...` | La aplicación no tiene acceso a la API: en la API, pestaña **Application Access**, autorizá a la aplicación (acceso de usuario) |
| El token sirve pero `roles` viene vacío | La Action no se desplegó o no se puso en el flujo (paso 5.3 y 5.4), o el usuario no tiene el rol asignado |
| La API responde `401 Token inválido` con un token recién emitido | `AUTH_ISSUER` sin la barra final, `AUTH_AUDIENCE` distinto del *identifier*, o se pidió el token sin `audience` (entonces Auth0 emite uno opaco, no un JWT) |
| La API responde `503` | La API no pudo bajar las claves: revisá `AUTH_JWKS_URL` y la conexión a internet |

---

## Probar sin Auth0: el proveedor de identidad falso

Para correr los tests de punta a punta sin cuenta, el repo trae una herramienta de desarrollo que imita a Auth0
(sirve las claves públicas y emite tokens de prueba para los tres roles). **Solo desarrollo, nunca en producción.**

```bash
npm run idp:falso                # en una terminal: escucha en http://localhost:4000
AUTH_ISSUER=http://localhost:4000/ AUTH_JWKS_URL=http://localhost:4000/.well-known/jwks.json npm run dev   # la API, apuntando a él
npx newman run postman/portafolio-cripto.postman_collection.json -e postman/entorno-idp-falso.postman_environment.json
```

Usuarios (contraseña `prueba123`): `auditor@prueba.com`, `trader@prueba.com`, `admin@prueba.com` y `sinrol@prueba.com`
(un usuario válido sin ningún rol).
