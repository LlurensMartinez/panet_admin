<script setup>
// Reactivación de una empleada que tiene horario habitual: pide la fecha de
// vuelta y ofrece copiar su último horario desde esa fecha. Las empleadas sin
// horario se reactivan directamente desde la página, sin este diálogo.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  employee: { type: Object, default: null },
  pending: { type: Boolean, default: false },
  // Resultado de useEmployeeLeave().loadLeaveContext
  context: { type: Object, default: null },
})

const emit = defineEmits(['confirm'])

const fullName = computed(() => getEmployeeFullName(props.employee))
const today = ref(getTodayDate())
const returnDate = ref('')
const copySchedule = ref(true)
const fieldId = useId()

watch(open, (isOpen) => {
  if (!isOpen) return
  today.value = getTodayDate()
  returnDate.value = getDefaultReturnDate({ lastWorkingDate: props.context?.lastWorkingDate ?? null, today: today.value })
  copySchedule.value = true
}, { immediate: true })

const lastWorkingDate = computed(() => props.context?.lastWorkingDate ?? null)
const minReturnDate = computed(() => lastWorkingDate.value ? addDaysToDate(lastWorkingDate.value, 1) : undefined)

const plan = computed(() => buildReactivationPlan({
  versions: props.context?.versions ?? [],
  lastWorkingDate: lastWorkingDate.value,
  returnDate: returnDate.value,
  copySchedule: copySchedule.value,
  today: today.value,
}))

// Copiar solo tiene sentido si hay un horario que copiar y no se va a anular
// el cierre (en ese caso sigue el horario anterior sin copiar nada).
const showCopy = computed(() => Boolean(plan.value.schedule) && plan.value.outcome !== REACTIVATION_OUTCOME.RESTORE
  && plan.value.outcome !== REACTIVATION_OUTCOME.CONTINUES)

const canConfirm = computed(() => !props.pending && !plan.value.error)

function confirm() {
  if (!canConfirm.value) return
  emit('confirm', {
    returnDate: returnDate.value,
    copySchedule: plan.value.outcome === REACTIVATION_OUTCOME.COPY,
  })
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`¿Activar a ${fullName}?`"
    :dismissible="!pending"
    :close="false"
    :ui="{
      content: 'sm:max-w-lg',
      title: 'font-display text-lg font-semibold',
      body: 'space-y-5',
      footer: 'justify-end gap-2',
    }"
  >
    <template #description>
      <span class="block text-pretty">
        Volverá a aparecer entre los empleados activos.
        <template v-if="lastWorkingDate">Su último día de trabajo fue el {{ formatLeaveDate(lastWorkingDate) }}.</template>
      </span>
    </template>

    <template #body>
      <UFormField
        label="Fecha de vuelta"
        :name="fieldId"
        help="Primer día que vuelve a trabajar."
        :error="plan.error || undefined"
        required
      >
        <UInput
          v-model="returnDate"
          type="date"
          :min="minReturnDate"
          size="lg"
          class="w-full sm:w-56"
          :disabled="pending"
          data-leave-return-date
        />
      </UFormField>

      <div
        v-if="showCopy"
        class="rounded-lg bg-elevated/60 px-3.5 py-1 ring ring-default"
      >
        <USwitch
          v-model="copySchedule"
          label="Copiar su último horario habitual"
          :description="`${formatDuration(plan.weeklyMinutes)} a la semana, desde la fecha de vuelta.`"
          :disabled="pending"
          :ui="{ root: 'items-center', label: 'block pt-2.5 text-sm font-medium', description: 'pb-2.5 text-sm' }"
          data-leave-copy
        />
      </div>

      <p
        v-if="!plan.error"
        class="text-sm text-default"
        data-leave-outcome
      >
        {{ describeReactivationOutcome(plan) }}
      </p>
    </template>

    <template #footer>
      <UButton
        label="Cancelar"
        color="neutral"
        variant="ghost"
        :disabled="pending"
        @click="open = false"
      />
      <UButton
        label="Activar"
        icon="i-lucide-circle-play"
        :loading="pending"
        :disabled="!canConfirm"
        @click="confirm"
      />
    </template>
  </UModal>
</template>
