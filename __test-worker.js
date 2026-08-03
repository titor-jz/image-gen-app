(() => {
  // 查找 Dialog 内容区域的文本
  const dialogs = document.querySelectorAll('[role="dialog"], [data-slot="dialog-content"]');
  const texts = [];
  dialogs.forEach(d => texts.push(d.innerText.slice(0, 500)));
  // 也检查 toast 通知
  const toasts = document.querySelectorAll('[data-sonner-toast]');
  const toastTexts = [];
  toasts.forEach(t => toastTexts.push(t.innerText.slice(0, 200)));
  return JSON.stringify({ dialogs: texts, toasts: toastTexts });
})();
