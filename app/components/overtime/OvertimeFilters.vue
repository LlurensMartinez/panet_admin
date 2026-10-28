<script setup>
// Filtros del listado: empleado y periodo (fechas de trabajo, ambos extremos
// incluidos). Incluye a los empleados inactivos: su historial sigue visible.
//
// Periodo:
// - Un periodo rápido (Hoy, Semanal, Mensual, Anual) rellena «Desde» y
//   «Hasta» con sus fechas (app/utils/overtime.js, getPeriodRange), así que
//   siempre se ve qué fechas se están filtrando.
// - Cambiar a mano cualquiera de las dos fechas pasa a «Personalizado».
// - Elegir «Personalizado» conserva las fechas que haya para ajustarlas.
const employeeId = defineModel('employeeId', { type: String, default: undefined })
const period = defineModel('period', { type: String, default: null })
const from = defineModel('from', { type: String, default: '' })
const to = defineModel('to', { type: String, default: '' })

const props = defineProps({
  employees: { type: Array, required: true },
  rangeError: { type: String, default: null },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['clear'])

const rangeErrorId = useId()

const employeeItems = computed(() => sortEmployees(props.employees).map(employee => ({
  value: employee.id,
  label: getEmployeeFullName(employee),
  description: employee.is_active ? (employee.role ?? undefined) : 'Inactivo',
})))

const hasFilters = computed(() => Boolean(employeeId.value || period.value || from.value || to.value))

// Selector de periodo: «hoy» se calcula en el momento de elegir, en la zona
// horaria de la tienda.
const selectedPeriod = computed({
  get: () => period.value,
  set: (value) => {
    const next = selectOvertimePeriod(value, { from: from.value, to: to.value })
    period.value = next.period
    from.value = next.from
    to.value = next.to
  },
})

// Fechas escritas a mano: el filtro pasa a «Personalizado».
function setDate(field, value) {
  const model = field === 'from' ? from : to
  model.value = value ?? ''
  period.value = OVERTIME_PERIOD.CUSTOM
}
</script>

<template>
  <div
    role="search"
    aria-label="Filtrar registros"
    class="space-y-2"
  >
    <div class="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <UFormField
        label="Empleado"
        class="lg:w-56"
      >
        <USelectMenu
          v-model="employeeId"
          :items="employeeItems"
          value-key="value"
          placeholder="Todos los empleados"
          :search-input="{ 'placeholder': 'Buscar empleado…', 'aria-label': 'Buscar empleado' }"
          :clear="{ 'aria-label': 'Mostrar todos los empleados' }"
          :disabled="disabled"
          icon="i-lucide-user-round"
          size="lg"
          class="w-full"
        >
          <template #empty>
            No hay empleados con ese nombre.
          </template>
        </USelectMenu>
      </UFormField>

      <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
        <OvertimePeriodSelect
          v-model="selectedPeriod"
          :disabled="disabled"
        />

        <div class="grid grid-cols-2 gap-3 sm:flex">
          <UFormField
            label="Desde"
            :error="Boolean(rangeError)"
            class="sm:w-36"
          >
            <UInput
              :model-value="from"
              type="date"
              size="lg"
              class="w-full"
              :disabled="disabled"
              :aria-describedby="rangeError ? rangeErrorId : undefined"
              @update:model-value="setDate('from', $event)"
            />
          </UFormField>

          <UFormField
            label="Hasta"
            :error="Boolean(rangeError)"
            class="sm:w-36"
          >
            <UInput
              :model-value="to"
              type="date"
              size="lg"
              class="w-full"
              :min="from || undefined"
              :disabled="disabled"
              :aria-describedby="rangeError ? rangeErrorId : undefined"
              @update:model-value="setDate('to', $event)"
            />
          </UFormField>
        </div>
      </div>

      <div v-if="hasFilters">
        <UButton
          label="Limpiar filtros"
          icon="i-lucide-filter-x"
          color="neutral"
          variant="ghost"
          size="lg"
          @click="emit('clear')"
        />
      </div>
    </div>

    <p
      v-if="rangeError"
      :id="rangeErrorId"
      class="text-sm text-error"
      role="alert"
    >
      {{ rangeError }}
    </p>
  </div>
</template>
