/**
 * Where is this code running? Cloud Run sets `K_SERVICE` on every deployed
 * instance — but so does the Functions emulator, which additionally sets
 * `FUNCTIONS_EMULATOR=true`. Tests and local scripts set neither.
 */
export function isDeployed(): boolean {
  const hasService = typeof process.env.K_SERVICE === 'string' && process.env.K_SERVICE.length > 0;
  return hasService && process.env.FUNCTIONS_EMULATOR !== 'true';
}
