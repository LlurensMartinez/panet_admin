<script setup>
// Ficha de una empleada: sus datos, su situación (activa o de baja, con su
// último día de trabajo) y su horario habitual (vigente hoy, o el último
// aplicable si está de baja) con el historial de versiones.
//
// Solo consulta los horarios: no se editan desde aquí. Los datos de la ficha
// se editan con el mismo formulario del listado, y la baja y la reactivación
// usan el mismo flujo (useEmployeeStatusFlow).
//
// El acceso a la página lo controla app/middleware/auth.global.js (sesión +
// cuenta autorizada). Los datos los protege la RLS de Supabase: una empleada
// que la cuenta no puede ver aparece como «no encontrada».

// Cada empleada tiene su propia instancia de la página (y de sus datos).
definePageMeta({ key: route => route.fullPath })

const route = useRoute()
const toast = useToast()
const employeeId = String(route.params.id ?? '')

const {
  employees,
  status,
  loadError,
  refresh,
  updateEmployee,
  setEmployeeActive,
  replaceEmployee,
} = useEmployees()
const { loadLeaveContext } = useEmployeeLeave()

// --------------------------------------------------------------- Empleada
const employee = computed(() => employees.value.find(item => item.id === employeeId) ?? null)
const loaded = computed(() => status.value === 'success' || employees.value.length > 0)
const pageError = computed(() => (loadError.value && !employees.value.length ? loadError.value : null))
const notFound = computed(() => !isUuid(employeeId) || (loaded.value && !pageError.value && !employee.value))
const fullName = computed(() => getEmployeeFullName(employee.value))

useHead({ title: () => `${fullName.value || 'Empleado'} · Empleados · Panet Admin` })

