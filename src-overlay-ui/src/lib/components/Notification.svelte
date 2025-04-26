<script lang="ts">
  import { blur, fade, slide } from "svelte/transition";
  import logo from "$lib/images/logo.png";
  import { delay, of, startWith } from "rxjs";
  import Card from "$lib/components/Card.svelte";

  export let message = "";
  export let duration = 3000;
  export let active = false;

  $: _active = of(active).pipe(delay(800), startWith(false));
</script>

<main
  in:fade|global={{ duration: 800 }}
  out:blur|global={{ duration: 1000 }}
>
  <Card
    class="w-[400px] overflow-visible"
  >
    <div class="grid items-start w-full relative">
      <!-- Bottom "Handle" + Glow -->
      <div
        class="absolute -bottom-1.5 left-[50%] -translate-x-1/2 w-16 h-2 bg-white rounded-lg drop-shadow-xl"
      />
      <div class="col-span-full row-span-full h-full w-full overflow-hidden relative">
        <div
          class="absolute bottom-0 left-[50%] -translate-x-1/2 translate-y-1 w-16 h-1 shadow-[0_0_60px_30px_#fff5]"
        />
      </div>
      <!-- Content -->
      <div
        class="notification-content col-span-full row-span-full flex flex-col justify-start items-center text-white"
        in:slide|global={{ duration: 800 }}
      >
        <img
          src={logo}
          alt="Oyasumi Logo"
          class="w-[150px] h-[24px] drop-shadow-[0_0_4px_rgba(255,255,255,100%)] m-4"
        />
        <div
          class="h-[1px] w-[300px] relative bg-white bg-opacity-20 drop-shadow-[0_0_4px_rgba(255,255,255,100%)] rounded-xl overflow-hidden"
          in:blur|global={{ duration: 200, delay: 400 }}
          out:blur|global={{ duration: 400, delay: 200 }}
        >
          <div
            class="h-[1px] w-0 bg-white left-0 top-0 absolute"
            style="
					transition: all {duration - 800}ms linear;
					width: {$_active ? '100%' : '0%'};
				"
          />
        </div>
        <span
          class="text-sm text-center m-4 whitespace-pre-line"
          in:blur|global={{ duration: 400, delay: 600 }}
          out:blur|global={{ duration: 400 }}>{message}</span
        >
      </div>
  </Card>
</main>

<style lang="scss">
</style>
