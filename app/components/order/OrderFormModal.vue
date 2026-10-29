<script setup>
// Formulario de pedido.
// - `item` null → pedido nuevo creado a mano (se elige un proveedor activo).
// - `item` con valor → editar fechas y notas de un pedido guardado o de una
//   previsión (al guardar, la previsión se convierte en pedido pendiente).
// El estado no se cambia aquí: tiene sus propios botones en la agenda.
// Si la fecha de entrega coincide con un festivo, se avisa para confirmarla
// con el proveedor; nunca se cambia nada automáticamente.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  item: { type: Object, default: null },
  suppliers: { type: Array, default: () => [] },
  // Pedidos guardados cargados, para avisar de entregas repetidas.
  orders: { type: Array, default: () => [] },
  holidays: { type: Array, default: () => [] },
  today: { type: String, required: true },
  submit: { type: Function, required: true },
})

const emit = defineEmits(['saved'])

const isNew = computed(() => !props.item)
const formId = useId()
const form = useTemplateRef('form')

const state = reactive(toOrderFormValues(null))
const saving = ref(false)
const errorMessage = ref('')
// La preparación sigue a la entrega (con la antelación habitual) hasta que se
// cambia a mano.
const prepareTouched = ref(false)

const supplier = computed(() => {
  const id = isNew.value ? state.supplier_id : props.item?.supplier_id
  return props.suppliers.find(s => s.id === id) ?? props.item?.supplier ?? null
})
const leadDays = computed(() => supplier.value?.order_lead_days ?? null)
const defaultPrepare = computed(() =>
  leadDays.value === null ? '' : getDefaultPrepareDate(state.delivery_date, leadDays.value))
const holidayWarning = computed(() =>
  isValidDate(state.delivery_date) ? getHolidayWarning(state.delivery_date, props.holidays) : null)

const supplierItems = computed(() => getSelectableSuppliers(props.suppliers).map(s => ({
  value: s.id,
  label: s.name,
  description: normalizeWeekdays(s.delivery_weekdays).length
    ? `${formatWeekdayList(s.delivery_weekdays)} · ${describeLeadDays(s.order_lead_days).toLowerCase()}`
    : 'Sin días de entrega habituales',
})))

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(state, toOrderFormValues(props.item))
  prepareTouched.value = !isNew.value
  errorMessage.value = ''
  form.value?.clear?.()
}, { immediate: true })

watch([() => state.delivery_date, () => state.supplier_id], () => {
  if (isNew.value && !prepareTouched.value && defaultPrepare.value) state.prepare_date = defaultPrepare.value
})

function onPrepareInput() {
  prepareTouched.value = true
}

function useDefaultPrepare() {
  state.prepare_date = defaultPrepare.value
  prepareTouched.value = true
  form.value?.validate?.({ name: 'prepare_date', silent: true })
}

function validate(values) {
  return validateOrderInput(values, {
    isNew: isNew.value,
    supplierId: props.item?.supplier_id ?? null,
    suppliers: props.suppliers,
    orders: props.orders,
    currentId: props.item?.isForecast ? null : (props.item?.id ?? null),
  })
}

const title = computed(() => isNew.value ? 'Nuevo pedido' : 'Editar pedido')
const description = computed(() => {
  if (isNew.value) return 'Para un pedido fuera de los días habituales de entrega.'
  return `${getOrderSupplierName(props.item)}${props.item?.isForecast ? ' · previsión del calendario' : ''}`
})

async function onSubmit() {
  if (saving.value) return
  errorMessage.value = ''

  // Sin cambios en un pedido guardado: no hace falta llamar a Supabase.
  if (!isNew.value && !props.item.isForecast && !hasOrderChanges(props.item, state)) {
    open.value = false
    return
  }

  saving.value = true
  try {
    const result = await props.submit({ ...state })
    if (result.ok) {
      open.value = false
      emit('saved', result.order)
      return
    }
    if (result.fields?.length) form.value?.setErrors(result.fields)
    errorMessage.value = result.message
    if (result.conflict && !result.fields?.length) open.value = false
  }
  finally {
    saving.value = false
  }
}

