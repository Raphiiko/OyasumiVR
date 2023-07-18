<script lang="ts">
  import Overview from "./Overview.svelte";
  import AutomationConfig from "./AutomationConfig.svelte";
  import { onMount } from "svelte";
  import Dialog from "$lib/components/Dialog.svelte";
  import { blur, scale } from "svelte/transition";

  let ready = !window.CefSharp;
  let shutdownSequenceDialog = {
    shown: false,
    startDisabled: false,
    timeout: null as NodeJS.Timeout | null
  };

  type DashboardMode = "OVERVIEW" | "AUTOMATIONS";
  let mode: "OVERVIEW" | "AUTOMATIONS" = "OVERVIEW";
  window.OyasumiIPCIn.hideDashboard = async () => ((ready = false), void 1);
  window.OyasumiIPCIn.showDashboard = async () => ((ready = true), void 0);
  onMount(() => window.OyasumiIPCOut.onUiReady());

  function navigate(e: CustomEvent<{ mode: DashboardMode }>) {
    mode = e.detail.mode;
  }

  function handleEvent(e: string | CustomEvent<string>) {
    const event = typeof e === "string" ? e : e.detail;
    switch (event) {
      case "openShutdownSequence":
        shutdownSequenceDialog.shown = true;
        shutdownSequenceDialog.startDisabled = true;
        if (shutdownSequenceDialog.timeout) clearTimeout(shutdownSequenceDialog.timeout);
        shutdownSequenceDialog.timeout = setTimeout(() => {
          shutdownSequenceDialog.startDisabled = false;
          shutdownSequenceDialog.timeout = null;
        }, 2000);
        break;
      case "closeShutdownSequence":
        if (shutdownSequenceDialog.timeout) clearTimeout(shutdownSequenceDialog.timeout);
        shutdownSequenceDialog.shown = false;
        break;
    }
  }
</script>

<main class:non-overlay={!window.CefSharp}>
  {#if ready}
    {#if mode === 'OVERVIEW'}
      <div class="stack-frame transition duration-700" class:blur-sm={shutdownSequenceDialog.shown}
           class:opacity-80={shutdownSequenceDialog.shown}>
        <Overview on:nav={navigate} on:event={handleEvent} />
      </div>
    {:else if mode === 'AUTOMATIONS'}
      <div class="stack-frame">
        <AutomationConfig on:nav={navigate} />
      </div>
    {/if}
    {#if shutdownSequenceDialog.shown}
      <div class="stack-frame" transition:blur>
        <div transition:scale>
          <Dialog
            title="t.overlay.dashboard.shutdownSequence.dialog.title"
            message="t.overlay.dashboard.shutdownSequence.dialog.message"
            confirmText="t.overlay.dashboard.shutdownSequence.dialog.start"
            confirmColor="red"
            confirmDisabled={shutdownSequenceDialog.startDisabled}
            on:cancel={() => handleEvent('closeShutdownSequence')}
          />
        </div>
      </div>
    {/if}
  {/if}
</main>

<style lang="scss">
  main {
    @apply w-[1024px] h-[1024px] select-none relative;
    background-size: cover;
    overflow: hidden;

    &.non-overlay {
      // Background for testing outside of VR
      background-image: url('https://media.discordapp.net/attachments/576683979298570246/1127657024654671932/VRChat_2023-06-12_20-46-39.988_4320x7680.png?width=1440&height=810');
    }
  }

  .stack-frame {
    @apply absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center;
  }
</style>
