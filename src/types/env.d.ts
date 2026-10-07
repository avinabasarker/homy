// env.d.ts — Metro/Hermes provide `process.env` at runtime (and Expo inlines
// EXPO_PUBLIC_* from .env), but no installed type package declares it.
declare var process: {
  env: Record<string, string | undefined>;
};
