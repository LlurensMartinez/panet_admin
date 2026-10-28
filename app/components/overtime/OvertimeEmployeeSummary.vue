<script setup>
// Resumen de horas extra por empleado para una semana (lunes a domingo) o un
// mes natural concretos, con navegación al periodo anterior y siguiente.
//
// Tiene su propio periodo: no usa los filtros del listado (empleado, periodo
// rápido, «Desde» y «Hasta») y estos no lo cambian. El encabezado indica
// siempre qué semana o mes se está sumando. «Ver registros» es la única
// conexión: lleva al listado con ese empleado y ese periodo, por acción
// expresa de la usuaria.
const view = defineModel('view', { type: String, required: true })
const anchor = defineModel('anchor', { type: String, required: true })

const props = defineProps({
  entries: { type: Array, required: true },
  employees: { type: Array, required: true },
  today: { type: String, required: true },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['view-records'])

const viewName = useId()
const titleId = useId()

const isWeek = computed(() => view.value === OVERTIME_PERIOD.WEEK)
const range = computed(() => getSummaryRange(view.value, anchor.value))
const title = computed(() => formatSummaryTitle(view.value, range.value))
const isCurrent = computed(() => Boolean(range.value) && range.value.from <= props.today && props.today <= range.value.to)
const summary = computed(() => summarizeOvertimeByEmployee(props.entries, props.employees, range.value))

const unit = computed(() => isWeek.value
  ? { this: 'esta semana', the: 'la semana', prev: 'Semana anterior', next: 'Semana siguiente', current: 'Semana actual' }
  : { this: 'este mes', the: 'el mes', prev: 'Mes anterior', next: 'Mes siguiente', current: 'Mes actual' })

const countText = computed(() => {
  const { entryCount, employeesWithEntries } = summary.value
  const entries = entryCount === 1 ? '1 registro' : `${entryCount} registros`
  const people = employeesWithEntries === 1 ? '1 empleado' : `${employeesWithEntries} empleados`
  return `${entries} de ${people}`
})

function go(step) {
  anchor.value = shiftSummaryAnchor(view.value, anchor.value, step)
}

function goToCurrent() {
  anchor.value = props.today
}

function viewRecords(row) {
  emit('view-records', { employeeId: row.id, ...range.value })
}

// Mensaje para compartir: usa el mismo resumen que la tabla.
const shareOpen = ref(false)
const sharePanelId = useId()
const canShare = computed(() => !props.loading && summary.value.entryCount > 0)
</script>

<template>
  <section
    class="space-y-4"
    :aria-labelledby="titleId"
  >
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <!-- Vista: mismo control que los filtros de estado y de periodo. -->
      <fieldset class="min-w-0">
        <legend class="mb-1 block text-sm font-medium text-default">
          Vista del resumen
        </legend>
        <div class="grid grid-cols-2 rounded-lg bg-elevated p-1 sm:inline-grid">
          <label
            v-for="option in OVERTIME_SUMMARY_VIEWS"
            :key="option.value"
            class="relative cursor-pointer"
          >
            <input
              v-model="view"
              type="radio"
              class="peer sr-only"
              :name="viewName"
              :value="option.value"
            >
            <span class="flex h-7 items-center justify-center whitespace-nowrap rounded-md px-4 text-sm font-medium text-muted transition-colors hover:text-highlighted peer-checked:bg-default peer-checked:text-highlighted peer-checked:shadow-xs peer-checked:ring peer-checked:ring-default peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">
              {{ option.label }}
            </span>
          </label>
        </div>
      </fieldset>

      <nav
        :aria-label="`Cambiar de ${isWeek ? 'semana' : 'mes'}`"
        class="flex items-center gap-1"
      >
        <UButton
          icon="i-lucide-chevron-left"
          label="Anterior"
          :aria-label="unit.prev"
          color="neutral"
          variant="outline"
          size="lg"
          class="flex-1 justify-center sm:flex-none"
          @click="go(-1)"
        />
        <UButton
          v-if="!isCurrent"
          :label="unit.current"
          color="neutral"
          variant="ghost"
          size="lg"
          class="flex-1 justify-center sm:flex-none"
          @click="goToCurrent"
        />
        <UButton
          trailing-icon="i-lucide-chevron-right"
          label="Siguiente"
          :aria-label="unit.next"
          color="neutral"
          variant="outline"
          size="lg"
          class="flex-1 justify-center sm:flex-none"
          @click="go(1)"
        />
      </nav>
    </div>

    <div class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default">
      <!-- Periodo consultado y total general -->
      <div
        class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-default bg-muted/60 px-4 py-4 sm:px-5"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div class="min-w-0">
          <h2
            :id="titleId"
            class="text-lg font-semibold leading-snug text-highlighted"
          >
            {{ title }}
          </h2>
          <p class="mt-0.5 text-sm text-muted">
            <span v-if="isCurrent">{{ unit.current }}<span v-if="!loading">, </span></span>
            <span v-if="!loading">{{ countText }}</span>
          </p>
        </div>
        <div class="sm:text-end">
          <p class="text-sm text-muted">
            Total {{ isWeek ? 'de la semana' : 'del mes' }}
          </p>
          <USkeleton
            v-if="loading"
            class="mt-1.5 h-8 w-28 sm:ms-auto"
          />
          <p
            v-else
            class="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-highlighted tabular-nums"
          >
            <span aria-hidden="true">{{ formatDuration(summary.totalMinutes) }}</span>
            <span class="sr-only">{{ formatDurationLong(summary.totalMinutes) }}</span>
          </p>
        </div>
      </div>

      <!-- Carga -->
      <ul
        v-if="loading"
        class="divide-y divide-default"
        aria-label="Cargando resumen"
        aria-busy="true"
      >
        <li
          v-for="n in 4"
          :key="n"
          class="flex items-center gap-3.5 px-4 py-4 sm:px-5"
        >
          <USkeleton class="size-10 rounded-full" />
          <USkeleton class="h-3.5 w-40 max-w-[50%] flex-1" />
          <USkeleton class="ms-auto h-4 w-16" />
        </li>
      </ul>

      <!-- Sin registros en el periodo -->
      <EmptyState
        v-else-if="summary.entryCount === 0"
        icon="i-lucide-calendar-off"
        :title="`No hay horas extra ${isCurrent ? unit.this : `en ${unit.the} consultad${isWeek ? 'a' : 'o'}`}`"
        :description="`Total: ${formatDuration(0)}. Cambia de ${isWeek ? 'semana' : 'mes'} con los botones de arriba.`"
      />

      <!-- Una fila por empleado -->
      <template v-else>
        <div
          class="hidden grid-cols-[minmax(0,1fr)_8rem_8rem_10rem] gap-x-4 border-b border-default px-5 py-2.5 text-xs font-medium text-muted lg:grid"
          aria-hidden="true"
        >
          <span class="ps-[3.375rem]">Empleado</span>
          <span>Registros</span>
          <span>Total</span>
          <span class="sr-only">Acciones</span>
        </div>
        <ul
          class="divide-y divide-default"
          :aria-label="`Horas extra por empleado, ${title}`"
        >
          <li
            v-for="row in summary.rows"
            :key="row.id"
            class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_8rem_8rem_10rem]"
          >
            <div class="flex min-w-0 items-center gap-3.5">
              <EmployeeAvatar
                v-if="row.employee"
                :employee="row.employee"
              />
              <div class="min-w-0">
                <p
                  class="truncate font-semibold"
                  :class="row.isActive ? 'text-highlighted' : 'text-toned'"
                >
                  {{ row.name }}
                  <span
                    v-if="!row.isActive"
                    class="ms-1 text-xs font-medium text-muted"
                  >(inactivo)</span>
                </p>
                <p class="text-sm text-muted lg:hidden">
                  {{ row.count === 1 ? '1 registro' : `${row.count} registros` }}
                </p>
              </div>
            </div>

            <p class="hidden text-sm text-default tabular-nums lg:block">
              {{ row.count }}
            </p>

            <div class="flex items-center justify-end gap-1 lg:contents">
              <p
                class="whitespace-nowrap font-semibold tabular-nums"
                :class="row.minutes ? 'text-highlighted' : 'text-dimmed'"
              >
                <span aria-hidden="true">{{ formatDuration(row.minutes) }}</span>
                <span class="sr-only">{{ formatDurationLong(row.minutes) }}</span>
              </p>
              <div class="flex justify-end">
                <!-- Sin registros: el botón ocupa su sitio (invisible) para
                     que las duraciones queden alineadas. -->
                <UButton
                  icon="i-lucide-list"
                  label="Ver registros"
                  :aria-label="`Ver los registros de ${row.name}, ${title}`"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :class="row.count ? '' : 'invisible'"
                  :disabled="!row.count"
                  :ui="{ label: 'hidden sm:inline' }"
                  @click="viewRecords(row)"
                />
              </div>
            </div>
          </li>
        </ul>
      </template>
    </div>

    <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
      <UButton
        label="Preparar resumen para compartir"
        icon="i-lucide-message-square-text"
        color="primary"
        variant="soft"
        size="lg"
        class="justify-center"
        :disabled="!canShare"
        :aria-expanded="shareOpen && canShare"
        :aria-controls="sharePanelId"
        @click="shareOpen = !shareOpen"
      />
      <p
        v-if="!loading && !summary.entryCount"
        class="px-1 text-sm text-muted"
      >
        No hay horas extra en {{ isCurrent ? unit.this : `${unit.the} consultad${isWeek ? 'a' : 'o'}` }}: no hay nada que compartir.
      </p>
    </div>

    <OvertimeShareMessage
      v-if="shareOpen"
      :id="sharePanelId"
      :view="view"
      :range="range"
      :summary="summary"
      :title="title"
      @close="shareOpen = false"
    />

    <p class="px-1 text-sm text-muted">
      El resumen suma todos los registros {{ isWeek ? 'de la semana (de lunes a domingo)' : 'del mes natural' }}, también los de empleados inactivos, y no depende de los filtros de la pestaña «Registros».
    </p>
  </section>
</template>
