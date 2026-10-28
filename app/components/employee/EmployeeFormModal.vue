<script setup>
// Formulario de alta y edición de empleados.
// - `employee` null → alta; con valor → edición de esa ficha.
// - `submit(values)` lo aporta la página y devuelve el resultado de
//   useEmployees: { ok, employee } o { ok: false, message, fields }.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  employee: { type: Object, default: null },
  submit: { type: Function, required: true },
})

const emit = defineEmits(['saved'])

const isEdit = computed(() => Boolean(props.employee))
const formId = useId()
const form = useTemplateRef('form')
const firstField = useTemplateRef('firstField')

const state = reactive({ first_name: '', last_name: '', role: '', notes: '' })
const saving = ref(false)
const errorMessage = ref('')

// Al abrir, se cargan los datos actuales (o se vacía el formulario).
watch(open, (isOpen) => {
  if (!isOpen) return
  state.first_name = props.employee?.first_name ?? ''
  state.last_name = props.employee?.last_name ?? ''
  state.role = props.employee?.role ?? ''
  state.notes = props.employee?.notes ?? ''
  errorMessage.value = ''
  form.value?.clear?.()
}, { immediate: true })

function focusFirstField(event) {
  event.preventDefault()
  nextTick(() => firstField.value?.inputRef?.focus())
}

async function onSubmit() {
  // Evita envíos repetidos mientras hay una petición en curso.
  if (saving.value) return
  errorMessage.value = ''

  // Sin cambios en una edición: no hace falta llamar a Supabase.
  if (isEdit.value && !hasEmployeeChanges(props.employee, state)) {
    open.value = false
    return
  }

  saving.value = true
  try {
    const result = await props.submit({ ...state })
    if (result.ok) {
      open.value = false
      emit('saved', result.employee)
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
  // Lleva el foco al primer campo con error.
  nextTick(() => {
    document.querySelector(`#${CSS.escape(formId)} [aria-invalid="true"]`)?.focus()
  })
}

const notesLength = computed(() => Array.from(state.notes ?? '').length)
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEdit ? 'Editar empleado' : 'Añadir empleado'"
    :description="isEdit
      ? getEmployeeFullName(employee)
      : 'Solo los datos necesarios para organizar la tienda.'"
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
        :validate="validateEmployeeInput"
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

        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField
            label="Nombre"
            name="first_name"
            required
          >
            <UInput
              ref="firstField"
              v-model="state.first_name"
              autocomplete="off"
              autocapitalize="words"
              :maxlength="EMPLOYEE_FIELD_LIMITS.first_name"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Apellidos"
            name="last_name"
            required
          >
            <UInput
              v-model="state.last_name"
              autocomplete="off"
              autocapitalize="words"
              :maxlength="EMPLOYEE_FIELD_LIMITS.last_name"
              size="lg"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField
          label="Puesto"
          name="role"
          hint="Opcional"
          help="Por ejemplo: dependienta, encargado de horno."
        >
          <UInput
            v-model="state.role"
            autocomplete="off"
            :maxlength="EMPLOYEE_FIELD_LIMITS.role"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Observaciones"
          name="notes"
          help="No anotes datos sensibles como salud, documentos o datos bancarios."
        >
          <UTextarea
            v-model="state.notes"
            :rows="3"
            autoresize
            :maxrows="8"
            :maxlength="EMPLOYEE_FIELD_LIMITS.notes"
            size="lg"
            class="w-full"
          />
          <template #hint>
            <span
              v-if="notesLength"
              class="tabular-nums"
              :class="notesLength > EMPLOYEE_FIELD_LIMITS.notes * 0.9 ? 'text-warning' : ''"
            >
              {{ notesLength }}/{{ EMPLOYEE_FIELD_LIMITS.notes }}
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
        :label="isEdit ? 'Guardar cambios' : 'Añadir empleado'"
        :loading="saving"
        :disabled="saving"
      />
    </template>
  </UModal>
</template>
