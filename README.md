# Panet Admin

Aplicación web privada para gestionar una única tienda (pedidos a proveedores y gestión básica del personal).

Documentación del proyecto:

- `SPEC.md`: alcance funcional.
- `DATA_MODEL.md`: modelo de datos y seguridad.
- `IMPLEMENTATION_PLAN.md`: fases de implementación.
- `CLAUDE.md`: instrucciones para Claude Code.
- `SUPABASE_SETUP.md`: configuración de Supabase, autorización (RLS), verificación y pasos pendientes.

## Stack

Nuxt 4 · JavaScript · Nuxt UI 4 · Tailwind CSS 4 · Supabase (`@nuxtjs/supabase`) · ESLint (`@nuxt/eslint`) · npm

Requiere Node.js `^22.22.3`, `^24.15.0` o `>=26`.

## Configuración

Copia `.env.example` como `.env` y rellena la URL y la clave publicable de Supabase (ver `SUPABASE_SETUP.md`). Sin ellas, la aplicación compila pero muestra un aviso de configuración pendiente en todas las páginas.

## Comandos

```bash
npm install       # instala dependencias (ejecuta `nuxt prepare` al terminar)
npm run dev       # servidor de desarrollo en http://localhost:3000
npm run build     # compilación de producción
npm run preview   # sirve la compilación de producción en local
npm run lint      # comprobación de calidad y estilo
npm run lint:fix  # corrige automáticamente lo que se pueda
```

## Estructura

```
app/
  app.vue                    # raíz: <UApp> + <NuxtLayout> + <NuxtPage>
  error.vue                  # página de error (incluye configuración pendiente)
  assets/css/main.css        # importa Tailwind CSS y Nuxt UI
  layouts/default.vue        # cabecera de las páginas privadas
  components/LogoutButton.vue
  middleware/auth.global.js  # exige sesión verificada salvo en /login
  pages/login.vue            # inicio de sesión (sin registro)
  pages/index.vue            # página privada provisional
  utils/                     # mensajes de error de acceso y redirección segura
supabase/
  migrations/                # migraciones SQL versionadas (se aplican a mano: ver SUPABASE_SETUP.md)
  tests/                     # comprobaciones SQL de autorización y RLS
nuxt.config.js
eslint.config.mjs
```

`tsconfig.json` solo sirve para que el editor (VS Code / Vue - Official) entienda los auto-imports de Nuxt; el proyecto está escrito en JavaScript.
