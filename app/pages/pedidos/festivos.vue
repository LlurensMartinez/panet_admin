<script setup>
// Festivos por años (nacionales, autonómicos y locales). Solo sirven para
// avisar en la agenda de que conviene confirmar una entrega; nunca mueven ni
// cancelan pedidos.
// - Los oficiales los mantiene la app con el calendario de la Generalitat del
//   municipio de la tienda (HolidayOfficialSettings).
// - Los demás se añaden a mano.
//
// El acceso a la página lo controla app/middleware/auth.global.js (sesión +
// cuenta autorizada). Los datos los protege la RLS de Supabase.
useHead({ title: 'Festivos · Pedidos · Panet Admin' })

const toast = useToast()
const {
  holidays,
  status,
  loadError,
  refresh,
  createHoliday,
  updateHoliday,
  deleteHoliday,
} = useHolidays()

// ------------------------------------------------------------------- Año
const today = getTodayDate()
const currentYear = getCurrentYear(today)
const year = ref(currentYear)
const listRegion = useTemplateRef('listRegion')

function changeYear(step) {
  year.value = clampHolidayYear(year.value + step)
}

const hasLoaded = computed(() => status.value === 'success' || holidays.value.length > 0)
const isInitialLoading = computed(() => !hasLoaded.value && !loadError.value)
const yearHolidays = computed(() => filterHolidaysByYear(holidays.value, year.value))

const yearSummary = computed(() => {
  const n = yearHolidays.value.length
  return n === 1 ? '1 festivo configurado' : `${n} festivos configurados`
})

