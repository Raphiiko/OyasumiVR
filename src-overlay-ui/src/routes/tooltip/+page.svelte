<script lang="ts">
  import Card from "$lib/components/Card.svelte";
  import ipcService from "$lib/services/ipc.service";
  import { blur } from "svelte/transition";
  import { onMount } from "svelte";

  let { showToolTip } = ipcService.events;
  onMount(() => window.OyasumiIPCOut.onUiReady());
</script>

<div class="w-[512px] h-[256px] px-8 flex flex-col justify-end items-center">
  {#if $showToolTip}
    <div transition:blur|global>
      <Card>
        <div
          class="flex flex-col justify-center items-end p-4 text-2xl text-center font-medium whitespace-pre-line"
        >
          <span>{$showToolTip}</span>
        </div>
      </Card>
    </div>
  {/if}
</div>
