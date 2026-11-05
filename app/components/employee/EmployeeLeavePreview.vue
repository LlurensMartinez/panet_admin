<script setup>
// Vista previa de una baja con fecha: qué planificación futura se eliminará
// (o se acortará) y qué se conserva. Usa buildDeactivationPreview, que aplica
// las mismas condiciones que public.deactivate_employee().
const props = defineProps({
  preview: { type: Object, required: true },
})

const removedItems = computed(() => {
  const { removed, shortened } = props.preview
  return [
    ...removed.versions.map(version => ({
      id: version.id,
      icon: 'i-lucide-calendar-range',
      text: version.kind === SCHEDULE_KIND.END
        ? `Cierre de horario previsto desde el ${formatLeaveDate(version.valid_from)}`
        : `Horario habitual que empezaba el ${formatLeaveDate(version.valid_from)}`,
    })),
    ...removed.overrides.map(override => ({
      id: override.id,
      icon: 'i-lucide-calendar-cog',
      text: `Cambio del ${formatLeaveDate(override.work_date)}: ${describeDayShifts(override.shifts)}`,
    })),
    ...removed.absences.map(absence => ({
      id: absence.id,
      icon: 'i-lucide-plane',
      text: `${getAbsenceTypeLabel(absence.absence_type)} ${describeDateRange(absence.start_date, absence.end_date)}`,
    })),
    ...shortened.map(({ absence, newEndDate }) => ({
      id: `${absence.id}-shortened`,
      icon: 'i-lucide-scissors',
      text: `${getAbsenceTypeLabel(absence.absence_type)} ${describeDateRange(absence.start_date, absence.end_date)}: se acorta hasta hoy (${formatLeaveDate(newEndDate)})`,
    })),
  ]
})

const keptItems = computed(() => {
  const { kept } = props.preview
  const items = []
  if (kept.versions) items.push(kept.versions === 1 ? 'Su horario vigente o anterior' : `Sus ${kept.versions} horarios vigentes o anteriores`)
  if (kept.overrides || kept.absences) items.push('Sus cambios de un día y ausencias hasta hoy')
  items.push('Su ficha y sus horas extra')
  return items
})
</script>

<template>
  <div
    class="space-y-3"
    data-leave-preview
  >
    <p
      v-if="!preview.hasPlanning"
      class="text-sm text-muted"
      data-leave-preview-empty
    >
      No tiene horarios, cambios de un día ni ausencias registrados.
    </p>

    <template v-else>
      <p
        v-if="preview.closesScheduleFrom"
        class="text-sm text-default"
        data-leave-preview-closes
      >
        Su horario habitual deja de aplicarse desde el {{ formatLeaveDate(preview.closesScheduleFrom) }}.
      </p>

      <section
        class="rounded-lg bg-amber-50 px-3.5 py-3 ring ring-amber-200 dark:bg-amber-400/10 dark:ring-amber-400/25"
        aria-labelledby="leave-preview-removed"
        data-leave-preview-removed
      >
        <h3
          id="leave-preview-removed"
          class="text-sm font-semibold text-amber-900 dark:text-amber-200"
        >
          Se eliminará (planificación posterior a hoy)
        </h3>
        <ul
          v-if="removedItems.length"
          class="mt-2 space-y-1.5"
        >
          <li
            v-for="item in removedItems"
            :key="item.id"
            class="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-100"
          >
            <UIcon
              :name="item.icon"
              class="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
              aria-hidden="true"
            />
            <span>{{ item.text }}</span>
          </li>
        </ul>
        <p
          v-else
          class="mt-1 text-sm text-amber-900 dark:text-amber-100"
        >
          Nada: no tiene planificación posterior a hoy.
        </p>
      </section>
    </template>

    <section
      class="rounded-lg bg-elevated/60 px-3.5 py-3 ring ring-default"
      aria-labelledby="leave-preview-kept"
      data-leave-preview-kept
    >
      <h3
        id="leave-preview-kept"
        class="text-sm font-semibold text-highlighted"
      >
        Se conserva
      </h3>
      <ul class="mt-2 space-y-1.5">
        <li
          v-for="item in keptItems"
          :key="item"
          class="flex items-start gap-2 text-sm text-default"
        >
          <UIcon
            name="i-lucide-check"
            class="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span>{{ item }}</span>
        </li>
      </ul>
      <p
        v-if="preview.kept.ignoredAfterLastDay"
        class="mt-2 text-sm text-muted"
        data-leave-preview-ignored
      >
        {{ preview.kept.ignoredAfterLastDay === 1
          ? 'Hay 1 cambio o ausencia entre su último día y hoy: se conserva, pero ya no cuenta.'
          : `Hay ${preview.kept.ignoredAfterLastDay} cambios o ausencias entre su último día y hoy: se conservan, pero ya no cuentan.` }}
      </p>
    </section>
  </div>
</template>
