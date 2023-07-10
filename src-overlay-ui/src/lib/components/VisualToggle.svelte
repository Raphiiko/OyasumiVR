<script lang="ts">
  export let active = false;
</script>

<div class="w-[60px] h-[35px] drop-shadow-[0_0_8px_rgba(255,255,255,40%)]">
  <div
    class="w-full relative h-full rounded-full border-[0.2em] bg-transparent opacity-25 border-white relative transition-all"
    class:bg-active={active}>
    <div class="aspect-square h-full flex items-center justify-center absolute transition-all"
         class:circle-active={active}>
      <div class="aspect-square bg-white h-[18px] rounded-full transition-all "></div>
    </div>
  </div>
</div>

<style lang="scss">
  .bg-active {
    @apply opacity-100;
  }

  .circle-active {
    transform: translateX(24px);
  }

</style>
