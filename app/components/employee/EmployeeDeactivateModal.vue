<script setup>
// Confirmación antes de desactivar. Explica que la ficha y su historial se
// conservan: desactivar no borra nada del pasado.
//
// Con la migración de horarios aplicada (`context.data.available`), pide el
// último día de trabajo (incluido; por defecto, hoy) y enseña qué
// planificación futura se eliminará y qué se conserva antes de confirmar.
// Sin la migración, se comporta como antes: solo confirma.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  employee: { type: Object, default: null },
  pending: { type: Boolean, default: false },
  // { status: 'idle' | 'loading' | 'ready' | 'error', data, message }
  context: { type: Object, default: () => ({ status: 'idle', data: null, message: '' }) },
})

const emit = defineEmits(['confirm', 'retry'])

const fullName = computed(() => getEmployeeFullName(props.employee))
const today = ref(getTodayDate())
const lastWorkingDate = ref(today.value)
const fieldId = useId()

watch(open, (isOpen) => {
  if (!isOpen) return
  today.value = getTodayDate()
  lastWorkingDate.value = today.value
}, { immediate: true })

const loading = computed(() => props.context.status === 'loading' || props.context.status === 'idle')
const loadFailed = computed(() => props.context.status === 'error')
const withDate = computed(() => props.context.status === 'ready' && props.context.data?.available === true)

const preview = computed(() => withDate.value
  ? buildDeactivationPreview({
      versions: props.context.data.versions,
      overrides: props.context.data.overrides,
      absences: props.context.data.absences,
      lastWorkingDate: lastWorkingDate.value,
      today: today.value,
    })
  : null)

const canConfirm = computed(() =>
  !props.pending && props.context.status === 'ready' && (!withDate.value || !preview.value?.error),
)

function confirm() {
  if (!canConfirm.value) return
  emit('confirm', { lastWorkingDate: withDate.value ? lastWorkingDate.value : null })
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`¿Desactivar a ${fullName}?`"
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
        Dejará de aparecer entre los empleados activos. Su ficha y su historial de horas extra se conservan, y puedes volver a activarla cuando quieras desde «Inactivos».
      </span>
    </template>

    <template #body>
      <div
        v-if="loading"
        class="space-y-3"
        aria-busy="true"
        aria-label="Comprobando su planificación"
      >
        <USkeleton class="h-10 w-48" />
        <USkeleton class="h-20 w-full" />
      </div>

      <UAlert
        v-else-if="loadFailed"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="No se ha podido comprobar su planificación"
        :description="context.message"
        :actions="[{ label: 'Reintentar', color: 'error', variant: 'outline', icon: 'i-lucide-refresh-cw', onClick: () => emit('retry') }]"
        data-leave-load-error
      />

      <template v-else-if="withDate && preview">
        <UFormField
          label="Último día de trabajo"
          :name="fieldId"
          help="Incluido. Desde el día siguiente no aparecerá en la planificación."
          :error="preview.error || undefined"
          required
        >
          <UInput
            v-model="lastWorkingDate"
            type="date"
            :max="today"
            size="lg"
            class="w-full sm:w-56"
            :disabled="pending"
            data-leave-last-day
          />
        </UFormField>

        <EmployeeLeavePreview
          v-if="!preview.error"
          :preview="preview"
        />
      </template>

      <p
        v-else
        class="text-sm text-muted"
        data-leave-legacy
      >
        Para indicar su último día de trabajo, aplica la migración de horarios (SUPABASE_SETUP.md, sección 14).
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
        label="Desactivar"
        color="neutral"
        icon="i-lucide-circle-pause"
        :loading="pending"
        :disabled="!canConfirm"
        @click="confirm"
      />
    </template>
  </UModal>
</template>
