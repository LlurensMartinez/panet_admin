<script setup>
// Ausencias de una empleada: lista (de la más reciente a la más antigua),
// alta, edición y eliminación. Tipos: Vacaciones, Permiso y Otro, sin datos
// de salud. Comprobaciones: validateAbsence (fechas, solapes y periodos
// laborales); la base de datos las repite.
const props = defineProps({
  employee: { type: Object, required: true },
  // Día desde el que se abre (fechas propuestas para una ausencia nueva).
  date: { type: String, required: true },
  versions: { type: Array, default: () => [] },
  // Cambios de un día cargados para la semana (para avisar de los que
  // quedarán sin efecto).
  overrides: { type: Array, default: () => [] },
  // Si no se puede modificar, solo se consultan.
  editable: { type: Boolean, default: true },
})

const emit = defineEmits(['done'])

const { loadEmployeeAbsences, saveAbsence, deleteAbsence } = useScheduleExceptions()

const list = ref({ status: 'loading', items: [], message: '' })
const form = ref(null)
const attempted = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const confirmingId = ref(null)
const deletingId = ref(null)
const notesId = useId()

async function load() {
  list.value = { ...list.value, status: 'loading', message: '' }
  const result = await loadEmployeeAbsences(props.employee.id)
  list.value = result.ok
    ? { status: 'ready', items: sortAbsencesDesc(result.data), message: '' }
    : { status: 'error', items: [], message: result.message }
  // Si el día elegido está dentro de una ausencia, se abre para editarla.
  if (result.ok && props.editable && !form.value) {
    const current = getDayAbsence(result.data, props.date)
    if (current) openForm(current)
  }
}

onMounted(load)

function openForm(absence = null) {
  form.value = getAbsenceFormValues(absence, props.date)
  attempted.value = false
  errorMessage.value = ''
  confirmingId.value = null
}

const validation = computed(() => form.value
  ? validateAbsence({ employee: props.employee, values: form.value, absences: list.value.items, versions: props.versions })
  : { errors: [] })
const fieldError = field => (attempted.value ? validation.value.errors.find(error => error.field === field)?.message : undefined)
const generalErrors = computed(() => (attempted.value ? validation.value.errors.filter(error => !error.field).map(error => error.message) : []))
const covered = computed(() => form.value ? countOverridesCoveredByAbsence(props.overrides, form.value) : 0)
const busy = computed(() => saving.value || Boolean(deletingId.value))

async function save() {
  attempted.value = true
  errorMessage.value = ''
  if (busy.value || validation.value.errors.length) return
  saving.value = true
  try {
    const result = await saveAbsence({ employeeId: props.employee.id, values: form.value })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    const label = getAbsenceTypeLabel(result.data.absence_type)
    emit('done', `${label} ${describeDateRange(result.data.start_date, result.data.end_date)}: ${form.value.id ? 'cambios guardados' : 'guardado'}.`)
  }
  finally {
    saving.value = false
  }
}

async function remove(absence) {
  if (busy.value) return
  if (confirmingId.value !== absence.id) {
    confirmingId.value = absence.id
    return
  }
  errorMessage.value = ''
  deletingId.value = absence.id
  try {
    const result = await deleteAbsence(absence.id)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    emit('done', `Se ha eliminado: ${getAbsenceTypeLabel(absence.absence_type).toLocaleLowerCase('es')} ${describeDateRange(absence.start_date, absence.end_date)}.`)
  }
  finally {
    deletingId.value = null
    confirmingId.value = null
  }
}
</script>

