<script setup>
// Calendario semanal de horarios (solo consulta): todas las empleadas con
// actividad en la semana, sus turnos de cada día, sus horas semanales y el
// total de la tienda. Navegación por semanas (?semana=AAAA-MM-DD).
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

const { state, reload } = useWeekPlan(weekStart)
// Los festivos son solo informativos: si no se pueden cargar, no se marcan.
const { holidays } = useHolidays()

const currentData = computed(() => state.value.data?.weekStart === weekStart.value ? state.value.data : null)
const loading = computed(() => state.value.available && !currentData.value && state.value.status !== 'error')
const plan = computed(() => currentData.value
  ? buildWeekPlan({ ...currentData.value, date: weekStart.value, today })
  : null)
const headers = computed(() => getDayHeaders(dates.value, { today, holidays: holidays.value }))

// Día elegido en la vista diaria: al cambiar de semana, hoy o el lunes.
const selectedDate = ref(getDefaultSelectedDate(dates.value, today))
watch(weekStart, () => {
  selectedDate.value = getDefaultSelectedDate(dates.value, today)
})

function reloadPage() {
  reloadNuxtApp({ path: route.fullPath, force: true })
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Horarios"
      description="Turnos previstos de cada empleada. Los cambios de un día y las ausencias se marcan aparte del horario habitual."
    />

    <ScheduleWeekNav
      :week-start="weekStart"
      :today="today"
      @change="changeWeek"
    />

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

    <template v-else-if="plan">
      <ScheduleWeekGrid
        class="hidden lg:block"
        :plan="plan"
        :headers="headers"
      />
      <ScheduleDayList
        v-model:selected-date="selectedDate"
        class="lg:hidden"
        :plan="plan"
        :headers="headers"
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
      </ul>
    </template>
  </div>
</template>
