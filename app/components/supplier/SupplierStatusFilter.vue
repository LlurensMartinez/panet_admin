<script setup>
// Filtro por estado de los proveedores, con el mismo aspecto y comportamiento
// que el de Empleados: botones de opción nativos con el recuento de cada
// estado. En pantallas de 320 px el relleno se reduce para que las tres
// opciones quepan sin desbordar.
const model = defineModel({ type: String, required: true })

const props = defineProps({
  counts: { type: Object, required: true },
  loading: { type: Boolean, default: false },
  // Sin datos (error de carga): no se muestran recuentos engañosos a cero.
  unavailable: { type: Boolean, default: false },
})

const groupName = useId()

const options = computed(() => [
  { value: SUPPLIER_STATUS_FILTER.ACTIVE, label: 'Activos', count: props.counts.active },
  { value: SUPPLIER_STATUS_FILTER.INACTIVE, label: 'Inactivos', count: props.counts.inactive },
  { value: SUPPLIER_STATUS_FILTER.ALL, label: 'Todos', count: props.counts.all },
])
</script>

<template>
  <fieldset class="min-w-0">
    <legend class="sr-only">
      Mostrar proveedores
    </legend>
    <div class="flex w-full rounded-lg bg-elevated p-1 sm:inline-flex sm:w-auto">
      <label
        v-for="option in options"
        :key="option.value"
        class="relative flex-1 cursor-pointer sm:flex-none"
      >
        <input
          v-model="model"
          type="radio"
          class="peer sr-only"
          :name="groupName"
          :value="option.value"
        >
        <span
          class="flex h-9 items-center justify-center gap-1.5 rounded-md px-1.5 text-sm font-medium min-[360px]:px-2.5 sm:gap-2 sm:px-3.5 text-muted transition-colors hover:text-highlighted peer-checked:bg-default peer-checked:text-highlighted peer-checked:shadow-xs peer-checked:ring peer-checked:ring-default peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
        >
          {{ option.label }}
          <span
            class="min-w-6 rounded-full bg-accented/70 px-1.5 text-center text-xs font-semibold tabular-nums text-toned"
          >
            <template v-if="loading || unavailable">
              <span aria-hidden="true">–</span>
              <span class="sr-only">{{ loading ? 'cargando' : 'sin datos' }}</span>
            </template>
            <template v-else>{{ option.count }}</template>
          </span>
        </span>
      </label>
    </div>
  </fieldset>
</template>
