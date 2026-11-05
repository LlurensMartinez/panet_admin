<script setup>
// Una sección del resumen de Inicio (Hoy, Mañana o Atrasados): cabecera con el
// día y los recuentos reales, y una tarjeta por proveedor. Solo presenta datos
// ya calculados por buildHomeSummary().
const props = defineProps({
  section: { type: Object, default: null },
  // 'today' | 'tomorrow' | 'overdue'
  kind: { type: String, required: true },
  // Ocupa todo el ancho (tarjetas en dos columnas también en escritorio).
  wide: { type: Boolean, default: false },
  today: { type: String, required: true },
  loading: { type: Boolean, default: false },
  productsLoading: { type: Boolean, default: false },
  productsUnavailable: { type: Boolean, default: false },
})

const isToday = computed(() => props.kind === 'today')
const isOverdue = computed(() => props.kind === 'overdue')
const headingId = computed(() => `home-${props.kind}`)
const title = computed(() => (isOverdue.value ? 'Atrasados' : isToday.value ? 'Hoy' : 'Mañana'))
const icon = computed(() => (isOverdue.value ? 'i-lucide-alarm-clock' : isToday.value ? 'i-lucide-sun' : 'i-lucide-sunrise'))
const iconClass = computed(() => {
  if (isOverdue.value) return 'bg-amber-50 text-amber-700 ring ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25'
  return isToday.value ? 'bg-primary text-inverted shadow-xs' : 'bg-default text-primary ring ring-default'
})
// Hoy ya se nombra en el título de la página: aquí se aclara qué incluye.
const dayLabel = computed(() => {
  if (isOverdue.value) return 'Pendientes de preparar de los últimos 7 días'
  if (!props.section?.date) return ''
  if (isToday.value) return 'Para preparar hoy'
  return formatAgendaDay(props.section.date, props.today).subtitle
})

const emptyTitle = computed(() => (isToday.value ? 'Nada que preparar hoy' : 'Nada que preparar mañana'))
const emptyText = computed(() => {
  const done = props.section?.doneCount ?? 0
  const when = isToday.value ? 'hoy' : 'mañana'
  if (done === 0) return `No hay pedidos previstos para ${when}.`
  return done === 1
    ? `El pedido de ${when} ya está preparado o marcado como «no se pide».`
    : `Los ${done} pedidos de ${when} ya están preparados o marcados como «no se pide».`
})
</script>

<template>
  <section
    :aria-labelledby="headingId"
    :aria-busy="loading"
    class="min-w-0"
    :data-home-section="kind"
  >
    <header class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
      <div class="flex min-w-0 flex-[1_1_14rem] items-center gap-3">
        <span
          class="grid size-10 shrink-0 place-items-center rounded-lg"
          :class="iconClass"
          aria-hidden="true"
        >
          <UIcon
            :name="icon"
            class="size-5"
          />
        </span>
        <div class="min-w-0 flex-1">
          <h2
            :id="headingId"
            class="font-display text-xl font-semibold leading-tight tracking-tight text-highlighted"
          >
            {{ title }}
          </h2>
          <p
            v-if="dayLabel"
            class="text-sm text-muted first-letter:uppercase"
          >
            {{ dayLabel }}
          </p>
        </div>
      </div>

      <!-- Indicadores reales: proveedores y pedidos pendientes del día -->
      <div
        v-if="!loading && section && section.orderCount"
        class="flex flex-wrap items-center gap-1.5"
        data-home-counts
      >
        <span
          class="inline-flex items-center gap-1 rounded-full bg-default px-2.5 py-1 text-xs font-medium text-default ring ring-default"
        >
          <UIcon
            name="i-lucide-store"
            class="size-3.5 text-dimmed"
            aria-hidden="true"
          />
          {{ plural(section.supplierCount, 'proveedor', 'proveedores') }}
        </span>
        <span
          v-if="section.orderCount !== section.supplierCount"
          class="inline-flex items-center gap-1 rounded-full bg-default px-2.5 py-1 text-xs font-medium text-default ring ring-default"
        >
          {{ plural(section.orderCount, 'pedido', 'pedidos') }}
        </span>
        <span
          v-if="section.overdueCount"
          class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25"
        >
          <UIcon
            name="i-lucide-alarm-clock"
            class="size-3.5"
            aria-hidden="true"
          />
          {{ plural(section.overdueCount, 'atrasado', 'atrasados') }}
        </span>
      </div>
    </header>

    <!-- Cargando -->
    <div
      v-if="loading"
      class="grid gap-3 md:grid-cols-2 lg:grid-cols-1"
      aria-hidden="true"
    >
      <div
        v-for="n in 2"
        :key="n"
        class="space-y-3 rounded-xl bg-default p-4 shadow-xs ring ring-default sm:px-5"
      >
        <USkeleton class="h-5 w-2/5" />
        <USkeleton class="h-3.5 w-1/3" />
        <div class="space-y-2.5 border-t border-default pt-3">
          <USkeleton class="h-3.5 w-full" />
          <USkeleton class="h-3.5 w-4/5" />
          <USkeleton class="h-3.5 w-3/5" />
        </div>
      </div>
      <span class="sr-only">Cargando pedidos…</span>
    </div>

    <!-- Proveedores -->
    <ul
      v-else-if="section?.cards.length"
      class="gap-3 md:columns-2"
      :class="wide ? '' : 'lg:columns-1'"
      :aria-label="isOverdue ? 'Proveedores con pedidos atrasados' : `Proveedores para ${title.toLowerCase()}`"
    >
      <!-- Columnas (y no rejilla) para que las tarjetas de distinta altura no
           dejen huecos en tableta. -->
      <li
        v-for="card in section.cards"
        :key="card.supplierId"
        class="mb-3 min-w-0 break-inside-avoid last:mb-0"
      >
        <HomeSupplierCard
          :card="card"
          :today="today"
          :products-loading="productsLoading"
          :products-unavailable="productsUnavailable"
        />
      </li>
    </ul>

    <!-- Vacío -->
    <div
      v-else
      class="flex items-start gap-3 rounded-xl border border-dashed border-accented/70 bg-default/60 px-4 py-5 sm:px-5"
      data-home-empty
    >
      <span
        class="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <UIcon
          :name="section?.doneCount ? 'i-lucide-check-check' : 'i-lucide-coffee'"
          class="size-[18px]"
        />
      </span>
      <div class="min-w-0">
        <p class="font-medium text-highlighted">
          {{ emptyTitle }}
        </p>
        <p class="mt-0.5 text-pretty text-sm text-muted">
          {{ emptyText }}
        </p>
      </div>
    </div>
  </section>
</template>
