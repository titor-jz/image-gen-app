/**
 * Capacitor 原生桥 mock（Playwright addInitScript 注入）
 *
 * 契约来源（不是凭空捏造）：
 *  - 平台判定：@capacitor/core getPlatformId() 检查 win.androidBridge
 *  - 方法分发：core 按 PluginHeaders 的 rtype 走 nativePromise/nativeCallback，
 *    我们在 window.Capacitor 上预置这两个函数（core 只追加属性、不覆盖）
 *  - 插件行为：镜像各插件 Android Java 源码的真实契约，尤其是
 *    @capacitor-community/media MediaPlugin.java 的「savePhoto 缺
 *    albumIdentifier 必须 reject」——让 mock 能抓住真实回归
 */
(() => {
  const state = {
    calls: [],
    albums: [],
    exitAppCount: 0,
    backButtonCallbacks: new Map(),
    nextCallbackId: 1,
    statusCalls: [],
  };
  window.__capMock = state;

  const ALBUM_NAME = "AI 生图";

  function handleNative(pluginId, methodName, options, cb) {
    state.calls.push({ pluginId, methodName, options: options || null });
    const ok = (data) => {
      if (cb.resolve) cb.resolve(data === undefined ? null : data);
      else cb.callback(data === undefined ? null : data);
    };
    const fail = (message) => {
      const err = { message };
      if (cb.reject) cb.reject(err);
      else cb.callback(null, err);
    };

    if (pluginId === "App") {
      if (methodName === "addListener") {
        // 注册时绝不能调用事件回调（真实桥只存储，事件到来才调用）——
        // 否则 backButton 在注册瞬间被触发一次（mock 契约偏差，会导致启动即退出）
        if (options && options.eventName === "backButton") {
          state.backButtonCallbacks.set(cb.callbackId, cb.callback);
        }
        return;
      }
      if (methodName === "removeListener") {
        if (options && options.callbackId) state.backButtonCallbacks.delete(String(options.callbackId));
        return;
      }
      if (methodName === "exitApp") {
        state.exitAppCount++;
        state.exitAppStacks = state.exitAppStacks || [];
        try {
          state.exitAppStacks.push(String(new Error().stack).split("\n").slice(1, 5).join(" | "));
        } catch (e) {}
        ok(null);
        return;
      }
      ok(null);
      return;
    }

    if (pluginId === "StatusBar") {
      state.statusCalls.push({ method: methodName, options: options || null });
      ok(null);
      return;
    }

    if (pluginId === "Media") {
      if (methodName === "getAlbums") {
        ok({ albums: state.albums.map((a) => ({ ...a })) });
        return;
      }
      if (methodName === "createAlbum") {
        const name = (options && options.name) || "";
        if (state.albums.some((a) => a.name === name)) {
          fail("Album name already taken");
          return;
        }
        state.albums.push({ identifier: "album-" + (state.albums.length + 1), name });
        ok(null);
        return;
      }
      if (methodName === "savePhoto") {
        // 镜像 MediaPlugin.java：Android 侧 albumIdentifier 与 path 必填
        if (!options || !options.albumIdentifier) {
          fail("Album identifier required");
          return;
        }
        if (!options.path) {
          fail("Path required");
          return;
        }
        const album = state.albums.find((a) => a.identifier === options.albumIdentifier);
        if (!album) {
          fail("Album not found");
          return;
        }
        ok({ filePath: "/mock/saved-" + Date.now() + ".png" });
        return;
      }
      fail("Not implemented in mock: Media." + methodName);
      return;
    }

    fail("Unknown plugin: " + pluginId);
  }

  window.Capacitor = {
    // core 检测到已存在的 window.Capacitor 时会跳过自身初始化，
    // isNativePlatform/getPlatform 必须由桥（这里由 mock）提供
    isNativePlatform: () => true,
    getPlatform: () => "android",
    PluginHeaders: [
      {
        name: "App",
        methods: [
          { name: "exitApp", rtype: "promise" },
          { name: "getState", rtype: "promise" },
          { name: "getInfo", rtype: "promise" },
          { name: "getLaunchUrl", rtype: "promise" },
          { name: "minimizeApp", rtype: "promise" },
          { name: "getAppLanguage", rtype: "promise" },
          { name: "addListener", rtype: "callback" },
          { name: "removeListener", rtype: "callback" },
        ],
      },
      {
        name: "StatusBar",
        methods: [
          { name: "setStyle", rtype: "promise" },
          { name: "setBackgroundColor", rtype: "promise" },
          { name: "setOverlaysWebView", rtype: "promise" },
          { name: "hide", rtype: "promise" },
          { name: "show", rtype: "promise" },
          { name: "getInfo", rtype: "promise" },
          { name: "getDefaults", rtype: "promise" },
        ],
      },
      {
        name: "Media",
        methods: [
          { name: "getAlbums", rtype: "promise" },
          { name: "createAlbum", rtype: "promise" },
          { name: "savePhoto", rtype: "promise" },
          { name: "saveVideo", rtype: "promise" },
          { name: "getMedias", rtype: "promise" },
          { name: "getMediaByIdentifier", rtype: "promise" },
          { name: "getAlbumsPath", rtype: "promise" },
        ],
      },
    ],
    nativePromise: (pluginName, methodName, options) =>
      new Promise((resolve, reject) =>
        handleNative(pluginName, methodName, options, { resolve, reject })
      ),
    nativeCallback: (pluginName, methodName, options, callback) => {
      const callbackId = String(state.nextCallbackId++);
      handleNative(pluginName, methodName, options, { callback, callbackId });
      return callbackId;
    },
  };

  // core 的平台判定只认 win.androidBridge（getPlatformId）
  window.androidBridge = { postMessage: () => {} };

  // 测试辅助：触发硬件返回键
  state.fireBackButton = () => {
    state.backButtonCallbacks.forEach((cb) => cb(null));
  };
})();
