<script setup>
// Formulario de alta y edición de proveedores.
// - `supplier` null → alta; con valor → edición de ese proveedor.
// - `suppliers`: lista cargada, para avisar de nombres repetidos antes de
//   guardar (la base de datos también los rechaza).
// - `submit(values)` lo aporta la página y devuelve el resultado de
//   useSuppliers: { ok, supplier } o { ok: false, message, fields }.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  supplier: { type: Object, default: null },
  suppliers: { type: Array, default: () => [] },
  submit: { type: Function, required: true },
})

const emit = defineEmits(['saved'])

const isEdit = computed(() => Boolean(props.supplier))
const formId = useId()
const form = useTemplateRef('form')
const firstField = useTemplateRef('firstField')

const state = reactive(toSupplierFormValues())
const saving = ref(false)
const errorMessage = ref('')

// Al abrir, se cargan los datos actuales (o los valores predeterminados).
watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(state, toSupplierFormValues(props.supplier))
  errorMessage.value = ''
  form.value?.clear?.()
}, { immediate: true })

function validate(values) {
  return validateSupplierInput(values, {
    suppliers: props.suppliers,
    currentId: props.supplier?.id ?? null,
  })
}

const schedule = computed(() => describeSupplierSchedule(state))
const weekdaysInvalid = computed(() =>
  Boolean(form.value?.getErrors?.('delivery_weekdays')?.length),
)

// Calendario: días fijos o a demanda, antelación por día, quincenal.
const onDemand = computed(() => state.order_mode === ORDER_MODE.ON_DEMAND)
const selectedDays = computed(() => WEEKDAYS.filter(day => state.delivery_weekdays.includes(day.value)))
const canCustomizeLeads = computed(() => !onDemand.value && selectedDays.value.length > 1)
const showFrequency = computed(() => !onDemand.value && selectedDays.value.length > 0)
const biweekly = computed(() => showFrequency.value && Number(state.delivery_every_weeks) === 2)

// Al activar la antelación por día, cada día empieza con la general.
function onCustomLeads(on) {
  if (!on) return
  for (const day of WEEKDAYS) state.day_leads[day.value] = state.order_lead_days
}

// Al pasar a quincenal, se propone la próxima entrega como referencia.
function onFrequency(value) {
  if (Number(value) !== 2 || state.delivery_anchor_date) return
  const [next] = getNextDeliveryDates({ delivery_weekdays: state.delivery_weekdays }, getTodayDate(), 1)
  if (next) state.delivery_anchor_date = next
}

function focusFirstField(event) {
  event.preventDefault()
  nextTick(() => firstField.value?.inputRef?.focus())
}

