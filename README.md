# Panet Admin

Aplicación web privada para gestionar una única tienda (pedidos a proveedores y gestión básica del personal).

Documentación del proyecto:

- `SPEC.md`: alcance funcional.
- `DATA_MODEL.md`: modelo de datos y seguridad.
- `IMPLEMENTATION_PLAN.md`: fases de implementación.
- `CLAUDE.md`: instrucciones para Claude Code.

## Stack

Nuxt 4 · JavaScript · Nuxt UI 4 · Tailwind CSS 4 · ESLint (`@nuxt/eslint`) · npm

Requiere Node.js `^22.22.3`, `^24.15.0` o `>=26`.

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
  app.vue              # raíz: <UApp> + <NuxtPage>
  assets/css/main.css  # importa Tailwind CSS y Nuxt UI
  pages/index.vue      # página inicial provisional
nuxt.config.js
eslint.config.mjs
```

`tsconfig.json` solo sirve para que el editor (VS Code / Vue - Official) entienda los auto-imports de Nuxt; el proyecto está escrito en JavaScript.
