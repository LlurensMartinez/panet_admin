<script setup>
// Pedidos: punto de entrada de la sección. La agenda (pedidos que toca
// preparar hoy y los próximos días) se implementa en el siguiente bloque de
// la Fase 3; mientras tanto, esta página lleva a la configuración que la
// agenda necesita: proveedores y festivos.
useHead({ title: 'Pedidos · Panet Admin' })
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Pedidos"
      description="Pedidos a proveedores según sus días de entrega."
    />

    <OrderSectionNav />

    <div class="rounded-xl bg-default shadow-xs ring ring-default">
      <EmptyState
        icon="i-lucide-calendar-days"
        title="La agenda de pedidos aún no está disponible"
        description="Mientras tanto, configura los proveedores con sus días de entrega y los festivos: la agenda los usará para saber qué pedidos toca preparar."
      >
        <UButton
          label="Proveedores"
          icon="i-lucide-truck"
          to="/pedidos/proveedores"
        />
        <UButton
          label="Festivos"
          icon="i-lucide-calendar-x-2"
          color="neutral"
          variant="outline"
          to="/pedidos/festivos"
        />
      </EmptyState>
    </div>
  </div>
</template>
