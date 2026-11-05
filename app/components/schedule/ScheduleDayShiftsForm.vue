<script setup>
// Cambio de un día: otros turnos (como mucho 3) o día libre, solo para esa
// fecha. «Volver al horario habitual» quita el cambio. Nunca modifica el
// horario habitual. Las comprobaciones son las de validateDayChange
// (app/utils/schedule-exceptions.js) y la base de datos las repite.
const props = defineProps({
  employee: { type: Object, required: true },
  date: { type: String, required: true },
  // Día resuelto por buildWeekPlan.
  day: { type: Object, required: true },
  // Datos de la empleada cargados para la semana (incluyen los días vecinos).
  versions: { type: Array, default: () => [] },
  overrides: { type: Array, default: () => [] },
  absences: { type: Array, default: () => [] },
})

const emit = defineEmits(['done'])

const { saveDayOverride, deleteDayOverride } = useScheduleExceptions()
const formId = useId()

const override = computed(() => getDayOverride(props.overrides, props.date))
// Con una ausencia ese día, la ausencia prevalece: no se editan los turnos.
const blockedByAbsence = computed(() => Boolean(getDayAbsence(props.absences, props.date)))
const habitualText = computed(() => {
  if (!props.day.version || props.day.version.kind === SCHEDULE_KIND.END) return 'sin horario habitual'
  const shifts = getWeekdayShifts(props.day.version.week, props.day.weekday)
  return shifts.length ? describeDayShifts(sortShifts(shifts)) : 'descanso'
})

// Se abre con los turnos actuales del día. Un día sin turnos que no sea un
// «Libre» guardado (descanso habitual o sin horario) se abre para añadir
// turnos.
const initial = getInitialDayShifts(props.day)
const mode = ref(initial.length || props.day.status !== DAY_STATUS.DAY_OFF ? 'work' : 'off')
const rows = ref(initial.length ? initial.map(shift => ({ ...shift })) : [{ start: '', end: '' }])
const attempted = ref(false)
const saving = ref(false)
const removing = ref(false)
const errorMessage = ref('')

const shifts = computed(() => (mode.value === 'off' ? [] : rows.value.map(({ start, end }) => ({ start, end }))))
const validation = computed(() => validateDayChange({
  employee: props.employee,
  date: props.date,
  shifts: shifts.value,
  versions: props.versions,
  overrides: props.overrides,
  absences: props.absences,
}))
// Se muestran los errores al intentar guardar, o en cuanto todos los turnos
// tienen hora (para avisar de solapes y cambios de hora mientras se edita).
const complete = computed(() => rows.value.every(row => row.start && row.end))
const showErrors = computed(() => attempted.value || mode.value === 'off' || complete.value || blockedByAbsence.value)
const unchanged = computed(() => sameShifts(shifts.value, override.value ? override.value.shifts : getInitialDayShifts(props.day)))
const busy = computed(() => saving.value || removing.value)

function rowError(index) {
  return showErrors.value ? validation.value.shiftErrors.find(error => error.index === index)?.message : undefined
}

function addRow() {
  if (rows.value.length < MAX_SHIFTS_PER_DAY) rows.value.push({ start: '', end: '' })
}

function removeRow(index) {
  rows.value.splice(index, 1)
  if (!rows.value.length) mode.value = 'off'
}

watch(mode, (value) => {
  if (value === 'work' && !rows.value.length) rows.value.push({ start: '', end: '' })
})

