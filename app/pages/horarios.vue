<script setup>
// Calendario semanal de horarios: todas las empleadas con actividad en la
// semana, sus turnos de cada día, sus horas semanales y el total de la
// tienda. Navegación por semanas (?semana=AAAA-MM-DD).
//
// Cada día de cada empleada abre sus excepciones (cambio de ese día o
// ausencias). Nunca se modifica el horario habitual ni su historial.
//
// Vista «Resumen» (?vista=resumen): horas planificadas por empleada y de la
// tienda, con las horas extra registradas esa semana aparte (solo lectura).
//
// Las reglas (versiones, bajas, ausencias, cambios de un día, horas reales en
// Europe/Madrid, turnos nocturnos y conflictos) son las de
// app/utils/schedules.js (buildWeekPlan). Los festivos solo se marcan: no
// cambian las horas previstas.
//
// El acceso a la página lo controla app/middleware/auth.global.js (sesión +
// cuenta autorizada). Los datos los protege la RLS de Supabase.
useHead({ title: 'Horarios · Panet Admin' })

const route = useRoute()
const router = useRouter()

const today = getTodayDate()
const weekStart = computed(() => resolveWeekParam(route.query[WEEK_QUERY_KEY], today))
const dates = computed(() => getWeekDates(weekStart.value))

// La semana actual no lleva parámetro: /horarios.
function changeWeek(start) {
  const { [WEEK_QUERY_KEY]: _current, ...rest } = route.query
  router.push({ query: start === getWeekStart(today) ? rest : { ...rest, [WEEK_QUERY_KEY]: start } })
}

// Vista: calendario o resumen. Se conserva al cambiar de semana.
const view = computed(() => resolveViewParam(route.query[VIEW_QUERY_KEY]))
function changeView(value) {
  const { [VIEW_QUERY_KEY]: _current, ...rest } = route.query
  router.push({ query: value === SCHEDULE_VIEW.SUMMARY ? { ...rest, [VIEW_QUERY_KEY]: value } : rest })
}
const VIEWS = [
  { value: SCHEDULE_VIEW.CALENDAR, label: 'Calendario', icon: 'i-lucide-calendar-days' },
  { value: SCHEDULE_VIEW.SUMMARY, label: 'Resumen de horas', icon: 'i-lucide-sigma' },
]

const { state, reload } = useWeekPlan(weekStart)
// Los festivos son solo informativos: si no se pueden cargar, no se marcan.
const { holidays } = useHolidays()

const currentData = computed(() => state.value.data?.weekStart === weekStart.value ? state.value.data : null)
const loading = computed(() => state.value.available && !currentData.value && state.value.status !== 'error')
const plan = computed(() => currentData.value
  ? buildWeekPlan({ ...currentData.value, date: weekStart.value, today })
  : null)
const headers = computed(() => getDayHeaders(dates.value, { today, holidays: holidays.value }))

// Resumen: horas planificadas (las mismas del calendario) y, aparte, las
// horas extra registradas esa semana.
const isSummary = computed(() => view.value === SCHEDULE_VIEW.SUMMARY)
const { state: overtimeState, reload: reloadOvertime } = useWeekOvertime(weekStart, isSummary)
const overtimeReady = computed(() => overtimeState.value.status === 'ready' && overtimeState.value.weekStart === weekStart.value)
const summary = computed(() => {
  if (!plan.value) return null
  const comparison = overtimeReady.value
    ? buildPlannedVsOvertime({
        ...currentData.value,
        overtimeEntries: overtimeState.value.entries,
        from: dates.value[0],
        to: dates.value[6],
      })
    : null
  return buildWeekSummary({ plan: plan.value, comparison })
})

// Día elegido en la vista diaria: al cambiar de semana, hoy o el lunes.
const selectedDate = ref(getDefaultSelectedDate(dates.value, today))
watch(weekStart, () => {
  selectedDate.value = getDefaultSelectedDate(dates.value, today)
})

// ------------------------------------------------------------- Excepciones
const dialogOpen = ref(false)
const selection = ref(null)

function openDay(value) {
  selection.value = value
  dialogOpen.value = true
}

