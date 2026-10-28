<script setup>
// Formulario de alta y edición de festivos.
// - `holiday` null → alta; con valor → edición.
// - `holidays`: lista cargada (todos los años), para avisar si la fecha ya
//   tiene un festivo (la base de datos también lo rechaza).
// - `defaultDate`: fecha propuesta al añadir (vacía si no se indica).
// - `submit(values)` lo aporta la página y devuelve el resultado de
//   useHolidays: { ok, holiday } o { ok: false, message, fields }.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  holiday: { type: Object, default: null },
  holidays: { type: Array, default: () => [] },
  defaultDate: { type: String, default: '' },
  submit: { type: Function, required: true },
})

const emit = defineEmits(['saved'])

const isEdit = computed(() => Boolean(props.holiday))
const formId = useId()
const form = useTemplateRef('form')
const firstField = useTemplateRef('firstField')

const state = reactive(toHolidayFormValues())
const saving = ref(false)
const errorMessage = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(state, toHolidayFormValues(props.holiday))
  if (!props.holiday && props.defaultDate) state.holiday_date = props.defaultDate
  errorMessage.value = ''
  form.value?.clear?.()
}, { immediate: true })

function validate(values) {
  return validateHolidayInput(values, {
    holidays: props.holidays,
    currentId: props.holiday?.id ?? null,
  })
}

const dateText = computed(() => formatHolidayDate(state.holiday_date))

function focusFirstField(event) {
  event.preventDefault()
  nextTick(() => firstField.value?.inputRef?.focus())
}

async function onSubmit() {
  if (saving.value) return
  errorMessage.value = ''

  if (isEdit.value && !hasHolidayChanges(props.holiday, state)) {
    open.value = false
    return
  }

  saving.value = true
  try {
    const result = await props.submit({ ...state })
    if (result.ok) {
      open.value = false
      emit('saved', result.holiday)
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
    :title="isEdit ? 'Editar festivo' : 'Añadir festivo'"
    :description="isEdit ? holiday.name : 'Fecha en la que conviene confirmar las entregas con los proveedores.'"
    :dismissible="!saving"
    :close="{ 'disabled': saving, 'aria-label': 'Cerrar' }"
    :content="{ onOpenAutoFocus: focusFirstField }"
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
          label="Fecha"
          name="holiday_date"
          required
          :help="dateText || undefined"
        >
          <UInput
            ref="firstField"
            v-model="state.holiday_date"
            type="date"
            :min="`${HOLIDAY_MIN_YEAR}-01-01`"
            :max="`${HOLIDAY_MAX_YEAR}-12-31`"
            size="lg"
            class="w-full sm:w-56"
          />
        </UFormField>

        <UFormField
          label="Nombre"
          name="name"
          required
          help="Por ejemplo: Navidad, Fiesta mayor."
        >
          <UInput
            v-model="state.name"
            autocomplete="off"
            :maxlength="HOLIDAY_FIELD_LIMITS.name"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Ámbito"
          name="scope"
          required
        >
          <HolidayScopePicker
            v-model="state.scope"
            :disabled="saving"
          />
        </UFormField>

        <UFormField
          label="Notas"
          name="notes"
        >
          <UTextarea
            v-model="state.notes"
            :rows="2"
            autoresize
            :maxrows="6"
            :maxlength="HOLIDAY_FIELD_LIMITS.notes"
            size="lg"
            class="w-full"
          />
          <template #hint>
            <span
              v-if="notesLength"
              class="tabular-nums"
              :class="notesLength > HOLIDAY_FIELD_LIMITS.notes * 0.9 ? 'text-warning' : ''"
            >
              {{ notesLength }}/{{ HOLIDAY_FIELD_LIMITS.notes }}
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
        :label="isEdit ? 'Guardar cambios' : 'Añadir festivo'"
        :loading="saving"
        :disabled="saving"
      />
    </template>
  </UModal>
</template>
