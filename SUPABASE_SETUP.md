# Supabase y acceso privado

Guía de configuración de Supabase: acceso privado y autorización (Fase 1, secciones 1 a 8) y tablas de trabajadoras y horas extra (Fase 2, sección 9). Complementa a `DATA_MODEL.md` (apartado *Seguridad (RLS)*) y a `IMPLEMENTATION_PLAN.md`.

> Los nombres de las opciones del panel de Supabase pueden cambiar ligeramente con el tiempo. Si alguno no coincide, busca el equivalente en *Authentication*.

## Estado actual

- Integración con el módulo oficial de Nuxt [`@nuxtjs/supabase`](https://supabase.nuxtjs.org) v2, que usa `@supabase/ssr` (sesión en cookies, compatible con SSR).
- Inicio de sesión con correo y contraseña en `/login`. **No hay registro público** en la aplicación.
- Todas las páginas, excepto `/login`, exigen una usuaria **verificada** (`app/middleware/auth.global.js`). Se comprueban los *claims* del JWT validados por Supabase, no solo que exista una cookie.
- Además, la cuenta debe estar en `public.profiles`. Si no lo está, solo puede ver `/acceso-denegado` (sección 7.4).
- Botón **Cerrar sesión** en la cabecera. Cierra solo la sesión de ese dispositivo.
- Proyecto de Supabase creado y variables configuradas en local.
- **Fase 1, aplicada en el proyecto remoto:**
  - Migración `supabase/migrations/20261028095000_profiles_authorization.sql`: crea `public.profiles` (lista de cuentas autorizadas), `private.is_authorized()` y la RLS de `profiles`.
  - Cuenta de la encargada autorizada (sección 6).
  - `supabase/tests/authorization_checks.sql` ejecutado: 31 filas correctas (sección 7.1).
  - El esquema `private` no está expuesto en la Data API.
  - Probado en la app: la cuenta autorizada entra y una segunda cuenta no autorizada queda bloqueada (sección 7.4).
  - **Pendiente de confirmar:** las pruebas por API de la sección 7.2.
- **Fase 2, preparada y pendiente de aplicar en el proyecto remoto** (sección 9):
  - Migración `supabase/migrations/20261028125000_employees_overtime.sql`: crea `public.employees` y `public.overtime_entries` con su RLS.
  - Script de comprobación `supabase/tests/staff_rls_checks.sql`.

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

Una cuenta solo tiene acceso a los datos si su UUID está en `public.profiles`. Se hace a mano en el **SQL Editor**, con el selector **Role** en **`postgres`**: `profiles` no admite altas desde ningún otro rol. Ejecuta las consultas **una a una**.

Haz esta sección justo después de la 5. Mientras la cuenta no esté en `profiles`, la app mostrará «Acceso no autorizado».

1. **Busca el UUID** de la cuenta, en *Authentication → Users* o con:

   ```sql
   select id, email, created_at from auth.users order by created_at;
   ```

2. **Añádela** sustituyendo el UUID. `display_name` es opcional.

   ```sql
   insert into public.profiles (id, display_name)
   values ('00000000-0000-0000-0000-000000000000', 'Encargada');
   ```

3. **Comprueba que está autorizada** con estas dos consultas, una a una:

   ```sql
   select p.id, u.email, p.display_name, p.created_at
   from public.profiles p
   join auth.users u on u.id = p.id;
   ```
   Esperado: una fila con el correo de la cuenta autorizada.

   ```sql
   select exists (
     select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000000'
   ) as autorizada;
   ```
   Sustituye el UUID. Esperado: `autorizada = true`.

   La comprobación completa, simulando peticiones como esa cuenta, como una cuenta no autorizada y sin sesión, la hace el script de la sección 7.1.

**Retirar una autorización:** `delete from public.profiles where id = '<uuid>';`. Solo borra la autorización, no la cuenta de Supabase Auth. El acceso a los datos protegidos se corta en la siguiente consulta, aunque la sesión siga abierta.

**Cuenta provisional:** si la cuenta con la que se está probando no es la definitiva de la encargada, autorízala solo mientras dure el desarrollo. Cuando exista la cuenta real, añade la nueva y retira la provisional.

## 7. Verificar la seguridad

### 7.1 Comprobaciones SQL (SQL Editor)

Archivo: `supabase/tests/authorization_checks.sql`.

1. **Opcional, pero recomendado:** crea una **segunda cuenta de prueba** en *Authentication → Users* (con *Auto Confirm User*) y **no** la añadas a `profiles`.
2. Abre **SQL Editor → New query** y comprueba que el selector **Role** está en **`postgres`**, sin suplantar a ninguna usuaria. El script cambia de rol por sí mismo para simular cada caso y al terminar restaura el rol original. Si se lanza con otro rol, falla o da resultados engañosos.
3. Pega el script **completo** y, en la sección `CONFIGURACIÓN` (al principio del bloque `do $$`), **sustituye los UUID de ejemplo** por los de tus cuentas. Los encontrarás en *Authentication → Users* o con la consulta del paso 1 de la sección 6. Mantén las comillas simples:
   - `v_authorized uuid := '…';` → **obligatorio**: el UUID de la cuenta autorizada, que ya debe estar en `profiles`. Si dejas el valor de ejemplo `00000000-0000-0000-0000-000000000000`, el script se detiene con el mensaje «Sustituye v_authorized…».
   - `v_unauthorized uuid := null;` → **recomendado**: el UUID de la segunda cuenta, entre comillas (`'…'`). Si lo dejas en `null`, se usa un UUID aleatorio que no corresponde a ninguna cuenta real. La prueba de RLS sigue siendo válida, pero no comprueba una cuenta existente.

   Haz la sustitución **solo en el SQL Editor**, no en el archivo del repositorio: el archivo versionado conserva los valores de ejemplo para que no queden UUID de cuentas reales en Git.
4. Ejecuta el script **entero de una vez**. Al contrario que las consultas de verificación, aquí el resultado que importa es el de la última sentencia.

**Cómo leer el resultado.** Se muestra una tabla de **31 filas**:

- **30 comprobaciones** cuyo `resultado` debe empezar por **`OK`**. En los intentos que deben estar prohibidos aparece `OK (denegado)`: el rechazo es el resultado correcto.
- **1 fila informativa** («Segunda cuenta: existe en auth.users») cuyo resultado empieza por **`INFO`**. **No es una comprobación y no cuenta como fallo**:
  - `INFO: sí, es una cuenta real`: has indicado una segunda cuenta existente, que es lo recomendado.
  - `INFO: UUID aleatorio …`: dejaste `v_unauthorized` en `null`.
  - `INFO: no existe; revisa el UUID de v_unauthorized`: el UUID no corresponde a ninguna cuenta, probablemente por una errata. Corrígelo y vuelve a ejecutar.
- **Cualquier fila con `FALLO`** indica un problema de seguridad o de configuración. No sigas adelante. Si la causa es un error, el mensaje incluye su código, por ejemplo `FALLO (error 42501: permission denied …)`.

Si en lugar de la tabla aparece un error, lo habitual es una de estas causas:
- no se sustituyó `v_authorized`;
- el selector Role no está en `postgres`;
- la migración de la sección 5 no está aplicada.

**Aviso de «operaciones destructivas».** Es posible que el SQL Editor pida confirmación porque el script contiene `DELETE`, `DROP`, `TRUNCATE` o `ALTER`. Es esperado y se puede confirmar:
- Son intentos de escritura que el script ejecuta como `anon` y como `authenticated`. **Deben fallar** por falta de permisos, y eso es precisamente lo que se comprueba.
- Si alguno llegara a funcionar, el script lo deshace en el momento y lo marca como `FALLO`.
- El único `TRUNCATE` que se ejecuta de verdad vacía la tabla temporal de resultados del propio script.
- No se modifica ninguna tabla, política ni función del proyecto.

Para confirmarlo, después del script puedes repetir las consultas de verificación de la sección 5 (paso 6) y la primera de la sección 6 (paso 3): deben dar lo mismo que antes.

El script no deja cambios en la base de datos ni en la sesión del SQL Editor. Simula peticiones como `anon` (sin sesión) y como `authenticated` con cada UUID, igual que hace Supabase con el JWT de cada petición. Comprueba lo siguiente:
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

- **Tablas de negocio:** este script solo cubre `profiles`. Las tablas de la Fase 2 tienen su propio script (sección 9) y cada tabla nueva necesita sus propias políticas y comprobaciones (sección 8).
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
4. Crear un script de comprobaciones propio en `supabase/tests/` (por ejemplo, `staff_rls_checks.sql` para la Fase 2), con el mismo patrón que `authorization_checks.sql`, y documentar en esta guía cómo aplicarlo. `authorization_checks.sql` no se amplía.

**Rutas de servidor de Nuxt** (si se crean en `server/api`): usar `serverSupabaseClient(event)`, que actúa con el JWT de la usuaria y respeta RLS. Devolver 401 si `serverSupabaseUser(event)` no devuelve usuaria. No usar `serverSupabaseServiceRole`.

## 9. Fase 2: trabajadoras y horas extra

Archivo: `supabase/migrations/20261028125000_employees_overtime.sql`. Solo crea objetos nuevos y no borra ni modifica datos. Se aplica **una sola vez** por proyecto, después de las secciones 5 y 6.

Crea lo siguiente:
- **Tabla `public.employees`:** nombre, apellidos, puesto (`role`, opcional), observaciones y `is_active`.
  - Rechaza nombres y apellidos vacíos o formados solo por espacios.
  - No se pueden borrar desde la app: se desactivan.
- **Tabla `public.overtime_entries`:** trabajadora, fecha (`work_date`), duración en minutos, motivo y observaciones.
  - La duración debe estar entre 1 y 1440 minutos.
  - Se permiten varios registros de la misma trabajadora el mismo día.
  - Se pueden editar y eliminar.
  - La clave foránea a `employees` usa `on delete restrict`: no se puede borrar una trabajadora con registros, ni siquiera desde el panel.
- **Índice** `(employee_id, work_date)` para historiales y totales por periodo.
- **Triggers** que mantienen `updated_at` en las dos tablas, con la función `private.set_updated_at()` de la Fase 1.
- **RLS:**
  - `anon` no tiene ningún privilegio.
  - `authenticated` puede leer, crear y modificar en las dos tablas y eliminar solo en `overtime_entries`, y **siempre que `private.is_authorized()` sea cierto**.
  - Nadie tiene `TRUNCATE` desde la API.

### 9.1 Antes de empezar

Las mismas condiciones que en la sección 5: selector **Role** en **`postgres`** y consultas de verificación **una a una**.

**Comprobación previa:** confirma que las tablas nuevas no existen y que las funciones de la Fase 1 sí.

```sql
select to_regclass('public.employees') as tabla_employees,
       to_regclass('public.overtime_entries') as tabla_overtime_entries,
       to_regprocedure('private.is_authorized()') as funcion_is_authorized,
       to_regprocedure('private.set_updated_at()') as funcion_set_updated_at;
```

- **Las dos primeras columnas vacías (`NULL`) y las dos últimas con valor:** se puede aplicar la migración.
- **Alguna tabla con valor:** **no apliques la migración.** Puede que ya esté aplicada; compruébalo con las consultas del paso 6 de la sección 9.2.
- **Alguna función vacía:** falta la migración de la Fase 1. Aplícala antes (sección 5).

### 9.2 Aplicar la migración (SQL Editor)

1. Abre **SQL Editor → New query** y comprueba que el selector **Role** está en `postgres`.
2. Escribe `begin;` en la primera línea.
3. Pega debajo el contenido completo de `20261028125000_employees_overtime.sql`.
4. Escribe `commit;` en la última línea.
5. Ejecuta (*Run*) una sola vez. Lo esperado es «Success. No rows returned».
6. Verifica el resultado con estas cuatro consultas, **una a una**:

   ```sql
   select c.relname, c.relrowsecurity as rls
   from pg_class c
   where c.oid in ('public.employees'::regclass, 'public.overtime_entries'::regclass)
   order by 1;
   ```
   Esperado: dos filas, `employees` y `overtime_entries`, las dos con `rls = true`.

   ```sql
   select tablename, policyname, cmd, roles
   from pg_policies
   where tablename in ('employees', 'overtime_entries')
   order by 1, 2;
   ```
   Esperado: siete filas, todas con `roles = {authenticated}`.
   - `employees`: `employees_insert_authorized` (INSERT), `employees_select_authorized` (SELECT) y `employees_update_authorized` (UPDATE). **Ninguna de DELETE.**
   - `overtime_entries`: `overtime_entries_delete_authorized` (DELETE), `overtime_entries_insert_authorized` (INSERT), `overtime_entries_select_authorized` (SELECT) y `overtime_entries_update_authorized` (UPDATE).

   ```sql
   select table_name, grantee,
          string_agg(privilege_type, ', ' order by privilege_type) as privilegios
   from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('employees', 'overtime_entries')
     and grantee in ('anon', 'authenticated')
   group by 1, 2
   order by 1, 2;
   ```
   Esperado: exactamente dos filas, ninguna de `anon`.
   - `employees` · `authenticated` · `INSERT, SELECT, UPDATE`
   - `overtime_entries` · `authenticated` · `DELETE, INSERT, SELECT, UPDATE`

   ```sql
   select tgname, tgrelid::regclass as tabla
   from pg_trigger
   where not tgisinternal
     and tgrelid in ('public.employees'::regclass, 'public.overtime_entries'::regclass)
   order by 1;
   ```
   Esperado: `employees_set_updated_at` y `overtime_entries_set_updated_at`.

Si después empiezas a usar la CLI de Supabase, marca esta migración como aplicada: `npx supabase migration repair --status applied 20261028125000`.

### 9.3 Si la migración da un error

Como en la sección 5, la transacción se anula entera y **no se aplica nada**.

1. Copia el mensaje de error completo y **no** vuelvas a ejecutar la migración todavía.
2. En una consulta nueva, con el rol `postgres`, repite la comprobación previa de la sección 9.1. Si aparece *current transaction is aborted*, ejecuta `rollback;` sola y repítela.
3. Interpreta el resultado:
   - **Las dos tablas vacías (`NULL`):** no ha quedado nada aplicado. Corrige la causa y repite la sección 9.2 desde el paso 1.
   - **Alguna tabla con valor:** no debería ocurrir con `begin;`/`commit;`. No reintentes ni borres nada a mano; revisa el estado con las consultas del paso 6.

Errores habituales:
- *schema "private" does not exist* o *function private.set_updated_at() does not exist*: falta la migración de la Fase 1.
- *relation "employees" already exists*: la migración ya estaba aplicada.
- *permission denied for schema public*: el selector Role no está en `postgres`.

### 9.4 Comprobaciones SQL

Archivo: `supabase/tests/staff_rls_checks.sql`. Se usa igual que el de la sección 7.1:

1. **SQL Editor → New query**, con el selector **Role** en **`postgres`**.
2. Pega el script **completo** y, en la sección `CONFIGURACIÓN`, sustituye los UUID de ejemplo por los de tus cuentas, **solo en el SQL Editor**:
   - `v_authorized`: **obligatorio**, la cuenta autorizada.
   - `v_unauthorized`: **recomendado**, la segunda cuenta de prueba, que no está en `profiles`. Si la dejas en `null`, se usa un UUID aleatorio.
3. Ejecuta el script **entero de una vez**. Es posible que el SQL Editor avise de «operaciones destructivas»: se puede confirmar (ver más abajo).

**Cómo leer el resultado.** Se muestra una tabla de **67 filas**:
- **66 comprobaciones** cuyo `resultado` debe empezar por **`OK`**:
  - `OK (denegado)`: un intento prohibido falló por falta de permisos, que es lo correcto.
  - `OK (0 filas afectadas)`: una cuenta no autorizada intentó modificar o borrar filas que no puede ver. Con RLS no da error: simplemente no afecta a nada.
  - `OK (rechazado, <código>)`: una restricción ha rechazado un dato inválido.
- **1 fila informativa** («Segunda cuenta: existe en auth.users»), que empieza por **`INFO`** y no cuenta como fallo. Se interpreta igual que en la sección 7.1.
- **Cualquier fila con `FALLO`** indica un problema. No sigas adelante.

Qué comprueba:
- **Configuración:**
  - RLS activo.
  - Políticas exactas y basadas en `is_authorized()`.
  - Privilegios de `anon`, `authenticated` y `PUBLIC`.
  - Clave foránea con `ON DELETE RESTRICT`, triggers e índice.
- **Sin sesión (`anon`):** no puede leer, crear, modificar, borrar ni vaciar ninguna de las dos tablas.
- **Cuenta no autorizada:**
  - No ve ninguna fila.
  - No puede crear filas.
  - Sus modificaciones y borrados no afectan a nada.
  - No puede borrar trabajadoras, vaciar tablas, desactivar RLS ni cambiar políticas.
- **Cuenta autorizada:**
  - Ve los datos, crea trabajadoras y registros (varios el mismo día), corrige y elimina registros y desactiva trabajadoras.
  - La trabajadora desactivada conserva su historial y `updated_at` se actualiza solo.
  - No puede borrar trabajadoras ni vaciar tablas.
- **Restricciones:**
  - Rechaza duraciones de 0, negativas o de más de 1440 minutos, y campos obligatorios vacíos.
  - Rechaza nombres o apellidos vacíos o solo con espacios y registros de trabajadoras inexistentes.
  - Como `postgres`, no se puede borrar una trabajadora con registros.
- **Limpieza:** la última fila confirma que no queda ningún dato de prueba.

**Datos de prueba y aviso de «operaciones destructivas».** Para que las pruebas de visibilidad tengan sentido, el script crea una trabajadora («Prueba Comprobaciones RLS») y unos registros de horas extra. Todas las pruebas se ejecutan dentro de un bloque que termina siempre con un error forzado, así que PostgreSQL **deshace todas esas filas y cualquier escritura de las pruebas**. Los `DELETE`, `TRUNCATE`, `ALTER` y `DROP` del script son intentos que deben fallar o escrituras sobre esas filas temporales. No se modifica ningún dato, tabla, política ni función real.

Para confirmarlo, después del script puedes ejecutar:

```sql
select count(*) from public.employees where last_name = 'Comprobaciones RLS';
```

Esperado: `0`.

### 9.5 Comprobaciones a través de la API (opcional, recomendado)

Igual que la sección 7.2, con las mismas funciones y variables (`URL`, `KEY`, `token_de`). Con la segunda cuenta (`T2`, no autorizada):

```bash
# Lectura → esperado: HTTP 200 y []
curl -s -w '\nHTTP %{http_code}\n' "$URL/rest/v1/employees?select=*" -H "apikey: $KEY" -H "Authorization: Bearer $T2"
curl -s -w '\nHTTP %{http_code}\n' "$URL/rest/v1/overtime_entries?select=*" -H "apikey: $KEY" -H "Authorization: Bearer $T2"
# Crear una trabajadora → esperado: HTTP 403, código 42501 (new row violates row-level security policy)
curl -s -w '\nHTTP %{http_code}\n' -X POST "$URL/rest/v1/employees" -H "apikey: $KEY" -H "Authorization: Bearer $T2" \
  -H "Content-Type: application/json" -d '{"first_name":"Prueba","last_name":"API"}'
```

Sin sesión (solo la clave publicable) → esperado: HTTP 401, código 42501:

```bash
curl -s -w '\nHTTP %{http_code}\n' "$URL/rest/v1/employees?select=*" -H "apikey: $KEY"
```

Con la cuenta autorizada (`T1`), la misma lectura devuelve HTTP 200 y la lista de trabajadoras (vacía si aún no hay ninguna). No hace falta probar escrituras con `T1` en el proyecto real: el script de la sección 9.4 ya las comprueba sin dejar datos.

## Limitaciones conocidas

- La cookie de sesión dura 8 horas desde la última renovación (valor por defecto del módulo). Si la app no se usa durante más tiempo, habrá que volver a iniciar sesión.
- En desarrollo las cookies no llevan el atributo `Secure` (`$development` en `nuxt.config.js`), para poder probar desde el móvil por `http://` en la red local. En producción sí lo llevan, así que hace falta HTTPS.
- No hay recuperación de contraseña desde la aplicación. Por ahora se cambia desde el panel de Supabase (*Authentication → Users*).
- Si un proyecto usa las claves JWT antiguas (simétricas), cada comprobación de sesión consulta a Supabase. Con las claves asimétricas actuales la verificación es local.
- **Validación del SQL:**
  - Las migraciones y los scripts de comprobación se han probado en un PostgreSQL 16 local que imita los roles y privilegios por defecto de Supabase (`anon`, `authenticated`, `service_role`, `auth.uid()`). Las peticiones de las secciones 7.2 y 9.5 se han probado contra PostgREST 13 en local, con tokens de prueba.
  - **Fase 1:** la migración y `authorization_checks.sql` se han ejecutado también en el proyecto remoto (31 filas correctas). Falta confirmar la sección 7.2.
  - **Fase 2:** la migración y `staff_rls_checks.sql` **no** se han ejecutado todavía en el proyecto remoto, cuya versión de PostgreSQL y configuración pueden diferir. Su seguridad solo se puede dar por validada después de las secciones 9.2 y 9.4.
- **`service_role` y la clave secreta:** saltan RLS por diseño. Cualquier proceso que las use tiene acceso total, así que nunca deben llegar a la app ni a archivos versionados.
