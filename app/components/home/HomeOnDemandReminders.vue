<script setup>
// Recordatorios de Inicio para los proveedores «a demanda»: una tarjeta
// informativa por proveedor activo (no son pedidos pendientes). «Ya lo he
// tenido en cuenta» la oculta hasta mañana en este navegador, sin escribir en
// Supabase ni cambiar pedidos.
const props = defineProps({
  suppliers: { type: Array, default: () => [] },
  today: { type: String, required: true },
})

const todayRef = toRef(props, 'today')
const { ready, dismissed, dismiss, restoreAll } = useDismissedReminders(todayRef)

const reminders = computed(() => buildReminders(props.suppliers, props.today))
const visible = computed(() => reminders.value.filter(r => !dismissed.value.includes(r.id)))
// Solo cuentan los ocultos que siguen siendo recordatorios (activos y a demanda).
const hiddenCount = computed(() => reminders.value.length - visible.value.length)
const headingId = useId()
</script>

<template>
  <section
    v-if="ready && reminders.length"
    :aria-labelledby="headingId"
    class="min-w-0"
    data-home-reminders
  >
    <header class="mb-3 flex flex-wrap items-center gap-3">
      <span
        class="grid size-10 shrink-0 place-items-center rounded-lg bg-default text-primary ring ring-default"
        aria-hidden="true"
      >
        <UIcon
          name="i-lucide-message-circle-question"
          class="size-5"
        />
      </span>
      <div class="min-w-0 flex-1">
        <h2
          :id="headingId"
          class="font-display text-xl font-semibold leading-tight tracking-tight text-highlighted"
        >
          Recordatorios
        </h2>
        <p class="text-pretty text-sm text-muted">
          Proveedores a demanda: no tienen día fijo de pedido.
        </p>
      </div>
    </header>

    <ul
      v-if="visible.length"
      class="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
      aria-label="Recordatorios de proveedores a demanda"
    >
      <li
        v-for="reminder in visible"
        :key="reminder.id"
        class="min-w-0"
      >
        <article
          class="flex h-full flex-col rounded-xl border border-dashed border-primary/30 bg-primary/[0.035] p-4 sm:p-5 dark:bg-primary/10"
          :aria-label="reminder.question"
          :data-reminder="reminder.id"
        >
          <h3 class="text-pretty font-display text-[1.0625rem] font-semibold leading-snug tracking-tight text-highlighted">
            {{ reminder.question }}
          </h3>

          <ul class="mt-2 space-y-1.5 text-sm text-muted">
            <li class="flex items-start gap-2">
              <UIcon
                name="i-lucide-truck"
                class="mt-0.5 size-4 shrink-0 text-dimmed"
                aria-hidden="true"
              />
              <span>
                {{ reminder.deliveryTime }}<template v-if="reminder.deliveryDays">
                  · {{ reminder.deliveryDays }}</template>
              </span>
            </li>
            <li class="flex items-start gap-2">
              <UIcon
                name="i-lucide-calendar-days"
                class="mt-0.5 size-4 shrink-0 text-dimmed"
                aria-hidden="true"
              />
              <span>{{ reminder.nextDelivery }}</span>
            </li>
            <li
              v-if="reminder.deadline"
              class="flex items-start gap-2"
            >
              <UIcon
                name="i-lucide-clock"
                class="mt-0.5 size-4 shrink-0 text-dimmed"
                aria-hidden="true"
              />
              <span>{{ reminder.deadline }}</span>
            </li>
          </ul>

          <p
            v-if="reminder.notes"
            class="mt-2 line-clamp-3 whitespace-pre-line text-pretty text-[0.8125rem] italic text-muted"
            data-reminder-notes
          >
            {{ reminder.notes }}
          </p>

          <div class="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-4">
            <UButton
              label="Ya lo he tenido en cuenta"
              icon="i-lucide-check"
              color="neutral"
              variant="outline"
              class="min-h-11 bg-default lg:min-h-9"
              :aria-label="`Ya lo he tenido en cuenta: ${reminder.name}`"
              @click="dismiss(reminder.id)"
            />
            <UButton
              to="/pedidos"
              label="Ir a la agenda"
              trailing-icon="i-lucide-arrow-up-right"
              color="neutral"
              variant="ghost"
              class="min-h-11 text-muted lg:min-h-9"
              :aria-label="`Ir a la agenda para pedir ${reminder.name}`"
            />
          </div>
        </article>
      </li>
    </ul>

    <!-- Ocultos hasta mañana -->
    <p
      v-if="hiddenCount"
      class="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted"
      data-reminders-hidden
    >
      <UIcon
        name="i-lucide-eye-off"
        class="size-4 shrink-0 text-dimmed"
        aria-hidden="true"
      />
      <span>{{ describeHiddenReminders(hiddenCount) }}</span>
      <UButton
        label="Volver a mostrar"
        color="primary"
        variant="link"
        size="sm"
        class="-mx-1 min-h-11 lg:min-h-0"
        @click="restoreAll"
      />
    </p>
  </section>
</template>
