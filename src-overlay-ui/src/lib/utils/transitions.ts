import { blur, type BlurParams, fly, type FlyParams, type TransitionConfig } from "svelte/transition";
import { backOut } from "svelte/easing";

export function blurFly(node: Element, options?: FlyParams & BlurParams): TransitionConfig {
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
