export async function loadAdapter() {
  return import('./adapter')
}

export function loadWithRequire() {
  return require('./adapter')
}
