<script setup>
// Agenda de pedidos: atrasados (si los hay), hoy (siempre) y los días
// siguientes con pedidos, cada uno con su lista. Recibe la agenda ya calculada
// por buildAgenda(): este componente solo presenta.
const props = defineProps({
  agenda: { type: Object, required: true },
  today: { type: String, required: true },
  pendingKeys: { type: Array, default: () => [] },
  highlightedKey: { type: String, default: null },
})

const emit = defineEmits(['prepare', 'reopen', 'skip', 'edit', 'delete'])

const todayGroup = computed(() => props.agenda.days.find(day => day.isToday))
const upcoming = computed(() => props.agenda.days.filter(day => !day.isToday))
const todayHeading = computed(() => formatAgendaDay(props.today, props.today))
const lastDay = computed(() => formatShortDate(props.agenda.range.to, props.today))

function countText(n) {
  return n === 1 ? '1 pedido' : `${n} pedidos`
}

const relay = {
  prepare: item => emit('prepare', item),
  reopen: item => emit('reopen', item),
  skip: item => emit('skip', item),
  edit: item => emit('edit', item),
  delete: item => emit('delete', item),
}
</script>

<template>
  <div class="space-y-6">
    <!-- Atrasados -->
    <section
      v-if="agenda.overdue.length"
      aria-labelledby="agenda-overdue"
      class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-warning/40"
    >
      <header class="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-default bg-warning/8 px-4 py-2.5 sm:px-5">
        <h2
          id="agenda-overdue"
          class="flex items-center gap-2 font-semibold text-highlighted"
        >
          <UIcon
            name="i-lucide-alarm-clock"
            class="size-4 text-warning"
            aria-hidden="true"
          />
          Atrasados
          <span class="text-sm font-normal text-muted">· últimos 7 días</span>
        </h2>
        <span class="text-sm text-muted">{{ countText(agenda.overdue.length) }}</span>
      </header>
      <ul
        class="divide-y divide-default"
        aria-label="Pedidos atrasados"
      >
        <OrderCard
          v-for="item in agenda.overdue"
          :key="item.key"
          :item="item"
          :today="today"
          :pending="pendingKeys.includes(item.key)"
          :highlighted="highlightedKey === item.key"
          v-on="relay"
        />
      </ul>
    </section>

    <!-- Hoy -->
    <section
      v-if="todayGroup"
      aria-labelledby="agenda-today"
      class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default"
    >
      <header class="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-default bg-primary/6 px-4 py-2.5 sm:px-5">
        <h2
          id="agenda-today"
          class="font-semibold text-highlighted"
        >
          Hoy <span class="font-normal text-muted">· {{ todayHeading.subtitle }}</span>
        </h2>
        <span
          v-if="todayGroup.items.length"
          class="text-sm text-muted"
        >{{ countText(todayGroup.items.length) }}</span>
      </header>
      <ul
        v-if="todayGroup.items.length"
        class="divide-y divide-default"
        aria-label="Pedidos de hoy"
      >
        <OrderCard
          v-for="item in todayGroup.items"
          :key="item.key"
          :item="item"
          :today="today"
          :pending="pendingKeys.includes(item.key)"
          :highlighted="highlightedKey === item.key"
          v-on="relay"
        />
      </ul>
      <p
        v-else
        class="px-4 py-5 text-sm text-muted sm:px-5"
      >
        Hoy no hay pedidos que preparar.
      </p>
    </section>

    <!-- Próximos días -->
    <section
      aria-labelledby="agenda-upcoming"
      class="space-y-3"
    >
      <h2
        id="agenda-upcoming"
        class="px-1 text-sm font-medium text-muted"
      >
        Próximos días (hasta el {{ lastDay }})
      </h2>

      <div
        v-if="!upcoming.length"
        class="rounded-xl bg-default px-4 py-5 text-sm text-muted shadow-xs ring ring-default sm:px-5"
      >
        No hay pedidos previstos en los próximos 14 días.
      </div>

      <section
        v-for="day in upcoming"
        :key="day.date"
        :aria-labelledby="`agenda-${day.date}`"
        class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default"
      >
        <header class="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-default bg-muted/60 px-4 py-2.5 sm:px-5">
          <h3
            :id="`agenda-${day.date}`"
            class="font-semibold text-highlighted"
          >
            {{ formatAgendaDay(day.date, today).title }}
            <span class="font-normal text-muted">· {{ formatAgendaDay(day.date, today).subtitle }}</span>
          </h3>
          <span class="text-sm text-muted">{{ countText(day.items.length) }}</span>
        </header>
        <ul
          class="divide-y divide-default"
          :aria-label="`Pedidos para preparar el ${formatShortDate(day.date, today)}`"
        >
          <OrderCard
            v-for="item in day.items"
            :key="item.key"
            :item="item"
            :today="today"
            :pending="pendingKeys.includes(item.key)"
            :highlighted="highlightedKey === item.key"
            v-on="relay"
          />
        </ul>
      </section>
    </section>
  </div>
</template>
