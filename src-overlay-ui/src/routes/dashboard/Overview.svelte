<script lang="ts">
  import { blur, type BlurParams, fade, fly, type FlyParams, type TransitionConfig } from "svelte/transition";
  import { backOut } from "svelte/easing";
  import logo from "$lib/images/logo.png";
  import Card from "$lib/components/Card.svelte";
  import BrightnessSlider from "$lib/components/BrightnessSlider.svelte";
  import ipcService from "$lib/services/ipc.service";
  import { get } from "svelte/store";
  import { createEventDispatcher } from "svelte";
  import { t } from "$lib/translations";

  // Animation settings
  let animationSpeed = 300;
  let staggerOffset = 60;
  let flyYTransform = 30;

  $: time = new Date();
  $: timeHours = time.getHours().toString().padStart(2, "0");
  $: timeMinutes = time.getMinutes().toString().padStart(2, "0");

  const { state, vrcLoggedIn } = ipcService;

  const dispatch = createEventDispatcher();

  function toggleSleepMode() {
    ipcService.setSleepMode(!get(state).sleepMode);
  }

  function blurFly(node: Element, options?: FlyParams & BlurParams): TransitionConfig {
    const flyTransition = fly(node, options as FlyParams);
    const blurTransition = blur(node, options as BlurParams);

    return {
      duration: options?.duration ?? 300,
      delay: options?.delay ?? 0,
      easing: options?.easing ?? backOut,
      css: (t: number, u: number) => `
            ${flyTransition.css!(t, u)};
            ${blurTransition.css!(t, u)}
        `
    };
  }
</script>

<div class="dashboard-container">
  <div
    class="logo-container"
    transition:blurFly={{ duration: animationSpeed, y: flyYTransform }}
  >
    <img src={logo} alt="Oyasumi Logo" />
  </div>
  <div class="action-container">
    <div
      class="action-large"
      on:click={toggleSleepMode}
      transition:blurFly={{
						duration: animationSpeed,
						y: flyYTransform,
						delay: staggerOffset
					}}
    >
      <Card clickable={true} active={$state.sleepMode} class="w-full h-full">
        <div class="action-contents">
          <i class="material-icons">nights_stay</i>
          <div class="sleep-mode-info">
            <span>{$t('t.overlay.dashboard.overview.sleepMode')}</span>
            <span>{$state.sleepMode ? $t('t.overlay.dashboard.overview.active') : $t('t.overlay.dashboard.overview.inactive')}</span>
          </div>
        </div>
      </Card>
    </div>
    <div
      transition:blurFly={{
						duration: animationSpeed,
						y: flyYTransform,
						delay: staggerOffset * 2
					}}
      on:mouseenter={() => window.OyasumiIPCOut_Dashboard.showToolTip($t('t.overlay.dashboard.overview.tooltip.automations'))}
      on:mouseleave={() => window.OyasumiIPCOut_Dashboard.showToolTip(null)}
      on:click={() => { dispatch('nav', {mode: 'AUTOMATIONS'}) }}
    >
      <Card clickable={true} class="w-full h-full">
        <div class="action-contents">
          <i class="material-icons">settings_suggest</i>
        </div>
      </Card>
    </div>
    <div
      transition:blurFly={{
						duration: animationSpeed,
						y: flyYTransform,
						delay: staggerOffset * 3
					}}
      on:mouseenter={() => window.OyasumiIPCOut_Dashboard.showToolTip($t('t.overlay.dashboard.overview.tooltip.deviceControl'))}
      on:mouseleave={() => window.OyasumiIPCOut_Dashboard.showToolTip(null)}
    >
      <Card clickable={true} class="w-full h-full">
        <div class="action-contents">
          <i class="material-icons">power_off</i>
        </div>
      </Card>
    </div>
    <div
      transition:blurFly={{
						duration: animationSpeed,
						y: flyYTransform,
						delay: staggerOffset * 4
					}}
      on:mouseenter={() => window.OyasumiIPCOut_Dashboard.showToolTip($t('t.overlay.dashboard.overview.tooltip.shutdown'))}
      on:mouseleave={() => window.OyasumiIPCOut_Dashboard.showToolTip(null)}
    >
      <Card clickable={true} class="w-full h-full">
        <div class="action-contents">
          <i class="material-icons">settings_power</i>
        </div>
      </Card>
    </div>
  </div>
  <div
    class="status-bar mt-6"
    transition:blurFly={{
					duration: animationSpeed,
					y: flyYTransform,
					delay: staggerOffset * 5
				}}
  >
    <Card class="w-full h-full">
      <div class="flex flex-row items-center p-3 text-xl font-semibold">
        {#if $vrcLoggedIn}
          <div class="flex-shrink-0 flex flex-row items-center" transition:fade>
            <div
              class="rounded-full w-4 h-4 mr-2 drop-shadow-[0_0_4px_rgba(255,255,255,40%)] transition-all
                    vrc-status-color-{$state.vrcStatus}
                  "
            />
            <span>{$state.vrcUsername}</span>
          </div>
        {/if}
        <div class="flex-1 flex flex-row items-center justify-end">
          <span>{timeHours}</span><span class="blink">:</span><span>{timeMinutes}</span>
          <i class="material-icons-round ml-2 opacity-60">access_time</i>
        </div>
      </div>
    </Card>
  </div>
  <div class="mt-6">
    <BrightnessSlider />
  </div>
  <div class="mt-6">
    <BrightnessSlider />
  </div>
</div>

<style lang="scss">
  .dashboard-container {
    @apply flex flex-col w-[500px];
  }

  .logo-container {
    @apply flex flex-col items-center justify-center w-full px-[80px] mb-4;
    img {
      @apply drop-shadow-[0_0_4px_rgba(255,255,255,100%)];
    }
  }

  .action-container {
    @apply grid grid-cols-3 gap-6 w-full auto-rows-fr mt-5;
    &::before {
      content: '';
      width: 0;
      padding-bottom: 100%;
      grid-row: 1 / 1;
      grid-column: 1 / 1;
    }

    .action-large {
      @apply col-span-3 col-start-1 col-end-4 row-start-1 row-end-1 w-full h-full;
    }

    .action-contents {
      @apply flex flex-row items-center justify-center w-full h-full p-6;
      .material-icons {
        @apply text-8xl drop-shadow-[0_0_8px_rgba(255,255,255,40%)] flex-shrink-0;
        line-height: 0;
      }

      .sleep-mode-info {
        @apply flex-1 flex flex-col items-end justify-center pr-2;
        span {
          &:first-child {
            @apply opacity-60 text-2xl;
          }

          &:last-child {
            @apply text-5xl;
          }
        }
      }
    }
  }

  .blink {
    animation: blinker 1s linear infinite;
  }

  @keyframes blinker {
    50% {
      opacity: 0;
    }
  }
</style>