<template>
  <div
    class="space-y-4"
    data-absence-manager
  >
    <!-- Lista -->
    <div
      v-if="list.status === 'loading'"
      class="space-y-2"
      aria-busy="true"
      aria-label="Cargando las ausencias"
    >
      <USkeleton class="h-12 w-full" />
    </div>

    <UAlert
      v-else-if="list.status === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="No se han podido cargar las ausencias"
      :description="list.message"
      :actions="[{ label: 'Reintentar', color: 'error', variant: 'outline', icon: 'i-lucide-refresh-cw', onClick: () => load() }]"
      data-absence-load-error
    />

    <template v-else>
      <p
        v-if="!list.items.length"
        class="text-sm text-muted"
        data-absence-empty
      >
        No tiene ausencias registradas.
      </p>
      <ul
        v-else
        class="divide-y divide-default overflow-hidden rounded-lg ring ring-default"
        aria-label="Ausencias registradas"
        data-absence-list
      >
        <li
          v-for="absence in list.items"
          :key="absence.id"
          class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5"
          :class="form?.id === absence.id ? 'bg-primary/5' : ''"
          :data-absence-id="absence.id"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted">
              {{ getAbsenceTypeLabel(absence.absence_type) }}
            </p>
            <p class="text-sm text-muted">
              {{ describeDateRange(absence.start_date, absence.end_date) }}
            </p>
            <p
              v-if="absence.notes"
              class="truncate text-xs text-muted"
            >
              {{ absence.notes }}
            </p>
          </div>
          <div
            v-if="editable"
            class="flex items-center gap-1"
          >
            <UButton
              label="Editar"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="`Editar ${getAbsenceTypeLabel(absence.absence_type).toLocaleLowerCase('es')} ${describeDateRange(absence.start_date, absence.end_date)}`"
              :disabled="busy"
              @click="openForm(absence)"
            />
            <UButton
              :label="confirmingId === absence.id ? '¿Eliminar?' : 'Eliminar'"
              :color="confirmingId === absence.id ? 'error' : 'neutral'"
              :variant="confirmingId === absence.id ? 'solid' : 'ghost'"
              size="sm"
              :aria-label="confirmingId === absence.id
                ? `Confirmar: eliminar ${getAbsenceTypeLabel(absence.absence_type).toLocaleLowerCase('es')} ${describeDateRange(absence.start_date, absence.end_date)}`
                : `Eliminar ${getAbsenceTypeLabel(absence.absence_type).toLocaleLowerCase('es')} ${describeDateRange(absence.start_date, absence.end_date)}`"
              :loading="deletingId === absence.id"
              :disabled="busy && deletingId !== absence.id"
              @click="remove(absence)"
            />
          </div>
        </li>
      </ul>

      <UButton
        v-if="editable && !form"
        label="Añadir ausencia"
        icon="i-lucide-plus"
        color="neutral"
        variant="outline"
        :disabled="busy"
        @click="openForm()"
      />
    </template>

    <!-- Formulario -->
    <form
      v-if="editable && form"
      class="space-y-4 rounded-lg bg-elevated/40 p-3.5 ring ring-default"
      novalidate
      data-absence-form
      @submit.prevent="save"
    >
      <p class="text-sm font-medium text-highlighted">
        {{ form.id ? 'Editar ausencia' : 'Nueva ausencia' }}
      </p>
      <UFormField
        label="Tipo"
        :error="fieldError('absence_type')"
        required
      >
        <USelect
          v-model="form.absence_type"
          :items="ABSENCE_TYPES"
          value-key="value"
          size="lg"
          class="w-full"
          :disabled="busy"
          data-absence-type
        />
      </UFormField>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField
          label="Desde"
          :error="fieldError('start_date')"
          required
        >
          <UInput
            v-model="form.start_date"
            type="date"
            size="lg"
            class="w-full"
            :disabled="busy"
            data-absence-start
          />
        </UFormField>
        <UFormField
          label="Hasta (incluido)"
          :error="fieldError('end_date')"
          required
        >
          <UInput
            v-model="form.end_date"
            type="date"
            :min="form.start_date || undefined"
            size="lg"
            class="w-full"
            :disabled="busy"
            data-absence-end
          />
        </UFormField>
      </div>
      <UFormField
        label="Observaciones"
        :name="notesId"
        help="Opcional. No escribas motivos médicos ni datos de salud."
        :error="fieldError('notes')"
      >
        <UTextarea
          v-model="form.notes"
          :rows="2"
          :maxlength="ABSENCE_NOTES_MAX_LENGTH"
          class="w-full"
          :disabled="busy"
          data-absence-notes
        />
      </UFormField>

      <p
        v-if="covered && !generalErrors.length"
        class="text-sm text-muted"
        data-absence-covers-overrides
      >
        {{ covered === 1 ? 'Hay 1 cambio de un día' : `Hay ${covered} cambios de un día` }} en esas fechas: mientras dure la ausencia, la ausencia prevalece.
      </p>

      <UAlert
        v-if="generalErrors.length"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="generalErrors.join(' ')"
        data-absence-errors
      />

      <div class="flex flex-wrap justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          :disabled="busy"
          @click="form = null"
        />
        <UButton
          type="submit"
          :label="form.id ? 'Guardar cambios' : 'Guardar ausencia'"
          icon="i-lucide-check"
          :loading="saving"
          :disabled="busy"
        />
      </div>
    </form>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="errorMessage"
      description="No se ha guardado nada. Puedes volver a intentarlo."
      data-absence-failed
    />
  </div>
</template>
