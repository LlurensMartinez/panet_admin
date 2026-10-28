# Supabase y acceso privado

Guía de configuración de la Fase 1 (acceso privado). Complementa a `DATA_MODEL.md` (apartado *Seguridad (RLS)*) y a `IMPLEMENTATION_PLAN.md`.

> Los nombres de las opciones del panel de Supabase pueden cambiar ligeramente con el tiempo. Si alguno no coincide, busca el equivalente en *Authentication*.

## Estado actual

- Integración con el módulo oficial de Nuxt [`@nuxtjs/supabase`](https://supabase.nuxtjs.org) v2, que usa `@supabase/ssr` (sesión en cookies, compatible con SSR).
- Inicio de sesión con correo y contraseña en `/login`. **No hay registro público** en la aplicación.
- Todas las páginas, excepto `/login`, exigen una usuaria **verificada** (`app/middleware/auth.global.js`). Se comprueban los *claims* del JWT validados por Supabase, no solo que exista una cookie.
- Botón **Cerrar sesión** en la cabecera. Cierra solo la sesión de ese dispositivo.
- **Pendiente:** crear el proyecto de Supabase, configurar las variables y las políticas RLS (ver más abajo).

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

## 5. Controles en servidor y base de datos (fase posterior, obligatoria)

La protección de páginas en Nuxt **no protege los datos**. Cualquiera con la URL y la clave publicable puede llamar directamente a la API de Supabase. La seguridad real dependerá de:

1. **RLS activado en todas las tablas** del esquema `public`, sin políticas para el rol `anon`.
2. **Políticas limitadas a la identidad autorizada**, no a cualquier usuario `authenticated` (ver `CLAUDE.md`). Hay que decidir la opción (decisión pendiente n.º 3 de `DATA_MODEL.md`):
   - **Opción A (recomendada):** usar la tabla `profiles` como lista de personas autorizadas. La fila de la encargada se crea a mano con su UUID. Se añade una función `security definer` que compruebe `exists (select 1 from public.profiles where id = auth.uid())`, y todas las políticas usan `to authenticated using (...) with check (...)` con esa función. `profiles` no admite inserciones ni cambios desde el cliente.
   - **Opción B:** comparar `auth.uid()` con el UUID fijo de la encargada en cada política. Es más simple, pero obliga a cambiar todas las políticas si cambia la cuenta.
3. **Pruebas explícitas antes de desplegar**:
   - Sin sesión no se puede leer ni escribir en ninguna tabla.
   - Una segunda cuenta de prueba creada a mano, que exista pero no esté autorizada, tampoco puede. Después hay que borrarla.
4. **Rutas de servidor de Nuxt** (si se crean en `server/api`): usar `serverSupabaseClient(event)`, que actúa con el JWT de la usuaria y respeta RLS, y devolver 401 si `serverSupabaseUser(event)` no devuelve usuaria. No usar `serverSupabaseServiceRole`.

## Limitaciones conocidas

- La cookie de sesión dura 8 horas desde la última renovación (valor por defecto del módulo). Si la app no se usa durante más tiempo, habrá que volver a iniciar sesión.
- En desarrollo las cookies no llevan el atributo `Secure` (`$development` en `nuxt.config.js`), para poder probar desde el móvil por `http://` en la red local. En producción sí lo llevan, así que hace falta HTTPS.
- No hay recuperación de contraseña desde la aplicación. Por ahora se cambia desde el panel de Supabase (*Authentication → Users*).
- Si un proyecto usa las claves JWT antiguas (simétricas), cada comprobación de sesión consulta a Supabase. Con las claves asimétricas actuales la verificación es local.