// Aviso si falla una recarga cuando ya se ve la lista.
watch(loadError, (error) => {
  if (error && holidays.value.length) {
    toast.add({
      title: 'No se ha podido actualizar la lista',
      description: error.message,
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
})

function reloadPage() {
  reloadNuxtApp({ path: '/pedidos/festivos', force: true })
}

function showError(feedback) {
  toast.add({
    title: feedback.message,
    color: 'error',
    icon: 'i-lucide-circle-alert',
    actions: feedback.kind === DB_ERROR_KIND.EXPIRED
      ? [{ label: 'Volver a iniciar sesión', color: 'neutral', variant: 'outline', onClick: reloadPage }]
      : undefined,
  })
}

const highlightedId = ref(null)
let highlightTimer
function highlight(id) {
  clearTimeout(highlightTimer)
  highlightedId.value = id
  highlightTimer = setTimeout(() => {
    highlightedId.value = null
  }, 2400)
}
onBeforeUnmount(() => clearTimeout(highlightTimer))

// --------------------------------------------------------- Alta y edición
const formOpen = ref(false)
const editingHoliday = ref(null)

function openCreate() {
  editingHoliday.value = null
  formOpen.value = true
}

function openEdit(holiday) {
  editingHoliday.value = holiday
  formOpen.value = true
}

function submitForm(values) {
  return editingHoliday.value
    ? updateHoliday(editingHoliday.value.id, values)
    : createHoliday(values)
}

function onSaved(holiday) {
  const created = !editingHoliday.value
  const savedYear = getYearOfDate(holiday.holiday_date)
  // Que el festivo guardado quede a la vista, aunque sea de otro año.
  if (savedYear && savedYear !== year.value) year.value = savedYear

  highlight(holiday.id)
  toast.add({
    title: created ? 'Festivo añadido' : 'Cambios guardados',
    description: `${holiday.name}: ${formatHolidayDate(holiday.holiday_date)}.`,
    color: 'success',
    icon: 'i-lucide-circle-check',
  })
}

// --------------------------------------------------------------- Eliminar
const pendingIds = ref([])
const confirmOpen = ref(false)
const holidayToDelete = ref(null)

function askDelete(holiday) {
  holidayToDelete.value = holiday
  confirmOpen.value = true
}

async function confirmDelete() {
  const holiday = holidayToDelete.value
  if (!holiday || pendingIds.value.includes(holiday.id)) return
  pendingIds.value = [...pendingIds.value, holiday.id]

  try {
    const result = await deleteHoliday(holiday.id)
    if (!result.ok) {
      showError(result)
      return
    }
    confirmOpen.value = false
    toast.add({
      title: 'Festivo eliminado',
      description: `${holiday.name} (${formatHolidayDate(holiday.holiday_date)}).`,
      color: 'success',
      icon: 'i-lucide-trash-2',
    })
    nextTick(() => listRegion.value?.focus())
  }
  finally {
    pendingIds.value = pendingIds.value.filter(id => id !== holiday.id)
  }
}

const deletePending = computed(() =>
  Boolean(holidayToDelete.value && pendingIds.value.includes(holidayToDelete.value.id)),
)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Festivos"
      description="Fechas en las que conviene confirmar las entregas con los proveedores. Los oficiales se actualizan solos; puedes añadir otros a mano."
    >
      <template #actions>
        <UButton
          label="Añadir festivo"
          icon="i-lucide-plus"
          size="lg"
          :disabled="!hasLoaded"
          @click="openCreate"
        />
      </template>
    </PageHeader>

    <OrderSectionNav />

    <HolidayOfficialSettings
      :holidays="holidays"
      :today="today"
      @synced="refresh()"
    />

    <section
      ref="listRegion"
      aria-labelledby="holidays-year-title"
      tabindex="-1"
      class="space-y-4 focus:outline-none"
    >
      <!-- Año consultado -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-1">
          <UButton
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="outline"
            :aria-label="`Año anterior (${year - 1})`"
            :disabled="year <= HOLIDAY_MIN_YEAR"
            @click="changeYear(-1)"
          />
          <h2
            id="holidays-year-title"
            class="min-w-20 text-center text-xl font-semibold tabular-nums text-highlighted"
            aria-live="polite"
          >
            <span class="sr-only">Festivos de </span>{{ year }}
          </h2>
          <UButton
            icon="i-lucide-chevron-right"
            color="neutral"
            variant="outline"
            :aria-label="`Año siguiente (${year + 1})`"
            :disabled="year >= HOLIDAY_MAX_YEAR"
            @click="changeYear(1)"
          />
          <UButton
            v-if="year !== currentYear"
            label="Año actual"
            color="neutral"
            variant="ghost"
            size="sm"
            class="ms-1"
            @click="year = currentYear"
          />
        </div>
        <p
          v-if="hasLoaded && !loadError"
          class="text-sm text-muted"
        >
          {{ yearSummary }}
        </p>
      </div>

      <p class="flex gap-2 text-pretty text-sm text-muted">
        <UIcon
          name="i-lucide-info"
          class="mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <span>Un festivo no cancela ni mueve ningún pedido: la agenda solo avisará para que confirmes la entrega con el proveedor.</span>
      </p>

      <!-- Error al cargar (sin datos que mostrar) -->
      <div
        v-if="loadError && !holidays.length"
        class="rounded-xl bg-default shadow-xs ring ring-default"
      >
        <EmptyState
          tone="error"
          icon="i-lucide-cloud-off"
          title="No se han podido cargar los festivos"
          :description="loadError.message"
        >
          <UButton
            v-if="loadError.kind === DB_ERROR_KIND.EXPIRED"
            label="Volver a iniciar sesión"
            icon="i-lucide-log-in"
            @click="reloadPage"
          />
          <UButton
            v-else
            label="Reintentar"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="status === 'pending'"
            @click="refresh()"
          />
        </EmptyState>
      </div>

      <HolidayList
        v-else
        :holidays="yearHolidays"
        :today="today"
        :loading="isInitialLoading"
        :pending-ids="pendingIds"
        :highlighted-id="highlightedId"
        @edit="openEdit"
        @delete="askDelete"
      >
        <template #empty>
          <EmptyState
            icon="i-lucide-calendar-x-2"
            :title="`No hay festivos configurados en ${year}`"
            description="Añade los festivos nacionales, autonómicos y locales que afecten a la tienda."
          >
            <UButton
              label="Añadir festivo"
              icon="i-lucide-plus"
              @click="openCreate"
            />
          </EmptyState>
        </template>
      </HolidayList>
    </section>

    <HolidayFormModal
      v-model:open="formOpen"
      :holiday="editingHoliday"
      :holidays="holidays"
      :submit="submitForm"
      @saved="onSaved"
    />

    <ConfirmModal
      v-model:open="confirmOpen"
      :title="`¿Eliminar ${holidayToDelete?.name ?? 'el festivo'}?`"
      :description="holidayToDelete
        ? `${formatHolidayDate(holidayToDelete.holiday_date)}. Dejará de mostrarse el aviso en las entregas de ese día. Los pedidos no cambian.${isOfficialHoliday(holidayToDelete) ? ' Es un festivo oficial: volverá a añadirse en la próxima actualización automática.' : ''}`
        : ''"
      confirm-label="Eliminar"
      confirm-icon="i-lucide-trash-2"
      confirm-color="error"
      :pending="deletePending"
      @confirm="confirmDelete"
    />
  </div>
</template>