function onError() {
  nextTick(() => {
    document.querySelector(`#${CSS.escape(formId)} [aria-invalid="true"]`)?.focus()
  })
}

const notesLength = computed(() => Array.from(state.notes ?? '').length)
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
    :dismissible="!saving"
    :close="{ 'disabled': saving, 'aria-label': 'Cerrar' }"
    :ui="{
      content: 'sm:max-w-lg',
      title: 'font-display text-lg font-semibold',
      body: 'sm:p-6',
      footer: 'justify-end gap-2',
    }"
  >
    <template #body>
      <UForm
        :id="formId"
        ref="form"
        :state="state"
        :validate="validate"
        :validate-on="['blur', 'change']"
        :disabled="saving"
        class="space-y-5"
        @submit="onSubmit"
        @error="onError"
      >
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorMessage"
          role="alert"
        />

        <UFormField
          v-if="isNew"
          label="Proveedor"
          name="supplier_id"
          required
        >
          <USelectMenu
            v-model="state.supplier_id"
            :items="supplierItems"
            value-key="value"
            placeholder="Elige un proveedor"
            :search-input="{ 'placeholder': 'Buscar proveedor…', 'aria-label': 'Buscar proveedor' }"
            icon="i-lucide-truck"
            size="lg"
            class="w-full"
          >
            <template #empty>
              No hay proveedores activos con ese nombre.
            </template>
          </USelectMenu>
        </UFormField>

        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField
            label="Entrega"
            name="delivery_date"
            required
          >
            <UInput
              v-model="state.delivery_date"
              type="date"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Preparar el pedido"
            name="prepare_date"
            required
          >
            <UInput
              v-model="state.prepare_date"
              type="date"
              :max="state.delivery_date || undefined"
              size="lg"
              class="w-full"
              @input="onPrepareInput"
            />
          </UFormField>
        </div>

        <p
          v-if="leadDays !== null && defaultPrepare"
          class="-mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted"
        >
          <span>Antelación habitual: {{ describeLeadDays(leadDays).toLowerCase() }} ({{ formatShortDate(defaultPrepare, today) }}).</span>
          <UButton
            v-if="state.prepare_date !== defaultPrepare"
            label="Usar esa fecha"
            color="neutral"
            variant="link"
            size="sm"
            class="px-0"
            @click="useDefaultPrepare"
          />
        </p>

        <UAlert
          v-if="holidayWarning"
          color="warning"
          variant="subtle"
          icon="i-lucide-calendar-x-2"
          :description="holidayWarning.message"
          :ui="{ root: 'p-3', description: 'text-sm text-default' }"
        />

        <UFormField
          label="Notas"
          name="notes"
          help="Qué hay que pedir u otras observaciones."
        >
          <UTextarea
            v-model="state.notes"
            :rows="3"
            autoresize
            :maxrows="10"
            :maxlength="ORDER_FIELD_LIMITS.notes"
            size="lg"
            class="w-full"
          />
          <template #hint>
            <span
              v-if="notesLength"
              class="tabular-nums"
              :class="notesLength > ORDER_FIELD_LIMITS.notes * 0.9 ? 'text-warning' : ''"
            >
              {{ notesLength }}/{{ ORDER_FIELD_LIMITS.notes }}
            </span>
            <span v-else>Opcional</span>
          </template>
        </UFormField>

        <p
          v-if="item?.isForecast"
          class="text-sm text-muted"
        >
          Al guardar, esta previsión se guardará como pedido pendiente.
        </p>
      </UForm>
    </template>

    <template #footer>
      <UButton
        label="Cancelar"
        color="neutral"
        variant="ghost"
        :disabled="saving"
        @click="open = false"
      />
      <UButton
        type="submit"
        :form="formId"
        :label="isNew ? 'Crear pedido' : 'Guardar cambios'"
        :loading="saving"
        :disabled="saving"
      />
    </template>
  </UModal>
</template>
