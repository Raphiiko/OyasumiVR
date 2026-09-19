(() => {
  const element = document.activeElement;
  const input = element instanceof HTMLInputElement;
  if ((!input && !(element instanceof HTMLTextAreaElement)) || element.disabled || element.readOnly)
    return null;
  if (
    input &&
    !['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(element.type)
  )
    return null;
  const id = (window.__oyasumiDashboardKeyboardSequence =
    (window.__oyasumiDashboardKeyboardSequence ?? 0) + 1);
  window.__oyasumiDashboardKeyboard = {
    id,
    accepts(id) {
      return (
        this.id === id &&
        document.activeElement === element &&
        element.isConnected &&
        !element.disabled &&
        !element.readOnly
      );
    },
    finish(id) {
      if (this.accepts(id)) element.blur();
    },
  };
  return {
    id,
    password: input && element.type === 'password',
    multiline: !input,
    maxLength: element.maxLength < 0 ? 16384 : element.maxLength,
  };
})();
