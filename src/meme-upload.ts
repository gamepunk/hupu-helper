// Hupu Helper - Upload Helper
// 此脚本运行在页面上下文中，用于操作虎扑的 file input
// 通过 CustomEvent 与 content script 通信

window.addEventListener("hupu-helper:upload-file", async (e: Event) => {
  const { dataUrl, fileName } = (e as CustomEvent).detail;

  try {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const file = new File([blob], fileName || "emoji.png", { type: blob.type });

    // 查找文件输入
    const inputs =
      document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    let target: HTMLInputElement | null = null;
    for (const inp of inputs) {
      if (inp.accept?.toLowerCase().includes("image")) {
        target = inp;
        break;
      }
    }
    if (!target && inputs.length > 0) {
      target = inputs[inputs.length - 1];
    }

    if (target) {
      const dt = new DataTransfer();
      dt.items.add(file);

      // 使用原生 setter（兼容 React 合成事件）
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "files",
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(target, dt.files);
      } else {
        Object.defineProperty(target, "files", {
          value: dt.files,
          writable: false,
        });
      }

      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      window.dispatchEvent(
        new CustomEvent("hupu-helper:upload-result", {
          detail: { success: true },
        }),
      );
    } else {
      window.dispatchEvent(
        new CustomEvent("hupu-helper:upload-result", {
          detail: { success: false, error: "no file input found" },
        }),
      );
    }
  } catch {
    window.dispatchEvent(
      new CustomEvent("hupu-helper:upload-result", {
        detail: { success: false, error: "upload failed" },
      }),
    );
  }
});
