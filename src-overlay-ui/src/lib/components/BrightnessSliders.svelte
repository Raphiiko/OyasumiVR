<script lang="ts">
  import ipc from "$lib/services/ipc.service";
  import BrightnessSlider from "./BrightnessSlider.svelte";
  import throttle from "just-throttle";
  import { blurFly } from "$lib/utils/transitions";
  import { t } from "$lib/translations";

  let animationSpeed = 300;
  let flyYTransform = 30;
  // State
  let { state } = ipc;
  $: brightnessState = $state.brightnessState;


</script>

<style lang="scss">
  .sliders-container {
    position: relative;

    & > div {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
    }
  }
</style>

<div class="sliders-container" style:height={brightnessState?.advancedMode ? '14em' : '7em'}>
  {#if !!brightnessState}
    {#if !brightnessState?.advancedMode}
      <div
        transition:blurFly|local={{
        				duration: animationSpeed,
        				y: flyYTransform,
        			}}>
        <BrightnessSlider label={$t('t.overlay.brightness.simple')}
                          value={brightnessState.brightness}
                          min={5}
                          isTransitioning={brightnessState.brightnessTransitioning}
                          transitionTarget="{brightnessState.brightnessTransitionTarget}"
                          onValueChange={throttle((value) => ipc.setBrightness('SIMPLE', value), 16, {leading: true, trailing: true})}
        ></BrightnessSlider>
      </div>
    {:else}
      <div
        transition:blurFly|local={{
        				duration: animationSpeed,
        				y: flyYTransform,
        			}}>
        <BrightnessSlider label={$t('t.overlay.brightness.software')}
                          min={5}
                          value={brightnessState.softwareBrightness}
                          isTransitioning={brightnessState.softwareBrightnessTransitioning}
                          transitionTarget="{brightnessState.softwareBrightnessTransitionTarget}"
                          onValueChange={throttle((value) => ipc.setBrightness('SOFTWARE', value), 16, {leading: true, trailing: true})}
        ></BrightnessSlider>
        <BrightnessSlider label={$t('t.overlay.brightness.hardware')}
                          min="{brightnessState.hardwareMinBrightness}"
                          max="{brightnessState.hardwareMaxBrightness}"
                          value={brightnessState.hardwareBrightness}
                          disabled={!brightnessState.hardwareBrightnessAvailable}
                          isTransitioning={brightnessState.hardwareBrightnessTransitioning}
                          transitionTarget="{brightnessState.hardwareBrightnessTransitionTarget}"
                          onValueChange={throttle((value) => ipc.setBrightness('HARDWARE', value), 16, {leading: true, trailing: true})}
        ></BrightnessSlider>
      </div>
    {/if}
  {/if}
</div>
