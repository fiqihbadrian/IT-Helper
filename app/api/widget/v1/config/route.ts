import { widgetJson, widgetPreflight, widgetRoute } from "@/lib/widget/cors";

/**
 * Public configuration for one channel.
 *
 * Everything here ends up in the visitor's DOM, so it holds nothing but the
 * wording and colours the widget paints with. The allow-list, the system profile
 * and the default category stay server-side.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = widgetRoute(async ({ channel }) =>
  widgetJson({
    name: channel.name,
    greeting: channel.greeting,
    accentColor: channel.accentColor,
  }),
);

export const OPTIONS = widgetPreflight;
