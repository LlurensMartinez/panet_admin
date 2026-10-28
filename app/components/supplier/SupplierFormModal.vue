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
    const result = await props.submit({ ...state, delivery_weekdays: [...state.delivery_weekdays] })
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
    :description="isEdit ? supplier.name : 'Nombre, días habituales de entrega y antelación del pedido.'"
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

        <UFormField
          label="Días de entrega"
          name="delivery_weekdays"
          hint="Opcional"
          help="Días habituales en que llega el pedido. Sin días, el proveedor no aparece en la agenda."
        >
          <SupplierWeekdayPicker
            v-model="state.delivery_weekdays"
            :disabled="saving"
            :invalid="weekdaysInvalid"
          />
        </UFormField>

        <UFormField
          label="Antelación del pedido"
          name="order_lead_days"
          required
          help="Cuántos días antes de la entrega se prepara. Cada pedido podrá tener su propia fecha si hace falta."
        >
          <USelect
            v-model="state.order_lead_days"
            :items="ORDER_LEAD_OPTIONS"
            size="lg"
            class="w-full sm:w-56"
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
