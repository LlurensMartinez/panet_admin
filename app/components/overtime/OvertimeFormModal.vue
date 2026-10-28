<script setup>
// Formulario de alta y edición de horas extra.
// - `entry` null → alta; con valor → edición de ese registro.
// - `employees`: todas las fichas (de useEmployees). Solo se ofrecen las
//   activas; al editar, también la ya asociada al registro aunque esté
//   inactiva, para poder corregir la fecha o la duración de un registro
//   antiguo sin tener que cambiar de persona.
// - `submit(values)` lo aporta la página y devuelve el resultado de
//   useOvertime: { ok, entry } o { ok: false, message, fields }.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  entry: { type: Object, default: null },
  employees: { type: Array, required: true },
  submit: { type: Function, required: true },
})

const emit = defineEmits(['saved'])

const DURATION_PRESETS = [30, 60, 90, 120]

const isEdit = computed(() => Boolean(props.entry))
const formId = useId()
const form = useTemplateRef('form')

const state = reactive(toOvertimeFormValues(null))
const today = ref(getTodayDate())
const saving = ref(false)
const errorMessage = ref('')

const selectableEmployees = computed(() => {
  const active = props.employees.filter(employee => employee.is_active)
  const current = props.entry?.employee
  if (current && !current.is_active && !active.some(e => e.id === current.id)) {
    return sortEmployees([...active, current])
  }
  return sortEmployees(active)
})

const employeeItems = computed(() => selectableEmployees.value.map(employee => ({
  value: employee.id,
  label: getEmployeeFullName(employee),
  description: employee.is_active ? (employee.role ?? undefined) : 'Inactivo: solo para este registro',
})))

const allowedEmployeeIds = computed(() => selectableEmployees.value.map(e => e.id))
const noActiveEmployees = computed(() => !isEdit.value && selectableEmployees.value.length === 0)

const duration = computed(() => parseDurationParts(state))

function validate(values) {
  return validateOvertimeInput(values, { allowedEmployeeIds: allowedEmployeeIds.value, today: today.value })
}

// Al abrir, se cargan los datos actuales (o se prepara un alta para hoy).
watch(open, (isOpen) => {
  if (!isOpen) return
  today.value = getTodayDate()
  Object.assign(state, toOvertimeFormValues(props.entry, { today: today.value }))
  errorMessage.value = ''
  form.value?.clear?.()
}, { immediate: true })

function focusFirstField(event) {
  event.preventDefault()
  nextTick(() => {
    document.querySelector(`#${CSS.escape(formId)} button, #${CSS.escape(formId)} input`)?.focus()
  })
}

function applyPreset(minutes) {
  const parts = splitMinutes(minutes)
  state.hours = String(parts.hours)
  state.minutes = String(parts.minutes)
  form.value?.clear?.('duration')
}

async function onSubmit() {
  // Evita envíos repetidos mientras hay una petición en curso.
  if (saving.value) return
  errorMessage.value = ''

  // Sin cambios en una edición: no hace falta llamar a Supabase.
  if (isEdit.value && !hasOvertimeChanges(props.entry, state)) {
    open.value = false
    return
  }

  saving.value = true
  try {
    const result = await props.submit({ ...state })
    if (result.ok) {
      open.value = false
      emit('saved', result.entry)
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
    :title="isEdit ? 'Editar horas extra' : 'Registrar horas extra'"
    :description="isEdit
      ? `${getEntryEmployeeName(entry)}, ${formatWorkDate(entry.work_date, 'long')}`
      : 'La duración se guarda en minutos exactos.'"
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

        <UAlert
          v-if="noActiveEmployees"
          color="neutral"
          variant="subtle"
          icon="i-lucide-users-round"
          title="No hay empleados activos"
          description="Añade o activa una ficha en Empleados para poder registrar sus horas extra."
          :actions="[{ label: 'Ir a Empleados', to: '/empleados', color: 'neutral', variant: 'outline' }]"
        />

        <UFormField
          label="Empleado"
          name="employee_id"
          required
        >
          <USelectMenu
            v-model="state.employee_id"
            :items="employeeItems"
            value-key="value"
            placeholder="Elige un empleado"
            :search-input="{ 'placeholder': 'Buscar empleado…', 'aria-label': 'Buscar empleado' }"
            :disabled="noActiveEmployees"
            size="lg"
            class="w-full"
          >
            <template #empty>
              No hay empleados activos con ese nombre.
            </template>
          </USelectMenu>
        </UFormField>

        <div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <UFormField
            label="Fecha"
            name="work_date"
            required
          >
            <UInput
              v-model="state.work_date"
              type="date"
              :max="today"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Duración"
            name="duration"
            required
            :help="duration.minutes ? `Total: ${formatDuration(duration.minutes)}` : 'Horas y minutos, sin decimales.'"
          >
            <div
              class="grid grid-cols-2 gap-2"
              role="group"
              aria-label="Duración"
            >
              <UInput
                :id="`${formId}-hours`"
                v-model="state.hours"
                inputmode="numeric"
                autocomplete="off"
                aria-label="Horas"
                placeholder="0"
                maxlength="2"
                size="lg"
                class="w-full"
                :ui="{ trailing: 'pe-3 text-sm text-muted pointer-events-none' }"
              >
                <template #trailing>
                  h
                </template>
              </UInput>
              <UInput
                :id="`${formId}-minutes`"
                v-model="state.minutes"
                inputmode="numeric"
                autocomplete="off"
                aria-label="Minutos"
                placeholder="0"
                maxlength="2"
                size="lg"
                class="w-full"
                :ui="{ trailing: 'pe-3 text-sm text-muted pointer-events-none' }"
              >
                <template #trailing>
                  min
                </template>
              </UInput>
            </div>
          </UFormField>
        </div>

        <div
          class="-mt-2 flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Duraciones frecuentes"
        >
          <span class="me-1 text-xs text-muted">Frecuentes:</span>
          <UButton
            v-for="preset in DURATION_PRESETS"
            :key="preset"
            :label="formatDuration(preset)"
            :aria-label="`Poner ${formatDurationLong(preset)}`"
            :aria-pressed="duration.minutes === preset"
            :color="duration.minutes === preset ? 'primary' : 'neutral'"
            :variant="duration.minutes === preset ? 'subtle' : 'outline'"
            size="xs"
            class="rounded-full tabular-nums"
            @click="applyPreset(preset)"
          />
        </div>

        <UFormField
          label="Motivo"
          name="reason"
          hint="Opcional"
          help="Por ejemplo: inventario, cubrir un turno, descarga de un pedido."
        >
          <UInput
            v-model="state.reason"
            autocomplete="off"
            :maxlength="OVERTIME_LIMITS.reason"
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
            :rows="2"
            autoresize
            :maxrows="6"
            :maxlength="OVERTIME_LIMITS.notes"
            size="lg"
            class="w-full"
          />
          <template #hint>
            <span
              v-if="notesLength"
              class="tabular-nums"
            >{{ notesLength }}/{{ OVERTIME_LIMITS.notes }}</span>
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
        :label="isEdit ? 'Guardar cambios' : 'Registrar horas extra'"
        :loading="saving"
        :disabled="saving || noActiveEmployees"
      />
    </template>
  </UModal>
</template>