async function onSubmit() {
  if (saving.value) return
  errorMessage.value = ''

  // Sin cambios en una edición: no hace falta llamar a Supabase.
  if (isEdit.value && !hasSupplierChanges(props.supplier, state)) {
    open.value = false
    return
  }

  saving.value = true
  try {
    const result = await props.submit({ ...state, delivery_weekdays: [...state.delivery_weekdays], day_leads: { ...state.day_leads } })
    if (result.ok) {
      open.value = false
      emit('saved', result.supplier)
      return
    }
    if (result.fields?.length) form.value?.setErrors(result.fields)
    errorMessage.value = result.message
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
    :title="isEdit ? 'Editar proveedor' : 'Añadir proveedor'"
    :description="isEdit ? supplier.name : 'Nombre, cómo se pide, días de entrega y antelación del pedido.'"
    :dismissible="!saving"
    :close="{ 'disabled': saving, 'aria-label': 'Cerrar' }"
    :content="{ onOpenAutoFocus: focusFirstField }"
    :ui="{
      content: 'sm:max-w-xl',
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
          label="Nombre"
          name="name"
          required
        >
          <UInput
            ref="firstField"
            v-model="state.name"
            autocomplete="off"
            autocapitalize="words"
            :maxlength="SUPPLIER_FIELD_LIMITS.name"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UFormField name="order_mode">
          <URadioGroup
            v-model="state.order_mode"
            :items="ORDER_MODE_OPTIONS"
            variant="card"
            orientation="horizontal"
            :disabled="saving"
            legend="Cómo se pide"
            :ui="{ legend: 'mb-1.5 text-sm font-medium text-default', fieldset: 'grid grid-cols-2 gap-2', item: 'min-w-0 p-3', label: 'font-medium', description: 'text-pretty' }"
          />
        </UFormField>

        <UFormField
          :label="onDemand ? 'Días en que puede entregar' : 'Días de entrega'"
          name="delivery_weekdays"
          hint="Opcional"
          :help="onDemand
            ? 'Se usan para proponer la entrega más próxima al crear un pedido.'
            : 'Días habituales en que llega el pedido. Sin días, el proveedor no aparece en la agenda.'"
        >
          <SupplierWeekdayPicker
            v-model="state.delivery_weekdays"
            :legend="onDemand ? 'Días en que puede entregar' : 'Días de entrega'"
            :disabled="saving"
            :invalid="weekdaysInvalid"
          />
        </UFormField>

        <UFormField
          v-show="!(canCustomizeLeads && state.custom_leads)"
          :label="onDemand ? 'Tiempo de entrega' : 'Antelación del pedido'"
          name="order_lead_days"
          required
          :help="onDemand
            ? 'Cuántos días tarda en llegar desde que se pide (por ejemplo, 2 días = 48 h).'
            : 'Cuántos días antes de la entrega se prepara. Cada pedido podrá tener su propia fecha si hace falta.'"
        >
          <USelect
            v-model="state.order_lead_days"
            :items="onDemand ? DELIVERY_TIME_OPTIONS : ORDER_LEAD_OPTIONS"
            :disabled="saving"
            size="lg"
            class="w-full sm:w-56"
          />
        </UFormField>

        <!-- Antelación distinta según el día de entrega -->
        <div
          v-if="canCustomizeLeads"
          class="space-y-3"
        >
          <USwitch
            v-model="state.custom_leads"
            label="Antelación distinta según el día"
            description="Por ejemplo, el pedido del lunes se hace el viernes y el del jueves, el miércoles."
            :disabled="saving"
            @update:model-value="onCustomLeads"
          />
          <UFormField
            v-if="state.custom_leads"
            name="day_leads"
            :ui="{ container: 'mt-0' }"
          >
            <fieldset class="divide-y divide-default rounded-lg ring ring-default">
              <legend class="sr-only">
                Antelación de cada día de entrega
              </legend>
              <div
                v-for="day in selectedDays"
                :key="day.value"
                class="flex items-center justify-between gap-3 px-3 py-2"
              >
                <label
                  :for="`${formId}-lead-${day.value}`"
                  class="text-sm font-medium text-highlighted first-letter:uppercase"
                >
                  {{ day.label }}
                </label>
                <USelect
                  :id="`${formId}-lead-${day.value}`"
                  v-model="state.day_leads[day.value]"
                  :items="ORDER_LEAD_OPTIONS"
                  :disabled="saving"
                  size="lg"
                  class="w-40 sm:w-48"
                />
              </div>
            </fieldset>
          </UFormField>
        </div>

        <!-- Frecuencia: cada semana o cada 2 semanas -->
        <div
          v-if="showFrequency"
          class="grid gap-4 sm:grid-cols-2"
        >
          <UFormField
            label="Frecuencia"
            name="delivery_every_weeks"
          >
            <USelect
              v-model="state.delivery_every_weeks"
              :items="DELIVERY_FREQUENCY_OPTIONS"
              :disabled="saving"
              size="lg"
              class="w-full"
              @update:model-value="onFrequency"
            />
          </UFormField>
          <UFormField
            v-if="biweekly"
            label="Una fecha de entrega"
            name="delivery_anchor_date"
            required
            help="Cualquier entrega de una semana en que toque: marca qué semanas alternas."
          >
            <UInput
              v-model="state.delivery_anchor_date"
              type="date"
              :disabled="saving"
              size="lg"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField
          label="Hora límite del pedido"
          name="order_deadline"
          hint="Opcional"
          help="Hora máxima para hacer el pedido el día que se prepara (se avisa en la agenda y en Inicio)."
        >
          <UInput
            v-model="state.order_deadline"
            type="time"
            :disabled="saving"
            size="lg"
            class="w-full sm:w-40"
          />
        </UFormField>

        <!-- Resumen del calendario: se actualiza al cambiar días o antelación. -->
        <div
          class="flex gap-3 rounded-lg bg-elevated/60 px-4 py-3 text-sm"
          aria-live="polite"
        >
          <UIcon
            name="i-lucide-calendar-days"
            class="mt-0.5 size-4 shrink-0 text-muted"
            aria-hidden="true"
          />
          <p class="text-pretty">
            <span class="font-medium text-highlighted">{{ schedule.delivery }}.</span>
            {{ ' ' }}<span class="text-muted">{{ schedule.preparation }}</span>
            <template v-if="schedule.deadline">
              {{ ' ' }}<span class="text-muted">{{ schedule.deadline }}.</span>
            </template>
          </p>
        </div>

        <UFormField
          label="Notas"
          name="notes"
          help="Por ejemplo: cómo se hace el pedido o qué conviene recordar."
        >
          <UTextarea
            v-model="state.notes"
            :rows="2"
            autoresize
            :maxrows="8"
            :maxlength="SUPPLIER_FIELD_LIMITS.notes"
            size="lg"
            class="w-full"
          />
          <template #hint>
            <span
              v-if="notesLength"
              class="tabular-nums"
              :class="notesLength > SUPPLIER_FIELD_LIMITS.notes * 0.9 ? 'text-warning' : ''"
            >
              {{ notesLength }}/{{ SUPPLIER_FIELD_LIMITS.notes }}
            </span>
            <span v-else>Opcional</span>
          </template>
        </UFormField>
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
        :label="isEdit ? 'Guardar cambios' : 'Añadir proveedor'"
        :loading="saving"
        :disabled="saving"
      />
    </template>
  </UModal>
</template>