function reloadPage() {
  reloadNuxtApp({ path: route.fullPath, force: true })
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Horarios"
      description="Turnos previstos de cada empleada. Los cambios de un día y las ausencias se marcan aparte y no modifican el horario habitual."
    />

    <ScheduleWeekNav
      :week-start="weekStart"
      :today="today"
      @change="changeWeek"
    />

    <div
      role="tablist"
      aria-label="Vista"
      class="inline-grid grid-cols-2 gap-1 rounded-lg bg-default p-1 shadow-xs ring ring-default"
      data-schedule-views
    >
      <button
        v-for="item in VIEWS"
        :key="item.value"
        type="button"
        role="tab"
        :aria-selected="view === item.value"
        class="flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary lg:min-h-9"
        :class="view === item.value ? 'bg-primary text-inverted' : 'text-muted hover:text-highlighted'"
        :data-view="item.value"
        @click="changeView(item.value)"
      >
        <UIcon
          :name="item.icon"
          class="size-4"
          aria-hidden="true"
        />
        {{ item.label }}
      </button>
    </div>

    <!-- Migración de horarios sin aplicar -->
    <div
      v-if="!state.available"
      class="rounded-xl bg-default shadow-xs ring ring-default"
      data-schedule-unavailable
    >
      <EmptyState
        icon="i-lucide-database"
        title="Los horarios todavía no están disponibles"
        description="La base de datos aún no está preparada para los horarios: falta aplicar su migración (SUPABASE_SETUP.md, sección 14)."
      />
    </div>

    <!-- Error al cargar -->
    <div
      v-else-if="state.status === 'error' && !currentData"
      class="rounded-xl bg-default shadow-xs ring ring-default"
      data-schedule-error
    >
      <EmptyState
        tone="error"
        icon="i-lucide-cloud-off"
        title="No se ha podido cargar el calendario"
        :description="state.message"
      >
        <UButton
          v-if="state.kind === DB_ERROR_KIND.EXPIRED"
          label="Volver a iniciar sesión"
          icon="i-lucide-log-in"
          @click="reloadPage"
        />
        <UButton
          v-else
          label="Reintentar"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          @click="reload()"
        />
      </EmptyState>
    </div>

    <!-- Cargando -->
    <div
      v-else-if="loading"
      class="space-y-2"
      aria-busy="true"
      aria-label="Cargando el calendario"
    >
      <USkeleton class="h-12 w-full" />
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-24 w-full" />
    </div>

    <!-- Sin empleadas esta semana -->
    <div
      v-else-if="plan && !plan.rows.length"
      class="rounded-xl bg-default shadow-xs ring ring-default"
      data-schedule-empty
    >
      <EmptyState
        icon="i-lucide-calendar-x"
        title="Nadie tiene horario esta semana"
        description="Aquí aparecen las empleadas en activo y las que tienen horario, cambios o ausencias en la semana."
      >
        <UButton
          label="Ir a Empleados"
          icon="i-lucide-users-round"
          color="neutral"
          variant="outline"
          to="/empleados"
        />
      </EmptyState>
    </div>

    <ScheduleWeekSummary
      v-else-if="plan && isSummary"
      :summary="summary"
      :overtime="overtimeState"
      @retry-overtime="reloadOvertime()"
    />

    <template v-else-if="plan">
      <ScheduleWeekGrid
        class="hidden lg:block"
        :plan="plan"
        :headers="headers"
        editable
        @select="openDay"
      />
      <ScheduleDayList
        v-model:selected-date="selectedDate"
        class="lg:hidden"
        :plan="plan"
        :headers="headers"
        editable
        @select="openDay"
      />

      <ul
        class="flex flex-wrap gap-x-5 gap-y-2 px-1 text-xs text-muted"
        aria-label="Leyenda"
        data-schedule-legend
      >
        <li class="flex items-center gap-1.5">
          <span
            class="size-3 rounded-sm border border-dashed border-primary/60 bg-primary/5"
            aria-hidden="true"
          />
          Cambio de un día
        </li>
        <li class="flex items-center gap-1.5">
          <span
            class="size-3 rounded-sm bg-sky-100 ring ring-sky-200 dark:bg-sky-400/20"
            aria-hidden="true"
          />
          Vacaciones, permiso u otra ausencia
        </li>
        <li>+1: acaba al día siguiente (cuenta en el día en que empieza)</li>
        <li>Horas reales, con los cambios de hora</li>
        <li>Toca un día para cambiar sus turnos o gestionar ausencias</li>
      </ul>
    </template>

    <ScheduleDayDialog
      v-model:open="dialogOpen"
      :selection="selection"
      :data="currentData"
      @changed="reload()"
    />
  </div>
</template>
