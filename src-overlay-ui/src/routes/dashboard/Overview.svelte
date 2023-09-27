<script lang="ts">
  import { fade } from "svelte/transition";
  import { blurFly } from "$lib/utils/transitions";
  import logo from "$lib/images/logo.png";
  import deviceControlIcon from "$lib/images/icon_device_control.png";
  import Card from "$lib/components/Card.svelte";
  import BrightnessSliders from "$lib/components/BrightnessSliders.svelte";
  import ipc from "$lib/services/ipc.service";
  import { get } from "svelte/store";
  import { createEventDispatcher } from "svelte";
  import { t } from "$lib/translations";
  import Clickable from "$lib/components/Clickable.svelte";

  // Input & Output
  const dispatch = createEventDispatcher();
  export let shutdownSequenceDisabled = true;

  // Animation settings
  let animationSpeed = 300;
  let staggerOffset = 50;
  let flyYTransform = 30;

  $: time = new Date();
  $: timeHours = time.getHours().toString().padStart(2, "0");
  $: timeMinutes = time.getMinutes().toString().padStart(2, "0");

  const { state, vrcLoggedIn } = ipc;

  $: sleepPreparationEnabled = $state.sleepPreparationAvailable && !$state.sleepPreparationTimedOut && !$state.sleepMode;

  function toggleSleepMode() {
    const mode = !get(state).sleepMode;
    ipc.setSleepMode(mode);
    if (mode) setTimeout(() => dispatch("closeDashboard"), 500);
  }

</script>

<div class="dashboard-container">
  <!-- LOGO HEADER -->
  <div class="logo-container" transition:blurFly={{ duration: animationSpeed, y: flyYTransform }}>
    <img src={logo} alt="Oyasumi Logo" class="glow-100" />
  </div>
  <div
    class="action-container"
  >
    <!-- SLEEP MODE TOGGLE -->
    <div class="action-large" transition:blurFly={{
			duration: animationSpeed,
			y: flyYTransform,
			delay: staggerOffset
		}}>
      <Clickable on:click={toggleSleepMode}>
        <Card clickable={true} active={$state.sleepMode} class="w-full h-full">
          <div class="action-contents">
            <i class="material-icons">nights_stay</i>
            <div class="sleep-mode-info">
              <span>{$t('t.overlay.dashboard.overview.sleepMode')}</span>
              <span
              >{$state.sleepMode
                ? $t('t.overlay.dashboard.overview.active')
                : $t('t.overlay.dashboard.overview.inactive')}</span
              >
            </div>
          </div>
        </Card>
      </Clickable>
    </div>
    <!-- SLEEP PREPARATION-->
    <div
      transition:blurFly={{
			duration: animationSpeed,
			y: flyYTransform,
			delay: staggerOffset * 2
		}}
    >
      <Clickable
        on:click={() => { if (sleepPreparationEnabled) ipc.prepareForSleep() }}
        tooltip={$t('t.overlay.dashboard.overview.tooltip.prepareForSleep')}
      >
        <Card class="w-full h-full" clickable={true}
              disabled={!sleepPreparationEnabled}
              active={$state.sleepPreparationTimedOut}>
          <div class="action-contents">
            <i class="material-icons-outlined glow">bedtime</i>
          </div>
        </Card>
      </Clickable>
    </div>
    <!-- AUTOMATION CONFIG -->
    <div
      transition:blurFly={{
				duration: animationSpeed,
				y: flyYTransform,
				delay: staggerOffset * 3
			}}
    >
      <Clickable
        on:click={() => {
					dispatch('nav', { mode: 'AUTOMATIONS' });
				}}
        tooltip={$t('t.overlay.dashboard.overview.tooltip.automations')}
      >
        <Card clickable={true} class="w-full h-full">
          <div class="action-contents">
            <i class="material-icons glow">settings_suggest</i>
          </div>
        </Card>
      </Clickable>
    </div>
    <!-- DEVICE CONTROL -->
    <div
      transition:blurFly={{
				duration: animationSpeed,
				y: flyYTransform,
				delay: staggerOffset * 4
			}}
    >
      <Clickable
        on:click={() => {
					dispatch('nav', { mode: 'DEVICE_CONTROL' });
				}}
        tooltip={$t('t.overlay.dashboard.overview.tooltip.deviceControl')}
      >
        <Card clickable={true} class="w-full h-full">
          <div class="action-contents pointer-events-none">
            <img src={deviceControlIcon} class="glow w-8/12" />
          </div>
        </Card>
      </Clickable>
    </div>
    <!-- SHUTDOWN SEQUENCE -->
    <div
      transition:blurFly={{
				duration: animationSpeed,
				y: flyYTransform,
				delay: staggerOffset * 5
			}}
    >
      <Clickable
        on:click={() => {
					if (!shutdownSequenceDisabled) dispatch('openShutdownSequence');
				}}
        tooltip={$t('t.overlay.dashboard.overview.tooltip.shutdown')}
      >
        <Card clickable={true} class="w-full h-full" disabled={shutdownSequenceDisabled}>
          <div class="action-contents">
            <i class="material-icons glow">settings_power</i>
          </div>
        </Card>
      </Clickable>
    </div>

  </div>
  <!-- STATUS BAR -->
  <div
    class="status-bar mt-6 z-10"
    transition:blurFly={{
			duration: animationSpeed,
			y: flyYTransform,
			delay: staggerOffset * 6
		}}
  >
    <Card class="w-full h-full">
      <div class="flex flex-row items-center p-3 text-xl font-semibold">
        {#if $vrcLoggedIn}
          <div class="flex-shrink-0 flex flex-row items-center" transition:fade>
            <div
              class="rounded-full w-4 h-4 mr-2 glow transition-all
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
  <!-- BRIGHTNESS SLIDERS -->
  <div class="mt-6 z-0"
       transition:blurFly={{
			duration: animationSpeed,
			y: flyYTransform,
			delay: staggerOffset * 7
		}}
  >
    <BrightnessSliders />
  </div>
</div>

<style lang="scss">
  .dashboard-container {
    @apply flex flex-col w-[500px];
  }

  .logo-container {
    @apply flex flex-col items-center justify-center w-full px-[80px] mb-4;
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
      @apply col-span-3 col-start-1 col-end-3 row-start-1 row-end-1 w-full h-full;
    }

    .action-contents {
      @apply flex flex-row items-center justify-center w-full h-full p-6;
      .material-icons, .material-icons-outlined {
        @apply text-8xl flex-shrink-0;
        line-height: 0;
      }

      .sleep-mode-info {
        @apply flex-1 flex flex-col items-end justify-center pr-2;
        span {
          &:first-child {
            @apply opacity-60 text-xl;
          }

          &:last-child {
            @apply text-4xl;
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
