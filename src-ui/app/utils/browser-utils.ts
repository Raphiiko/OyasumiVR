export function disableDefaultContextMenu() {
  document.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
      return false;
    },
    { capture: true }
  );

  document.addEventListener(
    'selectstart',
    (e) => {
      e.preventDefault();
      return false;
    },
    { capture: true }
  );
}
