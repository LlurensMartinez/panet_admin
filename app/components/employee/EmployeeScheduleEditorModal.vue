<script setup>
// Editor del horario habitual de una empleada: de lunes a domingo, días
// laborables o de descanso, hasta 3 turnos por día y la fecha desde la que
// rige. Siempre crea una versión nueva (useScheduleVersions): el historial no
// se sobrescribe. Las reglas están en app/utils/schedule-editor.js.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  employee: { type: Object, default: null },
  // Planificación de la empleada: { versions, overrides, absences }.
  planning: { type: Object, default: null },
})

const emit = defineEmits(['saved'])

const { createScheduleVersion } = useScheduleVersions()
const fieldId = useId()

const today = ref(getTodayDate())
const validFrom = ref('')
const days = ref(createEditorDays())
const attempted = ref(false)
const saving = ref(false)
const errorMessage = ref('')

const versions = computed(() => props.planning?.versions ?? [])
const context = computed(() => getScheduleEditorContext({ employee: props.employee, versions: versions.value, today: today.value }))
const isChange = computed(() => context.value.mode === SCHEDULE_EDITOR_MODE.CHANGE)
const fullName = computed(() => getEmployeeFullName(props.employee))

// Cada vez que se abre: hoy, la fecha propuesta y su último horario (si lo
// tiene) como punto de partida.
watch(open, (isOpen) => {
  if (!isOpen) return
  today.value = getTodayDate()
  validFrom.value = context.value.defaultDate
  days.value = createEditorDays(context.value.baseWeek)
  attempted.value = false
  errorMessage.value = ''
}, { immediate: true })

const validation = computed(() => validateScheduleDraft({
  employee: props.employee,
  context: context.value,
  days: days.value,
  validFrom: validFrom.value,
  versions: versions.value,
  overrides: props.planning?.overrides ?? [],
  absences: props.planning?.absences ?? [],
}))

// Los errores de los turnos se ven al intentar guardar o cuando todos los
// turnos tienen sus dos horas (para avisar mientras se edita).
const complete = computed(() => days.value.every(day => !day.works || day.shifts.every(shift => shift.start && shift.end)))
const showErrors = computed(() => attempted.value || complete.value)
const startText = computed(() => describeScheduleStart({ context: context.value, validFrom: validFrom.value, today: today.value }))
const workingDays = computed(() => days.value.filter(day => day.works).length)

async function save() {
  attempted.value = true
  errorMessage.value = ''
  if (saving.value || !validation.value.valid || !props.employee) return
  saving.value = true
  try {
    const result = await createScheduleVersion({ employeeId: props.employee.id, validFrom: validFrom.value, week: validation.value.week })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    emit('saved', result.data)
    open.value = false
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isChange ? 'Cambiar horario habitual' : 'Crear horario habitual'"
    :description="fullName"
    :dismissible="!saving"
    :ui="{
      content: 'sm:max-w-3xl',
      title: 'font-display text-lg font-semibold',
      body: 'space-y-5',
      footer: 'flex-wrap justify-end gap-2',
    }"
  >
    <template #body>
      <form
        :id="fieldId"
        class="space-y-5"
        novalidate
        data-schedule-editor
        @submit.prevent="save"
      >
        <UAlert
          v-if="validation.errors.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-circle-pause"
          :title="validation.errors[0]"
          data-schedule-editor-blocked
        />

        <!-- Fecha de inicio -->
        <div class="space-y-2">
          <UFormField
            label="Rige desde"
            :help="context.minDate ? `Como pronto, el ${formatLeaveDate(context.minDate)}.` : 'Es su primer horario: puede empezar en cualquier fecha.'"
            :error="validation.dateError || undefined"
            required
          >
            <UInput
              v-model="validFrom"
              type="date"
              :min="context.minDate || undefined"
              size="lg"
              class="w-full sm:w-56"
              :disabled="saving"
              data-schedule-editor-date
            />
          </UFormField>
          <p
            v-if="startText && !validation.dateError"
            class="text-sm text-default"
            data-schedule-editor-start
          >
            {{ startText }}
          </p>
        </div>

        <!-- Semana -->
        <fieldset class="space-y-2">
          <legend class="mb-2 text-sm font-medium text-highlighted">
            Turnos de cada día
          </legend>
          <div class="divide-y divide-default overflow-hidden rounded-lg ring ring-default">
            <EmployeeScheduleDayEditor
              v-for="(day, index) in days"
              :key="day.weekday"
              v-model:day="days[index]"
              :errors="validation.dayErrors[day.weekday] ?? []"
              :shift-errors="validation.shiftErrors"
              :minutes="validation.dayMinutes[day.weekday] ?? 0"
              :show-errors="showErrors"
              :disabled="saving"
            />
          </div>
        </fieldset>

        <p
          class="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-elevated/60 px-3.5 py-2.5 text-sm ring ring-default"
          data-schedule-editor-total
        >
          <span class="text-muted">{{ workingDays }} {{ workingDays === 1 ? 'día laborable' : 'días laborables' }} · {{ 7 - workingDays }} de descanso</span>
          <span class="font-semibold text-highlighted">Total: <span class="tabular-nums">{{ formatDuration(validation.weekMinutes) }}</span> a la semana</span>
        </p>

        <UAlert
          v-if="validation.warnings.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Revisa antes de guardar"
          data-schedule-editor-warnings
        >
          <template #description>
            <ul class="list-disc space-y-1 ps-4">
              <li
                v-for="warning in validation.warnings"
                :key="warning"
              >
                {{ warning }}
              </li>
            </ul>
          </template>
        </UAlert>
        <ul
          v-if="validation.notices.length"
          class="space-y-1 text-sm text-muted"
          data-schedule-editor-notices
        >
          <li
            v-for="notice in validation.notices"
            :key="notice"
          >
            {{ notice }}
          </li>
        </ul>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorMessage"
          data-schedule-editor-error
        />
        <p
          v-else-if="attempted && !validation.valid"
          class="text-sm font-medium text-error"
          role="alert"
          data-schedule-editor-invalid
        >
          Revisa los datos marcados antes de guardar.
        </p>
      </form>
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
        :form="fieldId"
        :label="isChange ? 'Guardar nueva versión' : 'Guardar horario'"
        icon="i-lucide-check"
        :loading="saving"
        :disabled="saving || validation.errors.length > 0"
        data-schedule-editor-save
      />
    </template>
  </UModal>
</template>
