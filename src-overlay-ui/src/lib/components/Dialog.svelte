<script lang="ts">

  import Card from "$lib/components/Card.svelte";
  import { createEventDispatcher } from "svelte";
  import type { DialogProperties } from "$lib/models/DialogProperties";
  import { t } from "$lib/translations";

  const dispatch = createEventDispatcher();

  export let title = "t.shared.modals.confirm";
  export let message = "";
  export let showCancel = true;
  export let cancelText = "t.shared.modals.cancel";
  export let confirmText = "t.shared.modals.confirm";
  export let confirmColor: "normal" | "blue" | "red" = "normal";
</script>

<div class="w-[400px]">
  <Card class="w-full">
    <div class="flex flex-col items-center">
      <div class="flex items-center justify-center p-4">
        <span class="text-xl font-medium glow-40">{$t(title)}</span>
      </div>
      <div class="w-[50px] h-[2px] bg-white glow-40 rounded-full"></div>
      <div class="text-center p-4 whitespace-pre-line">
        <p>{$t(message)}</p>
      </div>
    </div>
  </Card>
  <div class="grid grid-cols-2 gap-4 w-full mt-4">
    <div on:click={() => dispatch('cancel') }>
      <Card class="flex-1" clickable={true}>
        <div class="p-3 flex flex-row items-center justify-center font-medium">{$t(cancelText)}</div>
      </Card>
    </div>
    <div>
      <Card class="flex-1" clickable={true} active={confirmColor !== 'normal'} activeColor={confirmColor}>
        <div class="p-3 flex flex-row items-center justify-center font-medium">{$t(confirmText)}</div>
      </Card>
    </div>
  </div>
</div>

<style lang="scss">

</style>
