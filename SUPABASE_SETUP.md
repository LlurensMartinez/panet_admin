# Supabase y acceso privado

Guía de configuración de la Fase 1 (acceso privado y autorización). Complementa a `DATA_MODEL.md` (apartado *Seguridad (RLS)*) y a `IMPLEMENTATION_PLAN.md`.

> Los nombres de las opciones del panel de Supabase pueden cambiar ligeramente con el tiempo. Si alguno no coincide, busca el equivalente en *Authentication*.

## Estado actual

- Integración con el módulo oficial de Nuxt [`@nuxtjs/supabase`](https://supabase.nuxtjs.org) v2, que usa `@supabase/ssr` (sesión en cookies, compatible con SSR).
- Inicio de sesión con correo y contraseña en `/login`. **No hay registro público** en la aplicación.
- Todas las páginas, excepto `/login`, exigen una usuaria **verificada** (`app/middleware/auth.global.js`). Se comprueban los *claims* del JWT validados por Supabase, no solo que exista una cookie.
- Además, la cuenta debe estar en `public.profiles`. Si no lo está, solo puede ver `/acceso-denegado` (sección 7.4).
- Botón **Cerrar sesión** en la cabecera. Cierra solo la sesión de ese dispositivo.
- Proyecto de Supabase creado y variables configuradas en local.
- **Preparado, pendiente de aplicar en el proyecto remoto:**
  - Migración `supabase/migrations/20261028095000_profiles_authorization.sql`. Crea `public.profiles` (lista de cuentas autorizadas), `private.is_authorized()` y la RLS de `profiles`.
  - Script de comprobación `supabase/tests/authorization_checks.sql`.
- Secciones 5 a 8 de esta guía.

Sin `NUXT_PUBLIC_SUPABASE_URL` y `NUXT_PUBLIC_SUPABASE_KEY`, la aplicación compila, pero todas las páginas muestran el error 500 *«Falta configurar la conexión con Supabase»*. Es intencionado: no hay acceso de prueba ni autenticación simulada.

## 1. Crear el proyecto

1. Crea un proyecto en [supabase.com](https://supabase.com). Se recomienda una región de la UE, porque la aplicación guardará datos de trabajadoras.
2. Guarda la contraseña de la base de datos en un gestor de contraseñas. La aplicación no la necesita.

## 2. Cerrar el registro público (obligatorio)

En **Authentication → Sign In / Providers**:

- Desactiva **Allow new users to sign up**. Así solo pueden entrar usuarios que ya existan.
- Desactiva **Allow anonymous sign-ins**.
- Deja activo solo el proveedor **Email**. No actives Google, Apple, Magic Link ni otros.

Comprobación: con el registro desactivado, una llamada directa a la API de registro debe fallar con el error `signup_disabled` (HTTP 422):

```bash
curl -i -X POST "$NUXT_PUBLIC_SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $NUXT_PUBLIC_SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"prueba-registro@example.com","password":"Una-contraseña-larga-1"}'
```

Esta comprobación es importante: la clave publicable es pública y cualquiera podría llamar a la API directamente, aunque la aplicación no tenga pantalla de registro.

## 3. Crear la cuenta de la encargada

En **Authentication → Users → Add user → Create new user**:

- Correo de la encargada y una contraseña larga y única.
- Marca **Auto Confirm User**. Si no, el inicio de sesión fallará con «Esta cuenta todavía no está activada».
- Apunta el **UUID** de la usuaria: hará falta para las políticas RLS.

Recomendado (en **Authentication**): una longitud mínima de contraseña razonable. Si el plan lo permite, activa también la protección contra contraseñas filtradas.

## 4. Variables de entorno

Copia `.env.example` como `.env` y rellena:

| Variable | Dónde se obtiene | Notas |
| --- | --- | --- |
| `NUXT_PUBLIC_SUPABASE_URL` | Botón **Connect** o **Project Settings → API** | `https://<ref>.supabase.co` |
| `NUXT_PUBLIC_SUPABASE_KEY` | **Project Settings → API Keys** → *Publishable key* (`sb_publishable_…`) | Llega al navegador por diseño |

- **Nunca** pongas la clave secreta (`sb_secret_…`) ni la `service_role` en `.env`, en el código ni en el entorno de despliegue. Esas claves saltan todas las políticas RLS, y la aplicación no las necesita.
- El módulo leería automáticamente `SUPABASE_SECRET_KEY` o `SUPABASE_SERVICE_ROLE_KEY` si existieran (solo en el servidor). Por eso no deben definirse.
- `.env` está en `.gitignore`. Comprueba con `git status` que no aparece antes de cada commit.
- En el despliegue, define las mismas dos variables en el panel del hosting.

Con la autenticación por correo y contraseña no hace falta configurar *Redirect URLs*. En **Authentication → URL Configuration**, pon en *Site URL* la URL de producción. Las *Redirect URLs* solo harán falta si más adelante se añade la recuperación de contraseña.

## 5. Aplicar la migración de autorización

Archivo: `supabase/migrations/20261028095000_profiles_authorization.sql`. Solo crea objetos nuevos y no borra ni modifica datos. Se aplica **una sola vez** por proyecto.

Crea lo siguiente:
- **Esquema `private`:** no se expone en la Data API y solo el propietario puede crear objetos en él.
- **Tabla `public.profiles`:** `id` es el UUID de `auth.users`, con `on delete cascade`, y no guarda credenciales.
- **Función `private.is_authorized()`:**
  - Es `SECURITY DEFINER` y tiene `search_path` vacío.
  - Solo pueden ejecutarla las sesiones autenticadas (`authenticated`).
- **RLS de `profiles`:** cada cuenta solo puede leer su propia fila. Ningún cliente puede insertar, modificar ni borrar filas.
- **Trigger** que mantiene `updated_at`.

### Antes de empezar (SQL Editor)

- **Rol `postgres`:** en el SQL Editor, el selector **Role** (junto al botón *Run*) debe estar en **`postgres`**, sin suplantar a ninguna usuaria. Es necesario en las secciones 5, 6 y 7.1.
  - La migración y las altas en `profiles` solo puede hacerlas `postgres`.
  - Con otro rol, la migración falla sin aplicar nada y las comprobaciones dan resultados engañosos.
- **Una consulta cada vez:** el SQL Editor muestra solo el resultado de la **última** sentencia. Las consultas de verificación de esta guía se ejecutan **una a una**: pega una, ejecútala, mira el resultado y pasa a la siguiente. Las excepciones son la migración (paso 3 de la opción A) y el script de la sección 7.1, que se ejecutan enteros de una vez.

**Comprobación previa:** confirma que ni el esquema `private` ni la tabla `profiles` existen todavía.

```sql
select to_regnamespace('private') as esquema_private,
       to_regclass('public.profiles') as tabla_profiles;
```

- **Ambas columnas vacías (`NULL`):** se puede aplicar la migración.
- **Alguna con valor:** **no apliques la migración.**
  - Puede que ya esté aplicada (comprueba los pasos de verificación de la opción A) o que exista un esquema `private` creado para otra cosa.
  - Revisa qué contiene antes de seguir y no borres nada sin entenderlo.

### Opción A — SQL Editor del panel (recomendada por ahora)

1. Abre **SQL Editor → New query** y comprueba que el selector **Role** está en `postgres`.
2. Escribe `begin;` en la primera línea.
3. Pega debajo el contenido completo del archivo de migración.
4. Escribe `commit;` en la última línea.
5. Ejecuta (*Run*) una sola vez. Lo esperado es «Success. No rows returned».
6. Verifica el resultado con estas tres consultas, **una a una**:

   ```sql
   select c.relname, c.relrowsecurity as rls
   from pg_class c where c.oid = 'public.profiles'::regclass;
   ```
   Esperado: una fila `profiles` con `rls = true`.

   ```sql
   select policyname, cmd, roles from pg_policies where tablename = 'profiles';
   ```
   Esperado: una sola fila, `profiles_select_own` · `SELECT` · `{authenticated}`.

   ```sql
   select proname, prosecdef as security_definer, proconfig
   from pg_proc where pronamespace = 'private'::regnamespace;
   ```
   Esperado: dos filas.
   - `is_authorized`, con `security_definer = true`.
   - `set_updated_at`, con `security_definer = false`.
   - Las dos con `proconfig = {"search_path=\"\""}`.

### Si la migración da un error

La migración está envuelta en `begin;` … `commit;`. Si una sentencia falla, PostgreSQL anula la transacción entera y **no se aplica nada**. Antes de reintentar, compruébalo:

1. Copia el mensaje de error completo y **no** vuelvas a ejecutar la migración todavía.
2. En una consulta nueva, con el rol `postgres`, ejecuta:

   ```sql
   select to_regnamespace('private') as esquema_private,
          to_regclass('public.profiles') as tabla_profiles;
   ```

   Si en lugar de un resultado aparece el error *current transaction is aborted*, ejecuta `rollback;` sola y repite esta consulta.

3. Interpreta el resultado:
   - **Ambas columnas vacías (`NULL`):** no ha quedado nada aplicado. Corrige la causa del error y repite la opción A desde el paso 1.
   - **Alguna con valor:** se ha aplicado una parte. Esto no debería ocurrir con `begin;`/`commit;`.
     - No reintentes la migración ni borres nada a mano.
     - Revisa el estado con las tres consultas del paso 6 antes de decidir.

Si después empiezas a usar la CLI de Supabase, marca esta migración como ya aplicada para que `db push` no intente repetirla: `npx supabase migration repair --status applied 20261028095000`.

### Opción B — CLI de Supabase

No se ha añadido la CLI como dependencia del proyecto. Se puede usar con `npx`; pedirá la contraseña de la base de datos:

```bash
npx supabase login
npx supabase link --project-ref <ref-del-proyecto>
npx supabase db push --dry-run   # revisa qué se aplicaría
npx supabase db push
```

La CLI ejecuta cada migración dentro de una transacción.

### Comprobar que `private` no está expuesto

En **Project Settings → Data API** (o *API*), la lista **Exposed schemas** no debe incluir `private`. Por defecto solo incluye `public` y `graphql_public`.

## 6. Autorizar la cuenta

Una cuenta solo tiene acceso a los datos si su UUID está en `public.profiles`. Se hace a mano en el **SQL Editor**, que se ejecuta como `postgres`.

1. **Busca el UUID** de la cuenta, en *Authentication → Users* o con:

   ```sql
   select id, email, created_at from auth.users order by created_at;
   ```

2. **Añádela** sustituyendo el UUID. `display_name` es opcional.

   ```sql
   insert into public.profiles (id, display_name)
   values ('00000000-0000-0000-0000-000000000000', 'Encargada');
   ```

3. **Comprueba que está autorizada:**

   ```sql
   -- Cuentas autorizadas
   select p.id, u.email, p.display_name, p.created_at
   from public.profiles p
   join auth.users u on u.id = p.id;

   -- Simula una petición de esa cuenta: debe devolver true.
   -- No deja cambios: se revierte al final.
   begin;
   select set_config('request.jwt.claims',
     '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
   set local role authenticated;
   select private.is_authorized() as autorizada;
   rollback;
   ```

**Retirar una autorización:** `delete from public.profiles where id = '<uuid>';`. Solo borra la autorización, no la cuenta de Supabase Auth. El acceso a los datos protegidos se corta en la siguiente consulta, aunque la sesión siga abierta.

**Cuenta provisional:** si la cuenta con la que se está probando no es la definitiva de la encargada, autorízala solo mientras dure el desarrollo. Cuando exista la cuenta real, añade la nueva y retira la provisional.

## 7. Verificar la seguridad

### 7.1 Comprobaciones SQL (SQL Editor)

Archivo: `supabase/tests/authorization_checks.sql`.

1. **Opcional, pero recomendado:** crea una **segunda cuenta de prueba** en *Authentication → Users* (con *Auto Confirm User*) y **no** la añadas a `profiles`.
2. Pega el script en el SQL Editor y, en la sección `CONFIGURACIÓN`, sustituye:
   - `v_authorized`: el UUID de la cuenta autorizada.
   - `v_unauthorized`: el UUID de la segunda cuenta. Si lo dejas en `null`, se usa un UUID aleatorio.
3. Ejecuta. Se mostrará una tabla de unas 30 comprobaciones: **todas deben decir `OK`**.

El script no deja cambios. Simula peticiones como `anon` (sin sesión) y como `authenticated` con cada UUID, igual que hace Supabase con el JWT de cada petición. Comprueba lo siguiente:
- **Configuración:**
  - RLS activo y una única política.
  - Privilegios de `anon` y `authenticated`.
  - `SECURITY DEFINER`, `search_path` y propietario de la función.
  - Permisos del esquema `private`.
- **Sin sesión:** no puede leer `profiles`, ejecutar `is_authorized()` ni insertarse.
- **Cuenta autenticada no autorizada:**
  - `is_authorized()` devuelve `false` y no ve ninguna fila.
  - No puede insertarse, modificar ni borrar filas.
  - Tampoco puede desactivar RLS, borrar o crear políticas, ni reemplazar o crear funciones en `private`.
- **Cuenta autorizada:**
  - `is_authorized()` devuelve `true`, ve solo su fila.
  - No puede modificar ni retirar su propia autorización desde el cliente.

Si una escritura prohibida llegara a funcionar, el script la deshace en el momento y la marca como `FALLO`.

### 7.2 Comprobaciones a través de la API (de extremo a extremo)

Prueban el camino real que usa el navegador: la clave publicable y el JWT van a la API REST de Supabase. Ejecuta desde la carpeta del proyecto. Las contraseñas se piden por teclado para que no queden en el historial.

```bash
set -a; source .env; set +a
URL="$NUXT_PUBLIC_SUPABASE_URL"; KEY="$NUXT_PUBLIC_SUPABASE_KEY"

# Obtener el token de una cuenta (repite para cada cuenta que quieras probar)
token_de() {
  read -r -s -p "Contraseña de $1: " PW; echo >&2
  curl -s -X POST "$URL/auth/v1/token?grant_type=password" \
    -H "apikey: $KEY" -H "Content-Type: application/json" \
    -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$1" "$PW")" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).access_token'
}

# 1. Sin sesión → esperado: HTTP 401, código 42501 (permission denied)
curl -s -w '\nHTTP %{http_code}\n' "$URL/rest/v1/profiles?select=*" -H "apikey: $KEY"

# 2. Segunda cuenta (autenticada, NO autorizada)
T2=$(token_de segunda-cuenta@ejemplo.com)
#   Lectura → esperado: HTTP 200 y []
curl -s -w '\nHTTP %{http_code}\n' "$URL/rest/v1/profiles?select=*" -H "apikey: $KEY" -H "Authorization: Bearer $T2"
#   Intento de autorizarse a sí misma → esperado: HTTP 403, código 42501
curl -s -w '\nHTTP %{http_code}\n' -X POST "$URL/rest/v1/profiles" -H "apikey: $KEY" -H "Authorization: Bearer $T2" \
  -H "Content-Type: application/json" -d '{"id":"<uuid-de-la-segunda-cuenta>"}'
#   Llamar a la función como RPC → esperado: HTTP 404 (el esquema private no está expuesto)
curl -s -w '\nHTTP %{http_code}\n' -X POST "$URL/rest/v1/rpc/is_authorized" -H "apikey: $KEY" -H "Authorization: Bearer $T2"

# 3. Cuenta autorizada → esperado: HTTP 200 y solo su propia fila
T1=$(token_de encargada@ejemplo.com)
curl -s -w '\nHTTP %{http_code}\n' "$URL/rest/v1/profiles?select=*" -H "apikey: $KEY" -H "Authorization: Bearer $T1"
```

Cuando termines las pruebas, puedes eliminar la segunda cuenta desde *Authentication → Users*.

### 7.3 Lo que estas pruebas no cubren todavía

- **Tablas de negocio:** aún no existen. Cada tabla nueva necesita sus propias políticas y comprobaciones (sección 8).
- **La interfaz:** ver la sección 7.4. La app ya comprueba `profiles`, pero esa comprobación es solo de interfaz; la protección de los datos sigue siendo RLS.

### 7.4 Control de acceso en la aplicación

Después de iniciar sesión, la app consulta `public.profiles` con la sesión de la usuaria: `supabase.from('profiles').select('id').eq('id', <uuid>).maybeSingle()`. Usa la clave publicable y el JWT, nunca una clave secreta. La política `profiles_select_own` solo devuelve la propia fila, si existe.

| Resultado de la consulta | Qué ve la usuaria |
| --- | --- |
| Devuelve su fila | Las páginas privadas. |
| No devuelve fila | `/acceso-denegado`: mensaje de cuenta sin autorización, botón «Comprobar de nuevo» y «Cerrar sesión». No puede abrir ninguna otra página privada. |
| 401 / JWT rechazado | Se cierra la sesión local y vuelve a `/login` con el aviso «Tu sesión ha caducado». |
| Sin conexión, 5xx o error desconocido | Página de error 503 «No se ha podido comprobar el acceso», con «Reintentar» (recarga completa) y «Cerrar sesión». **No** se trata como «no autorizada» ni da acceso. |
| La tabla no existe o faltan permisos (migración sin aplicar) | Página de error 503 «Falta preparar la base de datos». |

Otros detalles del funcionamiento:
- **Por defecto se deniega:** cualquier resultado no reconocido deniega el acceso.
- **Caché:** los resultados «autorizada» y «no autorizada» se guardan mientras dura la sesión en la página. Cada carga completa vuelve a consultar en el servidor. Los errores no se guardan.
- **Bucles:** los evitan las reglas de `app/utils/authorization.js`, cubiertas por pruebas unitarias (`npm test`).
- **Código:**
  - `app/middleware/auth.global.js`
  - `app/composables/useAuthorization.js`
  - `app/utils/authorization.js`
  - `app/pages/acceso-denegado.vue`
  - `app/error.vue`

**Importante:** mientras la migración no esté aplicada, cualquier cuenta que inicie sesión verá «Falta preparar la base de datos». Es el comportamiento esperado: sin la lista de cuentas autorizadas no se concede acceso.

Para comprobarlo en el proyecto real, después de las secciones 5 y 6:
1. Inicia sesión con la cuenta autorizada: debe verse la página privada.
2. Inicia sesión con la segunda cuenta, que no está en `profiles`: debe verse «Acceso no autorizado». Al escribir `/` en la barra de direcciones debe volver a esa página.
3. Con la segunda cuenta, añádela temporalmente a `profiles` y pulsa «Comprobar de nuevo»: debe entrar. Después retírala.

## 8. Regla para las tablas de negocio (fases 2 a 5)

La plantilla SQL está en `DATA_MODEL.md` (*Regla para cada tabla de negocio*). En resumen, cada migración que cree una tabla debe, en el mismo archivo:

1. Activar RLS.
2. Retirar a `anon` y `authenticated` todos los privilegios que Supabase concede por defecto, incluido `TRUNCATE`, que salta RLS. Después, conceder a `authenticated` solo los necesarios.
3. Crear políticas `to authenticated` basadas en `(select private.is_authorized())`. Nunca `using (true)` ni políticas abiertas a cualquier autenticado.
4. Ampliar `supabase/tests/authorization_checks.sql` con las comprobaciones de la tabla.

**Rutas de servidor de Nuxt** (si se crean en `server/api`): usar `serverSupabaseClient(event)`, que actúa con el JWT de la usuaria y respeta RLS. Devolver 401 si `serverSupabaseUser(event)` no devuelve usuaria. No usar `serverSupabaseServiceRole`.

## Limitaciones conocidas

- La cookie de sesión dura 8 horas desde la última renovación (valor por defecto del módulo). Si la app no se usa durante más tiempo, habrá que volver a iniciar sesión.
- En desarrollo las cookies no llevan el atributo `Secure` (`$development` en `nuxt.config.js`), para poder probar desde el móvil por `http://` en la red local. En producción sí lo llevan, así que hace falta HTTPS.
- No hay recuperación de contraseña desde la aplicación. Por ahora se cambia desde el panel de Supabase (*Authentication → Users*).
- Si un proyecto usa las claves JWT antiguas (simétricas), cada comprobación de sesión consulta a Supabase. Con las claves asimétricas actuales la verificación es local.
- **Validación del SQL:**
  - La migración y el script de comprobación se han probado en un PostgreSQL 16 local que imita los roles y privilegios por defecto de Supabase (`anon`, `authenticated`, `service_role`, `auth.uid()`). Las peticiones de la sección 7.2 se han probado contra PostgREST 13 en local, con tokens de prueba.
  - **No** se han probado en el proyecto remoto, cuya versión de PostgreSQL y configuración pueden diferir.
  - La seguridad solo se puede dar por validada después de ejecutar las secciones 7.1 y 7.2 en el proyecto real.
- **`service_role` y la clave secreta:** saltan RLS por diseño. Cualquier proceso que las use tiene acceso total, así que nunca deben llegar a la app ni a archivos versionados.
