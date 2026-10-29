<script setup>
// Tarjeta de un proveedor en el resumen de Inicio (solo lectura): nombre,
// entregas que toca preparar y productos habituales activos con su cantidad.
// Las cantidades son las habituales del producto: orientativas, nunca se
// calculan ni se inventan aquí.
const props = defineProps({
  card: { type: Object, required: true },
  today: { type: String, required: true },
  // Los productos no se han podido cargar: no se dice «sin productos».
  productsUnavailable: { type: Boolean, default: false },
  productsLoading: { type: Boolean, default: false },
})

const headingId = useId()
const supplierPage = computed(() => `/pedidos/proveedores/${props.card.supplierId}`)

function deliveryText(delivery) {
  const date = formatShortDate(delivery.deliveryDate, props.today)
  const relative = describeRelativeDay(delivery.deliveryDate, props.today)
  return ['hoy', 'mañana'].includes(relative) ? `Entrega ${relative}, ${date}` : `Entrega ${date}`
}

function tagsOf(delivery) {
  const tags = []
  if (delivery.manual) tags.push('Pedido manual')
  if (delivery.moved) tags.push('Fecha cambiada')
  return tags
}
</script>

<template>
  <article
    :aria-labelledby="headingId"
    class="rounded-xl bg-default shadow-xs ring"
    :class="card.overdue ? 'ring-amber-300/80 dark:ring-amber-400/35' : 'ring-default'"
    :data-supplier-card="card.supplierId"
  >
    <header class="flex items-start gap-2 px-4 pt-3.5 sm:ps-5">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3
            :id="headingId"
            class="min-w-0 break-words font-display text-[1.0625rem] font-semibold leading-snug tracking-tight text-highlighted"
          >
            {{ card.name }}
          </h3>
          <span
            v-if="card.overdue"
            class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25"
          >
            <UIcon
              name="i-lucide-alarm-clock"
              class="size-3.5"
              aria-hidden="true"
            />
            Atrasado
          </span>
          <UBadge
            v-if="card.inactive"
            color="neutral"
            variant="soft"
            size="sm"
            label="Desactivado"
          />
        </div>
      </div>

      <UButton
        to="/pedidos"
        icon="i-lucide-arrow-up-right"
        color="neutral"
        variant="ghost"
        class="-me-1.5 -mt-1.5 size-11 shrink-0 justify-center text-muted"
        :aria-label="`Ver ${card.name} en la agenda`"
      />
    </header>

    <ul class="-mt-2 space-y-1.5 px-4 pb-3.5 sm:px-5">
      <li
        v-for="delivery in card.deliveries"
        :key="delivery.key"
        class="space-y-1"
      >
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span class="inline-flex items-center gap-1.5">
            <UIcon
              name="i-lucide-truck"
              class="size-3.5 shrink-0 text-dimmed"
              aria-hidden="true"
            />
            {{ deliveryText(delivery) }}
          </span>
          <span
            v-for="tag in tagsOf(delivery)"
            :key="tag"
            class="rounded-sm bg-elevated px-1.5 py-px text-xs font-medium text-toned"
          >{{ tag }}</span>
        </p>
        <p
          v-if="delivery.overdue"
          class="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300"
        >
          <UIcon
            name="i-lucide-alarm-clock"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          Tocaba prepararlo el {{ formatShortDate(delivery.prepareDate, today) }}
        </p>
        <p
          v-if="delivery.holidayWarning"
          class="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[0.8125rem] leading-snug text-default dark:bg-amber-400/10"
        >
          <UIcon
            name="i-lucide-calendar-x-2"
            class="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span>
            Festivo el día de entrega: <strong class="font-medium">{{ delivery.holidayWarning.holiday.name }}</strong>.
            Confirma con el proveedor.
          </span>
        </p>
        <p
          v-if="delivery.notes"
          class="line-clamp-2 whitespace-pre-line text-pretty ps-5 text-[0.8125rem] italic text-muted"
        >
          {{ delivery.notes }}
        </p>
      </li>
    </ul>

    <!-- Productos habituales -->
    <div class="border-t border-default px-4 py-1 sm:px-5">
      <div
        v-if="productsLoading"
        class="space-y-2.5 py-2.5"
        aria-hidden="true"
      >
        <USkeleton class="h-3.5 w-3/4" />
        <USkeleton class="h-3.5 w-1/2" />
      </div>

      <p
        v-else-if="productsUnavailable"
        class="flex items-center gap-2 py-2.5 text-sm text-muted"
      >
        <UIcon
          name="i-lucide-package-x"
          class="size-4 shrink-0 text-dimmed"
          aria-hidden="true"
        />
        Productos no disponibles ahora.
      </p>

      <dl
        v-else-if="card.products.length"
        class="divide-y divide-dashed divide-default"
        :aria-label="`Productos habituales de ${card.name}`"
      >
        <div
          v-for="product in card.products"
          :key="product.id"
          class="flex items-baseline justify-between gap-4 py-2"
          data-product-row
        >
          <dt class="min-w-0 break-words text-[0.9375rem] text-default">
            {{ product.name }}
          </dt>
          <dd class="shrink-0 text-end tabular-nums">
            <!-- Espacio explícito: sin él se leería «4sacos». -->
            <span class="font-semibold text-highlighted">{{ formatQuantity(product.usual_quantity) }}</span>{{ ' ' }}<span class="text-sm text-muted">{{ product.unit }}</span>
          </dd>
        </div>
      </dl>

      <div
        v-else
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
      >
        <p class="flex items-center gap-2 text-sm text-muted">
          <UIcon
            name="i-lucide-package-open"
            class="size-4 shrink-0 text-dimmed"
            aria-hidden="true"
          />
          Sin productos habituales activos.
        </p>
        <UButton
          :to="supplierPage"
          label="Añadir productos"
          color="primary"
          variant="link"
          size="sm"
          class="-mx-2.5 min-h-11 sm:min-h-0"
          :aria-label="`Añadir productos habituales de ${card.name}`"
        />
      </div>
    </div>
  </article>
</template>
