/** @type {import("tailwindcss").Config} */
export default {
  mode: "jit", purge: ["./src/**/*.svelte"], theme: {
    extend: {
      fontFamily: {
        sans: ["\"Poppins\"", "\"Noto Sans JP\"", "\"Noto Sans KR\"", "\"Noto Sans TC\"", "\"Noto Sans SC\"", "sans-serif"]
      }
    }
  }, plugins: []
};