// Recarga completa: el middleware vuelve a comprobar la sesión en el
// servidor y, si ha caducado, lleva al inicio de sesión.
function reloadPage() {
  reloadNuxtApp({ path: route.fullPath, force: true })
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

// ------------------------------------------------- Horarios (solo lectura)
// Fecha de baja y versiones del horario. Si la migración de horarios no está
// aplicada, `available` es false y la ficha lo indica.
const today = getTodayDate()
const planning = ref({ status: 'idle', data: null, message: '' })

async function loadPlanning() {
  if (!isUuid(employeeId)) return
  planning.value = { ...planning.value, status: 'loading' }
  const context = await loadLeaveContext(employeeId, { withLastWorkingDate: true })
  planning.value = context.ok
    ? { status: 'ready', data: context, message: '' }
    : { status: 'error', data: planning.value.data, message: context.message }
}

onMounted(loadPlanning)

const planningReady = computed(() => planning.value.status === 'ready' || Boolean(planning.value.data))
const planningAvailable = computed(() => planning.value.data?.available === true)
const lastWorkingDate = computed(() => planning.value.data?.lastWorkingDate ?? null)
const versions = computed(() => planning.value.data?.versions ?? [])

const statusInfo = computed(() => employee.value ? getEmployeeStatusInfo(employee.value, lastWorkingDate.value) : null)
const schedule = computed(() => employee.value && planningAvailable.value
  ? getProfileSchedule({ employee: employee.value, lastWorkingDate: lastWorkingDate.value, versions: versions.value, today })
  : null)
const history = computed(() => getScheduleHistory(versions.value, today))

const scheduleTitle = computed(() => schedule.value?.state === PROFILE_SCHEDULE_STATE.LAST_APPLICABLE
  ? 'Último horario habitual'
  : 'Horario habitual')

// ---------------------------------------------------------------- Edición
const formOpen = ref(false)

function submitForm(values) {
  return updateEmployee(employeeId, values)
}

function onSaved(saved) {
  toast.add({
    title: 'Cambios guardados',
    description: `Se ha actualizado la ficha de ${getEmployeeFullName(saved)}.`,
    color: 'success',
    icon: 'i-lucide-circle-check',
  })
}

// ------------------------------------------------- Activar y desactivar
// Mismo flujo que el listado. Después de un cambio, se vuelve a leer la
// fecha de baja y el horario.
const statusFlow = useEmployeeStatusFlow({
  setEmployeeActive,
  replaceEmployee,
  refresh,
  showError,
  onChanged: () => loadPlanning(),
})
const {
  confirmOpen,
  employeeToDeactivate,
  deactivateContext,
  deactivatePending,
  reactivateOpen,
  employeeToReactivate,
  reactivateContext,
  reactivatePending,
} = statusFlow
const statusPending = computed(() => Boolean(employee.value && statusFlow.isPending(employee.value.id)))
</script>

<template>
  <div class="space-y-8">
    <div class="space-y-3">
      <UButton
        to="/empleados"
        label="Empleados"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="link"
        class="-ms-1 px-1"
      />

      <PageHeader
        v-if="notFound"
        title="Empleado no encontrado"
      />

      <PageHeader
        v-else-if="employee"
        :title="fullName"
        :description="employee.role || 'Sin puesto'"
      >
        <template #actions>
          <UButton
            label="Editar"
            icon="i-lucide-pencil"
            color="neutral"
            variant="outline"
            size="lg"
            :disabled="statusPending"
            @click="formOpen = true"
          />
          <UButton
            :label="employee.is_active ? 'Desactivar' : 'Activar'"
            :icon="employee.is_active ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'"
            :color="employee.is_active ? 'neutral' : 'primary'"
            :variant="employee.is_active ? 'outline' : 'solid'"
            size="lg"
            :loading="statusPending"
            :disabled="statusPending"
            @click="statusFlow.toggleActive(employee)"
          />
        </template>
      </PageHeader>

      <div
        v-else-if="!pageError"
        class="space-y-3"
        aria-busy="true"
        aria-label="Cargando la ficha"
      >
        <USkeleton class="h-8 w-56 max-w-[70%]" />
        <USkeleton class="h-4 w-40 max-w-[60%]" />
      </div>
    </div>

    <!-- No encontrada (o no accesible para esta cuenta) -->
    <div
      v-if="notFound"
      class="rounded-xl bg-default shadow-xs ring ring-default"
    >
      <EmptyState
        icon="i-lucide-search-x"
        title="No se ha encontrado este empleado"
        description="Puede que la dirección no sea correcta. Vuelve a la lista de empleados para elegirlo."
      >
        <UButton
          label="Ver empleados"
          icon="i-lucide-users-round"
          to="/empleados"
        />
      </EmptyState>
    </div>

    <!-- Error al cargar -->
    <div
      v-else-if="pageError"
      class="rounded-xl bg-default shadow-xs ring ring-default"
    >
      <EmptyState
        tone="error"
        icon="i-lucide-cloud-off"
        title="No se ha podido cargar la ficha"
        :description="pageError.message"
      >
        <UButton
          v-if="pageError.kind === DB_ERROR_KIND.EXPIRED"
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

    <div
      v-else-if="employee"
      class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:items-start"
    >
      <div class="space-y-6">
        <!-- Situación -->
        <section
          aria-labelledby="profile-status-title"
          class="rounded-xl bg-default p-4 shadow-xs ring ring-default sm:p-5"
          data-profile-status
        >
          <h2
            id="profile-status-title"
            class="text-base font-semibold text-highlighted"
          >
            Situación
          </h2>
          <div class="mt-3 flex items-start gap-3">
            <EmployeeAvatar :employee="employee" />
            <div class="min-w-0 space-y-1">
              <p class="flex items-center gap-1.5">
                <UIcon
                  :name="employee.is_active ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                  class="size-4 shrink-0"
                  :class="employee.is_active ? 'text-primary' : 'text-muted'"
                  aria-hidden="true"
                />
                <span
                  class="font-semibold"
                  :class="employee.is_active ? 'text-highlighted' : 'text-toned'"
                  data-profile-status-label
                >{{ statusInfo.label }}</span>
              </p>
              <p
                v-if="planningReady && planningAvailable"
                class="text-sm text-muted"
                data-profile-status-detail
              >
                {{ statusInfo.detail }}
              </p>
              <USkeleton
                v-else-if="!planningReady && planning.status !== 'error'"
                class="h-4 w-48"
              />
            </div>
          </div>
        </section>

        <!-- Datos -->
        <section
          aria-labelledby="profile-data-title"
          class="rounded-xl bg-default p-4 shadow-xs ring ring-default sm:p-5"
          data-profile-data
        >
          <h2
            id="profile-data-title"
            class="text-base font-semibold text-highlighted"
          >
            Datos
          </h2>
          <dl class="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div>
              <dt class="text-muted">
                Nombre
              </dt>
              <dd class="font-medium text-highlighted">
                {{ employee.first_name }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Apellidos
              </dt>
              <dd class="font-medium text-highlighted">
                {{ employee.last_name }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Puesto
              </dt>
              <dd :class="employee.role ? 'text-default' : 'text-dimmed'">
                {{ employee.role || 'Sin puesto' }}
              </dd>
            </div>
            <div class="sm:col-span-2 lg:col-span-1 xl:col-span-2">
              <dt class="text-muted">
                Observaciones
              </dt>
              <dd
                class="whitespace-pre-line text-pretty"
                :class="employee.notes ? 'text-default' : 'text-dimmed'"
              >
                {{ employee.notes || 'Sin observaciones' }}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <div class="space-y-6">
        <!-- Horario habitual -->
        <section
          aria-labelledby="profile-schedule-title"
          class="rounded-xl bg-default p-4 shadow-xs ring ring-default sm:p-5"
          data-profile-schedule
        >
          <h2
            id="profile-schedule-title"
            class="text-base font-semibold text-highlighted"
          >
            {{ scheduleTitle }}
          </h2>

          <div
            v-if="!planningReady && planning.status !== 'error'"
            class="mt-3 space-y-2"
            aria-busy="true"
            aria-label="Cargando el horario"
          >
            <USkeleton class="h-4 w-52" />
            <USkeleton class="h-40 w-full" />
          </div>

          <UAlert
            v-else-if="planning.status === 'error' && !planning.data"
            class="mt-3"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="No se ha podido cargar el horario"
            :description="planning.message"
            :actions="[{ label: 'Reintentar', color: 'error', variant: 'outline', icon: 'i-lucide-refresh-cw', onClick: () => loadPlanning() }]"
            data-profile-schedule-error
          />

          <p
            v-else-if="!planningAvailable"
            class="mt-3 text-sm text-muted"
            data-profile-schedule-unavailable
          >
            Para ver los horarios, aplica la migración de horarios (SUPABASE_SETUP.md, sección 14).
          </p>

          <div
            v-else-if="schedule"
            class="mt-3 space-y-4"
          >
            <template v-if="schedule.state === PROFILE_SCHEDULE_STATE.CURRENT">
              <p
                class="text-sm text-muted"
                data-profile-schedule-period
              >
                Vigente hoy · {{ describePeriod(schedule.period) }}
              </p>
              <EmployeeWeekSchedule
                :week="schedule.version.week"
                label="Horario vigente"
              />
            </template>

            <template v-else-if="schedule.state === PROFILE_SCHEDULE_STATE.LAST_APPLICABLE">
              <UAlert
                color="neutral"
                variant="subtle"
                icon="i-lucide-history"
                title="No es un horario actual"
                :description="lastWorkingDate
                  ? `Es el horario que tenía hasta su baja. ${describePeriod(schedule.period)}.`
                  : `Es el último horario que tenía. ${describePeriod(schedule.period)}.`"
                data-profile-schedule-last
              />
              <EmployeeWeekSchedule
                :week="schedule.version.week"
                label="Último horario habitual"
              />
            </template>

            <div
              v-else
              class="rounded-lg bg-elevated/50 px-3.5 py-3 ring ring-default"
              data-profile-schedule-empty
            >
              <p class="text-sm font-medium text-highlighted">
                <template v-if="schedule.state === PROFILE_SCHEDULE_STATE.CLOSED">
                  No tiene horario habitual desde el {{ formatLeaveDate(schedule.closedFrom) }}.
                </template>
                <template v-else-if="schedule.state === PROFILE_SCHEDULE_STATE.NEVER">
                  No tuvo horario habitual registrado.
                </template>
                <template v-else>
                  No tiene horario habitual registrado.
                </template>
              </p>
            </div>

            <p
              v-if="schedule.upcoming"
              class="text-sm text-default"
              data-profile-schedule-upcoming
            >
              <UIcon
                name="i-lucide-calendar-clock"
                class="me-1 inline size-4 align-text-bottom text-muted"
                aria-hidden="true"
              />
              A partir del {{ formatLeaveDate(schedule.upcoming.valid_from) }} tendrá otro horario: {{ summarizeWeek(schedule.upcoming.week) }} ({{ describeWeeklyTotal(schedule.upcoming.week) }}).
            </p>
          </div>
        </section>

        <!-- Historial -->
        <section
          v-if="planningReady && planningAvailable"
          aria-labelledby="profile-history-title"
          class="rounded-xl bg-default p-4 shadow-xs ring ring-default sm:p-5"
          data-profile-history
        >
          <h2
            id="profile-history-title"
            class="text-base font-semibold text-highlighted"
          >
            Historial de horarios
          </h2>
          <EmployeeScheduleHistory
            v-if="history.length"
            class="mt-3"
            :history="history"
          />
          <p
            v-else
            class="mt-3 text-sm text-muted"
            data-profile-history-empty
          >
            Todavía no hay horarios registrados.
          </p>
        </section>
      </div>
    </div>

    <EmployeeFormModal
      v-model:open="formOpen"
      :employee="employee"
      :submit="submitForm"
      @saved="onSaved"
    />

    <EmployeeDeactivateModal
      v-model:open="confirmOpen"
      :employee="employeeToDeactivate"
      :pending="deactivatePending"
      :context="deactivateContext"
      @confirm="statusFlow.confirmDeactivate"
      @retry="statusFlow.loadDeactivateContext(employeeToDeactivate)"
    />

    <EmployeeReactivateModal
      v-model:open="reactivateOpen"
      :employee="employeeToReactivate"
      :pending="reactivatePending"
      :context="reactivateContext"
      @confirm="statusFlow.confirmReactivate"
    />
  </div>
</template>
