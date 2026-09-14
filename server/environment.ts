import { loadEnvFile } from 'node:process'

export function loadEnvironment(path = '.env') {
  try {
    loadEnvFile(path)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
}
