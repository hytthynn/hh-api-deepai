export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const runtime = await import('./server/runtime');
    runtime.boot();
  } catch (error) {
    process.stderr.write(`instrumentation boot failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}