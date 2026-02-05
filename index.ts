import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  atypicaWebChannelPlugin,
} from "./src/channel.js";
import { handleHistoryRequest } from "./src/history.js";
import { handleInboundRequest } from "./src/inbound.js";

const plugin = {
  id: "web-channel",
  name: "Atypica Web",
  description: "Custom web channel for Atypica app",
  register(api: OpenClawPluginApi) {
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
