import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  atypicaWebChannelPlugin,
} from "./src/channel.js";
import { handleHistoryRequest } from "./src/history.js";
import { handleInboundRequest } from "./src/inbound.js";
import { setAtypicaRuntime } from "./src/runtime.js";

const plugin = {
  id: "web-channel",
  name: "Web Channel",
  description: "Custom web channel",
  register(api: OpenClawPluginApi) {
    setAtypicaRuntime(api.runtime);

    // Register the channel
    api.registerChannel({ plugin: atypicaWebChannelPlugin });

    // Register inbound webhook route
    api.registerHttpRoute({
      path: "/atypica/inbound",
      handler: handleInboundRequest,
    });

    // Register history query route
    api.registerHttpRoute({
      path: "/atypica/messages",
      handler: handleHistoryRequest,
    });
  },
};

export default plugin;
