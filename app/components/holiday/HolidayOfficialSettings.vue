<script setup>
// Municipio de la tienda y estado de los festivos oficiales (los mantiene la
// app con el calendario de la Generalitat). Al elegir el municipio se
// actualizan en el momento; después, solos, como mucho una vez al día al
// abrir Festivos o la agenda de Pedidos.
const props = defineProps({
  holidays: { type: Array, default: () => [] },
  today: { type: String, required: true },
})

const emit = defineEmits(['synced'])

const toast = useToast()
const {
  settings,
  settingsStatus,
  settingsError,
  refreshSettings,
  saveMunicipality,
  sync,
  syncing,
  lastSync,
} = useOfficialHolidays()

const fieldId = useId()
const saving = ref(false)
const selected = ref(undefined)
watch(() => settings.value?.municipality_code, (code) => {
  selected.value = code ?? undefined
}, { immediate: true })

const loaded = computed(() => settingsStatus.value === 'success' || Boolean(settings.value))
const configured = computed(() => Boolean(settings.value?.municipality_code))
const years = computed(() => getOfficialSyncYears(props.today))
const lastYears = computed(() => (lastSync.value?.ok ? lastSync.value.years : null) ?? [])

const yearStatus = computed(() => summarizeOfficialYears(props.holidays, years.value).map((row) => {
  const info = lastYears.value.find(y => y.year === row.year)
  let text
  let tone = 'neutral'
  if (row.official === 0) {
    text = 'aún no publicado'
    tone = 'muted'
  }
  else {
    text = row.official === 1 ? '1 festivo oficial' : `${row.official} festivos oficiales`
    if (row.local === 0 && info?.published && !info.localPublished) {
      text += info.localInconsistent ? ' · locales con datos incoherentes' : ' · sin locales publicados'
      tone = 'warning'
    }
  }
  return { year: row.year, text, tone }
}))

const syncedText = computed(() => {
  const value = settings.value?.holidays_synced_at
  if (!value) return ''
  const date = getTodayDate(new Date(value))
  const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(value))
  return date === props.today ? `hoy a las ${time}` : `el ${formatShortDate(date, props.today)} a las ${time}`
})

const syncError = computed(() => (lastSync.value && !lastSync.value.ok ? lastSync.value : null))

async function runSync(force = false) {
  const result = await sync({ today: props.today, force })
  if (result.ok && result.plan && hasPlanChanges(result.plan)) emit('synced', result)
  return result
}

async function onChange(code) {
  if (!code || code === settings.value?.municipality_code) return
  saving.value = true
  try {
    const saved = await saveMunicipality(code)
    if (!saved.ok) {
      toast.add({ title: saved.message, color: 'error', icon: 'i-lucide-circle-alert' })
      selected.value = settings.value?.municipality_code ?? undefined
      return
    }
  }
  finally {
    saving.value = false
  }
  const result = await runSync(true)
  if (result.ok) {
    toast.add({
      title: `Festivos oficiales de ${settings.value.municipality_name}`,
      description: describePlan(result.plan),
      color: 'success',
      icon: 'i-lucide-calendar-check',
    })
  }
}

// Al abrir la página: actualización automática si toca (como mucho una vez al día).
let autoDone = false
watch(loaded, (isLoaded) => {
  if (!isLoaded || autoDone || !import.meta.client) return
  autoDone = true
  if (configured.value) runSync(false)
}, { immediate: true })
</script>

<template>
  <section
    aria-labelledby="official-holidays-title"
    class="rounded-xl bg-default p-4 shadow-xs ring ring-default sm:p-5"
    data-official-holidays
  >
    <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div class="min-w-0 max-w-xl flex-[1_1_18rem]">
        <h2
          id="official-holidays-title"
          class="flex items-center gap-2 font-semibold text-highlighted"
        >
          <UIcon
            name="i-lucide-landmark"
            class="size-4 text-primary"
            aria-hidden="true"
          />
          Festivos oficiales
        </h2>
        <p class="mt-1 text-pretty text-sm text-muted">
          Elige el municipio de la tienda y la app añadirá sola los festivos nacionales, de Cataluña y locales del año actual y del siguiente, con el calendario oficial de la Generalitat.
        </p>
      </div>

      <div class="w-full sm:w-72">
        <label
          :for="fieldId"
          class="mb-1.5 block text-sm font-medium text-default"
        >Municipio de la tienda</label>
        <USelect
          :id="fieldId"
          v-model="selected"
          :items="MUNICIPALITY_OPTIONS"
          placeholder="Elige el municipio"
          :disabled="!loaded || Boolean(settingsError) || saving || syncing"
          :loading="saving"
          size="lg"
          class="min-h-11 w-full lg:min-h-10"
          @update:model-value="onChange"
        />
      </div>
    </div>

    <!-- Error de la configuración (por ejemplo, migración sin aplicar) -->
    <UAlert
      v-if="settingsError"
      class="mt-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-database"
      :title="settingsError.message"
      :actions="settingsError.kind === DB_ERROR_KIND.MISSING ? undefined : [{ label: 'Reintentar', color: 'warning', variant: 'outline', onClick: () => refreshSettings() }]"
      data-official-error="settings"
    />

    <template v-else-if="configured">
      <div
        class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-default pt-3 text-sm"
        aria-live="polite"
      >
        <ul
          class="flex flex-wrap gap-1.5"
          aria-label="Festivos oficiales por año"
        >
          <li
            v-for="row in yearStatus"
            :key="row.year"
            class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring"
            :class="row.tone === 'warning'
              ? 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25'
              : row.tone === 'muted' ? 'bg-default text-muted ring-default' : 'bg-primary/8 text-primary ring-primary/20'"
            data-official-year
          >
            <span class="tabular-nums">{{ row.year }}</span>
            <span aria-hidden="true">·</span>
            {{ row.text }}
          </li>
        </ul>

        <p
          v-if="syncing"
          class="flex items-center gap-1.5 text-muted"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-4 animate-spin"
            aria-hidden="true"
          />
          Consultando el calendario oficial…
        </p>
        <p
          v-else-if="syncedText"
          class="text-muted"
          data-official-synced
        >
          Actualizado {{ syncedText }}
        </p>

        <UButton
          label="Actualizar ahora"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="sm"
          class="ms-auto"
          :loading="syncing"
          :disabled="syncing || saving"
          @click="runSync(true)"
        />
      </div>

      <UAlert
        v-if="syncError"
        class="mt-3"
        color="warning"
        variant="subtle"
        icon="i-lucide-cloud-off"
        :title="syncError.message"
        :actions="[{ label: 'Reintentar', color: 'warning', variant: 'outline', icon: 'i-lucide-refresh-cw', onClick: () => runSync(true) }]"
        :ui="{ title: 'text-sm' }"
        data-official-error="sync"
      />
    </template>
  </section>
</template>