async function save() {
  attempted.value = true
  errorMessage.value = ''
  if (busy.value || validation.value.errors.length || unchanged.value) return
  saving.value = true
  try {
    const result = await saveDayOverride({
      employeeId: props.employee.id,
      date: props.date,
      shifts: shifts.value,
      existingId: override.value?.id ?? null,
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    emit('done', shifts.value.length
      ? `Cambio guardado para el ${formatLongDay(props.date)}.`
      : `El ${formatLongDay(props.date)} queda como día libre.`)
  }
  finally {
    saving.value = false
  }
}

async function restore() {
  if (busy.value || !override.value) return
  errorMessage.value = ''
  removing.value = true
  try {
    const result = await deleteDayOverride(override.value.id)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    emit('done', `El ${formatLongDay(props.date)} vuelve a su horario habitual.`)
  }
  finally {
    removing.value = false
  }
}
</script>

<template>
  <UAlert
    v-if="blockedByAbsence"
    color="info"
    variant="subtle"
    icon="i-lucide-plane"
    :title="validation.errors[0]"
    data-day-change-errors
  />
  <form
    v-else
    class="space-y-4"
    novalidate
    data-day-shifts-form
    @submit.prevent="save"
  >
    <p class="text-sm text-muted">
      Solo cambia este día. Su horario habitual ({{ habitualText }}) no se modifica.
    </p>

    <fieldset class="space-y-2">
      <legend class="mb-2 text-sm font-medium text-highlighted">
        Ese día
      </legend>
      <div
        class="grid grid-cols-2 gap-1 rounded-lg bg-elevated/60 p-1 ring ring-default"
        role="radiogroup"
        aria-label="Ese día"
      >
        <label
          v-for="option in [{ value: 'work', label: 'Trabaja' }, { value: 'off', label: 'Libre' }]"
          :key="option.value"
          class="flex min-h-11 cursor-pointer items-center justify-center rounded-md text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary lg:min-h-9"
          :class="mode === option.value ? 'bg-default text-highlighted shadow-xs ring ring-default' : 'text-muted hover:text-highlighted'"
        >
          <input
            v-model="mode"
            type="radio"
            class="sr-only"
            :name="`${formId}-mode`"
            :value="option.value"
            :disabled="busy"
            :data-day-mode="option.value"
          >
          {{ option.label }}
        </label>
      </div>
    </fieldset>

    <div
      v-if="mode === 'work'"
      class="space-y-2"
    >
      <div
        v-for="(row, index) in rows"
        :key="index"
        class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2"
        :data-shift-row="index"
      >
        <UFormField
          :label="index === 0 ? 'Inicio' : undefined"
          :error="rowError(index) ? true : undefined"
        >
          <UInput
            v-model="row.start"
            type="time"
            step="60"
            size="lg"
            class="w-full"
            :aria-label="`Inicio del turno ${index + 1}`"
            :disabled="busy"
            data-shift-start
          />
        </UFormField>
        <UFormField
          :label="index === 0 ? 'Fin' : undefined"
          :error="rowError(index) ? true : undefined"
        >
          <UInput
            v-model="row.end"
            type="time"
            step="60"
            size="lg"
            class="w-full"
            :aria-label="`Fin del turno ${index + 1}`"
            :disabled="busy"
            data-shift-end
          />
        </UFormField>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          :aria-label="`Quitar el turno ${index + 1}`"
          class="min-h-11 min-w-11 justify-center lg:min-h-10"
          :class="index === 0 ? 'mt-6' : ''"
          :disabled="busy"
          @click="removeRow(index)"
        />
      </div>
      <UButton
        label="Añadir turno"
        icon="i-lucide-plus"
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="busy || rows.length >= MAX_SHIFTS_PER_DAY"
        @click="addRow"
      />
      <p
        v-if="rows.length >= MAX_SHIFTS_PER_DAY"
        class="text-xs text-muted"
      >
        Como mucho {{ MAX_SHIFTS_PER_DAY }} turnos por día.
      </p>
    </div>

    <p
      v-if="mode === 'work' && complete && !validation.errors.length"
      class="text-sm text-default"
      data-day-change-total
    >
      Total: <span class="font-semibold tabular-nums">{{ formatPlanMinutes(validation.minutes) }}</span><span
        v-if="validation.overnight"
        class="text-muted"
      > · un turno acaba al día siguiente y cuenta entero en este día</span>
    </p>

    <UAlert
      v-if="showErrors && validation.errors.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="validation.errors.length === 1 ? validation.errors[0] : 'Revisa los turnos'"
      :description="validation.errors.length > 1 ? validation.errors.join(' ') : undefined"
      data-day-change-errors
    />

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="errorMessage"
      description="No se ha guardado nada. Puedes volver a intentarlo."
      data-day-change-failed
    />

    <p
      v-if="unchanged && !override"
      class="text-sm text-muted"
    >
      Es igual que su horario habitual: no hace falta guardar un cambio.
    </p>

    <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
      <UButton
        v-if="override"
        label="Volver al horario habitual"
        icon="i-lucide-undo-2"
        color="neutral"
        variant="ghost"
        :loading="removing"
        :disabled="busy"
        data-day-change-restore
        @click="restore"
      />
      <span v-else />
      <UButton
        type="submit"
        :label="override ? 'Guardar cambio' : 'Guardar cambio de este día'"
        icon="i-lucide-check"
        :loading="saving"
        :disabled="busy || unchanged"
      />
    </div>
  </form>
</template>
