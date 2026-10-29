<script setup>
// Formulario de alta y edición de un producto habitual.
// - `product` null → alta; con valor → edición.
// - `products`: productos cargados de este proveedor, para avisar de nombres
//   repetidos antes de guardar (la base de datos también los rechaza).
// - `submit(values)` lo aporta la página y devuelve el resultado de
//   useSupplierProducts: { ok, product } o { ok: false, message, fields }.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  product: { type: Object, default: null },
  products: { type: Array, default: () => [] },
  supplierName: { type: String, default: '' },
  submit: { type: Function, required: true },
})

const emit = defineEmits(['saved'])

const isEdit = computed(() => Boolean(props.product))
const formId = useId()
const unitsListId = useId()
const form = useTemplateRef('form')
const firstField = useTemplateRef('firstField')

const state = reactive(toProductFormValues())
const saving = ref(false)
const errorMessage = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(state, toProductFormValues(props.product))
  errorMessage.value = ''
  form.value?.clear?.()
}, { immediate: true })

function validate(values) {
  return validateProductInput(values, {
    products: props.products,
    currentId: props.product?.id ?? null,
  })
}

function focusFirstField(event) {
  event.preventDefault()
  nextTick(() => firstField.value?.inputRef?.focus())
}

async function onSubmit() {
  if (saving.value) return
  errorMessage.value = ''

  if (isEdit.value && !hasProductChanges(props.product, state)) {
    open.value = false
    return
  }

  saving.value = true
  try {
    const result = await props.submit({ ...state })
    if (result.ok) {
      open.value = false
      emit('saved', result.product)
      return
    }
    if (result.fields?.length) form.value?.setErrors(result.fields)
    errorMessage.value = result.message
  }
  finally {
    saving.value = false
  }
}

function onError() {
  nextTick(() => {
    document.querySelector(`#${CSS.escape(formId)} [aria-invalid="true"]`)?.focus()
  })
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEdit ? 'Editar producto' : 'Añadir producto'"
    :description="isEdit ? `${product.name} · ${supplierName}` : supplierName"
    :dismissible="!saving"
    :close="{ 'disabled': saving, 'aria-label': 'Cerrar' }"
    :content="{ onOpenAutoFocus: focusFirstField }"
    :ui="{
      content: 'sm:max-w-lg',
      title: 'font-display text-lg font-semibold',
      body: 'sm:p-6',
      footer: 'justify-end gap-2',
    }"
  >
    <template #body>
      <UForm
        :id="formId"
        ref="form"
        :state="state"
        :validate="validate"
        :validate-on="['blur', 'change']"
        :disabled="saving"
        class="space-y-5"
        @submit="onSubmit"
        @error="onError"
      >
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorMessage"
          role="alert"
        />

        <UFormField
          label="Nombre"
          name="name"
          required
        >
          <UInput
            ref="firstField"
            v-model="state.name"
            autocomplete="off"
            :maxlength="PRODUCT_FIELD_LIMITS.name"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <div class="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-3">
          <UFormField
            label="Cantidad"
            name="usual_quantity"
            required
          >
            <UInput
              v-model="state.usual_quantity"
              inputmode="decimal"
              autocomplete="off"
              placeholder="2,5"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Unidad"
            name="unit"
            required
          >
            <UInput
              v-model="state.unit"
              :list="unitsListId"
              autocomplete="off"
              placeholder="cajas, kg, sacos…"
              :maxlength="PRODUCT_FIELD_LIMITS.unit"
              size="lg"
              class="w-full"
            />
            <datalist :id="unitsListId">
              <option
                v-for="unit in COMMON_UNITS"
                :key="unit"
                :value="unit"
              />
            </datalist>
          </UFormField>
        </div>

        <p class="flex gap-2 text-pretty text-sm text-muted">
          <UIcon
            name="i-lucide-info"
            class="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>La cantidad habitual es solo una referencia para preparar los pedidos: cada pedido podrá llevar otra.</span>
        </p>
      </UForm>
    </template>

    <template #footer>
      <UButton
        label="Cancelar"
        color="neutral"
        variant="ghost"
        :disabled="saving"
        @click="open = false"
      />
      <UButton
        type="submit"
        :form="formId"
        :label="isEdit ? 'Guardar cambios' : 'Añadir producto'"
        :loading="saving"
        :disabled="saving"
      />
    </template>
  </UModal>
</template>
