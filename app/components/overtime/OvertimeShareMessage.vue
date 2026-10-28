<script setup>
// Mensaje para compartir el resumen (WhatsApp, correo…): vista previa
// editable y botón para copiarlo. No envía nada: solo copia el texto.
//
// El texto se genera con buildOvertimeShareText a partir del mismo resumen
// que se ve en pantalla (mismas filas y minutos). Si cambia el periodo o los
// totales, el texto se vuelve a generar: nunca queda a la vista un mensaje de
// otro periodo.
const props = defineProps({
  view: { type: String, required: true },
  range: { type: Object, default: null },
  summary: { type: Object, required: true },
  title: { type: String, required: true },
})

const emit = defineEmits(['close'])

const toast = useToast()
const textareaId = useId()
const headingId = useId()
const textarea = useTemplateRef('textarea')

const baseText = computed(() => buildOvertimeShareText(props.view, props.range, props.summary))
const draft = ref(baseText.value ?? '')
const notice = ref('')
const copyError = ref('')
const copied = ref(false)
const copying = ref(false)
let copiedTimer

const isEdited = computed(() => baseText.value !== null && draft.value !== baseText.value)

// Cambio de semana o de mes (o de los totales): el texto se regenera. Si había
// cambios manuales, se descartan y se avisa.
watch(baseText, (next, previous) => {
  const hadEdits = draft.value !== (previous ?? '')
  draft.value = next ?? ''
  copied.value = false
  copyError.value = ''
  notice.value = next === null
    ? ''
    : hadEdits
      ? `El periodo o los totales han cambiado: el texto se ha actualizado a ${props.title} y se han descartado tus cambios.`
      : `Texto actualizado: ${props.title}.`
})

function restore() {
  draft.value = baseText.value ?? ''
  notice.value = ''
  copyError.value = ''
}

async function copy() {
  if (copying.value) return
  copyError.value = ''
  if (!draft.value.trim()) {
    copyError.value = 'El mensaje está vacío. Restablece el texto antes de copiarlo.'
    return
  }
  copying.value = true
  try {
    const result = await copyTextToClipboard(draft.value)
    if (!result.ok) {
      copyError.value = 'El navegador no ha permitido copiar el texto. Lo hemos seleccionado: cópialo a mano (Ctrl + C, Cmd + C o manteniendo pulsado en el móvil).'
      await nextTick()
      const el = textarea.value?.textareaRef ?? document.getElementById(textareaId)
      el?.focus()
      el?.select()
      return
    }
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2500)
    toast.add({
      title: 'Mensaje copiado',
      description: 'Ya puedes pegarlo en WhatsApp o en un correo.',
      color: 'success',
      icon: 'i-lucide-clipboard-check',
    })
  }
  finally {
    copying.value = false
  }
}

onBeforeUnmount(() => clearTimeout(copiedTimer))
</script>

<template>
  <section
    class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default"
    :aria-labelledby="headingId"
  >
    <div class="flex items-start justify-between gap-4 border-b border-default bg-muted/60 px-4 py-3.5 sm:px-5">
      <div class="min-w-0">
        <h3
          :id="headingId"
          class="font-display text-base font-semibold text-highlighted"
        >
          Mensaje para compartir
        </h3>
        <p class="mt-0.5 text-sm text-muted">
          {{ title }}. Revísalo y edítalo si hace falta antes de copiarlo.
        </p>
      </div>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Cerrar el mensaje para compartir"
        @click="emit('close')"
      />
    </div>

    <!-- Periodo sin registros: no se genera un mensaje vacío. -->
    <div
      v-if="baseText === null"
      class="px-4 py-6 sm:px-5"
    >
      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-calendar-off"
        :title="`No hay horas extra registradas: ${title}.`"
        description="No hay nada que compartir. Cambia de semana o de mes con los botones de arriba."
        role="status"
      />
    </div>

    <div
      v-else
      class="space-y-3 px-4 py-4 sm:px-5"
    >
      <p
        v-if="notice"
        class="flex items-start gap-2 rounded-md bg-primary/8 px-3 py-2 text-sm text-default"
        role="status"
      >
        <UIcon
          name="i-lucide-refresh-cw"
          class="mt-0.5 size-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        {{ notice }}
      </p>

      <label
        :for="textareaId"
        class="sr-only"
      >Texto del mensaje</label>
      <UTextarea
        :id="textareaId"
        ref="textarea"
        v-model="draft"
        :rows="8"
        autoresize
        :maxrows="18"
        size="lg"
        class="w-full"
        :ui="{ base: 'leading-relaxed' }"
        @update:model-value="notice = ''; copyError = ''"
      />

      <UAlert
        v-if="copyError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="copyError"
        role="alert"
      />

      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-xs text-muted">
          <template v-if="isEdited">
            Has editado el texto.
          </template>
          <template v-else>
            Solo aparecen los empleados con horas en el periodo.
          </template>
        </p>
        <div class="flex flex-col-reverse gap-2 sm:flex-row">
          <UButton
            v-if="isEdited"
            label="Restablecer texto"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="ghost"
            class="justify-center"
            @click="restore"
          />
          <UButton
            :label="copied ? 'Copiado' : 'Copiar mensaje'"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :color="copied ? 'success' : 'primary'"
            :loading="copying"
            class="justify-center"
            @click="copy"
          />
        </div>
      </div>
      <p
        class="sr-only"
        aria-live="polite"
      >
        {{ copied ? 'Mensaje copiado al portapapeles' : '' }}
      </p>
    </div>
  </section>
</template>
