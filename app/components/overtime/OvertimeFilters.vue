<script setup>
// Filtros del listado de registros: empleado y fechas de trabajo (ambos
// extremos incluidos). Incluye a los empleados inactivos: su historial sigue
// visible.
//
// Fechas: una fecha vacía no limita. Solo «Desde» = desde ese día en
// adelante; solo «Hasta» = hasta ese día inclusive; ninguna = todas.
// Los totales por semana o por mes están en la pestaña «Resumen por empleado».
const employeeId = defineModel('employeeId', { type: String, default: undefined })
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

const hasFilters = computed(() => Boolean(employeeId.value || from.value || to.value))
</script>

<template>
  <div
    role="search"
    aria-label="Filtrar registros"
    class="space-y-2"
  >
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,18rem)_10.5rem_10.5rem_auto] lg:items-end">
      <UFormField
        label="Empleado"
        class="col-span-2 lg:col-span-1"
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

      <UFormField
        label="Desde"
        :error="Boolean(rangeError)"
        class="min-w-0"
      >
        <UInput
          v-model="from"
          type="date"
          size="lg"
          class="w-full"
          :disabled="disabled"
          :aria-describedby="rangeError ? rangeErrorId : undefined"
        />
      </UFormField>

      <UFormField
        label="Hasta"
        :error="Boolean(rangeError)"
        class="min-w-0"
      >
        <UInput
          v-model="to"
          type="date"
          size="lg"
          class="w-full"
          :min="from || undefined"
          :disabled="disabled"
          :aria-describedby="rangeError ? rangeErrorId : undefined"
        />
      </UFormField>

      <div
        v-if="hasFilters"
        class="col-span-2 lg:col-span-1"
      >
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
