<script setup>
// Un día del editor del horario habitual: laborable o de descanso y, si
// trabaja, sus turnos (como mucho 3) con inicio y fin, y su total. Las
// comprobaciones llegan ya hechas (validateScheduleDraft).
const day = defineModel('day', { type: Object, required: true })

const props = defineProps({
  // Mensajes de error del día y de cada turno («día:índice»).
  errors: { type: Array, default: () => [] },
  shiftErrors: { type: Object, default: () => ({}) },
  minutes: { type: Number, default: 0 },
  showErrors: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const titleId = useId()

function setWorks(value) {
  day.value.works = value
  if (value && !day.value.shifts.length) day.value.shifts.push({ start: '', end: '' })
}

function addShift() {
  if (day.value.shifts.length < MAX_SHIFTS_PER_DAY) day.value.shifts.push({ start: '', end: '' })
}

function removeShift(index) {
  day.value.shifts.splice(index, 1)
  if (!day.value.shifts.length) day.value.works = false
}

const shiftError = index => (props.showErrors ? props.shiftErrors[`${day.value.weekday}:${index}`] : undefined)
const overnight = computed(() => hasOvernightShift(day.value))
</script>

<template>
  <div
    role="group"
    :aria-labelledby="titleId"
    class="grid gap-x-4 gap-y-3 px-3.5 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_4.5rem] sm:items-start"
    :class="day.works ? '' : 'bg-elevated/40'"
    :data-editor-day="day.weekday"
    :data-editor-works="day.works ? 'true' : 'false'"
  >
    <div class="flex items-center justify-between gap-3 sm:block sm:space-y-2 sm:pt-1.5">
      <p
        :id="titleId"
        class="font-medium text-highlighted"
      >
        {{ day.label }}
      </p>
      <USwitch
        :model-value="day.works"
        :label="day.works ? 'Trabaja' : 'Descanso'"
        :aria-label="`${day.label}: trabaja`"
        :disabled="disabled"
        :ui="{ label: 'text-sm' }"
        data-editor-toggle
        @update:model-value="setWorks"
      />
    </div>

    <div
      v-if="day.works"
      class="space-y-2"
    >
      <div
        v-for="(shift, index) in day.shifts"
        :key="index"
        class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
        :data-editor-shift="index"
      >
        <UInput
          v-model="shift.start"
          type="time"
          step="60"
          size="lg"
          class="w-full"
          :ui="{ base: 'min-h-11 sm:min-h-0' }"
          :aria-label="`${day.label}, inicio del turno ${index + 1}`"
          :aria-invalid="shiftError(index) ? 'true' : undefined"
          :color="shiftError(index) ? 'error' : undefined"
          :highlight="Boolean(shiftError(index))"
          :disabled="disabled"
          data-shift-start
        />
        <UInput
          v-model="shift.end"
          type="time"
          step="60"
          size="lg"
          class="w-full"
          :ui="{ base: 'min-h-11 sm:min-h-0' }"
          :aria-label="`${day.label}, fin del turno ${index + 1}`"
          :aria-invalid="shiftError(index) ? 'true' : undefined"
          :color="shiftError(index) ? 'error' : undefined"
          :highlight="Boolean(shiftError(index))"
          :disabled="disabled"
          data-shift-end
        />
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          class="min-h-11 min-w-11 justify-center lg:min-h-10"
          :aria-label="`${day.label}: quitar el turno ${index + 1}`"
          :disabled="disabled"
          @click="removeShift(index)"
        />
      </div>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <UButton
          label="Añadir turno"
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="sm"
          :aria-label="`${day.label}: añadir turno`"
          :disabled="disabled || day.shifts.length >= MAX_SHIFTS_PER_DAY"
          @click="addShift"
        />
        <span
          v-if="day.shifts.length >= MAX_SHIFTS_PER_DAY"
          class="text-xs text-muted"
        >Como mucho {{ MAX_SHIFTS_PER_DAY }} turnos por día.</span>
      </div>

      <p
        v-if="overnight"
        class="text-xs text-muted"
      >
        Un turno acaba al día siguiente: cuenta entero en este día.
      </p>
      <ul
        v-if="showErrors && errors.length"
        class="space-y-0.5 text-sm font-medium text-error"
        data-editor-day-errors
      >
        <li
          v-for="message in errors"
          :key="message"
        >
          {{ message }}
        </li>
      </ul>
    </div>
    <p
      v-else
      class="text-sm text-dimmed sm:pt-2"
    >
      Día de descanso.
    </p>

    <p
      class="hidden text-end text-sm tabular-nums sm:block sm:pt-2"
      :class="minutes ? 'font-medium text-highlighted' : 'text-dimmed'"
      data-editor-day-total
    >
      {{ day.works ? formatDuration(minutes) : '—' }}
    </p>
    <p
      v-if="day.works"
      class="text-sm text-muted tabular-nums sm:hidden"
    >
      Total del día: <span class="font-medium text-highlighted">{{ formatDuration(minutes) }}</span>
    </p>
  </div>
</template>
