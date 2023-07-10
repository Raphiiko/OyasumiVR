<script lang="ts">
  import Overview from "./Overview.svelte";
  import AutomationConfig from "./AutomationConfig.svelte";
  import { onMount } from "svelte";

  type DashboardMode = "OVERVIEW" | "AUTOMATIONS";

  let ready = !window.CefSharp;
  let mode: "OVERVIEW" | "AUTOMATIONS" = "OVERVIEW";
  window.OyasumiIPCIn.hideDashboard = async () => ((ready = false), void 1);
  window.OyasumiIPCIn.showDashboard = async () => ((ready = true), void 0);
  onMount(() => window.OyasumiIPCOut.onUiReady());

  function navigate(e: CustomEvent<{ mode: DashboardMode }>) {
    mode = e.detail.mode;
  }
</script>

<main>
  {#if ready}
    {#if mode === 'OVERVIEW'}
      <div class="stack-frame">
        <Overview on:nav={navigate} />
      </div>
    {:else if mode === 'AUTOMATIONS'}
      <div class="stack-frame">
        <AutomationConfig on:nav={navigate} />
      </div>
    {/if}
  {/if}
</main>

<style lang="scss">
  main {
    @apply w-[1024px] h-[1024px] select-none relative;
    // Background for testing outside of VR
    //background-image: url('https://media.discordapp.net/attachments/576683979298570246/1127657024654671932/VRChat_2023-06-12_20-46-39.988_4320x7680.png?width=1440&height=810');
    background-size: cover;
    overflow: hidden;
  }

  .stack-frame {
    @apply absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center;
  }
</style>
