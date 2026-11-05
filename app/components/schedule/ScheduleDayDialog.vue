<script setup>
// Excepciones de una empleada para un día del calendario: cambiar sus turnos
// de ese día (o marcarlo libre) y gestionar sus ausencias. Si el día no se
// puede modificar (empleada de baja o periodo de baja), solo se consulta.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  // { employee, day, header } de la celda elegida.
  selection: { type: Object, default: null },
  // Datos de la semana (useWeekPlan): versions, overrides, absences.
  data: { type: Object, default: null },
})

const emit = defineEmits(['changed'])
const toast = useToast()

const employee = computed(() => props.selection?.employee ?? null)
const day = computed(() => props.selection?.day ?? null)
const date = computed(() => day.value?.date ?? '')
const name = computed(() => getEmployeeFullName(employee.value))

const own = list => (list ?? []).filter(item => item.employee_id === employee.value?.id)
const versions = computed(() => own(props.data?.versions))
const overrides = computed(() => own(props.data?.overrides))
const absences = computed(() => own(props.data?.absences))

const editability = computed(() => employee.value
  ? getDayEditability({ employee: employee.value, date: date.value, versions: versions.value })
  : { editable: false, reason: null })
const view = computed(() => (day.value ? getDayCellView(day.value) : null))

const tab = ref('day')
watch(open, (isOpen) => {
  if (isOpen) tab.value = day.value?.status === DAY_STATUS.ABSENCE ? 'absences' : 'day'
}, { immediate: true })

const TABS = [
  { value: 'day', label: 'Turnos de este día' },
  { value: 'absences', label: 'Ausencias' },
]

function onDone(message) {
  toast.add({ title: message, color: 'success', icon: 'i-lucide-circle-check' })
  open.value = false
  emit('changed')
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="name"
    :description="date ? formatLongDay(date).replace(/^./, c => c.toLocaleUpperCase('es')) : ''"
    :ui="{
      content: 'sm:max-w-lg',
      title: 'font-display text-lg font-semibold',
      body: 'space-y-4',
    }"
  >
    <template #body>
      <div
        v-if="view"
        class="flex flex-wrap items-center gap-2 text-sm"
        data-day-dialog-status
      >
        <span class="text-muted">Ahora:</span>
        <span class="font-medium text-highlighted">{{ view.shifts.length ? view.shifts.map(shift => shift.text).join(', ') : view.label }}</span>
        <UBadge
          v-if="view.badge || view.tone === CELL_TONE.ABSENCE"
          :label="view.badge ?? 'Ausencia'"
          :color="view.tone === CELL_TONE.ABSENCE ? 'info' : 'primary'"
          variant="subtle"
          size="sm"
        />
        <span
          v-if="view.duration"
          class="text-muted tabular-nums"
        >· {{ view.duration }}</span>
      </div>

      <UAlert
        v-if="!editability.editable"
        color="neutral"
        variant="subtle"
        icon="i-lucide-lock"
        :title="editability.reason"
        description="Su horario e historial se pueden consultar, pero no modificar."
        data-day-dialog-readonly
      />

      <div
        role="tablist"
        aria-label="Qué quieres cambiar"
        class="grid grid-cols-2 gap-1 rounded-lg bg-elevated/60 p-1 ring ring-default"
      >
        <button
          v-for="item in TABS"
          :id="`day-dialog-tab-${item.value}`"
          :key="item.value"
          type="button"
          role="tab"
          :aria-selected="tab === item.value"
          :aria-controls="`day-dialog-panel-${item.value}`"
          class="min-h-11 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary lg:min-h-9"
          :class="tab === item.value ? 'bg-default text-highlighted shadow-xs ring ring-default' : 'text-muted hover:text-highlighted'"
          @click="tab = item.value"
        >
          {{ item.label }}
        </button>
      </div>

      <div
        v-if="tab === 'day'"
        id="day-dialog-panel-day"
        role="tabpanel"
        aria-labelledby="day-dialog-tab-day"
      >
        <ScheduleDayShiftsForm
          v-if="editability.editable && employee && day"
          :key="`${employee.id}-${date}`"
          :employee="employee"
          :date="date"
          :day="day"
          :versions="versions"
          :overrides="overrides"
          :absences="absences"
          @done="onDone"
        />
        <p
          v-else
          class="text-sm text-muted"
        >
          Los turnos de este día no se pueden cambiar.
        </p>
      </div>

      <div
        v-else
        id="day-dialog-panel-absences"
        role="tabpanel"
        aria-labelledby="day-dialog-tab-absences"
      >
        <ScheduleAbsenceManager
          v-if="employee"
          :key="`${employee.id}-${date}`"
          :employee="employee"
          :date="date"
          :versions="versions"
          :overrides="overrides"
          :editable="employee.is_active === true"
          @done="onDone"
        />
      </div>
    </template>
  </UModal>
</template>
