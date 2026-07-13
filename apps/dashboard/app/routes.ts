import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("dashboard/events", "routes/dashboard.events.ts"),
] satisfies RouteConfig;
